// El .zip que la gente descarga desde la web (botón "Descargar ClipViral"). Lo subes en el panel → Actualizaciones.
// Se guarda uno solo (el más nuevo) en data/descarga; los datos (versión, tamaño, fecha) van en settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, DATA_DIR, getSetting, setSetting } from './db.js';

export const DESCARGA_DIR = path.join(DATA_DIR, 'descarga');
fs.mkdirSync(DESCARGA_DIR, { recursive: true });

/** Lo que se muestra en la web y en el panel (null si todavía no subiste ningún .zip). */
export function descargaInfo() {
  let info = null;
  try { info = JSON.parse(getSetting('descarga_info') || 'null'); } catch {}
  if (!info?.file || !fs.existsSync(path.join(DESCARGA_DIR, info.file))) return null;
  return { version: info.version, size: info.size, sha256: info.sha256, at: info.at, name: info.name, downloads: Number(getSetting('descarga_count') || 0) };
}

export function descargaPath() {
  const info = descargaInfo();
  return info ? path.join(DESCARGA_DIR, JSON.parse(getSetting('descarga_info')).file) : null;
}

/** Guarda el .zip subido (ruta temporal) como la descarga de la web. Borra el anterior. */
export async function guardarDescarga(tmpFile, { version, originalName }) {
  const head = Buffer.alloc(4);
  const fd = fs.openSync(tmpFile, 'r');
  try { fs.readSync(fd, head, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (head[0] !== 0x50 || head[1] !== 0x4b) { fs.rmSync(tmpFile, { force: true }); throw Object.assign(new Error('Ese archivo no es un .zip'), { status: 400 }); }
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => fs.createReadStream(tmpFile).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject));
  const file = `ClipViral-${version}.zip`;
  const old = descargaPath();
  fs.renameSync(tmpFile, path.join(DESCARGA_DIR, file));
  if (old && path.basename(old) !== file) fs.rmSync(old, { force: true });
  const info = { file, version, size: fs.statSync(path.join(DESCARGA_DIR, file)).size, sha256: hash.digest('hex'), at: new Date().toISOString(), name: `ClipViral-${version}.zip` };
  setSetting('descarga_info', JSON.stringify(info));
  return descargaInfo();
}

export function borrarDescarga() {
  const p = descargaPath();
  if (p) fs.rmSync(p, { force: true });
  setSetting('descarga_info', '');
}

export function contarDescarga() {
  setSetting('descarga_count', String(Number(getSetting('descarga_count') || 0) + 1));
}

/** La versión más nueva publicada para las apps (para mostrarla en la web si no hay .zip todavía). */
export function ultimaVersion() {
  return db.prepare('SELECT version FROM releases ORDER BY id DESC LIMIT 1').get()?.version || null;
}
