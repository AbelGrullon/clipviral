// Clave de Claude puesta desde el panel o la app: se prueba sin costo, se guarda cifrada y se usa al momento.
// Claude está simulado: ninguna prueba llama a la API real ni gasta dinero.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-clave-'));
process.env.DATA_DIR = tmp;
process.env.SECRET_KEY = 'clave-de-prueba';
delete process.env.ANTHROPIC_API_KEY;

const GOOD = new Set(['sk-ant-api03-buena-AAAAAAAAAAAAAAAAAAAA-1111', 'sk-ant-api03-otra-BBBBBBBBBBBBBBBBBBBBB-2222', 'sk-ant-api03-env-CCCCCCCCCCCCCCCCCCCCCCC-3333']);
const anthropicCalls = [];
let messagesReply = null; // si no es null, /v1/messages responde con este error
let offline = false;

// Simulamos a Claude: lista de modelos (gratis) y mensajes.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith('https://api.anthropic.com/')) return realFetch(url, init);
  if (offline) throw new TypeError('fetch failed');
  const req = new Request(url, init);
  // Según la versión, el SDK manda la clave como x-api-key o como "Authorization: Bearer".
  const key = req.headers.get('x-api-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || null;
  const pathname = new URL(u).pathname;
  anthropicCalls.push({ path: pathname, key });
  const error = (status, type, message) => Response.json({ type: 'error', error: { type, message } }, { status, headers: { 'request-id': 'req_prueba' } });
  if (!GOOD.has(key)) return error(401, 'authentication_error', 'invalid x-api-key');
  if (pathname === '/v1/models') {
    return Response.json({ data: [{ type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-haiku-5-5', last_id: 'claude-haiku-5-5' });
  }
  if (pathname === '/v1/messages') {
    if (messagesReply) return error(...messagesReply);
    return Response.json({
      id: 'msg_prueba', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ candidates: [{ start: 10, end: 40, score: 8, reason: 'Momento gracioso' }] }) }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  }
  return error(404, 'not_found_error', 'no existe');
};

const { app } = await import('../src/index.js');
const { db, getSetting, setSetting } = await import('../src/db.js');
const { hashPassword, createSession } = await import('../src/auth.js');
const { cleanKey, keyFormatError } = await import('../src/clave.js');

let server;
let base;
let adminToken;
let userToken;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  // El dueño del servidor: admin que usa la clave del servidor.
  const admin = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, clave_servidor) VALUES ('amigo@clipviral.test', 'Amigo', ?, 'admin', 'pro247', 1)`).run(hash);
  const user = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES ('cliente@clipviral.test', 'Cliente', ?, 'user', 'pro')`).run(hash);
  adminToken = createSession(admin.lastInsertRowid, 'prueba');
  userToken = createSession(user.lastInsertRowid, 'prueba');
});
after(() => {
  server.close();
  db.close();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, url, body, token = adminToken) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const scan = (token = adminToken) => call('POST', '/ai/scan', { windowSeconds: 600, windowStart: 0, transcript: [{ t: 12, text: 'jajaja no puede ser' }] }, token);
const lastMessagesKey = () => anthropicCalls.filter((c) => c.path === '/v1/messages').at(-1)?.key;

test('sin clave: la IA está apagada y el admin ve qué falta', async () => {
  const health = await call('GET', '/health', null, null);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.ai, false);
  assert.equal(health.body.api, 4);
  assert.equal(health.body.publica, true);
  assert.match(health.body.copia, /^[0-9a-f]{12}$/);
  const st = await call('GET', '/admin/claude');
  assert.equal(st.status, 200);
  assert.equal(st.body.enabled, false);
  assert.equal(st.body.source, null);
  assert.equal(st.body.masked, '');
  const ia = await scan();
  assert.equal(ia.status, 503);
  assert.match(ia.body.error, /Ajustes → Clave de Claude/);
  assert.equal((await call('GET', '/me')).body.info.aiEnabled, false);
});

test('solo el administrador puede ver o cambiar la clave', async () => {
  assert.equal((await call('GET', '/admin/claude', null, userToken)).status, 403);
  assert.equal((await call('PUT', '/admin/claude', { key: [...GOOD][0] }, userToken)).status, 403);
  assert.equal((await call('DELETE', '/admin/claude', null, null)).status, 401);
});

test('limpia lo que se cuela al pegar y frena errores obvios sin preguntarle a Claude', async () => {
  assert.equal(cleanKey('  "sk-ant-api03-abc\r\n def"  '), 'sk-ant-api03-abcdef');
  assert.match(keyFormatError(''), /Pega tu clave/);
  assert.match(keyFormatError('hola'), /no parece una clave/);
  assert.match(keyFormatError('sk-ant-admin01-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'), /administración/);
  assert.match(keyFormatError('••••••1111'), /completa/);
  assert.equal(keyFormatError([...GOOD][0]), null);

  const before = anthropicCalls.length;
  const r = await call('PUT', '/admin/claude', { key: 'mi correo es amigo@gmail.com' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no parece una clave/);
  assert.equal(anthropicCalls.length, before, 'no debe llamar a Claude por un error obvio');
});

test('una clave que Claude rechaza no se guarda y el mensaje lo explica', async () => {
  const r = await call('PUT', '/admin/claude', { key: 'sk-ant-api03-mala-ZZZZZZZZZZZZZZZZZZZZZZZZ-9999' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no es válida/);
  assert.deepEqual(anthropicCalls.at(-1), { path: '/v1/models', key: 'sk-ant-api03-mala-ZZZZZZZZZZZZZZZZZZZZZZZZ-9999' });
  assert.equal(getSetting('anthropic_api_key'), '');
  assert.equal((await call('GET', '/health', null, null)).body.ai, false);
});

test('sin internet avisa que no pudo probarla', async () => {
  offline = true;
  try {
    const r = await call('PUT', '/admin/claude', { key: [...GOOD][0] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /internet/);
  } finally {
    offline = false;
  }
});

test('una clave buena se prueba gratis, se guarda cifrada y la IA se activa sin reiniciar', async () => {
  const key = [...GOOD][0];
  const r = await call('PUT', '/admin/claude', { key: `  ${key}\n` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: true, source: 'panel', masked: '••••••1111', hasEnv: false, unreadable: false });
  // Solo se usó la lista de modelos (no cuesta) para probarla.
  assert.deepEqual(anthropicCalls.at(-1), { path: '/v1/models', key });

  const stored = getSetting('anthropic_api_key');
  assert.ok(stored && !stored.includes(key) && !stored.includes('1111'), 'en la base queda cifrada');
  // El panel nunca recibe la clave completa.
  assert.ok(!JSON.stringify((await call('GET', '/admin/settings')).body).includes(key));

  assert.equal((await call('GET', '/health', null, null)).body.ai, true);
  assert.equal((await call('GET', '/me')).body.info.aiEnabled, true);
  const ia = await scan();
  assert.equal(ia.status, 200);
  assert.equal(ia.body.candidates.length, 1);
  assert.equal(lastMessagesKey(), key);
});

test('plan Claude: el cliente usa SU clave, nunca la del servidor', async () => {
  // La del servidor está puesta (prueba anterior), pero el cliente no tiene la suya: no puede usar la IA.
  const sin = await scan(userToken);
  assert.equal(sin.status, 503);
  assert.match(sin.body.error, /Falta tu clave de Claude/);
  assert.equal((await call('GET', '/me', null, userToken)).body.info.aiEnabled, false);
  // Pone la suya (se prueba gratis) y queda cifrada en su cuenta.
  const mine = [...GOOD][2];
  const r = await call('PUT', '/me/claude', { key: mine }, userToken);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: true, masked: '••••••3333', own: true, server: false, puedeServidor: false, unreadable: false });
  const row = db.prepare("SELECT claude_key FROM users WHERE email = 'cliente@clipviral.test'").get();
  assert.ok(row.claude_key && !row.claude_key.includes(mine));
  assert.equal((await scan(userToken)).status, 200);
  assert.equal(lastMessagesKey(), mine, 'el cliente gasta de su cuenta de Claude');
  // El admin sigue usando la del servidor.
  assert.equal((await scan()).status, 200);
  assert.equal(lastMessagesKey(), [...GOOD][0]);
  // El cliente no puede tocar la clave del servidor.
  assert.equal((await call('PUT', '/admin/claude', { key: mine }, userToken)).status, 403);
  assert.equal((await call('DELETE', '/me/claude', null, userToken)).body.enabled, false);
});

test('otro admin: sin permiso no gasta tu clave; puede poner la suya, o tú le das permiso en el panel', async () => {
  const hash = await hashPassword('ClipViral-Prueba-2026');
  const otro = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES ('socio@clipviral.test', 'Socio', ?, 'user', 'pro247')`).run(hash);
  const otroId = Number(otro.lastInsertRowid);
  const otroToken = createSession(otroId, 'prueba');
  // Lo haces admin en el panel: NO usa tu clave hasta que se lo permitas.
  assert.equal((await call('PATCH', `/admin/users/${otroId}`, { role: 'admin' })).status, 200);
  let st = (await call('GET', '/me/claude', null, otroToken)).body;
  assert.deepEqual(st, { enabled: false, masked: '', own: false, server: false, puedeServidor: false, unreadable: false });
  assert.equal((await scan(otroToken)).status, 503);
  assert.equal((await call('GET', '/me', null, otroToken)).body.info.aiEnabled, false);

  // Pone su propia clave en la app: gasta de SU cuenta.
  const suya = [...GOOD][2];
  assert.equal((await call('PUT', '/me/claude', { key: suya }, otroToken)).status, 200);
  assert.equal((await scan(otroToken)).status, 200);
  assert.equal(lastMessagesKey(), suya);

  // Le das permiso en el panel: con su clave puesta, sigue usando la suya.
  let fila = (await call('GET', '/admin/users?q=socio')).body.users[0];
  assert.equal(fila.claveServidor, false);
  assert.equal(fila.clavePropia, true);
  assert.equal((await call('PATCH', `/admin/users/${otroId}`, { claveServidor: true })).status, 200);
  assert.equal((await scan(otroToken)).status, 200);
  assert.equal(lastMessagesKey(), suya);
  st = (await call('GET', '/me/claude', null, otroToken)).body;
  assert.equal(st.own, true);
  assert.equal(st.puedeServidor, true);

  // Quita la suya: ahora usa la del servidor (tiene permiso).
  st = (await call('DELETE', '/me/claude', null, otroToken)).body;
  assert.equal(st.server, true);
  assert.equal(st.enabled, true);
  assert.equal((await scan(otroToken)).status, 200);
  assert.equal(lastMessagesKey(), [...GOOD][0]);

  // Le quitas el permiso: ya no gasta tu clave.
  assert.equal((await call('PATCH', `/admin/users/${otroId}`, { claveServidor: false })).status, 200);
  assert.equal((await scan(otroToken)).status, 503);
  fila = (await call('GET', '/admin/users?q=socio')).body.users[0];
  assert.equal(fila.claveServidor, false);
});

test('al cambiar la clave, la siguiente llamada ya usa la nueva', async () => {
  const other = [...GOOD][1];
  assert.equal((await call('PUT', '/admin/claude', { key: other })).status, 200);
  assert.equal((await scan()).status, 200);
  assert.equal(lastMessagesKey(), other);
});

test('si la cuenta de Claude se queda sin saldo o la clave deja de servir, el mensaje lo dice', async () => {
  try {
    messagesReply = [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'];
    let ia = await scan();
    assert.equal(ia.status, 502);
    assert.match(ia.body.error, /no tiene saldo/);
    messagesReply = [401, 'authentication_error', 'invalid x-api-key'];
    ia = await scan();
    assert.match(ia.body.error, /dejó de funcionar/);
    messagesReply = [500, 'api_error', 'algo falló'];
    ia = await scan();
    assert.match(ia.body.error, /no respondió/);
  } finally {
    messagesReply = null;
  }
});

test('la del .env sirve de respaldo y la guardada desde el panel tiene prioridad', async () => {
  const envKey = [...GOOD][2];
  process.env.ANTHROPIC_API_KEY = envKey;
  try {
    let st = (await call('GET', '/admin/claude')).body;
    assert.equal(st.source, 'panel');
    assert.equal(st.hasEnv, true);

    st = (await call('DELETE', '/admin/claude')).body;
    assert.deepEqual(st, { enabled: true, source: 'env', masked: '••••••3333', hasEnv: true, unreadable: false });
    assert.equal((await scan()).status, 200);
    assert.equal(lastMessagesKey(), envKey);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
  const st = (await call('GET', '/admin/claude')).body;
  assert.equal(st.enabled, false);
  assert.equal((await call('GET', '/health', null, null)).body.ai, false);
});

test('si la clave guardada no se puede leer (se perdió secret.key), avisa y no se rompe', async () => {
  setSetting('anthropic_api_key', 'esto.no.sirve');
  const st = (await call('GET', '/admin/claude')).body;
  assert.equal(st.enabled, false);
  assert.equal(st.unreadable, true);
  assert.equal((await scan()).status, 503);
  // Al guardar una nueva, vuelve a funcionar.
  assert.equal((await call('PUT', '/admin/claude', { key: [...GOOD][0] })).body.unreadable, false);
  assert.equal((await call('GET', '/health', null, null)).body.ai, true);
});
