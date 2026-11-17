// "Iniciar ClipViral.bat": asistente de primera vez, saludo, estado del puerto y copia limpia para un amigo.
// Todo corre en carpetas temporales: no toca tu base, tu sesión de la app ni tu clave.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import { teclas, errorNombre, errorCorreo, errorClave, hace, saludoDelDia } from '../scripts/asistente.js';
import { prohibido, archivosDeLaCopia, revisarCopia, INCLUIR } from '../scripts/preparar-copia.js';
import { idCopia } from '../src/copia.js';

const SERVER = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-arranque-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Corre un script de server/scripts con las respuestas por tubería, en una carpeta de datos aparte. */
function correr(script, args, entrada, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, DATA_DIR: path.join(tmp, 'datos'), CLIPVIRAL_PERFIL: path.join(tmp, 'perfil'), SECRET_KEY: 'prueba', NO_COLOR: '1', ...extraEnv };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER, 'scripts', script), ...args], { env, cwd: SERVER });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.stdin.end(entrada);
    child.on('exit', (code) => resolve({ code, out }));
  });
}

test('contraseña oculta: letras, borrar, pegar, flechas, Enter y Ctrl+C', () => {
  let r = teclas('', 'abc');
  assert.deepEqual(r, { valor: 'abc', eco: '***', fin: null });
  r = teclas(r.valor, '\b');
  assert.deepEqual(r, { valor: 'ab', eco: '\b \b', fin: null });
  r = teclas(r.valor, '\u001b[A'); // flecha arriba: no cambia nada
  assert.equal(r.valor, 'ab');
  r = teclas(r.valor, 'sk-ant-pegado\r\n'); // pegar con salto de línea al final
  assert.deepEqual(r, { valor: 'absk-ant-pegado', eco: '*************', fin: 'listo' });
  assert.equal(teclas('x', '\u0003').fin, 'cancelar');
  assert.equal(teclas('', '\b').valor, '');
  assert.equal(teclas('ñandú', '\u007f').valor, 'ñand');
  assert.equal(teclas('hola', '\u0015').valor, '');
  assert.equal(teclas('', '\t').valor, '');
});

test('validaciones del asistente y frases amables', () => {
  assert.ok(errorNombre('A'));
  assert.equal(errorNombre('José Pérez'), null);
  assert.ok(errorCorreo('pepe'));
  assert.equal(errorCorreo('pepe@gmail.com'), null);
  assert.ok(errorClave('1234567'));
  assert.equal(errorClave('12345678'), null);
  const ahora = new Date(2026, 10, 6, 15, 0, 0);
  const sql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  assert.equal(hace(sql(new Date(2026, 10, 6, 9, 0, 0)), ahora), 'hoy');
  assert.equal(hace(sql(new Date(2026, 10, 5, 12, 0, 0)), ahora), 'ayer');
  assert.equal(hace(sql(new Date(2026, 10, 1, 12, 0, 0)), ahora), 'hace 5 días');
  assert.equal(hace(null), null);
  assert.equal(saludoDelDia(8), 'Buenos días');
  assert.equal(saludoDelDia(15), 'Buenas tardes');
  assert.equal(saludoDelDia(21), 'Buenas noches');
});

test('primera vez: crea el admin, corrige errores y deja la app con la sesión iniciada', async () => {
  const respuestas = ['Ñandú Amigo', 'no-es-correo', 'Amigo@ClipViral.test', 'corta', 'Prueba-12345', 'distinta-123', 'Prueba-12345', 'Prueba-12345', '', 'n', ''].join('\n');
  const { code, out } = await correr('asistente.js', [], respuestas, { CLIPVIRAL_NOMBRE_EN: path.join(tmp, 'nombre.txt') });
  assert.equal(code, 0, out);
  assert.match(out, /Ese correo no parece válido/);
  assert.match(out, /al menos 8/);
  assert.match(out, /No son iguales/);
  assert.match(out, /¡Listo, Ñandú! Tu cuenta de administrador está creada/);
  assert.match(out, /modo Local/);
  assert.ok(!out.includes('Prueba-12345'), 'la contraseña nunca se muestra');
  assert.equal(fs.readFileSync(path.join(tmp, 'nombre.txt'), 'utf8'), 'Ñandú');

  const db = new DatabaseSync(path.join(tmp, 'datos', 'clipviral.db'));
  const user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.email, 'amigo@clipviral.test');
  assert.equal(user.role, 'admin');
  // La app entra sola: el token guardado en el perfil es una sesión válida de ese usuario.
  const sesion = JSON.parse(fs.readFileSync(path.join(tmp, 'perfil', 'sesion.json'), 'utf8'));
  assert.equal(sesion.email, 'amigo@clipviral.test');
  const hash = crypto.createHash('sha256').update(sesion.token).digest('hex');
  assert.equal(db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(hash)?.user_id, user.id);
  db.close();
  // Recuerda dónde está ClipViral (por si copian el .bat al escritorio).
  assert.equal(fs.readFileSync(path.join(tmp, 'perfil', 'carpeta.txt'), 'utf8'), `${path.resolve(SERVER, '..')}${path.sep}`);
});

test('las veces siguientes saluda por el nombre y avisa que falta la clave de Claude', async () => {
  const { code, out } = await correr('asistente.js', [], '');
  assert.equal(code, 0, out);
  assert.match(out, /(Buenos días|Buenas tardes|Buenas noches), Ñandú!/);
  assert.match(out, /falta tu clave de Claude/);
  assert.ok(!out.includes('Bienvenido'));
});

test('si la persona cierra a medias, sale con 2 y no crea nada', async () => {
  const datos = path.join(tmp, 'otra-base');
  const { code, out } = await correr('asistente.js', [], 'Pepe\n', { DATA_DIR: datos, CLIPVIRAL_PERFIL: path.join(tmp, 'otro-perfil') });
  assert.equal(code, 2, out);
  assert.match(out, /Cancelado/);
  const db = new DatabaseSync(path.join(datos, 'clipviral.db'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  db.close();
  assert.ok(!fs.existsSync(path.join(tmp, 'otro-perfil', 'sesion.json')));
});

test('estado del puerto: libre, este servidor, uno viejo, otra copia u otro programa', async () => {
  const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
  const health = (body) => http.createServer((req, res) => res.end(JSON.stringify(body)));
  const servers = [
    health({ ok: true, ai: false, api: 3, copia: idCopia(SERVER) }),
    health({ ok: true, ai: true, api: 2, copia: idCopia(SERVER) }),
    health({ ok: true, ai: false, api: 3, copia: 'de-otra-copia' }),
    net.createServer((s) => s.end()),
  ];
  const ports = [];
  for (const s of servers) ports.push(await listen(s));
  // Un puerto que estuvo libre hace un instante.
  const probe = net.createServer();
  const free = await listen(probe);
  await new Promise((r) => probe.close(r));
  try {
    const estado = async (port) => (await correr('estado-servidor.js', [String(port)], '')).out.trim();
    assert.equal(await estado(ports[0]), 'nuevo');
    assert.equal(await estado(ports[1]), 'viejo');
    assert.equal(await estado(ports[2]), 'otra');
    assert.equal(await estado(ports[3]), 'ocupado');
    assert.equal(await estado(free), 'libre');
  } finally {
    servers.forEach((s) => s.close());
  }
});

test('copia para un amigo: solo el programa, nunca datos, claves ni node_modules', () => {
  for (const rel of ['server/.env', 'server/data/clipviral.db', 'server/data/secret.key', 'server/servidor.log', 'desktop/node_modules/x.js',
    'server/test/api.test.js', 'clips-de-prueba/a.mp4', 'desktop/captura.png', 'perfil/sesion.json']) {
    assert.equal(prohibido(rel), true, rel);
  }
  for (const rel of ['server/.env.example', 'server/src/index.js', 'Iniciar ClipViral.bat', 'desktop/build/icon.ico']) assert.equal(prohibido(rel), false, rel);

  const files = archivosDeLaCopia();
  for (const must of ['Iniciar ClipViral.bat', 'LEEME - EMPIEZA AQUI.txt', 'server/.env.example', 'server/src/clave.js', 'server/scripts/asistente.js',
    'desktop/main.js', 'desktop/renderer/app.js', 'desktop/build/icon.ico']) {
    assert.ok(files.includes(must), `falta ${must}`);
  }
  assert.ok(files.every((f) => INCLUIR.some((inc) => f === inc || f.startsWith(`${inc}/`))));
  assert.ok(!files.some((f) => /(^|\/)(\.env|data|node_modules)(\/|$)/.test(f) || f.endsWith('.db')));
  assert.ok(!files.includes('Preparar copia para un amigo.bat'), 'el amigo no necesita el armador de copias');
});

test('la copia se frena si algún archivo trae una clave de Claude o un dato tuyo', () => {
  const dir = path.join(tmp, 'revisar');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'limpio.js'), "const ejemplo = 'sk-ant-...';");
  fs.writeFileSync(path.join(dir, 'src', 'clave.js'), `const k = 'sk-ant-api03-${'A'.repeat(90)}';`);
  fs.writeFileSync(path.join(dir, 'src', 'correo.md'), 'Escríbeme a mi.correo@ejemplo.com');
  const problemas = revisarCopia(dir, ['src/limpio.js', 'src/clave.js', 'src/correo.md'], ['mi.correo@ejemplo.com']);
  assert.equal(problemas.length, 2);
  assert.match(problemas[0], /clave\.js: parece tener una clave de Claude/);
  assert.match(problemas[1], /correo\.md: tiene un dato tuyo/);
  assert.ok(!problemas.join(' ').includes('mi.correo@ejemplo.com'), 'el aviso no repite el dato completo');
});

test('crear-admin sigue funcionando desde la consola', async () => {
  const datos = path.join(tmp, 'cli');
  let r = await correr('crear-admin.js', ['jefe@clipviral.test', 'corta'], '', { DATA_DIR: datos });
  assert.equal(r.code, 1);
  r = await correr('crear-admin.js', ['jefe@clipviral.test', 'Prueba-12345', 'Jefe'], '', { DATA_DIR: datos });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /se creó el administrador/);
  r = await correr('crear-admin.js', ['JEFE@clipviral.test', 'Otra-12345'], '', { DATA_DIR: datos });
  assert.match(r.out, /ahora es administrador/);
});
