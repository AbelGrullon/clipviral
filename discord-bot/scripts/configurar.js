// Prepara el bot de Discord de ClipViral. Lo abren:
//   "Encender bot de Discord.bat"                (en tu PC: para probarlo; el bot queda encendido en esa ventana)
//   "Instalar bot de Discord en el VPS.bat"      (en el VPS, con --vps: queda encendido siempre, aunque nadie esté conectado)
// Pasos: 1) el token del bot (lo pegas tú; no se ve en pantalla), 2) la dirección del servidor de ClipViral,
// 3) en el VPS: la clave para que el equipo vea las cuentas de los clientes, y la tarea que lo enciende sola.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { RAIZ, DOMINIO, enlaceInvitacion } from '../src/config.js';
import {
  TAREA, PLANTILLA_ENV, valorEnv, ponerEnEnv, puertoDelServidor, datosDelServidor, tokenParece, tieneMessageContent,
  esLocal, tareaScript, pararScript,
} from '../src/entorno.js';
import { LOG } from './servicio.js';

const VPS = process.argv.includes('--vps');
const ENV = path.join(RAIZ, '.env');
const PROYECTO = path.resolve(RAIZ, '..');
const SERVER = path.join(PROYECTO, 'server');
const PORTAL = 'https://discord.com/developers/applications';

// ---------- Pantalla ----------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const negrita = pinta('1');
const cian = pinta('96');
const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${pinta('92')('✔')} ${s}`);
const mal = (s) => say(`    ${pinta('91')('✖')} ${s}`);
const aviso = (s) => say(`    ${pinta('93')('!')} ${s}`);
const info = (s) => say(`    ${pinta('90')('·')} ${s}`);
const TOTAL = VPS ? 4 : 2;
const paso = (n, t) => { say(); say(`  ${pinta('95')(`Paso ${n} de ${TOTAL}`)} · ${negrita(t)}`); };

// ---------- Preguntas ----------
let lector = null;
let cerrado = false;
const lineas = [];
const esperando = [];
function lineaDeTuberia() {
  if (!lector) {
    lector = readline.createInterface({ input: process.stdin });
    lector.on('line', (l) => { const w = esperando.shift(); if (w) w(l); else lineas.push(l); });
    lector.on('close', () => { cerrado = true; esperando.splice(0).forEach((w) => w('')); });
  }
  if (lineas.length) return Promise.resolve(lineas.shift());
  if (cerrado) return Promise.resolve('');
  return new Promise((r) => esperando.push(r));
}

function preguntar(texto) {
  if (!process.stdin.isTTY) { process.stdout.write(texto); return lineaDeTuberia().then((l) => String(l ?? '').trim()); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(texto, (a) => { rl.close(); resolve(String(a).trim()); }));
}

/** Pide algo sin mostrarlo (el token). Al pegar se ven asteriscos. */
function preguntarOculto(texto) {
  if (!process.stdin.isTTY) { process.stdout.write(texto); return lineaDeTuberia().then((l) => { say(); return String(l ?? '').trim(); }); }
  return new Promise((resolve) => {
    const input = process.stdin;
    process.stdout.write(texto);
    let valor = '';
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const alTeclear = (trozo) => {
      for (const ch of trozo) {
        if (ch === '\r' || ch === '\n') {
          input.removeListener('data', alTeclear);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          return resolve(valor.trim());
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') {
          if (valor) { valor = valor.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue;
        valor += ch;
        process.stdout.write('*');
      }
    };
    input.on('data', alTeclear);
  });
}

const siNo = async (texto, porDefecto = false) => {
  const r = (await preguntar(`${texto} ${porDefecto ? '(S/n)' : '(s/N)'}: `)).toLowerCase();
  return r ? r.startsWith('s') : porDefecto;
};

// ---------- Discord y ClipViral ----------
async function aplicacionDelToken(token) {
  try {
    const res = await fetch('https://discord.com/api/v10/applications/@me', {
      headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (https://discord.com, 1.0.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) return { invalido: true };
    if (!res.ok) return { error: `Discord contestó ${res.status}` };
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function salud(url) {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function estadoBot(url, clave) {
  try {
    const res = await fetch(`${url}/api/bot/estado`, { headers: { 'x-bot-clave': clave }, signal: AbortSignal.timeout(8000) });
    return res.status;
  } catch {
    return 0;
  }
}

function powershell(script) {
  const file = path.join(os.tmpdir(), `clipviral-bot-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(file, `﻿${script}`, 'utf8'); // con BOM: Windows PowerShell lee bien las tildes
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const leer = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const dominioGuardado = () => {
  const d = leer(path.join(PROYECTO, 'https', 'dominio.txt')).trim();
  if (d) return `https://${d.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')}`;
  const central = leer(path.join(PROYECTO, 'servidor-central.txt')).trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(central) ? central : DOMINIO;
};

// ---------- Pasos ----------
async function pasoToken(env) {
  paso(1, 'El token del bot');
  const guardado = valorEnv(env, 'DISCORD_TOKEN');
  let token = null;
  let app = null;
  if (guardado) {
    ok('Ya hay un token guardado.');
    if (!(await siNo('    ¿Quieres poner otro?'))) {
      app = await aplicacionDelToken(guardado);
      if (app.invalido) mal('El token guardado ya no sirve (quizás lo cambiaste en Discord). Pega el nuevo:');
      else token = guardado;
    }
  }
  if (!token) {
    info(`Se saca en ${cian(PORTAL)} → tu aplicación → ${negrita('Bot')} → ${negrita('Reset Token')} → Copy.`);
    info('Los pasos con dibujos están en GUIA-DISCORD.md. No se lo pases a nadie: es como la contraseña del bot.');
    for (let intento = 1; ; intento++) {
      const t = await preguntarOculto('    Pega el token (clic derecho o Ctrl+V; se ven asteriscos) y pulsa Enter: ');
      if (!t) { mal('No pegaste nada.'); if (intento >= 3) return null; continue; }
      if (!tokenParece(t)) { mal('Eso no parece un token de bot (son tres partes separadas por puntos).'); if (intento >= 3) return null; continue; }
      app = await aplicacionDelToken(t);
      if (app.invalido) { mal('Discord dice que ese token no sirve. Copia uno nuevo con "Reset Token".'); if (intento >= 3) return null; continue; }
      token = t;
      break;
    }
  }
  if (app?.error) {
    aviso(`No pude preguntarle a Discord (${app.error}). Lo guardo igual; si está mal, el bot lo dirá al encender.`);
    return { token, app: null };
  }
  ok(`Token correcto: el bot se llama ${negrita(app.bot?.username || app.name)}.`);
  for (let i = 0; !tieneMessageContent(app.flags); i++) {
    aviso(`Falta encender ${negrita('MESSAGE CONTENT INTENT')} (lo necesita para guardar la conversación de cada ticket).`);
    info(`En ${cian(PORTAL)} → tu aplicación → Bot → Privileged Gateway Intents → enciéndelo y pulsa ${negrita('Save Changes')}.`);
    if (i >= 2) { aviso('Sigo sin verlo encendido. Sigo igual; el bot avisará si Discord no lo deja entrar.'); break; }
    await preguntar('    Cuando lo hayas encendido, pulsa Enter: ');
    const otra = await aplicacionDelToken(token);
    if (otra.error || otra.invalido) break;
    app = otra;
    if (tieneMessageContent(app.flags)) ok('Listo, ya está encendido.');
  }
  return { token, app };
}

async function pasoServidor(env) {
  paso(2, 'El servidor de ClipViral');
  let url;
  let web = valorEnv(env, 'CLIPVIRAL_WEB');
  if (VPS) {
    const puerto = puertoDelServidor(leer(path.join(SERVER, '.env')));
    url = `http://127.0.0.1:${puerto}`;
    info(`El bot habla con el servidor por dentro del VPS (${url}).`);
    const sugerida = web || dominioGuardado();
    const r = await preguntar(`    Dirección pública de tu web [Enter = ${sugerida}]: `);
    web = (r || sugerida).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(web)) web = `https://${web}`;
  } else {
    const sugerida = valorEnv(env, 'CLIPVIRAL_URL') || dominioGuardado();
    const r = await preguntar(`    Dirección del servidor de ClipViral [Enter = ${sugerida}]: `);
    url = (r || sugerida).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!esLocal(url)) web = '';
  }
  const h = await salud(url);
  if (h?.ok) ok(`El servidor de ClipViral contesta en ${url}.`);
  else aviso(`El servidor de ClipViral no contesta en ${url}. El bot igual funciona; las noticias de versiones saldrán cuando conteste.`);
  return { url, web };
}

/** En el VPS: una clave que solo saben el bot y el servidor, para que el equipo vea la cuenta del cliente. */
async function pasoClave(env, url) {
  paso(3, 'Conectar con las cuentas de los clientes');
  const datos = datosDelServidor(SERVER, leer(path.join(SERVER, '.env')));
  const archivo = path.join(datos, 'bot-discord.clave');
  let clave = valorEnv(env, 'CLIPVIRAL_BOT_CLAVE');
  if (!clave || leer(archivo).trim() !== clave) {
    clave = crypto.randomBytes(32).toString('base64url');
    try {
      fs.mkdirSync(datos, { recursive: true });
      fs.writeFileSync(archivo, `${clave}\n`);
    } catch (err) {
      mal(`No pude guardar la clave en ${archivo}: ${err.message}`);
      return '';
    }
  }
  const s = await estadoBot(url, clave);
  if (s === 200) ok('Conectado: en cada ticket nuevo, el equipo verá el plan y los pagos de ese cliente.');
  else if (s === 404) aviso('El servidor de ClipViral de este VPS es de antes del bot. Actualízalo (GUIA-VPS.md: "Para actualizar") y vuelve a abrir este instalador.');
  else if (s === 0) aviso('El servidor de ClipViral no contesta ahora. La conexión funcionará cuando esté encendido.');
  else aviso(`El servidor contestó ${s} al probar la clave. Vuelve a abrir este instalador.`);
  return clave;
}

async function pasoTarea() {
  paso(4, 'Dejarlo siempre encendido');
  powershell(pararScript({ botDir: RAIZ, excepto: process.pid }));
  const desde = (() => { try { return fs.statSync(LOG).size; } catch { return 0; } })();
  const r = powershell(tareaScript({ node: process.execPath, botDir: RAIZ }));
  if (!r.ok) { mal(`No pude crear la tarea "${TAREA}": ${r.out}`); return false; }
  ok(`Tarea "${TAREA}" creada: se enciende sola con el VPS y, si se cae, vuelve.`);
  info('Esperando a que el bot entre a Discord...');
  for (let i = 0; i < 45; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const nuevo = leer(LOG).slice(desde);
    if (/LISTO/.test(nuevo)) { ok('El bot está encendido y conectado a Discord.'); return true; }
    const problema = nuevo.split('\n').find((l) => /token|MESSAGE CONTENT|No pude conectar|Ya hay un bot/i.test(l));
    if (problema) { mal(problema.replace(/^\[[^\]]*\]\s*/, '')); return false; }
  }
  aviso(`El bot tarda en conectar. Mira el registro: ${LOG}`);
  return false;
}

async function main() {
  if (VPS) { // en la PC, "Encender bot de Discord.bat" ya puso el título
    say();
    say(`  ${pinta('95')('╔════════════════════════════════════════════╗')}`);
    say(`  ${pinta('95')('║')}  ${negrita(cian('►  ClipViral · bot de Discord en tu VPS'))}    ${pinta('95')('║')}`);
    say(`  ${pinta('95')('╚════════════════════════════════════════════╝')}`);
  }

  let env = leer(ENV) || PLANTILLA_ENV;
  const t = await pasoToken(env);
  if (!t) { mal('Sin token no puedo seguir. Vuelve a abrir este archivo cuando lo tengas (GUIA-DISCORD.md, paso 2).'); process.exitCode = 1; return; }
  env = ponerEnEnv(env, 'DISCORD_TOKEN', t.token);

  const s = await pasoServidor(env);
  env = ponerEnEnv(env, 'CLIPVIRAL_URL', s.url);
  env = ponerEnEnv(env, 'CLIPVIRAL_WEB', s.web);

  if (VPS) env = ponerEnEnv(env, 'CLIPVIRAL_BOT_CLAVE', await pasoClave(env, s.url));
  else if (!valorEnv(env, 'CLIPVIRAL_BOT_CLAVE')) info('Desde esta PC el equipo no verá el plan de cada cliente en los tickets: eso se conecta al instalarlo en el VPS.');

  fs.writeFileSync(ENV, env);
  ok('Guardado en discord-bot\\.env (no lo compartas).');

  let encendido = true;
  if (VPS) encendido = await pasoTarea();

  say();
  if (t.app?.id) {
    say(`  ${negrita('Invita el bot a tu servidor de Discord')} (si ya está adentro, no hace falta):`);
    say(`    ${cian(enlaceInvitacion(t.app.id))}`);
    info('Ábrelo en el navegador, elige tu servidor y pulsa Autorizar. El bot arma solo los canales.');
  }
  if (VPS && encendido) {
    say();
    say(`  ${negrita('Listo.')} El bot queda encendido en el VPS. Si en tu PC tienes "Encender bot de Discord.bat" abierto, ciérralo.`);
  }
}

main().catch((err) => { mal(err.message); process.exitCode = 1; });
