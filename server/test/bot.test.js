import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base de datos temporal, separada de la real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
process.env.DATA_DIR = tmp;
delete process.env.DISCORD_BOT_CLAVE;

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { fechaIso, ARCHIVO_CLAVE_BOT } = await import('../src/routes/bot.js');

const CLAVE = 'clave-de-prueba-del-bot-0123456789abcdef';
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/bot`;
  const id = db.prepare(`INSERT INTO users (email, name, pass_hash, plan, plan_expires, last_login) VALUES (?, ?, 'x', 'pro', '2099-01-01T00:00:00.000Z', '2026-11-18 19:00:00')`)
    .run('ana@clipviral.test', 'Ana Pérez').lastInsertRowid;
  db.prepare(`INSERT INTO payments (user_id, order_id, plan, amount, status) VALUES (?, 'o1', 'pro', 30, 'pagado'), (?, 'o2', 'pro', 30, 'pagado'), (?, 'o3', 'pro', 30, 'creado')`).run(id, id, id);
  db.prepare(`INSERT INTO clip_events (user_id) VALUES (?), (?)`).run(id, id);
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const pedir = async (ruta, clave) => {
  const res = await fetch(base + ruta, { headers: clave ? { 'x-bot-clave': clave } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('sin clave del bot guardada, las rutas del bot no existen', async () => {
  assert.equal((await pedir('/estado', CLAVE)).status, 404);
});

test('con la clave en DATA_DIR: clave equivocada 401, la buena entra (sin reiniciar el servidor)', async () => {
  fs.writeFileSync(path.join(tmp, ARCHIVO_CLAVE_BOT), `${CLAVE}\n`);
  assert.equal((await pedir('/estado')).status, 401);
  assert.equal((await pedir('/estado', 'otra-clave-cualquiera-0123456789')).status, 401);
  const r = await pedir('/estado', CLAVE);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('busca la cuenta por correo (sin importar mayúsculas) y no devuelve la contraseña', async () => {
  const r = await pedir(`/cliente?correo=${encodeURIComponent('  ANA@ClipViral.test ')}`, CLAVE);
  assert.equal(r.status, 200);
  assert.equal(r.body.encontrada, true);
  assert.equal(r.body.nombre, 'Ana Pérez');
  assert.equal(r.body.correo, 'ana@clipviral.test');
  assert.equal(r.body.plan.activo, true);
  assert.equal(r.body.plan.vencido, false);
  assert.equal(r.body.pagos, 2, 'solo cuenta los pagos hechos');
  assert.equal(r.body.pagado, 60);
  assert.equal(r.body.clips, 2);
  assert.equal(r.body.ultimaEntrada, '2026-11-18T19:00:00Z');
  assert.ok(!JSON.stringify(r.body).includes('pass_hash'));
  assert.equal(r.body.pass_hash, undefined);
});

test('correo sin cuenta o mal escrito', async () => {
  assert.deepEqual((await pedir('/cliente?correo=nadie%40clipviral.test', CLAVE)).body, { encontrada: false });
  assert.equal((await pedir('/cliente?correo=sin-arroba', CLAVE)).status, 400);
  assert.equal((await pedir('/cliente', CLAVE)).status, 400);
});

test('DISCORD_BOT_CLAVE en el .env manda sobre el archivo', async () => {
  process.env.DISCORD_BOT_CLAVE = 'clave-del-env-0123456789abcdefghij';
  try {
    assert.equal((await pedir('/estado', CLAVE)).status, 401);
    assert.equal((await pedir('/estado', process.env.DISCORD_BOT_CLAVE)).status, 200);
  } finally {
    delete process.env.DISCORD_BOT_CLAVE;
  }
});

test('fechas de SQLite pasan a ISO con zona', () => {
  assert.equal(fechaIso('2026-11-18 19:00:00'), '2026-11-18T19:00:00Z');
  assert.equal(fechaIso('2026-12-01T10:00:00.000Z'), '2026-12-01T10:00:00.000Z');
  assert.equal(fechaIso(null), null);
});
