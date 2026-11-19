// El .zip que la gente descarga desde la web (botón "Descargar ClipViral"). Lo subes en el panel → Actualizaciones.
// Se guarda uno solo (el más nuevo) en data/descarga; los datos (versión, tamaño, fecha) van en settings.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { db, DATA_DIR, RELEASES_DIR, getSetting, setSetting } from './db.js';

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

function fechaDos(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Arma un .zip con un solo archivo adentro, sin volver a comprimir (el instalador ya viene comprimido). */
export async function zipConUnArchivo(origen, destino, nombre) {
  const size = fs.statSync(origen).size;
  if (size > 0xfff00000) throw new Error('El instalador es demasiado grande para meterlo en un .zip');
  let crc = 0;
  for await (const chunk of fs.createReadStream(origen)) crc = zlib.crc32(chunk, crc);
  const name = Buffer.from(nombre, 'utf8');
  const { time, date } = fechaDos(new Date());
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // nombre en UTF-8
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc >>> 0, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc >>> 0, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(central.length + name.length, 12);
  fin.writeUInt32LE(local.length + name.length + size, 16);
  await pipeline(async function* () {
    yield local; yield name;
    yield* fs.createReadStream(origen);
    yield central; yield name; yield fin;
  }, fs.createWriteStream(destino));
}

/** La descarga de la web hecha con el instalador de una versión ya publicada (así no lo subes dos veces). */
export async function descargaDesdeVersion(version) {
  const r = db.prepare('SELECT filename FROM releases WHERE version = ?').get(version);
  if (!r) throw Object.assign(new Error('Esa versión no existe'), { status: 404 });
  const tmp = path.join(DESCARGA_DIR, `armando-${Date.now()}.zip`);
  try {
    await zipConUnArchivo(path.join(RELEASES_DIR, r.filename), tmp, `ClipViral-Setup-${version}${path.extname(r.filename) || '.exe'}`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  return guardarDescarga(tmp, { version, originalName: `ClipViral-${version}.zip` });
}

/** La versión más nueva publicada para las apps (para mostrarla en la web si no hay .zip todavía). */
export function ultimaVersion() {
  return db.prepare('SELECT version FROM releases ORDER BY id DESC LIMIT 1').get()?.version || null;
}
