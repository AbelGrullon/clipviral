import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base de datos temporal, separada de la real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-test-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES (?, ?, ?, 'admin', 'pro247')`)
    .run('admin@clipviral.test', 'Admin', await hashPassword('ClipViral-Prueba-2026'));
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let userToken;
let adminToken;

test('registro exige aceptar términos', async () => {
  const r = await call('POST', '/auth/register', { name: 'Ana', email: 'ana@clipviral.test', password: '12345678' });
  assert.equal(r.status, 400);
});

test('registro crea cuenta de prueba con días gratis', async () => {
  const r = await call('POST', '/auth/register', { name: 'Ana', email: 'ana@clipviral.test', password: '12345678', acceptTerms: true });
  assert.equal(r.status, 201);
  assert.ok(r.body.token);
  assert.equal(r.body.user.plan.id, 'trial');
  assert.equal(r.body.user.plan.active, true);
  userToken = r.body.token;
});

test('no permite correo repetido', async () => {
  const r = await call('POST', '/auth/register', { name: 'Ana', email: 'ANA@clipviral.test', password: '12345678', acceptTerms: true });
  assert.equal(r.status, 409);
});

test('login con contraseña mala falla y buena funciona', async () => {
  assert.equal((await call('POST', '/auth/login', { email: 'ana@clipviral.test', password: 'mala1234' })).status, 401);
  const ok = await call('POST', '/auth/login', { email: 'admin@clipviral.test', password: 'ClipViral-Prueba-2026' });
  assert.equal(ok.status, 200);
  adminToken = ok.body.token;
});

test('/me devuelve planes públicos', async () => {
  const r = await call('GET', '/me', null, userToken);
  assert.equal(r.status, 200);
  // Solo dos planes a la venta: Local (20 USD) y Claude (30 USD, con la clave del cliente).
  assert.deepEqual(r.body.plans.map((p) => [p.id, p.priceUsd, p.usesAi]), [['local', 20, false], ['pro', 30, true]]);
  assert.equal(r.body.info.publicar, false);
  assert.equal(r.body.info.aiEnabled, false);
});

test('cliente: no puede publicar en redes ni programar', async () => {
  assert.deepEqual((await call('GET', '/social', null, userToken)).body, { platforms: [], publicar: false });
  assert.equal((await call('POST', '/social/facebook/start', {}, userToken)).status, 403);
  assert.equal((await call('POST', '/social/instagram/manual', { token: 'x' }, userToken)).status, 403);
  assert.equal((await call('POST', '/social/youtube/token', {}, userToken)).status, 403);
  assert.equal((await call('GET', '/publicaciones', null, userToken)).status, 403);
  assert.equal((await call('POST', '/social/relay', {}, userToken)).status, 403);
  const admin = await call('GET', '/me', null, adminToken);
  assert.equal(admin.body.info.publicar, true);
});

test('cliente: su propia clave de Claude (se revisa antes de guardar)', async () => {
  assert.deepEqual((await call('GET', '/me/claude', null, userToken)).body, { enabled: false, masked: '', own: false, server: false, puedeServidor: false, unreadable: false });
  const bad = await call('PUT', '/me/claude', { key: 'hola' }, userToken);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no parece una clave/);
  assert.equal((await call('DELETE', '/me/claude', null, userToken)).body.enabled, false);
});

test('usuario normal no entra al panel de admin', async () => {
  assert.equal((await call('GET', '/admin/stats', null, userToken)).status, 403);
  assert.equal((await call('GET', '/admin/stats', null)).status, 401);
});

test('admin ve estadísticas y cambia plan de usuario', async () => {
  const stats = await call('GET', '/admin/stats', null, adminToken);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.totalUsers, 2);
  const users = await call('GET', '/admin/users?q=ana', null, adminToken);
  const ana = users.body.users[0];
  const r = await call('PATCH', `/admin/users/${ana.id}`, { plan: 'pro', addDays: 30 }, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.plan, 'pro');
  assert.equal(r.body.user.planActive, true);
});

test('admin edita precio de un plan', async () => {
  const r = await call('PUT', '/admin/plans/pro', { price_usd: 35 }, adminToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.plan.price_usd, 35);
});

test('IA sin clave responde 503 claro', async () => {
  const r = await call('POST', '/ai/scan', { windowSeconds: 600, transcript: [{ t: 1, text: 'hola' }] }, userToken);
  assert.equal(r.status, 503);
  // Lo nuevo del piloto y la competencia responde igual (y pide estar conectado)
  assert.equal((await call('POST', '/ai/pick', { candidates: [{ id: '1', start: 1, end: 20 }] }, userToken)).status, 503);
  assert.equal((await call('POST', '/ai/rank', { temas: ['x'], videos: [{ id: 'a', title: 'b' }] }, userToken)).status, 503);
  assert.equal((await call('POST', '/ai/competencia', { competitors: [{ name: 'x', posts: [] }] }, userToken)).status, 503);
  assert.equal((await call('POST', '/ai/competencia', {})).status, 401);
  // Recorte para Instagram / Facebook: igual (la app entonces corta el final, como antes).
  assert.equal((await call('POST', '/ai/recorte', { duracion: 80, maximo: 39, frases: [{ s: 1, e: 2, texto: 'hola' }] }, userToken)).status, 503);
  assert.equal((await call('POST', '/ai/recorte', { duracion: 80, maximo: 39 })).status, 401);
});

test('verificador de actualizaciones', async () => {
  const none = await call('GET', '/updates/latest?current=1.0.0');
  assert.equal(none.body.available, false);
  const fake = path.join(tmp, 'releases', 'ClipViral-1.2.0.exe');
  fs.writeFileSync(fake, 'instalador de prueba');
  db.prepare(`INSERT INTO releases (version, notes, filename, original_name, size, sha256, mandatory) VALUES ('1.2.0', 'Mejoras', 'ClipViral-1.2.0.exe', 'ClipViral-1.2.0.exe', 20, 'x', 1)`).run();
  const yes = await call('GET', '/updates/latest?current=1.0.0');
  assert.equal(yes.body.available, true);
  assert.equal(yes.body.version, '1.2.0');
  assert.equal(yes.body.mandatory, true);
  const same = await call('GET', '/updates/latest?current=1.2.0');
  assert.equal(same.body.available, false);
  const dl = await fetch(base + yes.body.url.replace('/api', ''));
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), 'instalador de prueba');
});

test('admin suspende cuenta y se cierra su sesión', async () => {
  const users = await call('GET', '/admin/users?q=ana', null, adminToken);
  await call('PATCH', `/admin/users/${users.body.users[0].id}`, { banned: true }, adminToken);
  assert.equal((await call('GET', '/me', null, userToken)).status, 401);
});
