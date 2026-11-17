// Arma una copia limpia de ClipViral para pasársela a otra persona (por ejemplo, un amigo):
// solo el programa, SIN tus datos (base de datos, cuentas, claves, tokens de redes, registros ni clips).
// La otra persona descomprime, abre "Iniciar ClipViral.bat" y crea su propia cuenta con su propia clave de Claude.
//
// Uso: node scripts/preparar-copia.js [carpeta-donde-dejar-el-zip]   (sin carpeta: tu escritorio)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const ZIP_NAME = 'ClipViral para un amigo.zip';
const TOP = 'ClipViral';

// Solo esto entra en la copia (todo lo demás se queda fuera).
export const INCLUIR = [
  'Iniciar ClipViral.bat',
  'LEEME - EMPIEZA AQUI.txt',
  'README.md',
  'GUIA-PERMISOS-REDES.md',
  'GUION-VIDEO-META.md',
  'Grabar video para Meta.bat',
  'GUIA-VPS.md',
  'Preparar copia para el VPS.bat',
  'Instalar en el VPS.bat',
  'server/package.json',
  'server/package-lock.json',
  'server/.env.example',
  'server/src',
  'server/public',
  'server/scripts',
  'desktop/package.json',
  'desktop/package-lock.json',
  'desktop/app-config.json',
  'desktop/main.js',
  'desktop/preload.js',
  'desktop/engine',
  'desktop/renderer',
  'desktop/build',
  'desktop/grabador',
];

// Por si acaso: nada de esto entra aunque aparezca dentro de una carpeta permitida.
export function prohibido(rel) {
  const parts = rel.split('/');
  const name = parts.at(-1).toLowerCase();
  if (parts.some((p) => ['node_modules', 'data', 'dist', '.git', '.claude', 'clips-de-prueba', 'test', 'traer-datos', 'https'].includes(p.toLowerCase()))) return true;
  if (name === '.env' || name === 'sesion.json' || name === 'secret.key') return true;
  if (/\.(db|db-wal|db-shm|sqlite|key|log|pem|mp4|mov|mkv|webm)$/i.test(name)) return true;
  if (/^(captura|salida).*\.png$/i.test(name)) return true;
  return false;
}

/** Lista los archivos que van en la copia (rutas con /). */
export function archivosDeLaCopia(root = ROOT, incluir = INCLUIR) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || prohibido(rel)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) walk(`${rel}/${name}`);
    } else if (st.isFile()) {
      out.push(rel);
    }
  };
  incluir.forEach(walk);
  return out;
}

/** Valores que nunca deben aparecer en la copia: lo que hay en tu server/.env y los correos de tus cuentas. */
export async function secretosPropios(root = ROOT) {
  const values = new Set();
  const envFile = path.join(root, 'server', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m && m[1] !== 'PORT' && m[1] !== 'DATA_DIR' && m[2].length >= 6) values.add(m[2].replace(/^["']|["']$/g, ''));
    }
  }
  const dbFile = path.join(process.env.DATA_DIR || path.join(root, 'server', 'data'), 'clipviral.db');
  if (fs.existsSync(dbFile)) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbFile, { readOnly: true });
      for (const { email } of db.prepare('SELECT email FROM users').all()) if (!email.endsWith('.test')) values.add(email);
      db.close();
    } catch { /* si la base está ocupada, igual seguimos con lo del .env */ }
  }
  return [...values];
}

/** Revisa que ningún archivo de la copia tenga una clave de Claude real ni tus datos. Devuelve los problemas. */
export function revisarCopia(root, files, secretos) {
  const problemas = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'latin1');
    if (/sk-ant-(api|admin)\d\d-[A-Za-z0-9_-]{60,}/.test(text)) problemas.push(`${rel}: parece tener una clave de Claude`);
    for (const s of secretos) if (text.includes(s)) problemas.push(`${rel}: tiene un dato tuyo (${s.slice(0, 3)}…)`);
  }
  return problemas;
}

/** Arma el zip. extras: archivos de otro lugar ({ rel, abs }), por ejemplo la copia de tus datos para el VPS. */
export function crearZip(root, files, zipPath, extras = []) {
  fs.rmSync(zipPath, { force: true });
  const require = createRequire(path.join(root, 'desktop', 'package.json'));
  let AdmZip = null;
  try { AdmZip = require('adm-zip'); } catch { /* sin adm-zip usamos tar de Windows */ }
  if (AdmZip) {
    const zip = new AdmZip();
    for (const rel of files) zip.addFile(`${TOP}/${rel}`, fs.readFileSync(path.join(root, rel)));
    for (const x of extras) zip.addFile(`${TOP}/${x.rel}`, fs.readFileSync(x.abs));
    zip.writeZip(zipPath);
    return;
  }
  // Plan B: carpeta temporal + tar.exe (viene con Windows 10 y 11).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-copia-'));
  try {
    for (const rel of files) {
      const dest = path.join(tmp, TOP, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(root, rel), dest);
    }
    for (const x of extras) {
      const dest = path.join(tmp, TOP, x.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(x.abs, dest);
    }
    const r = spawnSync('tar.exe', ['-a', '-c', '-f', zipPath, '-C', tmp, TOP], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || 'no se pudo crear el zip');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function escritorio() {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8', windowsHide: true });
  const dir = (r.stdout || '').trim();
  return dir && fs.existsSync(dir) ? dir : path.join(os.homedir(), 'Desktop');
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${pinta('92')('✔')} ${s}`);
const mal = (s) => say(`    ${pinta('91')('✖')} ${s}`);
const info = (s) => say(`    ${pinta('90')('·')} ${s}`);

async function main() {
  const destDir = process.argv[2] ? path.resolve(process.argv[2]) : escritorio();
  const zipPath = path.join(destDir, ZIP_NAME);
  const files = archivosDeLaCopia();
  ok(`${files.length} archivos del programa (sin node_modules: se instalan solos en la otra PC).`);
  info('Fuera de la copia: tu base de datos, tus cuentas, tu clave de Claude, tokens de redes, registros y clips.');

  const problemas = revisarCopia(ROOT, files, await secretosPropios());
  if (problemas.length) {
    mal('Encontré datos tuyos en estos archivos, así que no armé la copia:');
    problemas.forEach((p) => info(p));
    process.exit(1);
  }
  ok('Revisé cada archivo: no hay claves ni correos tuyos.');

  fs.mkdirSync(destDir, { recursive: true });
  crearZip(ROOT, files, zipPath);
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  ok(`Copia lista (${mb} MB): ${pinta('96')(zipPath)}`);
  if (!process.argv[2]) spawn('explorer.exe', [`/select,"${zipPath}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    mal(`No se pudo armar la copia: ${err?.message || err}`);
    process.exit(1);
  });
}
