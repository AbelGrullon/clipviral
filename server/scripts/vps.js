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

// ---------- Caddy que ya tienes funcionando con otras páginas ----------
const INICIO = '# ClipViral (inicio) - lo agregó "Instalar en el VPS.bat"';
const FIN = '# ClipViral (fin)';
export const DOMINIO_SUGERIDO = 'cviral.duckdns.org';

/** El bloque de ClipViral para tu Caddyfile (marcado, para poder cambiarlo después sin tocar lo demás). */
export function caddyBlock(host, port) {
  return [INICIO, `${host} {`, '\tencode gzip', `\treverse_proxy 127.0.0.1:${port}`, '}', FIN].join('\n');
}

/** Pone (o cambia) el bloque de ClipViral en tu Caddyfile sin tocar tus otras páginas. */
export function ponerEnCaddyfile(texto, host, port) {
  const nl = /\r\n/.test(texto) ? '\r\n' : '\n';
  const block = caddyBlock(host, port).replace(/\n/g, nl);
  const i = texto.indexOf(INICIO);
  const j = i >= 0 ? texto.indexOf(FIN, i) : -1;
  if (i >= 0 && j > i) return texto.slice(0, i) + block + texto.slice(j + FIN.length);
  const base = texto.replace(/\s*$/, '');
  return `${base}${base ? nl + nl : ''}${block}${nl}`;
}

/** ¿Tu Caddyfile ya usa esa dirección en OTRO bloque (no en el de ClipViral)? */
export function hostEnOtroBloque(texto, host) {
  const i = texto.indexOf(INICIO);
  const j = i >= 0 ? texto.indexOf(FIN, i) : -1;
  const resto = i >= 0 && j > i ? texto.slice(0, i) + texto.slice(j + FIN.length) : texto;
  return resto.split(/\r?\n/).some((l) => !l.trim().startsWith('#')
    && l.split(/[\s,{]+/).map((w) => w.replace(/^https?:\/\//i, '').toLowerCase()).includes(host.toLowerCase()));
}

/** La ruta del Caddyfile, sacada de la línea con que se encendió Caddy (--config "C:\...\Caddyfile"). */
export function configDeLinea(cmd) {
  const m = String(cmd || '').match(/--config(?:=|\s+)(?:"([^"]+)"|(\S+))/i);
  return m ? (m[1] || m[2]) : '';
}

/** Pone (o cambia) una línea CLAVE=valor en server/.env. */
export function ponerEnEnv(texto, clave, valor) {
  const re = new RegExp(`^[ \\t]*#?[ \\t]*${clave}[ \\t]*=.*$`, 'm');
  const line = `${clave}=${valor}`;
  if (re.test(texto)) return texto.replace(re, line);
  return `${texto.replace(/\s*$/, '')}\n${line}\n`;
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
    // Solo se apaga el servidor de ClipViral: si otro programa tuyo usa ese puerto, no se toca.
    `Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"; if ($p.CommandLine -like '*src?index.js*' -or $p.CommandLine -like '*vps-servicio*') { Stop-Process -Id $_.OwningProcess -Force } }`,
    `Get-Process caddy | Where-Object { $_.Path -eq ${psq(CADDY)} } | Stop-Process -Force`,
  ].join('\r\n');
}

/** PowerShell que deja abiertos en el firewall de Windows solo los puertos que hacen falta. */
export function firewallScript(ports) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Get-NetFirewallRule -DisplayName 'ClipViral*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule",
    // Con tu Caddy delante (puertos 80 y 443 ya abiertos) no hace falta abrir nada más.
    ...(ports.length ? [`New-NetFirewallRule -DisplayName 'ClipViral' -Direction Inbound -Protocol TCP -LocalPort ${ports.map(Number).join(',')} -Action Allow | Out-Null`] : []),
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

/** Los Caddy que ya están encendidos en el VPS (que no son el de la carpeta https de ClipViral). */
function caddyFuncionando() {
  const r = powershell("Get-CimInstance Win32_Process -Filter \"Name='caddy.exe'\" | Select-Object ExecutablePath, CommandLine | ConvertTo-Json -Compress");
  if (!r.ok || !r.out) return [];
  try {
    const list = [].concat(JSON.parse(r.out.slice(r.out.indexOf(r.out.trim()[0]))));
    return list.filter((p) => p?.ExecutablePath && path.resolve(p.ExecutablePath).toLowerCase() !== path.resolve(CADDY).toLowerCase())
      .map((p) => ({ exe: p.ExecutablePath, config: configDeLinea(p.CommandLine) }));
  } catch { return []; }
}

/** ¿Algo que NO es ClipViral está usando ese puerto? */
function puertoOcupado(port) {
  const r = powershell(`Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").Name }`);
  return r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '';
}

/**
 * Agrega ClipViral a TU Caddy (el que ya sirve tus otras páginas): copia de respaldo, bloque marcado y "caddy reload".
 * Si Caddy no acepta el cambio, se deja tu Caddyfile como estaba.
 */
function agregarATuCaddy({ exe, config }, host, port) {
  const antes = fs.readFileSync(config, 'utf8');
  if (hostEnOtroBloque(antes, host)) return { ok: false, why: `tu Caddyfile ya usa ${host} en otro bloque. Quita ese bloque o usa otra dirección.` };
  const respaldo = `${config}.antes-de-clipviral.bak`;
  if (!fs.existsSync(respaldo)) fs.copyFileSync(config, respaldo);
  fs.writeFileSync(config, ponerEnCaddyfile(antes, host, port));
  const r = spawnSync(exe, ['reload', '--config', config, '--adapter', 'caddyfile'], { cwd: path.dirname(config), encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.status === 0) return { ok: true, respaldo };
  fs.writeFileSync(config, antes);
  return { ok: false, why: `Caddy no aceptó el cambio (${`${r.stderr || r.stdout || r.error?.message || ''}`.trim().split(/\r?\n/).pop()?.slice(0, 200)}). Dejé tu Caddyfile como estaba.` };
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
  info(`Con una dirección (por ejemplo ${DOMINIO_SUGERIDO}, gratis en duckdns.org) y Caddy, tu VPS tiene candado (https).`);
  const sugerida = prev || DOMINIO_SUGERIDO;
  let host = '';
  for (;;) {
    const a = cleanHost(await ask(`    ${negrita('¿Cuál es la dirección de ClipViral?')} (Enter = ${sugerida}; escribe "ip" para no usar dirección): `));
    host = a === 'ip' ? '' : (a || sugerida);
    if (!host || validHost(host)) break;
    aviso(`Esa dirección no se ve bien. Escríbela así: ${DOMINIO_SUGERIDO}`);
  }
  let url;
  let ports;
  let envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  fs.mkdirSync(HTTPS_DIR, { recursive: true });
  // ¿Ya tienes Caddy sirviendo otras páginas en este VPS? Entonces ClipViral se agrega a ESE Caddy (no se abre otro).
  const tuyo = host ? caddyFuncionando()[0] : null;
  let conTuCaddy = false;
  if (tuyo) {
    ok(`Encontré tu Caddy funcionando (${tuyo.exe}).`);
    let config = tuyo.config;
    if (!config || !fs.existsSync(config)) {
      const guess = path.join(path.dirname(tuyo.exe), 'Caddyfile');
      const a = (await ask(`    ¿Dónde está tu Caddyfile? (Enter = ${guess}): `)).trim().replace(/^"|"$/g, '');
      config = a || guess;
    }
    if (!fs.existsSync(config)) {
      aviso(`No encontré ${config}. Agrega esto a tu Caddyfile y recarga Caddy (caddy reload):`);
      say(caddyBlock(host, port).split('\n').map((l) => `      ${l}`).join('\n'));
    } else if ((await ask(`    ¿Agrego ClipViral a tu Caddyfile (${config})? Tus otras páginas no se tocan y guardo una copia antes. (S/n): `)).trim().toLowerCase().startsWith('n')) {
      aviso('No lo toqué. Agrega esto a tu Caddyfile y recarga Caddy (caddy reload):');
      say(caddyBlock(host, port).split('\n').map((l) => `      ${l}`).join('\n'));
    } else {
      const r = agregarATuCaddy({ exe: tuyo.exe, config }, host, port);
      if (r.ok) ok(`Agregué ClipViral a tu Caddyfile y recargué Caddy. Copia de antes: ${r.respaldo}`);
      else { mal(r.why); aviso('Agrega esto a tu Caddyfile a mano y recarga Caddy:'); say(caddyBlock(host, port).split('\n').map((l) => `      ${l}`).join('\n')); }
    }
    conTuCaddy = true;
  }
  if (conTuCaddy) {
    // Con tu Caddy delante, el servidor solo escucha dentro del VPS; no se enciende otro Caddy.
    fs.rmSync(CADDYFILE, { force: true });
    fs.writeFileSync(DOMINIO_TXT, host);
    envText = ponerEnEnv(envText, 'HOST', '127.0.0.1');
    fs.writeFileSync(envFile, envText);
    url = `https://${host}`;
    ports = [];
    ok(`Con candado (por tu Caddy): ${cian(url)}`);
  } else if (host && fs.existsSync(CADDY)) {
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
  if (!conTuCaddy && /^HOST=127\.0\.0\.1\s*$/m.test(envText)) {
    // Ya no hay Caddy delante: el servidor tiene que escuchar desde afuera otra vez.
    fs.writeFileSync(envFile, envText.replace(/^HOST=127\.0\.0\.1\s*$/m, '# HOST=127.0.0.1'));
  }
  await setPublicUrl(dataDir, url);

  paso(4, 'Encender el servidor');
  const ocupado = puertoOcupado(port);
  if (ocupado) {
    mal(`El puerto ${port} lo está usando otro programa de tu VPS (${ocupado}). Para no tocarlo, ClipViral no se encendió.`);
    info(`Abre server\\.env, cambia PORT=${port} por otro (por ejemplo PORT=4610) y vuelve a abrir este archivo.`);
    process.exit(1);
  }
  const fw = powershell(firewallScript(ports));
  if (!ports.length) ok('Firewall: no hace falta abrir nada (se entra por tu Caddy).');
  else if (fw.ok) ok(`Firewall de Windows: abrí el puerto ${ports.join(' y ')}.`);
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
  say(`  ${negrita('Listo.')}`);
  say(`    · La web de ClipViral (información, compra y descarga): ${cian(url)}`);
  say(`    · El panel de administración: ${cian(`${url}/admin/`)}`);
  say(`    · En tu PC, abre ${negrita('Publicar versión de ClipViral.bat')} con esta dirección: arma el instalador,`);
  say('      lo sube como actualización y deja el .zip para descargar desde la web.');
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
