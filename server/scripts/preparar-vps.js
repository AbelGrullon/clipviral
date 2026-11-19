// Arma la copia de ClipViral para TU VPS: el servidor (con el código de subida de la app) y TUS datos (tu cuenta, tus
// redes conectadas y tu clave de Claude), para que el VPS publique lo programado aunque tu PC esté apagada.
// La copia es PRIVADA: lleva tus conexiones. Pásala solo a tu VPS (por Escritorio remoto) y bórrala después.
// Lo programado en esta PC no va en la copia: al cambiar de servidor en la app, se manda de nuevo al VPS.
//
// Uso: node --env-file-if-exists=.env scripts/preparar-vps.js [carpeta-donde-dejar-el-zip]   (sin carpeta: tu escritorio)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, archivosDeLaCopia, crearZip, escritorio, revisarCopia, secretosPropios } from './preparar-copia.js';

export const ZIP_VPS = 'ClipViral para el VPS (PRIVADO).zip';
// El VPS solo necesita el servidor y el código que sube a las redes (desktop/engine).
export const INCLUIR_VPS = [
  'Instalar en el VPS.bat',
  'GUIA-VPS.md',
  'README.md',
  'server/package.json',
  'server/package-lock.json',
  'server/.env.example',
  'server/src',
  'server/public',
  'server/scripts',
  'desktop/engine',
  // El bot de Discord (tickets y anuncios). Su token NO va: se pega en el VPS al instalarlo.
  'Instalar bot de Discord en el VPS.bat',
  'GUIA-DISCORD.md',
  'discord-bot/package.json',
  'discord-bot/package-lock.json',
  'discord-bot/.env.example',
  'discord-bot/src',
  'discord-bot/scripts',
];

/**
 * Copia de tus datos para el VPS en `outDir` (una foto de la base aunque el servidor esté encendido, la llave que cifra
 * tus tokens y server/.env). Sin lo programado ni videos de paso. Devuelve [{ rel, abs }] para el zip.
 */
export function copiaDeDatos({ dataDir, envFile, outDir }) {
  const out = [];
  const dbFile = path.join(dataDir, 'clipviral.db');
  if (fs.existsSync(dbFile)) {
    fs.mkdirSync(outDir, { recursive: true });
    const snap = path.join(outDir, 'clipviral.db');
    fs.rmSync(snap, { force: true });
    const src = new DatabaseSync(dbFile, { readOnly: true });
    try { src.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); } finally { src.close(); }
    const copy = new DatabaseSync(snap);
    try {
      const tables = new Set(copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
      for (const t of ['posts', 'post_files', 'relay_files']) if (tables.has(t)) copy.exec(`DELETE FROM ${t}`);
      copy.exec('VACUUM');
    } finally { copy.close(); }
    out.push({ rel: 'traer-datos/clipviral.db', abs: snap });
  }
  const key = path.join(dataDir, 'secret.key');
  if (fs.existsSync(key)) out.push({ rel: 'traer-datos/secret.key', abs: key });
  if (envFile && fs.existsSync(envFile)) out.push({ rel: 'traer-datos/.env', abs: envFile });
  return out;
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${pinta('92')('✔')} ${s}`);
const mal = (s) => say(`    ${pinta('91')('✖')} ${s}`);
const aviso = (s) => say(`    ${pinta('93')('!')} ${s}`);
const info = (s) => say(`    ${pinta('90')('·')} ${s}`);

async function main() {
  const destDir = process.argv[2] ? path.resolve(process.argv[2]) : escritorio();
  const zipPath = path.join(destDir, ZIP_VPS);
  const files = archivosDeLaCopia(ROOT, INCLUIR_VPS);
  ok(`${files.length} archivos del servidor (sin node_modules: se instalan solos en el VPS).`);
  const problemas = revisarCopia(ROOT, files, await secretosPropios());
  if (problemas.length) {
    mal('Encontré datos tuyos dentro del programa, así que no armé la copia:');
    problemas.forEach((p) => info(p));
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-vps-'));
  try {
    const dataDir = process.env.DATA_DIR || path.join(ROOT, 'server', 'data');
    const extras = copiaDeDatos({ dataDir, envFile: path.join(ROOT, 'server', '.env'), outDir: tmp });
    if (extras.some((x) => x.rel.endsWith('clipviral.db'))) ok('Tus datos van en la copia: tu cuenta, tus redes conectadas y tu clave de Claude.');
    else aviso('No encontré tus datos: en el VPS vas a crear tu cuenta de nuevo y conectar tus redes allá.');
    fs.mkdirSync(destDir, { recursive: true });
    crearZip(ROOT, files, zipPath, extras);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const mb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  ok(`Copia lista (${mb} MB): ${pinta('96')(zipPath)}`);
  aviso('Es PRIVADA: lleva tus conexiones. No se la pases a nadie y bórrala cuando termines de instalar.');
  if (!process.argv[2]) spawn('explorer.exe', [`/select,"${zipPath}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    mal(`No se pudo armar la copia: ${err?.message || err}`);
    process.exit(1);
  });
}
