// Publicar desde el servidor: la cola de la app (subidas.js + servidor.js) contra el servidor de verdad (server/src),
// con las redes simuladas. Es lo mismo que pasa con el servidor en la PC o en un VPS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UploadQueue, SERVER_NOTE } = require('../engine/subidas');
const { createRemote, isLocalUrl } = require('../engine/servidor');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-servidor-'));
process.env.DATA_DIR = path.join(tmp, 'datos');
process.env.SECRET_KEY = 'clave-de-prueba';
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });

let srv;
let base;
let token;
let db;
let pub;
const publicadas = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const { app } = await import('../../server/src/index.js');
  ({ db } = await import('../../server/src/db.js'));
  const { hashPassword } = await import('../../server/src/auth.js');
  const { seal } = await import('../../server/src/secretbox.js');
  pub = await import('../../server/src/publicaciones.js');
  srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires) VALUES ('ana@clipviral.test', 'Ana', ?, 'admin', 'local', ?)`)
    .run(await hashPassword('ClipViral-Prueba-2026'), new Date(Date.now() + 86400000).toISOString());
  const userId = db.prepare("SELECT id FROM users WHERE email = 'ana@clipviral.test'").get().id;
  db.prepare(`INSERT INTO social_accounts (user_id, platform, account_id, account_name, access_token, refresh_token, expires_at, extra)
    VALUES (?, 'facebook', 'PAGE1', 'Mi Página', ?, ?, ?, ?)`)
    .run(userId, seal('token-pagina'), seal('token-pagina'), Date.now() + 365 * 86400000,
      JSON.stringify({ igBusinessId: 'IG77', igUsername: 'ana.ig', pageId: 'PAGE1', userToken: seal('token-usuario'), userTokenExpiresAt: Date.now() + 50 * 86400000 }));
  token = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@clipviral.test', password: 'ClipViral-Prueba-2026' }) })).json()).token;
  // Las redes, simuladas en el servidor.
  const fake = (platform) => async (o) => {
    publicadas.push({ platform, token: o.token, caption: o.caption, duration: o.duration, contenido: fs.readFileSync(o.file, 'utf8') });
    o.onProgress?.(1);
    return { id: `${platform}-${publicadas.length}`, url: `https://${platform}.test/${publicadas.length}` };
  };
  pub.publisher.uploaders = { facebook: fake('facebook'), instagram: fake('instagram'), youtube: fake('youtube'), tiktok: fake('tiktok') };
});
after(() => {
  srv?.close();
  db?.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows a veces tarda en soltar la base */ }
});

/** Las llamadas JSON al servidor (como api() en main.js). */
const apiTo = (url) => async (pathname, body, method) => {
  let res;
  try {
    res = await fetch(url() + '/api' + pathname, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor de ClipViral. Revisa tu internet.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
};

function makeQueue({ url = () => base, prepare = null, onLate = null } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'app-'));
  const clip = path.join(dir, 'clip.mp4');
  fs.writeFileSync(clip, 'el clip completo '.repeat(2000));
  const pcUploads = [];
  const q = new UploadQueue({
    file: path.join(dir, 'subidas.json'),
    getToken: async () => { throw new Error('la PC no debería subir nada'); },
    uploaders: new Proxy({}, { get: (t, p) => async () => { pcUploads.push(p); return { id: 'pc', url: 'pc' }; } }),
    prepare,
    onLate,
    remote: createRemote({ serverUrl: url, token: () => token, api: apiTo(url), enabled: () => true }),
  });
  return { q, clip, dir, pcUploads };
}

/** Deja que la cola mande todo lo que tiene que mandar al servidor. */
async function drain(q) {
  for (let i = 0; i < 50; i++) {
    while (q.busy) await wait(10);
    const due = q.jobs.some((j) => j.status === 'pendiente' && !j.servidor && !j.quitar && !(j.sendAfter > Date.now()));
    if (!due) return;
    await q.tick();
  }
}
const serverPost = (id) => db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
const atNow = (postId) => db.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').run(Date.now() - 1000, postId);
const HOUR = 3600000;

test('servidor de esta PC o de un VPS', () => {
  assert.equal(isLocalUrl('http://localhost:4600'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:4601/'), true);
  assert.equal(isLocalUrl('https://quejuidero.duckdns.org'), false);
  assert.equal(isLocalUrl('http://185.10.20.30:4600'), false);
});

test('programar: la app manda el video al servidor, el servidor publica a su hora y la app ve "Publicado"', async () => {
  const cleaned = [];
  // Instagram recibe la copia recortada (como igTrimCopy en main.js); Facebook, el clip entero.
  const prepare = async (job) => {
    if (job.platform !== 'instagram') return null;
    const out = path.join(path.dirname(job.file), 'recortado.mp4');
    fs.writeFileSync(out, 'la copia de 39 s '.repeat(800));
    return { file: out, duration: 39, note: 'Recortado a 39 s para Instagram', cleanup: () => { cleaned.push(out); fs.rmSync(out, { force: true }); } };
  };
  const { q, clip, pcUploads } = makeQueue({ prepare });
  const done = [];
  const failed = [];
  q.on('done', (j) => done.push(j.platform));
  q.on('failed', (j) => failed.push(j.platform));
  try {
    const at = Date.now() + 2 * HOUR;
    const fb = q.add({ clip: { id: 'c1', file: clip, duration: 52 }, platform: 'facebook', title: 'Clip', caption: 'para fb', scheduledAt: at });
    const ig = q.add({ clip: { id: 'c1', file: clip, duration: 52 }, platform: 'instagram', title: 'Clip', caption: 'para ig', scheduledAt: at });
    const yt = q.add({ clip: { id: 'c1', file: clip, duration: 52 }, platform: 'youtube', title: 'Clip', caption: 'para yt', scheduledAt: at });
    await drain(q);

    // Se mandaron enseguida (aunque falten 2 horas) y la hora no cambió.
    for (const j of [fb, ig, yt]) {
      assert.ok(j.servidor?.id, `${j.platform} está en el servidor`);
      assert.equal(j.servidor.base, base);
      assert.equal(j.status, 'pendiente');
      assert.equal(j.scheduledAt, at);
      assert.equal(j.note, SERVER_NOTE);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM post_files').get().n, 2, 'el clip una sola vez (Facebook y YouTube) + la copia de Instagram');
    assert.deepEqual(cleaned.length, 1, 'la copia recortada se borra de la PC al mandarla');
    assert.equal(serverPost(ig.servidor.id).scheduled_at, at);
    assert.equal(JSON.parse(serverPost(ig.servidor.id).data).duration, 39);

    // Llega la hora (la PC podría estar apagada): publica el servidor.
    [fb, ig, yt].forEach((j) => atNow(j.servidor.id));
    await pub.publishDue();
    assert.deepEqual(publicadas.map((p) => p.platform).sort(), ['facebook', 'instagram']);
    const igPub = publicadas.find((p) => p.platform === 'instagram');
    assert.match(igPub.contenido, /copia de 39 s/);
    assert.equal(igPub.token, 'token-usuario');
    assert.match(publicadas.find((p) => p.platform === 'facebook').contenido, /clip completo/);

    // La app pregunta y se pone al día.
    await q.sync();
    assert.equal(fb.status, 'publicado');
    assert.match(fb.url, /^https:\/\/facebook\.test\/\d$/);
    assert.ok(fb.remoteId, 'para las estadísticas');
    assert.equal(ig.status, 'publicado');
    assert.equal(ig.note, 'Recortado a 39 s para Instagram');
    // YouTube no está conectado: el error del servidor llega a la app.
    assert.equal(yt.status, 'error');
    assert.match(yt.error, /Conecta tu cuenta de YouTube/);
    assert.deepEqual(done.sort(), ['facebook', 'instagram']);
    assert.deepEqual(failed, ['youtube']);
    assert.deepEqual(pcUploads, [], 'la PC no subió nada a las redes');

    // Reintentar: se manda otra vez (el video sigue en el servidor por el error, no se repite).
    q.retry(yt.id);
    await drain(q);
    assert.ok(yt.servidor?.id);
    assert.equal(yt.status, 'pendiente');
  } finally { q.stop(); }
});

test('cancelar y "Publicar ahora" desde la app se hacen en el servidor', async () => {
  const { q, clip } = makeQueue();
  try {
    const a = q.add({ clip: { id: 'c2', file: clip }, platform: 'facebook', title: 'A', caption: 'a', scheduledAt: Date.now() + 3 * HOUR });
    const b = q.add({ clip: { id: 'c3', file: clip }, platform: 'instagram', title: 'B', caption: 'b', scheduledAt: Date.now() + 3 * HOUR });
    await drain(q);
    await q.cancel(a.id);
    assert.equal(a.status, 'cancelado');
    assert.equal(serverPost(a.servidor.id).status, 'cancelado');

    await q.publishNow(b.id);
    assert.ok(serverPost(b.servidor.id).scheduled_at <= Date.now());
    await pub.publishDue();
    await q.sync();
    assert.equal(b.status, 'publicado');

    // Cancelar sin conexión con el servidor: avisa y no se cancela (si no, se publicaría igual).
    const c = q.add({ clip: { id: 'c4', file: clip }, platform: 'facebook', title: 'C', caption: 'c', scheduledAt: Date.now() + 3 * HOUR });
    await drain(q);
    const realBase = base;
    base = 'http://127.0.0.1:9';
    try {
      await assert.rejects(q.cancel(c.id), /No hay conexión/);
      assert.equal(c.status, 'pendiente');
      // Lo que se cancela solo (por ejemplo, al descartar el clip) se termina de cancelar cuando vuelve la conexión.
      assert.equal(q.cancelWhere((j) => j.id === c.id), 1);
      assert.equal(c.status, 'cancelado');
      await q.sync();
      assert.equal(c.servidorCancelar, true, 'queda pendiente de avisar');
    } finally { base = realBase; }
    await q.sync();
    assert.equal(c.servidorCancelar, undefined);
    assert.equal(serverPost(c.servidor.id).status, 'cancelado');
  } finally { q.stop(); }
});

test('sin conexión al mandarla: la hora de publicar no cambia y se vuelve a mandar después', async () => {
  let url = 'http://127.0.0.1:9';
  const { q, clip } = makeQueue({ url: () => url });
  try {
    const at = Date.now() + 5 * HOUR;
    const j = q.add({ clip: { id: 'c5', file: clip }, platform: 'facebook', title: 'T', caption: 'c', scheduledAt: at });
    await drain(q);
    assert.equal(j.status, 'pendiente');
    assert.equal(j.servidor, undefined);
    assert.equal(j.scheduledAt, at, 'la hora elegida se mantiene');
    assert.ok(j.sendAfter > Date.now(), 'espera un rato para volver a mandarla');
    assert.equal(j.note, null);
    assert.match(j.error, /No se pudo mandar el video|No hay conexión/);
    // Vuelve internet.
    url = base;
    j.sendAfter = Date.now() - 1;
    await drain(q);
    assert.ok(j.servidor?.id);
    assert.equal(j.error, null);
  } finally { q.stop(); }
});

test('automática con el servidor apagado a su hora: la app le busca la próxima hora buena', async () => {
  const later = Date.now() + 6 * HOUR;
  const { q, clip } = makeQueue({ onLate: () => later });
  try {
    const j = q.add({ clip: { id: 'c6', file: clip }, platform: 'facebook', title: 'T', caption: 'c', origen: 'sola', reprogramar: true, scheduledAt: Date.now() + HOUR });
    await drain(q);
    db.prepare('UPDATE posts SET scheduled_at = ? WHERE id = ?').run(Date.now() - 3 * HOUR, j.servidor.id);
    const before = publicadas.length;
    await pub.publishDue();
    assert.equal(publicadas.length, before, 'no publica a deshora');
    assert.equal(serverPost(j.servidor.id).status, 'tarde');
    await q.sync();
    assert.equal(j.status, 'pendiente');
    assert.equal(j.scheduledAt, later);
    assert.match(j.note, /servidor estaba apagado/);
    assert.equal(serverPost(j.servidor.id).scheduled_at, later);
  } finally { q.stop(); }
});

test('cambiar de servidor: lo programado se cancela en el viejo y se manda al nuevo', async () => {
  const { q, clip } = makeQueue();
  try {
    const j = q.add({ clip: { id: 'c7', file: clip }, platform: 'facebook', title: 'T', caption: 'c', scheduledAt: Date.now() + 4 * HOUR });
    await drain(q);
    const old = j.servidor.id;
    const r = await q.detachFromServer();
    assert.deepEqual(r, { moved: 1, kept: 0 });
    assert.equal(serverPost(old).status, 'cancelado');
    assert.equal(j.servidor, null);
    assert.equal(j.status, 'pendiente');
    // Se vuelve a mandar (aquí, al mismo servidor de prueba) y queda una sola programada.
    await drain(q);
    assert.ok(j.servidor?.id && j.servidor.id !== old);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE client_id = ? AND status = 'pendiente'`).get(j.id).n, 1);
  } finally { q.stop(); }
});

test('apagar "Publicar sola": las automáticas se quitan también del servidor', async () => {
  const { q, clip } = makeQueue();
  try {
    const j = q.add({ clip: { id: 'c8', file: clip }, platform: 'facebook', title: 'T', caption: 'c', origen: 'sola', scheduledAt: Date.now() + 4 * HOUR });
    await drain(q);
    const postId = j.servidor.id;
    assert.equal(q.removeWhere((x) => x.origen === 'sola' && x.clipId === 'c8'), 1);
    assert.ok(!q.list().includes(j), 'ya no se ve en la lista');
    await q.sync();
    assert.equal(serverPost(postId).status, 'cancelado');
    assert.ok(!q.jobs.includes(j), 'y se quitó cuando el servidor confirmó');
  } finally { q.stop(); }
});
