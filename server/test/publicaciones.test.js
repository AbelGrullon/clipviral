// Publicaciones programadas en el servidor: la app manda el video y el servidor publica a su hora (con la PC apagada).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-publicaciones-'));
process.env.DATA_DIR = tmp;
process.env.SECRET_KEY = 'clave-de-prueba';

const { app } = await import('../src/index.js');
const { db, setSetting } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { seal } = await import('../src/secretbox.js');
const { publisher, publishDue, cleanPostFiles, canPublish, POSTS_DIR } = await import('../src/publicaciones.js');

// Subidas simuladas: guardan con qué las llamaron. `falla` decide si una red falla y cómo.
const subidas = [];
const falla = {};
const fake = (platform) => async (opts) => {
  subidas.push({ platform, ...opts, existia: fs.existsSync(opts.file), bytes: fs.readFileSync(opts.file).length });
  if (falla[platform]) throw falla[platform]();
  if (platform === 'instagram' && opts.relay) {
    const r = await opts.relay.put(opts.file);
    subidas.at(-1).relayUrl = r.url;
    subidas.at(-1).relayServido = (await fetch(r.url.replace('https://clip.test', base))).status;
    await opts.relay.remove(r.id);
  }
  opts.onProgress?.(0.5, `Subiendo a ${platform}`);
  opts.onProgress?.(1);
  return { id: `${platform}-123`, url: `https://${platform}.test/p/123` };
};

let server;
let base;
let ana;
let beto;
let anaId;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  const exp = new Date(Date.now() + 86400000).toISOString();
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires) VALUES ('ana@clipviral.test', 'Ana', ?, 'admin', 'local', ?)`).run(hash, exp);
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires) VALUES ('beto@clipviral.test', 'Beto', ?, 'admin', 'local', ?)`).run(hash, exp);
  const login = async (email) => (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'ClipViral-Prueba-2026' }) })).json()).token;
  ana = await login('ana@clipviral.test');
  beto = await login('beto@clipviral.test');
  anaId = db.prepare("SELECT id FROM users WHERE email = 'ana@clipviral.test'").get().id;
  // Facebook conectado a su página, con el Instagram unido (se publica a través de la página).
  db.prepare(`INSERT INTO social_accounts (user_id, platform, account_id, account_name, access_token, refresh_token, expires_at, extra)
    VALUES (?, 'facebook', 'PAGE1', 'Mi Página', ?, ?, ?, ?)`)
    .run(anaId, seal('token-pagina'), seal('token-pagina'), Date.now() + 365 * 86400000,
      JSON.stringify({ igBusinessId: 'IG77', igUsername: 'ana.ig', pageId: 'PAGE1', userToken: seal('token-usuario'), userTokenExpiresAt: Date.now() + 50 * 86400000 }));
  publisher.uploaders = { facebook: fake('facebook'), instagram: fake('instagram'), youtube: fake('youtube'), tiktok: fake('tiktok') };
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, url, body, token = ana) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const video = (text) => Buffer.from(`video de prueba ${text} `.repeat(500));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sendFile = async (buf, token = ana) => {
  const res = await fetch(`${base}/api/publicaciones/archivos`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', Authorization: `Bearer ${token}` }, body: buf });
  return { status: res.status, body: await res.json() };
};
const post = (id) => db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
const fileOnDisk = (hash, userId = anaId) => fs.existsSync(path.join(POSTS_DIR, `${userId}-${hash}.mp4`));
const MIN = 60000;

test('el servidor trae el código de subida de la app', () => {
  const saved = publisher.uploaders;
  publisher.uploaders = null;
  try { assert.equal(canPublish(), true, 'carga desktop/engine/redes.js'); } finally { publisher.uploaders = saved; }
});

test('programar en el servidor: el video se manda una vez y se publica a su hora con el token de la página', async () => {
  const buf = video('uno');
  const hash = sha(buf);
  assert.equal((await call('GET', `/api/publicaciones/archivos/${hash}`)).body.exists, false);
  const up = await sendFile(buf);
  assert.equal(up.status, 200);
  assert.equal(up.body.hash, hash, 'el servidor calcula la misma huella');
  assert.equal(up.body.size, buf.length);
  assert.equal((await call('GET', `/api/publicaciones/archivos/${hash}`)).body.exists, true);
  // Beto no ve el video de Ana.
  assert.equal((await call('GET', `/api/publicaciones/archivos/${hash}`, null, beto)).body.exists, false);

  const at = Date.now() + 30 * MIN;
  const r = await call('POST', '/api/publicaciones', { clientId: 'job-1', platform: 'facebook', fileHash: hash, title: 'Mi clip', caption: 'Texto #viral', duration: 30, scheduledAt: at });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pendiente');
  assert.equal(r.body.scheduledAt, at);
  // Si la app repite el pedido, no se crea otra.
  assert.equal((await call('POST', '/api/publicaciones', { clientId: 'job-1', platform: 'facebook', fileHash: hash })).body.id, r.body.id);

  // Antes de la hora no se publica.
  await publishDue();
  assert.equal(subidas.length, 0);
  assert.equal(post(r.body.id).status, 'pendiente');

  // A la hora: se publica.
  db.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').run(Date.now() - 1000, r.body.id);
  await publishDue();
  assert.equal(subidas.length, 1);
  const s = subidas[0];
  assert.equal(s.platform, 'facebook');
  assert.equal(s.token, 'token-pagina');
  assert.equal(s.accountId, 'PAGE1');
  assert.equal(s.caption, 'Texto #viral');
  assert.equal(s.title, 'Mi clip');
  assert.equal(s.duration, 30);
  assert.equal(s.bytes, buf.length, 'sube el mismo video que mandó la app');
  assert.equal(s.relay, null, 'sin https no hay enlace público para Instagram');

  const done = (await call('GET', `/api/publicaciones?ids=${r.body.id}`)).body.posts[0];
  assert.equal(done.status, 'publicado');
  assert.equal(done.url, 'https://facebook.test/p/123');
  assert.equal(done.remoteId, 'facebook-123');
  assert.equal(done.progress, 1);
  assert.ok(done.publishedAt > 0);
  assert.equal(fileOnDisk(hash), false, 'publicado: el video se borra del servidor');
  assert.equal(db.prepare("SELECT ok FROM uploads_log WHERE platform = 'facebook'").get().ok, 1);
});

test('el mismo clip a Facebook e Instagram: un solo video, Instagram usa el token de usuario y el video se borra al final', async () => {
  const buf = video('dos');
  const hash = sha(buf);
  await sendFile(buf);
  const now = Date.now();
  const fb = (await call('POST', '/api/publicaciones', { clientId: 'job-fb', platform: 'facebook', fileHash: hash, caption: 'fb', scheduledAt: now - 1000 })).body;
  const ig = (await call('POST', '/api/publicaciones', { clientId: 'job-ig', platform: 'instagram', fileHash: hash, caption: 'ig', scheduledAt: now + 60 * MIN, note: 'Recortado a 39 s para Instagram' })).body;
  subidas.length = 0;
  await publishDue();
  assert.deepEqual(subidas.map((s) => s.platform), ['facebook']);
  assert.equal(fileOnDisk(hash), true, 'Instagram todavía lo necesita');

  db.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').run(Date.now() - 1000, ig.id);
  await publishDue();
  const s = subidas.at(-1);
  assert.equal(s.platform, 'instagram');
  assert.equal(s.token, 'token-usuario');
  assert.equal(s.accountId, 'IG77');
  assert.deepEqual(s.extra, { via: 'facebook', pageId: 'PAGE1' });
  const igDone = post(ig.id);
  assert.equal(igDone.status, 'publicado');
  assert.equal(igDone.note, 'Recortado a 39 s para Instagram');
  assert.equal(post(fb.id).status, 'publicado');
  assert.equal(fileOnDisk(hash), false);
});

test('con https (en el VPS), Instagram puede descargar el video del servidor', async () => {
  setSetting('public_url', 'https://clip.test');
  try {
    const buf = video('tres');
    await sendFile(buf);
    const p = (await call('POST', '/api/publicaciones', { platform: 'instagram', fileHash: sha(buf) })).body;
    await publishDue();
    const s = subidas.at(-1);
    assert.equal(s.relay.anyAccount, true, 'también para Instagram a través de la página');
    assert.match(s.relayUrl, /^https:\/\/clip\.test\/media\/[a-f0-9]{32}\.mp4$/);
    assert.equal(s.relayServido, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relay_files').get().n, 0, 'el paso temporal se borra');
    assert.equal(post(p.id).status, 'publicado');
  } finally {
    setSetting('public_url', '');
  }
});

test('si falla: reintenta más tarde; con un error del video o de permisos, se queda en error', async () => {
  const buf = video('cuatro');
  await sendFile(buf);
  falla.facebook = () => new Error('fetch failed');
  const p = (await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: sha(buf) })).body;
  await publishDue();
  let row = post(p.id);
  assert.equal(row.status, 'pendiente', 'un corte de internet se reintenta');
  assert.equal(row.attempts, 1);
  assert.ok(row.scheduled_at > Date.now() + MIN, 'dentro de unos minutos');
  assert.equal(row.error, 'fetch failed');

  falla.facebook = () => Object.assign(new Error('Facebook: los Reels deben durar entre 3 y 90 segundos'), { status: 400 });
  db.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').run(Date.now() - 1000, p.id);
  await publishDue();
  row = post(p.id);
  assert.equal(row.status, 'error');
  assert.match(row.error, /90 segundos/);
  assert.equal(fileOnDisk(sha(buf)), true, 'se guarda unos días por si se reintenta');
  assert.equal(cleanPostFiles(Date.now() + 8 * 24 * 3600000) >= 1, true);
  assert.equal(fileOnDisk(sha(buf)), false, 'a la semana se borra');
  delete falla.facebook;

  // Conexión vencida: no reintenta, pide reconectar.
  const buf2 = video('cinco');
  await sendFile(buf2);
  const row2 = db.prepare("SELECT extra FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(anaId);
  const extra = JSON.parse(row2.extra);
  db.prepare("UPDATE social_accounts SET extra = ? WHERE user_id = ? AND platform = 'facebook'").run(JSON.stringify({ ...extra, userTokenExpiresAt: Date.now() - 1000 }), anaId);
  const p2 = (await call('POST', '/api/publicaciones', { platform: 'instagram', fileHash: sha(buf2) })).body;
  await publishDue();
  const r2 = (await call('GET', `/api/publicaciones?ids=${p2.id}`)).body.posts[0];
  assert.equal(r2.status, 'error');
  assert.equal(r2.reconnect, true);
  assert.match(r2.error, /venció/);
  db.prepare("UPDATE social_accounts SET extra = ? WHERE user_id = ? AND platform = 'facebook'").run(row2.extra, anaId);
});

test('cancelar, publicar ahora y cambiar la hora', async () => {
  const buf = video('seis');
  await sendFile(buf);
  const later = Date.now() + 120 * MIN;
  const a = (await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: sha(buf), scheduledAt: later })).body;
  const b = (await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: sha(buf), scheduledAt: later, title: 'otra' })).body;
  // Otra persona no puede tocarla.
  assert.equal((await call('POST', `/api/publicaciones/${a.id}/cancelar`, {}, beto)).status, 404);
  assert.equal((await call('POST', `/api/publicaciones/${a.id}/cancelar`, {})).body.status, 'cancelado');
  const moved = (await call('POST', `/api/publicaciones/${b.id}/hora`, { scheduledAt: later + 5 * MIN })).body;
  assert.equal(moved.scheduledAt, later + 5 * MIN);
  const now = (await call('POST', `/api/publicaciones/${b.id}/ahora`, {})).body;
  assert.ok(now.scheduledAt <= Date.now());
  await publishDue();
  assert.equal(post(b.id).status, 'publicado');
  assert.equal(subidas.at(-1).title, 'otra');
  // Ya publicada: no se puede cancelar ni mover.
  assert.equal((await call('POST', `/api/publicaciones/${b.id}/ahora`, {})).status, 409);
  // Mientras se sube, tampoco se cancela.
  db.prepare("UPDATE posts SET status = 'subiendo' WHERE id = ?").run(a.id);
  assert.equal((await call('POST', `/api/publicaciones/${a.id}/cancelar`, {})).status, 409);
  db.prepare("UPDATE posts SET status = 'cancelado' WHERE id = ?").run(a.id);
});

test('automática con el servidor apagado a su hora: espera a que la app elija otra hora', async () => {
  const buf = video('siete');
  await sendFile(buf);
  const p = (await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: sha(buf), reprogramar: true, scheduledAt: Date.now() - 3 * 3600000 })).body;
  const before = subidas.length;
  await publishDue();
  assert.equal(subidas.length, before, 'no se publica a deshora');
  const late = (await call('GET', `/api/publicaciones?ids=${p.id}`)).body.posts[0];
  assert.equal(late.status, 'tarde');
  assert.equal(fileOnDisk(sha(buf)), true);
  const at = Date.now() + 90 * MIN;
  assert.equal((await call('POST', `/api/publicaciones/${p.id}/hora`, { scheduledAt: at, note: 'Pasó a las 21:00' })).body.status, 'pendiente');
  assert.equal(post(p.id).note, 'Pasó a las 21:00');
});

test('pedidos que no sirven', async () => {
  assert.equal((await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: 'a'.repeat(64) })).body.needFile, true);
  assert.equal((await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: 'a'.repeat(64) })).status, 409);
  assert.equal((await call('POST', '/api/publicaciones', { platform: 'myspace', fileHash: 'a'.repeat(64) })).status, 400);
  assert.equal((await call('GET', '/api/publicaciones', null, null)).status, 401);
  assert.equal((await sendFile(Buffer.alloc(0))).status, 400);
  // Beto no ve las de Ana.
  assert.equal((await call('GET', '/api/publicaciones', null, beto)).body.posts.length, 0);
});

test('al desconectar Facebook se cancela lo programado para Facebook y para el Instagram de la página', async () => {
  const buf = video('ocho');
  await sendFile(buf);
  const later = Date.now() + 60 * MIN;
  const fb = (await call('POST', '/api/publicaciones', { platform: 'facebook', fileHash: sha(buf), scheduledAt: later })).body;
  const ig = (await call('POST', '/api/publicaciones', { platform: 'instagram', fileHash: sha(buf), scheduledAt: later })).body;
  assert.equal((await call('DELETE', '/api/social/facebook')).status, 200);
  assert.equal(post(fb.id).status, 'cancelado');
  assert.equal(post(ig.id).status, 'cancelado');
  assert.equal(fileOnDisk(sha(buf)), true);
  cleanPostFiles();
  assert.equal(fileOnDisk(sha(buf)), false, 'nadie lo necesita: se borra');
});
