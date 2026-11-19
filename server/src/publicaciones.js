// Publicaciones programadas EN EL SERVIDOR: la app manda el video y los textos, y el servidor publica a su hora.
// Si el servidor está en un VPS, se publica aunque la PC esté apagada. En la PC funciona igual, mientras esté encendida.
// Para subir a cada red usa el mismo código que la app (desktop/engine/redes.js), así que se comporta igual en los dos lados.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { db, DATA_DIR } from './db.js';
import { requireAdmin } from './auth.js';
import { platformToken } from './routes/social.js';
import { relayLocal } from './relay.js';

export const POSTS_DIR = path.join(DATA_DIR, 'publicaciones');
fs.mkdirSync(POSTS_DIR, { recursive: true });

const MAX_BYTES = 1024 * 1024 * 1024; // Facebook acepta Reels de hasta 1 GB
const MAX_ATTEMPTS = 3;
const NETS = ['youtube', 'tiktok', 'instagram', 'facebook'];
const ACTIVE = ['pendiente', 'subiendo', 'tarde'];
const HOUR = 3600 * 1000;
// Si la hora de una publicación automática pasó hace más de esto (servidor apagado), la app elige otra hora buena.
const LATE_MS = 2 * HOUR;

// ---------- El código de subida de la app ----------
let loaded;
/** { UPLOADERS } de desktop/engine/redes.js, o null si esta copia del servidor no lo tiene. */
function engine() {
  if (loaded === undefined) {
    try {
      loaded = createRequire(import.meta.url)('../../desktop/engine/redes.js');
    } catch (err) {
      console.error('Publicaciones en el servidor apagadas: falta desktop/engine/redes.js', err.message);
      loaded = null;
    }
  }
  return loaded;
}
/** Las pruebas cambian las subidas por unas simuladas. */
export const publisher = { uploaders: null };
const uploaders = () => publisher.uploaders || engine()?.UPLOADERS || null;
export const canPublish = () => !!uploaders();

// ---------- Archivos ----------
const HASH_RE = /^[a-f0-9]{64}$/;
const fileOf = (userId, hash) => path.join(POSTS_DIR, `${Number(userId)}-${hash}.mp4`);
const hasFile = (userId, hash) => !!db.prepare('SELECT 1 FROM post_files WHERE user_id = ? AND hash = ?').get(userId, hash) && fs.existsSync(fileOf(userId, hash));

/**
 * Borra los videos que ya nadie necesita: al publicarse o cancelarse todo lo que los usa; si alguno falló, a los 7 días
 * (para poder reintentar); y si nunca se usaron, a las 6 horas.
 */
export function cleanPostFiles(now = Date.now()) {
  let n = 0;
  for (const f of db.prepare('SELECT * FROM post_files').all()) {
    const refs = db.prepare('SELECT status, updated_at FROM posts WHERE user_id = ? AND file_hash = ?').all(f.user_id, f.hash);
    if (refs.some((r) => ACTIVE.includes(r.status))) continue;
    const last = Math.max(f.created_at, ...refs.map((r) => r.updated_at));
    const keep = !refs.length ? 6 * HOUR : refs.some((r) => r.status === 'error') ? 7 * 24 * HOUR : 0;
    if (now - last < keep) continue;
    fs.rmSync(fileOf(f.user_id, f.hash), { force: true });
    db.prepare('DELETE FROM post_files WHERE user_id = ? AND hash = ?').run(f.user_id, f.hash);
    n++;
  }
  // Restos de subidas cortadas y de cuentas borradas.
  for (const name of fs.readdirSync(POSTS_DIR)) {
    const m = /^(\d+)-([a-f0-9]{64})\.mp4$/.exec(name);
    const abs = path.join(POSTS_DIR, name);
    let age = 0;
    try { age = now - fs.statSync(abs).mtimeMs; } catch { continue; }
    const orphan = m ? !db.prepare('SELECT 1 FROM post_files WHERE user_id = ? AND hash = ?').get(Number(m[1]), m[2]) : true;
    if (orphan && age > 6 * HOUR) { fs.rmSync(abs, { force: true }); n++; }
  }
  return n;
}

/** Guarda el video que manda la app (el cuerpo de la petición es el .mp4 tal cual) y devuelve su huella. */
function receiveFile(req, userId) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(POSTS_DIR, `.${crypto.randomBytes(8).toString('hex')}.parte`);
    const out = fs.createWriteStream(tmp);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe?.(out);
      out.destroy();
      fs.rm(tmp, { force: true }, () => reject(err));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { fail(Object.assign(new Error('El video pesa más de 1 GB'), { status: 413 })); req.destroy(); return; }
      hash.update(chunk);
    });
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('Se cortó el envío del video'), { status: 400 })));
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!size) return fail(Object.assign(new Error('Falta el video'), { status: 400 }));
      const digest = hash.digest('hex');
      fs.renameSync(tmp, fileOf(userId, digest));
      db.prepare(`INSERT INTO post_files (user_id, hash, size, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, hash) DO UPDATE SET created_at = excluded.created_at`).run(userId, digest, size, Date.now());
      resolve({ hash: digest, size });
    });
    req.pipe(out);
  });
}

// ---------- Publicaciones ----------
const parse = (text) => { try { return JSON.parse(text || '{}') || {}; } catch { return {}; } };

export function publicPost(row) {
  return {
    id: row.id, clientId: row.client_id, platform: row.platform, status: row.status, progress: row.progress,
    note: row.note, error: row.error, reconnect: !!row.reconnect, url: row.url, remoteId: row.remote_id,
    scheduledAt: row.scheduled_at, publishedAt: row.published_at, attempts: row.attempts, updatedAt: row.updated_at,
  };
}

function setPost(id, patch) {
  const cols = Object.keys(patch);
  db.prepare(`UPDATE posts SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...cols.map((c) => patch[c]), Date.now(), id);
}

const getPost = (id) => db.prepare('SELECT * FROM posts WHERE id = ?').get(id);

const clean = (v, max) => String(v ?? '').slice(0, max);

/** Crea una publicación con un video que ya está en el servidor. */
export function createPost(userId, body = {}) {
  const platform = String(body.platform || '');
  if (!NETS.includes(platform)) throw Object.assign(new Error('Red social no soportada'), { status: 400 });
  const hash = String(body.fileHash || '');
  if (!HASH_RE.test(hash)) throw Object.assign(new Error('Falta el video'), { status: 400 });
  // Si la app repite el pedido (por ejemplo, se cortó internet justo después), no se publica dos veces.
  const clientId = body.clientId ? clean(body.clientId, 80) : null;
  if (clientId) {
    const same = db.prepare(`SELECT * FROM posts WHERE user_id = ? AND client_id = ? AND status NOT IN ('error', 'cancelado')`).get(userId, clientId);
    if (same && (same.status === 'publicado' || hasFile(userId, same.file_hash))) return same;
    // Una vieja sin su video (por ejemplo, vino en una copia de la base): se reemplaza por la nueva.
    if (same) setPost(same.id, { status: 'cancelado', note: 'Reemplazada por una nueva' });
  }
  if (!hasFile(userId, hash)) throw Object.assign(new Error('El video no está en el servidor'), { status: 409, needFile: true });
  const scheduledAt = Number(body.scheduledAt) > 0 ? Math.round(Number(body.scheduledAt)) : Date.now();
  const data = {
    title: clean(body.title, 300),
    caption: clean(body.caption, 5000),
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 40).map((t) => clean(t, 100)) : [],
    privacy: body.privacy ? clean(body.privacy, 40) : undefined,
    shareToFeed: body.shareToFeed !== false,
    duration: Number(body.duration) || 0,
    tiktok: body.tiktok && typeof body.tiktok === 'object' ? body.tiktok : null,
    note: body.note ? clean(body.note, 200) : null,
  };
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO posts (id, user_id, client_id, platform, file_hash, data, scheduled_at, reprogramar, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`)
    .run(id, userId, clientId, platform, hash, JSON.stringify(data), scheduledAt, body.reprogramar ? 1 : 0, now, now);
  soon();
  return getPost(id);
}

/** Avisos que pueden llegar mientras se sube (vienen de redes.js). */
function onProgressFor(id) {
  let last = -1;
  let lastNote = null;
  return (p, note) => {
    if (note && note !== lastNote) { lastNote = note; last = p; setPost(id, { progress: p, note }); return; }
    if (p - last >= 0.05 || p === 1) { last = p; setPost(id, { progress: p }); }
  };
}

async function publishOne(row) {
  const attempts = row.attempts + 1;
  setPost(row.id, { status: 'subiendo', attempts, progress: 0, error: null, reconnect: 0 });
  const data = parse(row.data);
  try {
    const up = uploaders()?.[row.platform];
    if (!up) throw Object.assign(new Error('Este servidor no puede publicar en esa red. Actualízalo.'), { status: 503 });
    const file = fileOf(row.user_id, row.file_hash);
    if (!fs.existsSync(file)) throw Object.assign(new Error('El video ya no está en el servidor. Vuelve a programarlo desde la app.'), { status: 410 });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) throw Object.assign(new Error('La cuenta ya no existe'), { status: 404 });
    const auth = await platformToken(user, row.platform);
    const result = await up({
      file,
      title: data.title,
      description: data.caption,
      caption: data.caption,
      tags: data.tags || [],
      privacy: data.privacy,
      shareToFeed: data.shareToFeed !== false,
      duration: data.duration || 0,
      tiktok: data.tiktok,
      relay: relayLocal(row.user_id),
      token: auth.accessToken,
      accountId: auth.accountId,
      extra: auth.extra || null,
      onProgress: onProgressFor(row.id),
    });
    const note = result.pending ? 'TikTok sigue procesando el video: aparecerá en tu perfil en unos minutos'
      : result.privacy === 'SELF_ONLY' ? 'Publicado como "Solo yo"' : data.note || null;
    setPost(row.id, { status: 'publicado', progress: 1, url: result.url || null, remote_id: result.id ? String(result.id) : null, published_at: Date.now(), note, error: null });
    db.prepare('INSERT INTO uploads_log (user_id, platform, ok) VALUES (?, ?, 1)').run(row.user_id, row.platform);
  } catch (err) {
    const giveUp = err.reconnect || attempts >= MAX_ATTEMPTS || [400, 402, 403, 404, 410, 503].includes(err.status);
    setPost(row.id, {
      status: giveUp ? 'error' : 'pendiente',
      error: String(err.message || err).slice(0, 300),
      reconnect: err.reconnect ? 1 : 0,
      scheduled_at: giveUp ? row.scheduled_at : Date.now() + 2 ** attempts * 60000,
      progress: 0,
    });
    if (giveUp) db.prepare('INSERT INTO uploads_log (user_id, platform, ok) VALUES (?, ?, 0)').run(row.user_id, row.platform);
  }
}

let busy = false;
/** Publica lo que ya tocó, de a uno. Devuelve cuántas intentó. */
export async function publishDue(now = Date.now()) {
  if (busy) return 0;
  busy = true;
  let n = 0;
  try {
    // Automáticas cuya hora pasó con el servidor apagado: la app les busca otra hora buena (como hace en la PC).
    db.prepare(`UPDATE posts SET status = 'tarde', note = ?, updated_at = ? WHERE status = 'pendiente' AND reprogramar = 1 AND attempts = 0 AND scheduled_at < ?`)
      .run('La hora pasó con el servidor apagado: ClipViral elegirá otra hora buena cuando abras la app', now, now - LATE_MS);
    for (;;) {
      const row = db.prepare(`SELECT p.* FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.status = 'pendiente' AND p.scheduled_at <= ? AND u.role = 'admin' ORDER BY p.scheduled_at LIMIT 1`).get(Date.now());
      if (!row) break;
      await publishOne(row);
      n++;
    }
  } finally {
    busy = false;
    try { cleanPostFiles(); } catch (err) { console.error('publicaciones:', err.message); }
  }
  return n;
}

let soonTimer = null;
function soon() {
  if (!started || soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = null; publishDue().catch((err) => console.error('publicaciones:', err.message)); }, 300);
}

let started = false;
/** Lo llama index.js al encender el servidor: revisa cada 20 segundos qué toca publicar. */
export function startPublisher() {
  if (started) return;
  started = true;
  // Si el servidor se apagó a mitad de una subida, se vuelve a intentar.
  db.prepare(`UPDATE posts SET status = 'pendiente', progress = 0, updated_at = ? WHERE status = 'subiendo'`).run(Date.now());
  setInterval(() => publishDue().catch((err) => console.error('publicaciones:', err.message)), 20000).unref();
  soon();
}

// ---------- Panel de admin: lo que el servidor va a publicar ----------
const adminRow = (r) => {
  const d = parse(r.data);
  return {
    ...publicPost(r),
    user: { id: r.user_id, email: r.email, name: r.name, role: r.role },
    title: d.title || '', caption: String(d.caption || '').slice(0, 280), duration: Number(d.duration) || 0,
    recorte: d.note || null, // por ejemplo: "Claude dejó lo mejor en 39 s para Instagram"
    conVideo: hasFile(r.user_id, r.file_hash),
    // El servidor solo publica lo de cuentas de administrador.
    sePublica: r.role === 'admin',
  };
};

/** Lo programado en el servidor (de todas las cuentas) y lo que pasó en los últimos 7 días. */
export function adminPosts(now = Date.now()) {
  const sql = (where, order) => `SELECT p.*, u.email, u.name, u.role FROM posts p JOIN users u ON u.id = p.user_id WHERE ${where} ORDER BY ${order}`;
  return {
    activo: started && canPublish(),
    puede: canPublish(),
    proximas: db.prepare(sql(`p.status IN ('pendiente', 'subiendo', 'tarde')`, 'p.scheduled_at LIMIT 300')).all().map(adminRow),
    recientes: db.prepare(sql(`p.status IN ('publicado', 'error', 'cancelado') AND p.updated_at > ?`, 'p.updated_at DESC LIMIT 60')).all(now - 7 * 24 * HOUR).map(adminRow),
  };
}

const findPost = (id) => {
  const row = getPost(String(id));
  if (!row) throw Object.assign(new Error('No encontré esa publicación'), { status: 404 });
  return row;
};
/** El admin cancela una publicación de cualquier cuenta (si todavía no se está subiendo). */
export function adminCancel(id) {
  const row = findPost(id);
  if (row.status === 'subiendo') throw Object.assign(new Error('Ya se está publicando: no se puede cancelar'), { status: 409 });
  if (!['pendiente', 'tarde', 'error'].includes(row.status)) throw Object.assign(new Error('Esa publicación ya no está programada'), { status: 409 });
  setPost(row.id, { status: 'cancelado', progress: 0, note: 'Cancelada desde el panel de admin' });
  return publicPost(getPost(row.id));
}
/** El admin la manda a publicar ya. */
export function adminNow(id) {
  const row = findPost(id);
  if (!['pendiente', 'tarde'].includes(row.status)) throw Object.assign(new Error('Esa publicación ya no está programada'), { status: 409 });
  setPost(row.id, { status: 'pendiente', scheduled_at: Date.now(), reprogramar: 0, note: null });
  soon();
  return publicPost(getPost(row.id));
}

// ---------- Rutas (/api/publicaciones) ----------
export const postRoutes = Router();
// Publicar solo, a su hora: solo administradores.
postRoutes.use(requireAdmin);

const mine = (req) => {
  const row = getPost(String(req.params.id));
  if (!row || row.user_id !== req.user.id) throw Object.assign(new Error('No encontré esa publicación'), { status: 404 });
  return row;
};
const handle = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message, ...(err.needFile ? { needFile: true } : {}) });
  }
};

// Lista (todas, o las que pide la app con ?ids=a,b,c).
postRoutes.get('/', handle((req) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300);
  const rows = ids.length
    ? db.prepare(`SELECT * FROM posts WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids)
    : db.prepare('SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.id);
  return { posts: rows.map(publicPost) };
}));

// ¿Ya está este video en el servidor? (así no se manda dos veces el mismo clip, por ejemplo a Facebook y a Instagram)
postRoutes.get('/archivos/:hash', handle((req) => {
  const hash = String(req.params.hash || '');
  return { exists: HASH_RE.test(hash) && hasFile(req.user.id, hash) };
}));

// El video, tal cual (Content-Type: video/mp4).
postRoutes.post('/archivos', handle(async (req) => {
  if (!canPublish()) throw Object.assign(new Error('Este servidor no puede publicar: le falta desktop/engine. Actualízalo.'), { status: 503 });
  return receiveFile(req, req.user.id);
}));

postRoutes.post('/', handle((req) => {
  if (!canPublish()) throw Object.assign(new Error('Este servidor no puede publicar: le falta desktop/engine. Actualízalo.'), { status: 503 });
  return publicPost(createPost(req.user.id, req.body || {}));
}));

postRoutes.post('/:id/cancelar', handle((req) => {
  const row = mine(req);
  if (row.status === 'subiendo') throw Object.assign(new Error('Ya se está publicando: no se puede cancelar'), { status: 409 });
  if (['pendiente', 'tarde', 'error'].includes(row.status)) setPost(row.id, { status: 'cancelado', progress: 0 });
  return publicPost(getPost(row.id));
}));

postRoutes.post('/:id/ahora', handle((req) => {
  const row = mine(req);
  if (!['pendiente', 'tarde'].includes(row.status)) throw Object.assign(new Error('Esa publicación ya no está programada'), { status: 409 });
  setPost(row.id, { status: 'pendiente', scheduled_at: Date.now(), reprogramar: 0, note: null });
  soon();
  return publicPost(getPost(row.id));
}));

postRoutes.post('/:id/hora', handle((req) => {
  const row = mine(req);
  const at = Math.round(Number(req.body?.scheduledAt));
  if (!(at > 0)) throw Object.assign(new Error('Falta la hora'), { status: 400 });
  if (!['pendiente', 'tarde'].includes(row.status)) throw Object.assign(new Error('Esa publicación ya no está programada'), { status: 409 });
  setPost(row.id, { status: 'pendiente', scheduled_at: at, note: req.body?.note ? clean(req.body.note, 200) : null });
  soon();
  return publicPost(getPost(row.id));
}));
