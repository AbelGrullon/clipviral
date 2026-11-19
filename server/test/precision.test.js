// Precisión de Claude (normal, alta, máxima) y clips pedidos por el streamer ("saca ese clip").
// Claude está simulado: ninguna prueba llama a la API real ni gasta dinero.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-precision-'));
process.env.DATA_DIR = tmp;
process.env.SECRET_KEY = 'clave-de-prueba';
process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-prueba-AAAAAAAAAAAAAAAAAAAA-1111';

const sent = []; // lo que la app le mandó a Claude en cada consulta
const red = { titulo: 'T', gancho: 'G', descripcion: 'D', hashtags: ['#a'] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith('https://api.anthropic.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  sent.push(body);
  const system = String(body.system || '');
  let data = { candidates: [] };
  if (system.includes('editor jefe')) {
    data = { clips: [{ id: '1', start: 45, end: 74, title: 'Se cayó del puente', hashtags: ['#fail'], description: 'd', score: 9, reason: 'r',
      redes: { tiktok: red, instagram: red, youtube: red, facebook: red } }] };
  } else if (system.includes('cortes saltados')) {
    data = { partes: [{ inicio: 0, fin: 30 }], resumen: 'Dejé lo mejor' };
  }
  return Response.json({
    id: 'msg_prueba', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    usage: { input_tokens: 1000, output_tokens: 200 },
  });
};

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { hashPassword, createSession } = await import('../src/auth.js');
const { precisionOf, PRECISION, HAIKU, SONNET, OPUS } = await import('../src/claude.js');

let server;
let base;
let token;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  const admin = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, clave_servidor) VALUES ('dueno@clipviral.test', 'Dueño', ?, 'admin', 'pro247', 1)`).run(hash);
  token = createSession(admin.lastInsertRowid, 'prueba');
});
after(() => {
  server.close();
  db.close();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (url, body) => {
  const res = await fetch(base + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const userText = (b) => (typeof b.messages[0].content === 'string' ? b.messages[0].content : b.messages[0].content.map((c) => c.text || '').join('\n'));

test('precisionOf: solo acepta normal, alta y maxima', () => {
  assert.equal(precisionOf('alta'), 'alta');
  assert.equal(precisionOf('maxima'), 'maxima');
  for (const raro of [undefined, '', 'MAXIMA', 'opus', '__proto__', 'toString', 3]) assert.equal(precisionOf(raro), 'normal');
  assert.deepEqual(PRECISION.normal, { scan: [HAIKU, 'low'], pick: [SONNET, 'low'], trim: [SONNET, 'low'] });
});

test('barrido: Haiku en normal y alta, Sonnet en máxima', async () => {
  const tramo = { windowSeconds: 600, windowStart: 0, transcript: [{ t: 12, text: 'jajaja no puede ser' }] };
  for (const [precision, model] of [[undefined, HAIKU], ['alta', HAIKU], ['maxima', SONNET]]) {
    sent.length = 0;
    const r = await call('/ai/scan', { ...tramo, precision });
    assert.equal(r.status, 200);
    assert.equal(sent[0].model, model, `precisión ${precision}`);
  }
});

test('elegir clips: Opus en alta, y el pedido del streamer llega marcado', async () => {
  sent.length = 0;
  const r = await call('/ai/pick', {
    title: 'Directo', clipSeconds: 30, precision: 'alta', maxClips: 5,
    candidates: [{ id: '1', start: 28, end: 76, score: 10, reason: 'El streamer pidió este clip',
      pedido: { quien: 'streamer', frase: 'saca ese clip', t: 73 }, transcript: [{ t: 70, text: 'se cayó del puente jajaja saca ese clip' }] }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.clips[0].title, 'Se cayó del puente');
  assert.equal(sent[0].model, OPUS);
  assert.equal(sent[0].output_config.effort, 'medium');
  assert.match(userText(sent[0]), /PEDIDO POR EL STREAMER: "saca ese clip" en el segundo 73/);
  assert.match(String(sent[0].system), /justo ANTES del pedido/);
  // El costo se anota con el modelo que de verdad respondió.
  const usage = db.prepare("SELECT model FROM ai_usage WHERE kind = 'pick' ORDER BY id DESC LIMIT 1").get();
  assert.equal(usage.model, OPUS);
});

test('elegir clips sin precisión: Sonnet, como siempre', async () => {
  sent.length = 0;
  const r = await call('/ai/pick', { candidates: [{ id: '1', start: 1, end: 30, transcript: [{ t: 1, text: 'hola' }] }] });
  assert.equal(r.status, 200);
  assert.equal(sent[0].model, SONNET);
  assert.doesNotMatch(userText(sent[0]), /PEDIDO POR/);
});

test('recorte para una red: Opus en alta', async () => {
  sent.length = 0;
  const r = await call('/ai/recorte', { titulo: 'Clip', duracion: 60, maximo: 39, red: 'instagram', precision: 'alta', frases: [{ s: 0, e: 2, texto: 'hola' }] });
  assert.equal(r.status, 200);
  assert.equal(sent[0].model, OPUS);
  assert.deepEqual(r.body.partes, [{ inicio: 0, fin: 30 }]);
});
