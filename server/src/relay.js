// Paso temporal de videos para Instagram.
// Con "inicio de sesión de Instagram", Meta solo garantiza recibir el video desde un enlace público (video_url).
// Si la subida directa desde la PC no funciona, la app sube el clip aquí, Instagram lo descarga y se borra enseguida.
// Nada queda guardado: se borra al publicar o, como mucho, a las 24 horas.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, planInfo } from './db.js';
import { requireAdmin } from './auth.js';
import { publicUrl } from './social.js';

export const RELAY_DIR = path.join(DATA_DIR, 'relay');
fs.mkdirSync(RELAY_DIR, { recursive: true });
const TTL = 24 * 3600 * 1000;
const MAX_BYTES = 300 * 1024 * 1024; // lo máximo que acepta Instagram para un Reel

const fileOf = (id) => path.join(RELAY_DIR, `${id}.mp4`);

/** Borra los videos de más de 24 horas. */
export function cleanRelay(now = Date.now()) {
  const old = db.prepare('SELECT id FROM relay_files WHERE created_at < ?').all(now - TTL);
  for (const { id } of old) {
    fs.rmSync(fileOf(id), { force: true });
    db.prepare('DELETE FROM relay_files WHERE id = ?').run(id);
  }
  return old.length;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: RELAY_DIR,
    filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.mp4`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

export const relayRoutes = Router();

relayRoutes.post('/', requireAdmin, (req, res, next) => {
  if (!planInfo(req.user).active) return res.status(402).json({ error: 'Tu plan venció. Renuévalo para subir a redes.' });
  const ig = db.prepare("SELECT 1 FROM social_accounts WHERE user_id = ? AND platform = 'instagram'").get(req.user.id);
  if (!ig) return res.status(404).json({ error: 'Conecta tu cuenta de Instagram primero' });
  cleanRelay();
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el video' });
  const id = path.basename(req.file.filename, '.mp4');
  db.prepare('INSERT INTO relay_files (id, user_id, size, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, req.file.size, Date.now());
  res.status(201).json({ id, url: `${publicUrl()}/media/${id}.mp4`, expiresAt: Date.now() + TTL });
});

relayRoutes.delete('/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM relay_files WHERE id = ? AND user_id = ?').get(String(req.params.id), req.user.id);
  if (row) {
    fs.rmSync(fileOf(row.id), { force: true });
    db.prepare('DELETE FROM relay_files WHERE id = ?').run(row.id);
  }
  res.json({ ok: true });
});

/**
 * Para las publicaciones que sube el propio servidor: pone un video que ya está aquí en el paso temporal y da su enlace.
 * Solo sirve si el servidor tiene una dirección pública con https (en el VPS): Instagram no puede descargar de "localhost".
 */
export function relayLocal(userId) {
  if (!/^https:\/\//.test(publicUrl())) return null;
  return {
    anyAccount: true, // también para Instagram a través de la página de Facebook
    async put(file) {
      cleanRelay();
      const id = crypto.randomBytes(16).toString('hex');
      try { fs.linkSync(file, fileOf(id)); } catch { fs.copyFileSync(file, fileOf(id)); }
      db.prepare('INSERT INTO relay_files (id, user_id, size, created_at) VALUES (?, ?, ?, ?)').run(id, userId, fs.statSync(file).size, Date.now());
      return { id, url: `${publicUrl()}/media/${id}.mp4` };
    },
    async remove(id) {
      fs.rmSync(fileOf(id), { force: true });
      db.prepare('DELETE FROM relay_files WHERE id = ?').run(id);
    },
  };
}

/** Enlace público (difícil de adivinar) que Instagram usa para descargar el video. */
export function serveRelay(req, res) {
  const m = /^([a-f0-9]{32})\.mp4$/.exec(String(req.params.name || ''));
  const row = m && db.prepare('SELECT * FROM relay_files WHERE id = ?').get(m[1]);
  if (!row || Date.now() - row.created_at > TTL || !fs.existsSync(fileOf(row.id))) return res.status(404).send('No encontrado');
  res.sendFile(fileOf(row.id), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
