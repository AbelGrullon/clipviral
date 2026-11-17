// Asistente de la consola de "Iniciar ClipViral.bat" (paso 3: tu cuenta).
// - Primera vez (no hay ningún administrador): pide nombre, correo y contraseña, crea la cuenta, ofrece pegar
//   la clave de Claude y deja la app con la sesión iniciada para no tener que escribirla otra vez.
// - Las demás veces: saluda por el nombre y avisa si falta algo.
// Sale con 0 si todo bien, 2 si la persona canceló (Ctrl+C) y 1 si algo falló.
//
// CLIPVIRAL_PERFIL: carpeta de datos de la app (por defecto %APPDATA%\ClipViral). Sirve para probar sin tocar la tuya.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BAT = path.join(ROOT, 'Iniciar ClipViral.bat');
const ICONO = path.join(ROOT, 'desktop', 'build', 'icon.ico');
const CLAVES_URL = 'https://console.anthropic.com/settings/keys';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- Pantalla ----------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const verde = pinta('92');
const rojo = pinta('91');
const amarillo = pinta('93');
const cian = pinta('96');
const gris = pinta('90');
const negrita = pinta('1');
const rosa = pinta('95');

const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${verde('✔')} ${s}`);
const info = (s) => say(`    ${gris('·')} ${s}`);
const aviso = (s) => say(`    ${amarillo('!')} ${s}`);
const mal = (s) => say(`    ${rojo('✖')} ${s}`);

function caja(lineas) {
  const ancho = Math.max(...lineas.map((l) => l.length)) + 2;
  say(`    ${rosa(`┌${'─'.repeat(ancho)}┐`)}`);
  for (const l of lineas) say(`    ${rosa('│')} ${l.padEnd(ancho - 1)}${rosa('│')}`);
  say(`    ${rosa(`└${'─'.repeat(ancho)}┘`)}`);
}

// ---------- Preguntas ----------
export class Cancelado extends Error {}

/**
 * Aplica lo que llegó del teclado (en modo crudo) a lo escrito hasta ahora, sin mostrar las letras.
 * Devuelve { valor, eco, fin } con fin = null, 'listo' (Enter) o 'cancelar' (Ctrl+C).
 */
export function teclas(valor, trozo) {
  let eco = '';
  for (const ch of String(trozo)) {
    if (ch === '\u0003') return { valor, eco, fin: 'cancelar' };
    if (ch === '\r' || ch === '\n') return { valor, eco, fin: 'listo' };
    if (ch === '\u001b') break; // flechas y otras teclas especiales: se ignoran
    if (ch === '\b' || ch === '\u007f') {
      if (valor) {
        valor = [...valor].slice(0, -1).join('');
        eco += '\b \b';
      }
      continue;
    }
    if (ch === '\u0015') { // Ctrl+U: borra todo
      eco += '\b \b'.repeat([...valor].length);
      valor = '';
      continue;
    }
    if (ch < ' ') continue;
    valor += ch;
    eco += '*';
  }
  return { valor, eco, fin: null };
}

function leerOculto(pregunta) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    process.stdout.write(pregunta);
    let valor = '';
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const onData = (trozo) => {
      const r = teclas(valor, trozo);
      valor = r.valor;
      if (r.eco) process.stdout.write(r.eco);
      if (!r.fin) return;
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (r.fin === 'cancelar') reject(new Cancelado());
      else resolve(valor);
    };
    input.on('data', onData);
  });
}

// Cuando las respuestas llegan por una tubería (pruebas), se leen línea por línea.
let tuberia = null;
function siguienteLinea() {
  if (!tuberia) {
    tuberia = { lineas: [], esperando: [], cerrada: false };
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (l) => {
      const w = tuberia.esperando.shift();
      if (w) w(l); else tuberia.lineas.push(l);
    });
    rl.on('close', () => {
      tuberia.cerrada = true;
      tuberia.esperando.splice(0).forEach((w) => w(null));
    });
  }
  if (tuberia.lineas.length) return Promise.resolve(tuberia.lineas.shift());
  if (tuberia.cerrada) return Promise.resolve(null);
  return new Promise((r) => tuberia.esperando.push(r));
}

async function preguntar(pregunta, { oculto = false } = {}) {
  if (!process.stdin.isTTY) {
    process.stdout.write(pregunta);
    const linea = await siguienteLinea();
    if (linea === null) throw new Cancelado();
    say(oculto ? '*'.repeat(Math.min(linea.length, 12)) : linea);
    return linea;
  }
  if (oculto) return leerOculto(pregunta);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.on('SIGINT', () => { rl.close(); say(); reject(new Cancelado()); });
    rl.question(pregunta, (respuesta) => { rl.close(); resolve(respuesta); });
  });
}

const siNo = async (pregunta, porDefecto = true) => {
  const r = (await preguntar(`${pregunta} ${gris(porDefecto ? '(S/n)' : '(s/N)')} `)).trim().toLowerCase();
  return r ? r.startsWith('s') || r.startsWith('y') : porDefecto;
};

// ---------- Validaciones (las mismas que el registro de la app) ----------
export function errorNombre(nombre) {
  const n = String(nombre || '').trim();
  return n.length < 2 || n.length > 60 ? 'Escribe tu nombre (de 2 a 60 letras).' : null;
}
export function errorCorreo(correo) {
  return EMAIL_RE.test(String(correo || '').trim()) ? null : 'Ese correo no parece válido. Ejemplo: nombre@gmail.com';
}
export function errorClave(clave) {
  const c = String(clave || '');
  if (c.length < 8) return 'La contraseña debe tener al menos 8 letras o números.';
  if (c.length > 200) return 'Esa contraseña es demasiado larga.';
  return null;
}

/** "hoy", "ayer", "hace 3 días"… a partir de una fecha de SQLite (UTC). */
export function hace(fechaSql, ahora = new Date()) {
  if (!fechaSql) return null;
  const t = new Date(`${String(fechaSql).replace(' ', 'T')}Z`);
  if (Number.isNaN(t.getTime())) return null;
  const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((dia(ahora) - dia(t)) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  return 'hace más de un mes';
}

export function saludoDelDia(hora = new Date().getHours()) {
  return hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
}

// ---------- Carpeta de la app y recuerdos ----------
export function perfilApp() {
  return process.env.CLIPVIRAL_PERFIL || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ClipViral');
}

/** Deja la sesión iniciada en la app (el mismo archivo que escribe la app al entrar). */
export function entrarSolo(createSession, userId, email) {
  const dir = perfilApp();
  fs.mkdirSync(dir, { recursive: true });
  const token = createSession(userId, `${os.hostname()} (Windows)`);
  fs.writeFileSync(path.join(dir, 'sesion.json'), JSON.stringify({ token, email }, null, 2));
}

/** Guarda dónde está ClipViral, por si alguien copia "Iniciar ClipViral.bat" a otro lugar (por ejemplo al escritorio). */
function recordarCarpeta() {
  try {
    const dir = perfilApp();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'carpeta.txt'), `${ROOT}${path.sep}`);
  } catch { /* no es importante */ }
}

function abrirNavegador(url) {
  spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function crearAccesoDirecto() {
  const ps = [
    "$d = [Environment]::GetFolderPath('Desktop')",
    "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'ClipViral.lnk'))",
    '$s.TargetPath = $env:CV_BAT',
    '$s.WorkingDirectory = $env:CV_ROOT',
    'if (Test-Path -LiteralPath $env:CV_ICO) { $s.IconLocation = $env:CV_ICO }',
    "$s.Description = 'Abrir ClipViral'",
    '$s.Save()',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    env: { ...process.env, CV_BAT: BAT, CV_ROOT: ROOT, CV_ICO: ICONO }, windowsHide: true, encoding: 'utf8', timeout: 30000,
  });
  return r.status === 0;
}

// ---------- Primera vez ----------
async function primeraVez({ db, createSession, crearAdmin, keyStatus, saveKey }) {
  say();
  caja([
    '¡Bienvenido a ClipViral!',
    'Es la primera vez que lo abres en esta PC.',
    'Vamos a crear tu cuenta de administrador.',
    'Toma menos de un minuto.',
  ]);
  say();

  let nombre;
  for (;;) {
    nombre = (await preguntar(`    ${negrita('Tu nombre:')} `)).trim();
    const e = errorNombre(nombre);
    if (!e) break;
    mal(e);
  }
  let correo;
  for (;;) {
    correo = (await preguntar(`    ${negrita('Tu correo:')} `)).trim().toLowerCase();
    const e = errorCorreo(correo);
    if (!e) break;
    mal(e);
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(correo)) {
    aviso('Ya hay una cuenta con ese correo en esta PC: la convierto en administrador con esta contraseña.');
  }
  info('Ahora inventa una contraseña. No se ve mientras escribes: es normal.');
  let clave;
  for (;;) {
    clave = await preguntar(`    ${negrita('Contraseña')} ${gris('(mínimo 8)')}${negrita(':')} `, { oculto: true });
    const e = errorClave(clave);
    if (e) { mal(e); continue; }
    const otra = await preguntar(`    ${negrita('Escríbela otra vez:')} `, { oculto: true });
    if (otra === clave) break;
    mal('No son iguales. Vamos de nuevo.');
  }

  const { id } = await crearAdmin({ email: correo, password: clave, name: nombre });
  const primerNombre = nombre.split(/\s+/)[0];
  ok(`¡Listo, ${primerNombre}! Tu cuenta de administrador está creada.`);
  info(`Con ${cian(correo)} y tu contraseña entras a la app y al panel de admin.`);

  await pedirClaveClaude({ keyStatus, saveKey });

  say();
  try {
    entrarSolo(createSession, id, correo);
    ok('La app va a entrar sola con tu cuenta: no tienes que escribirla otra vez.');
  } catch {
    aviso('No pude dejar la sesión lista: cuando abra la app, entra con tu correo y contraseña.');
  }

  // En el VPS (CLIPVIRAL_VPS) no hay app que abrir: no hace falta el acceso directo.
  if (process.platform === 'win32' && !process.env.CLIPVIRAL_VPS) {
    say();
    if (await siNo(`    ${negrita('¿Te pongo un acceso directo de ClipViral en el escritorio?')}`)) {
      if (crearAccesoDirecto()) ok('Acceso directo creado: la próxima vez ábrelo desde el escritorio.');
      else aviso('No pude crear el acceso directo. Puedes abrir este archivo como siempre.');
    }
  }
  return primerNombre;
}

async function pedirClaveClaude({ keyStatus, saveKey }) {
  const st = keyStatus();
  if (st.enabled) {
    ok(`La IA Pro ya tiene clave de Claude (${st.masked}).`);
    return;
  }
  say();
  say(`    ${negrita('Tu clave de Claude')} ${gris('(para la IA Pro: Claude elige los mejores momentos)')}`);
  info('La IA Pro usa tu propia cuenta de Claude: lo que gaste se cobra ahí.');
  info(`1) Entra a ${cian(CLAVES_URL)} y toca "Create Key".`);
  info('2) Pon saldo en "Billing": unos pocos dólares alcanzan para muchas horas de directos.');
  info('3) Copia la clave, pégala aquí (clic derecho o Ctrl+V) y pulsa Enter.');
  info(`Si no la tienes ahora, solo pulsa Enter: la pones después en la app (${negrita('Ajustes → Clave de Claude')}).`);
  info(`Escribe ${negrita('A')} y pulsa Enter para abrir esa página en el navegador.`);
  for (;;) {
    const raw = (await preguntar(`    ${negrita('Clave de Claude:')} `, { oculto: true })).trim();
    if (!raw) {
      info('Sin problema: mientras tanto la app funciona en modo Local.');
      return;
    }
    if (/^a(brir)?$/i.test(raw)) {
      abrirNavegador(CLAVES_URL);
      info('Abrí la página. Cuando copies la clave, pégala aquí.');
      continue;
    }
    say(`    ${gris('…')} Probando la clave con Claude (no cuesta nada)…`);
    const r = await saveKey(raw);
    if (r.ok) {
      ok(`¡Funciona! La IA Pro quedó activa con tu clave (${r.status.masked}).`);
      return;
    }
    mal(r.error);
    info('Pega otra, o pulsa Enter para dejarlo para después.');
  }
}

// ---------- Las demás veces ----------
function saludo(admin, { keyStatus }) {
  const primerNombre = admin.name.split(/\s+/)[0];
  const cuando = hace(admin.visto || admin.last_login);
  ok(`¡${saludoDelDia()}, ${negrita(primerNombre)}!${cuando && cuando !== 'hoy' ? ` Tu última visita fue ${cuando}.` : ''}`);
  const st = keyStatus();
  if (st.enabled) {
    ok(`IA Pro lista con tu clave de Claude (${st.masked}${st.source === 'env' ? ', del archivo .env' : ''}).`);
  } else if (st.unreadable) {
    aviso('Tu clave de Claude guardada ya no se puede leer. Ponla otra vez en la app: Ajustes → Clave de Claude.');
  } else {
    aviso('La IA Pro está apagada: falta tu clave de Claude.');
    info('Ponla en la app: Ajustes → Clave de Claude. El modo Local funciona igual.');
  }
  return primerNombre;
}

export function adminPrincipal(db) {
  return db.prepare(`SELECT u.id, u.name, u.email, u.last_login,
      (SELECT MAX(s.last_seen) FROM sessions s WHERE s.user_id = u.id) AS visto
    FROM users u WHERE u.role = 'admin' AND u.banned = 0
    ORDER BY COALESCE(visto, u.last_login, u.created_at) DESC LIMIT 1`).get();
}

async function main() {
  // Se cargan aquí para que las pruebas puedan importar las funciones de arriba sin abrir la base.
  const { db } = await import('../src/db.js');
  const { createSession } = await import('../src/auth.js');
  const { keyStatus, saveKey } = await import('../src/clave.js');
  const { crearAdmin } = await import('./crear-admin.js');

  const admin = adminPrincipal(db);
  const nombre = admin
    ? saludo(admin, { keyStatus })
    : await primeraVez({ db, createSession, crearAdmin, keyStatus, saveKey });
  recordarCarpeta();
  // El .bat lee esta línea para despedirse por el nombre.
  if (process.env.CLIPVIRAL_NOMBRE_EN) fs.writeFileSync(process.env.CLIPVIRAL_NOMBRE_EN, nombre);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().then(() => process.exit(0)).catch((err) => {
    if (err instanceof Cancelado) {
      say();
      aviso('Cancelado. Cuando quieras, vuelve a abrir "Iniciar ClipViral".');
      process.exit(2);
    }
    mal(`Algo falló: ${err?.message || err}`);
    process.exit(1);
  });
}
