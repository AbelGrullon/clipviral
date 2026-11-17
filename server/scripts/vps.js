// Instala (o actualiza) el servidor de ClipViral en tu VPS con Windows. Lo abre "Instalar en el VPS.bat" como administrador.
//  1. Trae tus datos de la copia (solo la primera vez: si el VPS ya tiene los suyos, no los toca) y borra esa copia.
//  2. Si no hay cuenta, la crea (como en tu PC).
//  3. Pregunta tu dirección (por ejemplo miclipviral.duckdns.org). Con Caddy en la carpeta https, pone el candado (https).
//  4. Abre el puerto en el firewall de Windows, crea la tarea "ClipViral servidor" (se enciende sola con el VPS,
//     aunque nadie esté conectado) y la enciende.
//  5. Revisa que conteste y te dice qué dirección poner en la app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { SERVER, ROOT, HTTPS_DIR, CADDY, CADDYFILE } from './vps-servicio.js';

export const TASK = 'ClipViral servidor';
const TRAER = path.join(ROOT, 'traer-datos');
const DOMINIO_TXT = path.join(HTTPS_DIR, 'dominio.txt');
const CADDY_URL = 'https://caddyserver.com/download';

// ---------- Piezas (se prueban en server/test/vps.test.js) ----------
export const validHost = (h) => /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(String(h || ''));

/** Quita https://, barras y espacios de lo que escribió la persona. */
export const cleanHost = (h) => String(h || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();

export function caddyfile(host, port) {
  return [
    '# Lo escribió "Instalar en el VPS.bat". Caddy saca y renueva solo el certificado https (Let\'s Encrypt).',
    `${host} {`,
    `\treverse_proxy 127.0.0.1:${port}`,
    '}',
    '',
  ].join('\n');
}

/**
 * Trae los datos de la copia (traer-datos) si este VPS todavía no tiene. Siempre borra traer-datos (tiene tus tokens).
 * Devuelve 'traidos' | 'ya-tenia' | 'sin-copia'.
 */
export function importarDatos({ traer = TRAER, dataDir, serverDir = SERVER }) {
  if (!fs.existsSync(path.join(traer, 'clipviral.db'))) {
    fs.rmSync(traer, { recursive: true, force: true });
    return 'sin-copia';
  }
  let r = 'ya-tenia';
  if (!fs.existsSync(path.join(dataDir, 'clipviral.db'))) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(path.join(traer, 'clipviral.db'), path.join(dataDir, 'clipviral.db'));
    if (fs.existsSync(path.join(traer, 'secret.key'))) fs.copyFileSync(path.join(traer, 'secret.key'), path.join(dataDir, 'secret.key'));
    if (fs.existsSync(path.join(traer, '.env')) && !fs.existsSync(path.join(serverDir, '.env'))) fs.copyFileSync(path.join(traer, '.env'), path.join(serverDir, '.env'));
    r = 'traidos';
  }
  fs.rmSync(traer, { recursive: true, force: true });
  return r;
}

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** PowerShell que crea (o cambia) la tarea que mantiene encendido el servidor, y la enciende. */
export function taskScript({ node = process.execPath, serverDir = SERVER } = {}) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$a = New-ScheduledTaskAction -Execute ${psq(node)} -Argument ${psq(`"${path.join(serverDir, 'scripts', 'vps-servicio.js')}"`)} -WorkingDirectory ${psq(serverDir)}`,
    '$t = New-ScheduledTaskTrigger -AtStartup',
    '$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    `Register-ScheduledTask -TaskName ${psq(TASK)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${psq(TASK)}`,
  ].join('\r\n');
}

/** PowerShell que apaga lo que estaba encendido (la tarea, el servidor en ese puerto y Caddy). */
export function stopScript(port) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Stop-ScheduledTask -TaskName ${psq(TASK)}`,
    `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`,
    `Get-Process caddy | Where-Object { $_.Path -eq ${psq(CADDY)} } | Stop-Process -Force`,
  ].join('\r\n');
}

/** PowerShell que deja abiertos en el firewall de Windows solo los puertos que hacen falta. */
export function firewallScript(ports) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Get-NetFirewallRule -DisplayName 'ClipViral*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
    `New-NetFirewallRule -DisplayName 'ClipViral' -Direction Inbound -Protocol TCP -LocalPort ${ports.map(Number).join(',')} -Action Allow | Out-Null`,
  ].join('\r\n');
}

/** Lee el puerto de server/.env (4600 si no dice). */
export function portFrom(envFile) {
  try {
    const m = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d{2,5})\s*$/m);
    if (m) return Number(m[1]);
  } catch {}
  return 4600;
}

// ---------- Pantalla ----------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const cian = pinta('96');
const negrita = pinta('1');
const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${pinta('92')('✔')} ${s}`);
const mal = (s) => say(`    ${pinta('91')('✖')} ${s}`);
const aviso = (s) => say(`    ${pinta('93')('!')} ${s}`);
const info = (s) => say(`    ${pinta('90')('·')} ${s}`);
const paso = (n, t) => { say(); say(`  ${pinta('95')(`Paso ${n} de 5`)} · ${negrita(t)}`); };

function powershell(script) {
  const file = path.join(os.tmpdir(), `clipviral-vps-${process.pid}-${Date.now()}.ps1`);
  // Con BOM para que Windows PowerShell lea bien las tildes.
  fs.writeFileSync(file, `﻿${script}`, 'utf8');
  try {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function health(url, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const h = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
      if (h?.ok) return h;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function publicIp() {
  try {
    const ip = (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(6000) }).then((r) => r.text())).trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null;
  } catch { return null; }
}

function setPublicUrl(dataDir, url) {
  return import('node:sqlite').then(({ DatabaseSync }) => {
    const db = new DatabaseSync(path.join(dataDir, 'clipviral.db'));
    try {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('public_url', url);
    } finally { db.close(); }
  });
}

async function usuarios(dataDir) {
  const file = path.join(dataDir, 'clipviral.db');
  if (!fs.existsSync(file)) return 0;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM users').get().n; } catch { return 0; } finally { db.close(); }
}

async function main() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    mal(`Tienes Node.js ${process.versions.node} y ClipViral necesita la 22.13 o más nueva. Instala la versión LTS desde nodejs.org y vuelve a abrir este archivo.`);
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR || path.join(SERVER, 'data');
  const envFile = path.join(SERVER, '.env');

  paso(1, 'Tus datos');
  const port = portFrom(fs.existsSync(envFile) ? envFile : path.join(TRAER, '.env'));
  info('Apago lo que estaba encendido (si es una actualización)...');
  powershell(stopScript(port));
  const datos = importarDatos({ dataDir });
  if (datos === 'traidos') ok('Traje tus datos: tu cuenta, tus redes conectadas y tu clave de Claude. Borré la copia que venía en el zip.');
  else if (datos === 'ya-tenia') ok('Este VPS ya tiene sus datos: no los cambié. Borré la copia que venía en el zip.');
  else info('No vino ninguna copia de datos (si es una actualización, está bien).');
  if (!fs.existsSync(envFile) && fs.existsSync(path.join(SERVER, '.env.example'))) {
    fs.copyFileSync(path.join(SERVER, '.env.example'), envFile);
    ok('Creé el archivo de ajustes del servidor (server\\.env).');
  }

  paso(2, 'Tu cuenta');
  if (await usuarios(dataDir)) {
    ok('Tu cuenta ya está en este servidor.');
  } else {
    info('Este servidor todavía no tiene cuenta: vamos a crearla (como en tu PC).');
    const r = spawnSync(process.execPath, ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', 'scripts/asistente.js'],
      { cwd: SERVER, stdio: 'inherit', env: { ...process.env, CLIPVIRAL_VPS: '1', CLIPVIRAL_PERFIL: path.join(SERVER, 'data', 'perfil-vps') } });
    if (r.status !== 0) { mal('No se creó la cuenta. Vuelve a abrir este archivo para intentarlo otra vez.'); process.exit(1); }
  }

  paso(3, 'Tu dirección');
  let prev = '';
  try { prev = fs.readFileSync(DOMINIO_TXT, 'utf8').trim(); } catch {}
  info('Con una dirección (por ejemplo miclipviral.duckdns.org, gratis en duckdns.org) y Caddy, tu VPS tiene candado (https).');
  let host = '';
  for (;;) {
    const a = cleanHost(await ask(`    ${negrita('¿Cuál es la dirección de tu VPS?')} ${prev ? `(Enter = ${prev})` : '(Enter = sin dirección, usar la IP)'}: `));
    host = a || prev;
    if (!host || validHost(host)) break;
    aviso('Esa dirección no se ve bien. Escríbela así: miclipviral.duckdns.org');
  }
  let url;
  let ports;
  fs.mkdirSync(HTTPS_DIR, { recursive: true });
  if (host && fs.existsSync(CADDY)) {
    fs.writeFileSync(CADDYFILE, caddyfile(host, port));
    fs.writeFileSync(DOMINIO_TXT, host);
    url = `https://${host}`;
    ports = [80, 443];
    ok(`Con candado: ${cian(url)}`);
  } else {
    if (host) {
      fs.writeFileSync(DOMINIO_TXT, host);
      aviso(`Para el candado (https) falta Caddy. Descárgalo de ${CADDY_URL} (Windows, amd64), guárdalo como`);
      aviso(`${CADDY} y vuelve a abrir este archivo. Por ahora queda sin candado.`);
    }
    fs.rmSync(CADDYFILE, { force: true });
    const ip = host || (await publicIp()) || 'LA-IP-DE-TU-VPS';
    url = `http://${ip}:${port}`;
    ports = [port];
    aviso(`Sin candado: ${cian(url)}. Sirve para probar, pero tu contraseña y tus conexiones viajan sin cifrar.`);
  }
  await setPublicUrl(dataDir, url);

  paso(4, 'Encender el servidor');
  const fw = powershell(firewallScript(ports));
  if (fw.ok) ok(`Firewall de Windows: abrí el puerto ${ports.join(' y ')}.`);
  else aviso(`No pude abrir el firewall (${fw.out.slice(0, 200)}). Ábrelo a mano: puerto ${ports.join(' y ')} TCP de entrada.`);
  const task = powershell(taskScript());
  if (!task.ok) {
    mal(`No pude crear la tarea que mantiene encendido el servidor: ${task.out.slice(0, 300)}`);
    info('¿Abriste este archivo con clic derecho → Ejecutar como administrador?');
    process.exit(1);
  }
  ok(`Creé la tarea "${TASK}": se enciende sola cuando arranca el VPS, aunque nadie esté conectado.`);
  info('Esperando a que encienda...');
  const local = await health(`http://127.0.0.1:${port}`, 60000);
  if (!local) {
    mal('El servidor no encendió. Mira el registro: server\\servidor.log');
    process.exit(1);
  }
  ok(local.publica ? 'El servidor está encendido y publica solo lo programado.' : 'El servidor está encendido, pero no puede publicar (falta desktop\\engine en la copia).');

  paso(5, 'Probar desde internet');
  if (url.startsWith('https://')) {
    info('Caddy está sacando el certificado (puede tardar un par de minutos la primera vez)...');
    if (await health(url, 150000)) ok(`Tu VPS contesta con candado en ${cian(url)}`);
    else aviso(`Todavía no contesta ${url}. Revisa en duckdns.org que la dirección apunte a la IP de este VPS, y mira https\\caddy.log. El servidor ya quedó encendido.`);
  } else {
    info(`Desde tu PC, abre ${url}/api/health en el navegador: debe decir "ok":true.`);
  }

  say();
  say(`  ${negrita('Listo. Ahora, en tu PC:')}`);
  say(`    1. Abre ClipViral → Ajustes → ${negrita('Servidor de ClipViral')}.`);
  say(`    2. Pega ${cian(url)} → Probar → Usar mi VPS.`);
  say('    3. Cierra y abre ClipViral.');
  say();
  info('Ya puedes cerrar el Escritorio remoto: el servidor sigue encendido.');
  info('Borra el zip PRIVADO de este VPS y de tu PC: tenía tus conexiones.');
  info('Para actualizar: descomprime la copia nueva encima de esta carpeta y vuelve a abrir este archivo.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    mal(`Algo falló: ${err?.message || err}`);
    process.exit(1);
  });
}
