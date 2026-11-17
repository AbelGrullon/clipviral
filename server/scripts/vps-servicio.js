// Lo enciende Windows al arrancar el VPS (tarea programada "ClipViral servidor", la crea "Instalar en el VPS.bat").
// Mantiene encendidos el servidor de ClipViral y, si lo configuraste, Caddy (el candado https). Si uno se apaga, lo
// vuelve a encender. Funciona aunque nadie esté conectado al Escritorio remoto.
// Registros: server/servidor.log y https/caddy.log.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SERVER = path.resolve(import.meta.dirname, '..');
export const ROOT = path.resolve(SERVER, '..');
export const HTTPS_DIR = path.join(ROOT, 'https');
export const CADDY = path.join(HTTPS_DIR, 'caddy.exe');
export const CADDYFILE = path.join(HTTPS_DIR, 'Caddyfile');
const MAX_LOG = 20 * 1024 * 1024;

/** Abre el registro para agregar (si pasa de 20 MB, guarda el viejo como .1). */
function openLog(file) {
  try { if (fs.statSync(file).size > MAX_LOG) fs.renameSync(file, `${file}.1`); } catch {}
  return fs.openSync(file, 'a');
}
const stamp = () => new Date().toLocaleString('es');

/**
 * Enciende un programa y lo vuelve a encender si se apaga (espera más si se cae enseguida, hasta 1 minuto).
 * Devuelve { stop() } para las pruebas.
 */
export function keep(name, cmd, args, opts, logFile, { firstWait = 2000 } = {}) {
  let wait = firstWait;
  let stopped = false;
  let child = null;
  let timer = null;
  const start = () => {
    if (stopped) return;
    const fd = openLog(logFile);
    const started = Date.now();
    let again = false;
    const restart = (why) => {
      if (again) return;
      again = true;
      try { fs.writeSync(fd, `[${stamp()}] ${name}: ${why}.${stopped ? '' : ' Lo vuelvo a encender.'}\n`); fs.closeSync(fd); } catch {}
      if (stopped) return;
      wait = Date.now() - started > 60000 ? firstWait : Math.min(wait * 2, 60000);
      timer = setTimeout(start, wait);
    };
    fs.writeSync(fd, `\n[${stamp()}] Encendiendo ${name}\n`);
    try {
      child = spawn(cmd, args, { ...opts, stdio: ['ignore', fd, fd], windowsHide: true });
    } catch (err) {
      return restart(`no se pudo abrir (${err.message})`);
    }
    child.on('error', (err) => restart(`no se pudo abrir (${err.message})`));
    child.on('exit', (code) => restart(`se apagó (código ${code})`));
  };
  start();
  return { stop() { stopped = true; clearTimeout(timer); try { child?.kill(); } catch {} } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const conHttps = fs.existsSync(CADDY) && fs.existsSync(CADDYFILE);
  // Con Caddy delante, el servidor solo escucha dentro del VPS: desde internet se entra por https.
  keep('el servidor de ClipViral', process.execPath,
    ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', 'src/index.js'],
    { cwd: SERVER, env: { ...process.env, ...(conHttps ? { HOST: '127.0.0.1' } : {}) } },
    path.join(SERVER, 'servidor.log'));
  if (conHttps) {
    keep('el candado https (Caddy)', CADDY, ['run', '--config', CADDYFILE, '--adapter', 'caddyfile'],
      { cwd: HTTPS_DIR, env: { ...process.env, XDG_DATA_HOME: path.join(HTTPS_DIR, 'datos'), XDG_CONFIG_HOME: path.join(HTTPS_DIR, 'config') } },
      path.join(HTTPS_DIR, 'caddy.log'));
  }
}
