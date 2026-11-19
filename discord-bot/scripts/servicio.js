// En el VPS lo enciende Windows al arrancar (tarea "ClipViral bot de Discord", la crea
// "Instalar bot de Discord en el VPS.bat"). Mantiene el bot encendido: si se apaga, lo vuelve a encender
// (espera más si se cae enseguida, hasta 1 minuto). Funciona aunque nadie esté conectado al Escritorio remoto.
// Registro: discord-bot/bot.log
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const RAIZ = path.resolve(import.meta.dirname, '..');
export const LOG = path.join(RAIZ, 'bot.log');
const MAX_LOG = 20 * 1024 * 1024;

function abrirLog(file) {
  try { if (fs.statSync(file).size > MAX_LOG) fs.renameSync(file, `${file}.1`); } catch {}
  return fs.openSync(file, 'a');
}
const hora = () => new Date().toLocaleString('es-DO', { hour12: false });

export function mantener({ cmd = process.execPath, args = ['--env-file-if-exists=.env', path.join(RAIZ, 'src', 'index.js')], cwd = RAIZ, log = LOG, primeraEspera = 2000 } = {}) {
  let espera = primeraEspera;
  let parado = false;
  let hijo = null;
  let timer = null;
  const encender = () => {
    if (parado) return;
    const fd = abrirLog(log);
    const inicio = Date.now();
    let otraVez = false;
    const reiniciar = (porque) => {
      if (otraVez) return;
      otraVez = true;
      try { fs.writeSync(fd, `[${hora()}] El bot ${porque}.${parado ? '' : ' Lo vuelvo a encender.'}\n`); fs.closeSync(fd); } catch {}
      if (parado) return;
      espera = Date.now() - inicio > 60000 ? primeraEspera : Math.min(espera * 2, 60000);
      timer = setTimeout(encender, espera);
    };
    fs.writeSync(fd, `\n[${hora()}] Encendiendo el bot de Discord\n`);
    try {
      hijo = spawn(cmd, args, { cwd, stdio: ['ignore', fd, fd], windowsHide: true });
    } catch (err) {
      return reiniciar(`no se pudo abrir (${err.message})`);
    }
    hijo.on('error', (err) => reiniciar(`no se pudo abrir (${err.message})`));
    hijo.on('exit', (code) => reiniciar(`se apagó (código ${code})`));
  };
  encender();
  return { parar() { parado = true; clearTimeout(timer); try { hijo?.kill(); } catch {} } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) mantener();
