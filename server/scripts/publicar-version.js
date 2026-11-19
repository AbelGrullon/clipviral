// Arma el instalador único de ClipViral (conectado a tu VPS) y, si quieres, lo sube al VPS como actualización.
// Todas las apps instaladas lo ven solas: "Nueva versión disponible" → "Actualizar ahora".
//
// Uso: node scripts/publicar-version.js            (lo abre "Publicar versión de ClipViral.bat")
//      node scripts/publicar-version.js --solo-subir <instalador.exe>
// Tu contraseña de administrador se escribe aquí (no se ve ni se guarda); solo se usa para entrar al VPS y subir el archivo.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as esperar } from 'node:timers/promises';
import { ROOT, preguntar, Cancelado } from './asistente.js';

const DESKTOP = path.join(ROOT, 'desktop');
const PKG = path.join(DESKTOP, 'package.json');
const DIRECCION = path.join(ROOT, 'servidor-central.txt');
const SALIDA = path.join(DESKTOP, 'dist-instalador');

/** Windows tenía un archivo ocupado (casi siempre el antivirus revisando ClipViral.exe recién copiado, o la app abierta). */
export const OCUPADO_RE = /EBUSY|EPERM|resource busy or locked|being used by another process/i;

/** Corre npx en desktop\ mostrando lo que dice y guardándolo (para saber si falló por un archivo ocupado). */
function correr(args) {
  return new Promise((resolve) => {
    const p = spawn('npx', args, { cwd: DESKTOP, shell: true, windowsHide: true });
    let texto = '';
    const pasa = (dest) => (d) => { texto += d; dest.write(d); };
    p.stdout.on('data', pasa(process.stdout));
    p.stderr.on('data', pasa(process.stderr));
    p.on('error', (err) => { texto += String(err?.message || err); });
    p.on('close', (code) => resolve({ code: code ?? 1, salida: texto }));
  });
}

/**
 * Corre electron-builder. Si Windows tiene ClipViral.exe ocupado un momento (antivirus), espera y lo intenta otra vez.
 * `salida`: carpeta donde deja el instalador (por defecto desktop\dist-instalador).
 */
export async function armarInstalador(base, { salida = SALIDA, intentos = 3, espera = 8000 } = {}) {
  const args = ['electron-builder', '--win', 'nsis', '--config', 'instalador.json', `-c.extraMetadata.servidorCentral=${base}`];
  if (salida !== SALIDA) args.push(`"-c.directories.output=${salida}"`);
  let r = { code: 1, salida: '' };
  for (let i = 1; i <= intentos; i++) {
    // Lo que quedó a medio armar de un intento anterior se borra (con reintentos por si sigue ocupado).
    try { fs.rmSync(path.join(salida, 'win-unpacked'), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }); } catch {}
    r = await correr(args);
    if (r.code === 0 || !OCUPADO_RE.test(r.salida) || i === intentos) return r;
    say();
    info(`Windows tenía ClipViral.exe ocupado un momento (casi siempre es el antivirus revisándolo). Lo intento otra vez (${i + 1} de ${intentos})…`);
    await esperar(espera);
  }
  return r;
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const say = (s = '') => process.stdout.write(`${s}\n`);
const ok = (s) => say(`    ${pinta('92')('✔')} ${s}`);
const mal = (s) => say(`    ${pinta('91')('✖')} ${s}`);
const info = (s) => say(`    ${pinta('90')('·')} ${s}`);
const titulo = (s) => { say(); say(`  ${pinta('1;96')(s)}`); };

export const VERSION_RE = /^\d+\.\d+\.\d+$/;
/** 1.0.9 → 1.0.10 */
export function siguienteVersion(v) {
  const [a, b, c] = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  return `${a}.${b}.${c + 1}`;
}
/** "midominio.duckdns.org" → "https://midominio.duckdns.org" (sin barra ni nada al final). */
export function limpiarDireccion(raw) {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const u = new URL(url);
  if (u.pathname.length > 1 || u.search) throw new Error('Pon solo la dirección del servidor, por ejemplo https://tu-vps.duckdns.org');
  return `${u.protocol}//${u.host}`;
}
/** Cambia solo el número de versión en package.json (sin tocar el resto del archivo). */
export function ponerVersion(texto, version) {
  return texto.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
}

async function revisarServidor(base) {
  try {
    const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    if (h?.ok !== true) throw new Error();
    return h;
  } catch { return null; }
}

async function subirArchivo(base, headers, url, campos, archivo, campo) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.set(k, v);
  form.set(campo, await fs.openAsBlob(archivo), path.basename(archivo));
  info(`Subiendo ${path.basename(archivo)} (${(fs.statSync(archivo).size / 1048576).toFixed(0)} MB)… puede tardar unos minutos.`);
  const r = await fetch(`${base}${url}`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(60 * 60000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `El VPS respondió ${r.status}`);
  return data;
}

async function subir(base, exe, version) {
  titulo('Subir la versión a tu VPS');
  const notas = (await preguntar('    ¿Qué trae esta versión? (una línea, opcional): ')).trim();
  const obligatoria = (await preguntar('    ¿Es obligatoria? (s/N): ')).trim().toLowerCase().startsWith('s');
  const correo = (await preguntar('    Tu correo de administrador en el VPS: ')).trim();
  const clave = await preguntar('    Tu contraseña (no se ve al escribir): ', { oculto: true });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: clave, device: 'Publicar versión' }), signal: AbortSignal.timeout(20000),
  });
  const sesion = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error(sesion.error || 'No pude entrar al VPS con ese correo y contraseña.');
  if (sesion.user?.role !== 'admin') throw new Error('Esa cuenta no es de administrador en el VPS.');
  const headers = { Authorization: `Bearer ${sesion.token}` };
  try {
    // Se sube UNA vez: el VPS arma solo el .zip de la web con este mismo instalador.
    const r = await subirArchivo(base, headers, '/api/admin/releases',
      { version, notes: notas || `Versión ${version}`, mandatory: obligatoria ? 'true' : 'false', web: 'true' }, exe, 'file');
    ok(`Actualización ${version} publicada. Las apps la verán en menos de 30 minutos (o al abrirse).`);
    if (r.descarga) ok(`La web ya descarga la versión ${version}: ${pinta('96')(`${base}/descargar`)}`);
    else mal(r.descargaError || 'Tu VPS no armó el .zip de la web (¿tiene el servidor viejo?). Actualiza el servidor del VPS o sube el .zip en el panel.');
  } finally {
    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers, signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
}

async function main() {
  const args = process.argv.slice(2);
  const pkgText = fs.readFileSync(PKG, 'utf8');
  const actual = JSON.parse(pkgText).version;

  titulo('1. Tu VPS');
  const guardada = fs.existsSync(DIRECCION) ? fs.readFileSync(DIRECCION, 'utf8').trim() : '';
  const resp = await preguntar(`    Dirección de tu VPS${guardada ? ` ${pinta('90')(`[Enter = ${guardada}]`)}` : ' (por ejemplo https://tu-vps.duckdns.org)'}: `);
  const base = limpiarDireccion(resp.trim() || guardada);
  if (!base) throw new Error('Hace falta la dirección de tu VPS.');
  fs.writeFileSync(DIRECCION, `${base}\n`);
  const h = await revisarServidor(base);
  if (h) ok(`Tu VPS contesta (${base}).`);
  else info(`Tu VPS no contesta ahora en ${base}. Igual puedo armar el instalador; súbelo cuando el VPS esté encendido.`);
  if (!base.startsWith('https://')) info('Ojo: sin https las contraseñas viajan sin cifrar. Usa la dirección con https (GUIA-VPS.md).');

  if (args[0] === '--solo-subir') {
    const exe = path.resolve(args[1] || '');
    const m = path.basename(exe).match(/(\d+\.\d+\.\d+)/);
    if (!fs.existsSync(exe) || !m) throw new Error('Indica el instalador: ClipViral-Setup-X.Y.Z.exe');
    await subir(base, exe, m[1]);
    return;
  }

  titulo('2. Número de versión');
  const propuesta = siguienteVersion(actual);
  const v = (await preguntar(`    Versión actual ${actual}. Versión nueva ${pinta('90')(`[Enter = ${propuesta}]`)}: `)).trim().replace(/^v/i, '') || propuesta;
  if (!VERSION_RE.test(v)) throw new Error('La versión debe ser como 1.2.3');
  fs.writeFileSync(PKG, ponerVersion(pkgText, v));
  ok(`Versión ${v}.`);

  titulo('3. Armar el instalador (tarda unos minutos)');
  const exe = path.join(SALIDA, `ClipViral-Setup-${v}.exe`);
  const r = await armarInstalador(base);
  if (r.code !== 0 || !fs.existsSync(exe)) {
    fs.writeFileSync(PKG, pkgText); // vuelve al número anterior
    if (OCUPADO_RE.test(r.salida)) {
      throw new Error('Windows no soltó el programa (ClipViral.exe) mientras se armaba. Si abriste ClipViral desde la carpeta '
        + 'dist-instalador\\win-unpacked, ciérralo. Espera un minuto y vuelve a abrir "Publicar versión de ClipViral.bat".');
    }
    throw new Error('No se pudo armar el instalador. Mira los mensajes de arriba.');
  }
  ok(`Instalador listo: ${pinta('96')(exe)} (${(fs.statSync(exe).size / 1048576).toFixed(0)} MB)`);
  info('Quien lo descarga crea su cuenta en tu VPS al abrir la app.');

  if (!h) { info('Cuando tu VPS esté encendido, súbelo en el panel de administración → Actualizaciones.'); return; }
  const si = (await preguntar('    ¿Subirla ya a tu VPS (actualización para las apps + descarga de la web)? (S/n): ')).trim().toLowerCase();
  if (si && !si.startsWith('s')) { info('No se subió. Puedes subirlo después en el panel de administración → Actualizaciones.'); return; }
  await subir(base, exe, v);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    if (err instanceof Cancelado) { say(); info('Cancelado.'); process.exit(2); }
    mal(err?.message || String(err));
    process.exit(1);
  });
}
