// Servidor central (VPS): la primera cuenta es la del administrador, días de prueba (0 = sin prueba),
// dar acceso de administrador y publicar una versión que las apps ven y descargan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-central-'));
process.env.DATA_DIR = tmp;
delete process.env.EDICION;
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../src/index.js');
const { db, setSetting } = await import('../src/db.js');
const { siguienteVersion, limpiarDireccion, ponerVersion, OCUPADO_RE } = await import('../scripts/publicar-version.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => {
  server.close();
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const registrar = (name, email) => call('POST', '/auth/register', { name, email, password: 'Clave-segura-1', acceptTerms: true });

let admin;
let cliente;

test('la primera cuenta de un servidor nuevo es administrador, sin vencer', async () => {
  const r = await registrar('Dueño', 'dueno@clipviral.test');
  assert.equal(r.status, 201);
  admin = r.body.token;
  const me = await call('GET', '/me', null, admin);
  assert.equal(me.body.user.role, 'admin');
  assert.equal(me.body.user.plan.active, true);
  assert.equal(db.prepare("SELECT clave_servidor FROM users WHERE email = 'dueno@clipviral.test'").get().clave_servidor, 1, 'el dueño usa la clave del servidor');
});

test('con 0 días de prueba, la cuenta nueva nace sin plan activo', async () => {
  setSetting('trial_days', '0');
  const r = await registrar('Cliente', 'cliente@clipviral.test');
  assert.equal(r.status, 201);
  cliente = r.body.token;
  const me = await call('GET', '/me', null, cliente);
  assert.equal(me.body.user.role, 'user');
  assert.equal(me.body.user.plan.active, false);
  // La bienvenida se intenta igual (aquí no hay correo configurado, así que queda anotada sin enviar).
  const intento = db.prepare("SELECT kind FROM mail_log WHERE email = 'cliente@clipviral.test'").get();
  assert.equal(intento?.kind, 'bienvenida', 'con 0 días de prueba también sale la bienvenida');
});

test('el administrador da días, cambia el plan y da acceso de administrador desde el panel', async () => {
  const list = await call('GET', '/admin/users?q=cliente', null, admin);
  const id = list.body.users.find((u) => u.email === 'cliente@clipviral.test').id;
  assert.equal((await call('GET', '/admin/users', null, cliente)).status, 403);
  let r = await call('PATCH', `/admin/users/${id}`, { plan: 'pro', addDays: 30 }, admin);
  assert.equal(r.status, 200);
  let me = await call('GET', '/me', null, cliente);
  assert.equal(me.body.user.plan.active, true);
  r = await call('PATCH', `/admin/users/${id}`, { role: 'admin' }, admin);
  assert.equal(r.status, 200);
  me = await call('GET', '/me', null, cliente);
  assert.equal(me.body.user.role, 'admin');
  assert.equal((await call('GET', '/admin/users', null, cliente)).status, 200);
});

test('una versión publicada en el panel la ven y la descargan las apps', async () => {
  const exe = Buffer.from('MZ instalador de prueba');
  const form = new FormData();
  form.set('version', '1.0.5');
  form.set('notes', 'Arreglos');
  form.set('file', new Blob([exe]), 'ClipViral-Setup-1.0.5.exe');
  const up = await fetch(`${base}/admin/releases`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form });
  assert.equal(up.status, 201);
  const sinNada = await call('GET', '/updates/latest?current=1.0.5');
  assert.equal(sinNada.body.available, false);
  const hay = await call('GET', '/updates/latest?current=1.0.4');
  assert.equal(hay.body.available, true);
  assert.equal(hay.body.version, '1.0.5');
  const file = await fetch(base.replace(/\/api$/, '') + hay.body.url);
  assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), exe);
});

test('ayudas de "Publicar versión"', () => {
  assert.equal(siguienteVersion('1.0.9'), '1.0.10');
  assert.equal(limpiarDireccion('mi-vps.duckdns.org/'), 'https://mi-vps.duckdns.org');
  assert.throws(() => limpiarDireccion('https://mi-vps.duckdns.org/admin'));
  assert.equal(ponerVersion('{\n  "name": "x",\n  "version": "1.0.0",\n  "a": 1\n}', '1.0.1'), '{\n  "name": "x",\n  "version": "1.0.1",\n  "a": 1\n}');
  // El error de "archivo ocupado" de electron-builder (antivirus revisando ClipViral.exe) se reconoce para reintentar.
  assert.match("⨯ EBUSY: resource busy or locked, open 'C:\\x\\dist-instalador\\win-unpacked\\ClipViral.exe'  failedTask=build", OCUPADO_RE);
  assert.doesNotMatch('⨯ Cannot find module electron', OCUPADO_RE);
});

test('el .zip de la web: se sube en el panel y lo baja el botón "Descargar"', async () => {
  const sinZip = await fetch(base.replace(/\/api$/, '') + '/descargar', { redirect: 'manual' });
  assert.equal(sinZip.status, 302, 'sin .zip lleva a la sección de descarga');
  const noZip = new FormData();
  noZip.set('version', '1.0.5');
  noZip.set('zip', new Blob([Buffer.from('no soy zip')]), 'ClipViral-1.0.5.zip');
  const mal = await fetch(`${base}/admin/descarga`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: noZip });
  assert.equal(mal.status, 400);
  const zip = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 1)]);
  const form = new FormData();
  form.set('version', '1.0.5');
  form.set('zip', new Blob([zip]), 'ClipViral-Setup-1.0.5.zip');
  const up = await fetch(`${base}/admin/descarga`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form });
  assert.equal(up.status, 201);
  const info = await call('GET', '/admin/descarga', null, admin);
  assert.equal(info.body.descarga.version, '1.0.5');
  const dl = await fetch(base.replace(/\/api$/, '') + '/descargar');
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /ClipViral-1\.0\.5\.zip/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), zip);
  assert.equal((await call('GET', '/admin/descarga', null, admin)).body.descarga.downloads, 1);
  const otro = new FormData();
  otro.set('version', '1.0.6');
  otro.set('zip', new Blob([zip]), 'x.zip');
  await fetch(`${base}/admin/descarga`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: otro });
  const dir = path.join(tmp, 'descarga');
  assert.deepEqual(fs.readdirSync(dir), ['ClipViral-1.0.6.zip'], 'solo queda el más nuevo');
});

test('la web: inicio con planes y descarga, y la página de compra (sin WhatsApp ni pagos a mano)', async () => {
  const root = base.replace(/\/api$/, '');
  const home = await (await fetch(`${root}/`)).text();
  assert.match(home, /clips virales/i);
  assert.match(home, /href="\/descargar"/);
  assert.match(home, /Versión 1\.0\.6/);
  for (const pl of db.prepare('SELECT name FROM plans WHERE public = 1 AND price_usd > 0').all()) assert.ok(home.includes(pl.name), pl.name);
  const buy = await (await fetch(`${root}/comprar?plan=pro`)).text();
  assert.match(buy, /value="pro"[^>]*checked/);
  assert.match(buy, /\/pagos\/crear/);
  for (const page of [home, buy]) assert.doesNotMatch(page, /whatsapp|wa\.me|efectivo|transferencia/i);
  assert.equal((await fetch(`${root}/web/icono.png`)).status, 200);
  assert.equal((await fetch(`${root}/privacidad`)).status, 200, 'las páginas legales siguen');
});

test('soporte: la web y la app llevan al Discord de ClipViral (o a lo que ponga el admin)', async () => {
  const root = base.replace(/\/api$/, '');
  setSetting('support_contact', '');
  assert.match(await (await fetch(`${root}/`)).text(), /<a href="https:\/\/discord\.gg\/2k4Q3bBMh"[^>]*>Soporte<\/a>/);
  assert.equal((await call('GET', '/me', null, admin)).body.info.supportContact, 'https://discord.gg/2k4Q3bBMh');
  setSetting('support_contact', 'ayuda@clipviral.test');
  assert.match(await (await fetch(`${root}/`)).text(), /Soporte: ayuda@clipviral\.test/);
  assert.equal((await call('GET', '/me', null, admin)).body.info.supportContact, 'ayuda@clipviral.test');
  setSetting('support_contact', '');
});

test('subir el .exe una sola vez: con "web" el VPS arma el .zip de la descarga con el mismo instalador', async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(300000)]);
  const form = new FormData();
  form.set('version', '1.0.7');
  form.set('web', 'true');
  form.set('file', new Blob([exe]), 'ClipViral-Setup-1.0.7.exe');
  const up = await fetch(`${base}/admin/releases`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form });
  assert.equal(up.status, 201);
  const body = await up.json();
  assert.equal(body.descarga?.version, '1.0.7');
  assert.deepEqual(fs.readdirSync(path.join(tmp, 'descarga')), ['ClipViral-1.0.7.zip'], 'reemplaza el .zip anterior');

  const zip = Buffer.from(await (await fetch(base.replace(/\/api$/, '') + '/descargar')).arrayBuffer());
  // Un .zip válido con un solo archivo: ClipViral-Setup-1.0.7.exe, idéntico al subido.
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLen = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30, 30 + nameLen).toString(), 'ClipViral-Setup-1.0.7.exe');
  assert.equal(zip.readUInt32LE(22), exe.length);
  const data = zip.subarray(30 + nameLen, 30 + nameLen + exe.length);
  assert.deepEqual(data, exe);
  assert.equal(zip.readUInt32LE(14), zlib.crc32(exe));
  const end = zip.subarray(zip.length - 22);
  assert.equal(end.readUInt32LE(0), 0x06054b50);
  assert.equal(end.readUInt16LE(10), 1);
  assert.equal(zip.readUInt32LE(end.readUInt32LE(16)), 0x02014b50, 'el índice del .zip está donde dice');

  const sinWeb = new FormData();
  sinWeb.set('version', '1.0.8');
  sinWeb.set('file', new Blob([exe]), 'ClipViral-Setup-1.0.8.exe');
  const r = await (await fetch(`${base}/admin/releases`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: sinWeb })).json();
  assert.equal(r.descarga, undefined, 'sin la casilla, la web se queda como estaba');
  assert.equal((await call('GET', '/admin/descarga', null, admin)).body.descarga.version, '1.0.7');
});
