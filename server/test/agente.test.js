import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Base de datos temporal, separada de la real.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-agente-'));
process.env.DATA_DIR = tmp;
delete process.env.ANTHROPIC_API_KEY;

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { seal } = await import('../src/secretbox.js');
const { monthStart } = await import('../src/agente.js');

let server;
let base;
let admin;
let cliente;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES (?, ?, ?, 'admin', 'pro247')`).run('admin@agente.test', 'Admin', hash);
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES (?, ?, ?, 'user', 'pro')`).run('ana@agente.test', 'Ana', hash);
  admin = (await call('POST', '/auth/login', { email: 'admin@agente.test', password: 'ClipViral-Prueba-2026' })).body.token;
  cliente = (await call('POST', '/auth/login', { email: 'ana@agente.test', password: 'ClipViral-Prueba-2026' })).body.token;
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const adminId = () => db.prepare("SELECT id FROM users WHERE email = 'admin@agente.test'").get().id;

test('el agente es solo para administradores', async () => {
  assert.equal((await call('GET', '/agente/estado', null, cliente)).status, 403);
  assert.equal((await call('POST', '/agente/pensar', { prompt: 'hola' }, cliente)).status, 403);
  assert.equal((await call('GET', '/agente/estado')).status, 401);
});

test('estado inicial: sin Facebook, sin página, tope de 10 USD', async () => {
  const r = await call('GET', '/agente/estado', null, admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.facebook, false);
  assert.equal(r.body.pagina, null);
  assert.equal(r.body.tope, 10);
  assert.equal(r.body.gastado, 0);
  assert.equal(r.body.ia, false);
});

test('cambiar el tope de gasto', async () => {
  assert.equal((await call('PUT', '/agente/tope', { usd: -1 }, admin)).status, 400);
  assert.equal((await call('PUT', '/agente/tope', { usd: 'mucho' }, admin)).status, 400);
  const r = await call('PUT', '/agente/tope', { usd: 7.5 }, admin);
  assert.equal(r.body.tope, 7.5);
  assert.equal((await call('GET', '/agente/estado', null, admin)).body.tope, 7.5);
});

test('elegir la página del agente entre las de la conexión de Facebook', async () => {
  assert.equal((await call('POST', '/agente/pagina', { pageId: '111' }, admin)).status, 404);
  const extra = { pageId: '111', pages: [
    { id: '111', name: 'QueJuidero', token: seal('token-pagina-1') },
    { id: '222', name: 'Página del agente', token: seal('token-pagina-2') },
  ] };
  db.prepare(`INSERT INTO social_accounts (user_id, platform, account_id, account_name, access_token, refresh_token, expires_at, extra)
    VALUES (?, 'facebook', '111', 'QueJuidero', ?, ?, ?, ?)`).run(adminId(), seal('token-pagina-1'), seal('token-pagina-1'), Date.now() + 1e12, JSON.stringify(extra));
  assert.equal((await call('POST', '/agente/token', {}, admin)).status, 404);
  assert.equal((await call('POST', '/agente/pagina', { pageId: '999' }, admin)).status, 404);
  const ok = await call('POST', '/agente/pagina', { pageId: '222' }, admin);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.pagina.name, 'Página del agente');
  const st = await call('GET', '/agente/estado', null, admin);
  assert.equal(st.body.paginas.length, 2);
  assert.equal(st.body.pagina.id, '222');
  assert.equal(JSON.stringify(st.body).includes('token-pagina'), false, 'el estado no muestra tokens');
  const tok = await call('POST', '/agente/token', {}, admin);
  assert.deepEqual(tok.body, { accessToken: 'token-pagina-2', accountId: '222', accountName: 'Página del agente' });
});

test('si la página desaparece de la conexión, se avisa', async () => {
  const row = db.prepare("SELECT extra FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(adminId());
  const extra = JSON.parse(row.extra);
  db.prepare("UPDATE social_accounts SET extra = ? WHERE user_id = ? AND platform = 'facebook'")
    .run(JSON.stringify({ ...extra, pages: extra.pages.filter((p) => p.id !== '222') }), adminId());
  const st = await call('GET', '/agente/estado', null, admin);
  assert.equal(st.body.pagina, null);
  assert.equal(st.body.paginaPerdida, true);
  assert.equal((await call('POST', '/agente/token', {}, admin)).status, 404);
  db.prepare("UPDATE social_accounts SET extra = ? WHERE user_id = ? AND platform = 'facebook'").run(row.extra, adminId());
});

test('pensar: sin clave de Claude avisa, y al llegar al tope se frena sin llamar a Claude', async () => {
  assert.equal((await call('POST', '/agente/pensar', {}, admin)).status, 400);
  const sinClave = await call('POST', '/agente/pensar', { tarea: 'idea', prompt: 'Dame una idea' }, admin);
  assert.equal(sinClave.status, 503);
  // Gasto de este mes del agente (y uno de otra cosa que no cuenta).
  const insert = db.prepare('INSERT INTO ai_usage (user_id, kind, model, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  insert.run(adminId(), 'agente:idea', 'claude-opus-5-5', 5, now);
  insert.run(adminId(), 'agente:serie', 'claude-opus-5-5', 3, now);
  insert.run(adminId(), 'pick', 'claude-opus-5-5', 50, now);
  insert.run(adminId(), 'agente:idea', 'claude-opus-5-5', 40, '2020-01-15 10:00:00'); // otro mes
  const st = await call('GET', '/agente/estado', null, admin);
  assert.equal(st.body.gastado, 8);
  const r = await call('POST', '/agente/pensar', { tarea: 'idea', prompt: 'Dame una idea' }, admin);
  assert.equal(r.status, 402);
  assert.equal(r.body.tope, true);
  assert.match(r.body.error, /tope de gasto/);
});

test('monthStart usa el primer día del mes', () => {
  assert.equal(monthStart(new Date('2026-11-16T12:00:00Z')), '2026-11-01 00:00:00');
  assert.equal(monthStart(new Date('2027-01-01T00:00:00Z')), '2027-01-01 00:00:00');
});
