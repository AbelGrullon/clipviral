const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, powerSaveBlocker, nativeTheme, Notification } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createComponents } = require('./engine/components');
const { ClipSession, ytdlpProblem } = require('./engine/session');
const localAi = require('./engine/localai');
const { Oido } = require('./engine/sonido');
const vista = require('./engine/vista');
const { CamStore } = require('./engine/camara');
const { checkSystem, findOllama, freeSpace } = require('./engine/requisitos');
const perf = require('./engine/rendimiento');
const { UploadQueue } = require('./engine/subidas');
const { UPLOADERS, buildCaption, tiktokCreatorInfo } = require('./engine/redes');
const { autoPlan, checkTiktokApproval, tiktokPostOptions, AUTO_REDES, SOLA_REDES } = require('./engine/publicar');
const { trimTarget, smartTrim } = require('./engine/recorte');
const { transcribeSegment } = require('./engine/transcribe');
const { nextSlot } = require('./engine/calendario');
const { Vigilante, channelUrl } = require('./engine/vigilante');
const { Sugerencias, buildSnapshot } = require('./engine/sugerencias');
const { Estadisticas, FETCHERS } = require('./engine/estadisticas');
const { Agente } = require('./engine/agente/agente');
const { learn } = require('./engine/aprendizaje');
const { youtubeChannel, instagramAccount, reportInput, igUsername } = require('./engine/competencia');
const { run, download, youtubeId, sleep, fmtClock } = require('./engine/util');
const { createRemote, isLocalUrl } = require('./engine/servidor');
const appConfig = require('./app-config.json');
const { Licencia, generateKey, parseMachineCode, PLANES } = require('./engine/licencia');

// Versión para clientes (su propio instalador): sin agente ni publicar en redes, con su servidor dentro de la app
// y una licencia de 30 días que activa con una clave. En desarrollo se prueba con CLIPVIRAL_EDICION=cliente.
const EDICION = appConfig.edicion || require('./package.json').edicion || (!app.isPackaged && process.env.CLIPVIRAL_EDICION) || '';
const CLIENTE = EDICION === 'cliente';
// Versión para administradores/amigos (su instalador): el servidor va dentro de la app (puerto 4600, el que usan
// las redes para volver después de conectar) y la primera vez se crea la cuenta de administrador.
const ADMIN_APP = EDICION === 'admin';
const INTERNO = CLIENTE || ADMIN_APP;
// Instalador único (el que se descarga y se actualiza desde tu VPS): todos entran con su cuenta en el servidor central.
// La dirección se pone al empaquetar ("Empaquetar ClipViral.bat" → extraMetadata.servidorCentral).
const CENTRAL = INTERNO ? '' : String(require('./package.json').servidorCentral || appConfig.servidorCentral
  || (!app.isPackaged && process.env.CLIPVIRAL_CENTRAL) || '').trim().replace(/\/+$/, '');
// En desarrollo se puede probar en otro puerto (para no chocar con el servidor que ya tengas encendido).
const ADMIN_PORT = (!app.isPackaged && Number(process.env.CLIPVIRAL_PUERTO)) || 4600;

app.setAppUserModelId(CLIENTE ? 'com.clipviral.cliente' : 'com.clipviral.app');
// Carpeta de datos aparte: así la versión de clientes no se mezcla con la tuya si están en la misma PC.
if (CLIENTE) app.setPath('userData', path.join(app.getPath('appData'), 'ClipViral Cliente'));
nativeTheme.themeSource = 'dark';

// Modo captura (solo en desarrollo): abre la app, toma una foto de la ventana y se cierra.
const captureArg = !app.isPackaged && process.argv.find((a) => a.startsWith('--captura='));
// En modo captura se puede usar otra carpeta de datos (para no tocar tu sesión real).
if (captureArg && process.env.CAPTURA_DATOS) app.setPath('userData', process.env.CAPTURA_DATOS);
const userData = app.getPath('userData');
const files = {
  settings: path.join(userData, 'ajustes.json'),
  session: path.join(userData, 'sesion.json'),
  clips: path.join(userData, 'clips.json'),
  uploads: path.join(userData, 'subidas.json'),
  perf: path.join(userData, 'rendimiento.json'),
  piloto: path.join(userData, 'piloto.json'),
  stats: path.join(userData, 'estadisticas.json'),
  competencia: path.join(userData, 'competencia.json'),
  sugerencias: path.join(userData, 'sugerencias.json'),
};
// Cookies de YouTube (Ajustes): cuando YouTube pide confirmar que no eres un robot, yt-dlp entra con tu sesión.
const COOKIES_FILE = path.join(userData, 'youtube-cookies.txt');
// Cámara + juego: las cámaras marcadas a mano, por canal.
const camStore = new CamStore(path.join(userData, 'camaras.json'));
const COOKIE_BROWSERS = ['edge', 'chrome', 'firefox', 'brave'];
function cookieArgs() {
  const c = getSettings().ytCookies;
  if (c === 'archivo') return fs.existsSync(COOKIES_FILE) ? ['--cookies', COOKIES_FILE] : [];
  return COOKIE_BROWSERS.includes(c) ? ['--cookies-from-browser', c] : [];
}
const components = createComponents(path.join(userData, 'bin'), { extraYtdlpArgs: () => cookieArgs() });
// Oído de la IA local: detector de risas, gritos, aplausos… (se baja una vez, unos 90 MB).
const oido = new Oido(path.join(userData, 'bin', 'modelos-ia'));

// ---------- Licencia (versión para clientes) ----------
const licencia = CLIENTE ? new Licencia({ file: path.join(userData, 'licencia.json'), publicKeyPem: fs.readFileSync(path.join(__dirname, 'licencia-publica.pem'), 'utf8') }) : null;
const licenciaActiva = () => !CLIENTE || licencia.status().active;
// Lo único que funciona sin licencia: la pantalla de activación (y lo que necesita para dibujarse).
const SIN_LICENCIA = new Set(['app:info', 'settings:get', 'auth:session', 'licencia:estado', 'licencia:activar', 'shell:open', 'clipboard:write', 'clipboard:read']);
if (CLIENTE) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, (e, ...args) => {
    if (!SIN_LICENCIA.has(channel) && !licenciaActiva()) throw new Error('Tu licencia de ClipViral venció. Pon una clave nueva para seguir.');
    return fn(e, ...args);
  });
}
// Tus claves para clientes (solo en tu versión): la clave privada nunca sale de esta carpeta.
const LICENCIAS_DIR = path.join(userData, 'licencias');

let win;
let session = null;
let sessionLogs = [];
let blocker = null;
let gpu = { hasNvidia: false, name: null, vramGb: 0 };

// ---------- Archivos de datos ----------
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Texto de cada publicación. {gancho} es la primera frase que engancha (si no hay, va el título).
const DEFAULT_TEMPLATE = '{gancho}\n\n{descripcion}\n\n{hashtags}\n\n🎥 Créditos: {canal}';
const OLD_TEMPLATE = '{titulo}\n\n{descripcion}\n\n{hashtags}\n\n🎥 Créditos: {canal}';
const NETWORKS = ['youtube', 'tiktok', 'instagram', 'facebook'];

const DEFAULTS = {
  outputDir: path.join(app.getPath('videos'), 'ClipViral'),
  mode: 'local',
  clipSeconds: 45,
  style: 'blur',
  subtitles: true,
  subColor: 'amarillo',
  sensitivity: 'media',
  maxPerHour: 8,
  // IA Pro: qué tan fino trabaja Claude ('normal', 'alta' u 'maxima'). Más precisión = más caro y un poco más lento.
  precision: 'normal',
  whisperModel: 'small',
  language: 'auto',
  whisperGpu: true,
  gpuEncode: true,
  ollamaModel: '',
  // IA local que ve y escucha: el detector de sonidos (risas, gritos…) y el modelo de Ollama que mira el video.
  oido: true,
  visionModel: '',
  serverUrl: appConfig.serverUrl,
  // '' (sin cookies), 'archivo' (cookies.txt) o un navegador: edge, chrome, firefox, brave.
  ytCookies: '',
  lastUrl: '',
  notifications: true,
  // Para grabar el video de la revisión de Meta: el menú, Redes, Crear publicación y Estadísticas se ven en inglés.
  pantallasEnIngles: false,
  // Cómo se ven los clips
  look: {
    subs: { color: 'amarillo', textColor: 'blanco', size: 'normal', position: 'abajo', font: 'Arial Black', wordsPerLine: 3, uppercase: true, animation: 'pop' },
    titleBanner: { enabled: false, seconds: 4, color: 'rosa' },
    watermark: { text: '', position: 'abajo-der' },
    logo: { file: '', position: 'arriba-der', size: 18, opacity: 85 },
    quality: '1080',
    fps: 30,
    zoom: 1,
    // Efectos: espejo, velocidad (1 a 2), imagen de fondo propia, quitar silencios y efecto de voz.
    efectos: { espejo: false, velocidad: 1, fondo: '', silencios: false, voz: 'normal' },
  },
  // Subida a redes. publicarSola (apagado por defecto): Instagram y Facebook publican solos a la hora sugerida;
  // en TikTok el usuario aprueba cada clip y se publica solo a su hora. YouTube siempre a mano.
  // TikTok no guarda una privacidad por defecto: su auditoría pide elegirla en cada video.
  redes: {
    plantilla: DEFAULT_TEMPLATE,
    youtube: { privacy: 'public', shortsTag: true },
    tiktok: { publicarSola: false },
    // recortar: si el clip dura más de 40 s, a Instagram se sube una copia de 39 s (por la API rechaza los largos a cuentas nuevas).
    instagram: { shareToFeed: true, publicarSola: false, recortar: true },
    facebook: { publicarSola: false },
    // servidorPublica: lo programado se manda al servidor de ClipViral y él lo publica a su hora. Con el servidor en un
    // VPS, se publica aunque la PC esté apagada; con el de esta PC, mientras esté encendida.
    servidorPublica: true,
  },
  // Clips sugeridos: en qué redes publica el usuario (para la hora y el texto de cada una)
  sugerencias: { redes: ['tiktok', 'instagram', 'youtube', 'facebook'] },
  // Piloto automático: busca solo qué clipear
  piloto: {
    activo: false,
    canales: [],            // { url, nombre, id, permiso, directos, videos }
    temas: [],              // { texto }
    soloConPermiso: true,   // solo clipea solo los canales marcados "Tengo permiso"; lo demás queda como sugerencia
    revisarCadaMin: 20,
    maxVideosDia: 6,
    edadMaxHoras: 48,
    duracionMaxMin: 180,
    minVistasTema: 20000,   // vistas mínimas en el día para que un video de un tema cuente
    usarIa: true,           // con IA Pro, Claude descarta resultados que no tienen que ver con tus temas
    usarAprendido: true,    // usa la duración de clip que mejor le funciona a tus redes
  },
  // Cuentas de la competencia: { plataforma: 'youtube'|'instagram', usuario }
  competencia: { cuentas: [], informeAuto: true },
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
/**
 * Quita los ajustes de la publicación automática de una versión anterior (`auto`, `minScore`, calendario).
 * La de ahora usa `publicarSola` y empieza apagada. Devuelve true si había alguno.
 */
function dropAutoPublish(saved) {
  const r = saved?.redes;
  if (!r || typeof r !== 'object') return false;
  let changed = false;
  for (const k of ['calendario', 'intervaloMin']) if (k in r) { delete r[k]; changed = true; }
  for (const p of NETWORKS) {
    for (const k of ['auto', 'minScore']) if (r[p] && k in r[p]) { delete r[p][k]; changed = true; }
  }
  // TikTok: la privacidad se elige en cada video (no puede haber una por defecto).
  if (r.tiktok && 'privacy' in r.tiktok) { delete r.tiktok.privacy; changed = true; }
  // Si nunca cambió el texto de la plantilla, pasa a la nueva (empieza con el gancho).
  if (r.plantilla === OLD_TEMPLATE) { delete r.plantilla; changed = true; }
  return changed;
}

const getSettings = () => {
  const saved = readJson(files.settings, {});
  dropAutoPublish(saved);
  const s = deepMerge(DEFAULTS, saved);
  if (saved.subColor && !saved.look?.subs?.color) s.look.subs.color = saved.subColor; // ajustes de la versión anterior
  return s;
};

// ---------- Servidor ----------
// El de esta PC (lo enciende Iniciar ClipViral.bat) o el de tu VPS (Ajustes → Servidor de ClipViral).
function serverUrl() {
  if (CLIENTE) return `http://127.0.0.1:${localPort}`;
  const saved = String(getSettings().serverUrl || '').trim();
  // Instalador único: siempre el servidor central (un administrador puede elegir otro remoto en Ajustes).
  if (CENTRAL) return (saved && !isLocalUrl(saved) ? saved : CENTRAL).replace(/\/+$/, '');
  // Versión de administradores: el servidor de adentro, salvo que hayas elegido tu VPS en Ajustes.
  if (ADMIN_APP && !(saved && !isLocalUrl(saved))) return `http://localhost:${localPort || ADMIN_PORT}`;
  // Si elegiste tu VPS, se usa ese aunque el .bat haya encendido el servidor de esta PC.
  if (saved && !isLocalUrl(saved)) return saved.replace(/\/+$/, '');
  return (process.env.CLIPVIRAL_SERVER || saved || appConfig.serverUrl).replace(/\/+$/, '');
}
function token() { return readJson(files.session, {}).token || null; }

async function api(pathname, body, method, timeoutMs = 120000) {
  if (INTERNO && (CLIENTE || isLocalUrl(serverUrl()))) {
    try { await startLocalServer(); } catch (err) { throw Object.assign(new Error(`No se pudo encender ClipViral por dentro: ${err.message}`), { status: 0 }); }
  }
  let res;
  try {
    res = await fetch(serverUrl() + '/api' + pathname, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw Object.assign(new Error('No hay conexión con el servidor de ClipViral. Revisa tu internet.'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

// ---------- Servidor dentro de la app (versión para clientes) ----------
// Corre en la misma PC con el Node que trae la app y solo escucha en esta PC (127.0.0.1).
let localServer = null;
let localPort = 0;
const internoSecreto = require('node:crypto').randomBytes(24).toString('hex');
let serverReady = null;
const serverDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'servidor') : path.join(__dirname, '..', 'server'));
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('node:net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
/** ¿Hay algo escuchando en ese puerto de esta PC? */
function portBusy(port) {
  return new Promise((resolve) => {
    const s = require('node:net').connect({ port, host: '127.0.0.1' });
    s.setTimeout(1500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}
function startLocalServer() {
  if (serverReady) return serverReady;
  serverReady = (async () => {
    // Administradores: siempre el 4600. Si ya hay un ClipViral encendido ahí (por ejemplo con Iniciar ClipViral.bat), se usa ese.
    if (ADMIN_APP) {
      const h = await fetch(`http://127.0.0.1:${ADMIN_PORT}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()).catch(() => null);
      if (h?.ok) { localPort = ADMIN_PORT; return; }
    }
    const port = ADMIN_APP ? ADMIN_PORT : await freePort();
    if (ADMIN_APP && await portBusy(port)) throw new Error(`el puerto ${port} lo está usando otro programa. Reinicia la PC y vuelve a abrir ClipViral`);
    const dataDir = path.join(userData, 'servidor');
    fs.mkdirSync(dataDir, { recursive: true });
    const log = fs.openSync(path.join(userData, 'servidor.log'), 'a');
    const child = require('node:child_process').fork(path.join(serverDir(), 'src', 'index.js'), [], {
      execArgv: ['--disable-warning=ExperimentalWarning'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', EDICION, INTERNO_SECRETO: internoSecreto, DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' },
      stdio: ['ignore', log, log, 'ipc'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { child.kill(); reject(new Error('tardó demasiado en arrancar')); }, 30000);
      child.on('message', (m) => { if (m?.listo) { clearTimeout(t); resolve(); } });
      child.once('exit', (code) => { clearTimeout(t); reject(new Error(`se cerró (código ${code}). El detalle está en ${path.join(userData, 'servidor.log')}`)); });
    });
    // Si se cae más tarde, la próxima consulta lo vuelve a encender.
    child.once('exit', () => { if (localServer === child) { localServer = null; serverReady = null; } });
    localServer = child;
    localPort = port;
  })().catch((err) => { serverReady = null; throw err; });
  return serverReady;
}
app.on('will-quit', () => { localServer?.kill(); });

/** La cuenta de la versión para clientes: una sola, se crea y se entra sola (el cliente nunca ve usuario ni contraseña). */
async function localLogin() {
  const file = path.join(userData, 'cuenta-local.json');
  let c = readJson(file, null);
  if (!c?.email) {
    c = { email: 'cliente@clipviral.local', password: require('node:crypto').randomBytes(24).toString('base64url') };
    writeJson(file, c);
  }
  let data;
  try { data = await api('/auth/login', { email: c.email, password: c.password, device: deviceName() }); } catch {
    const name = (os.userInfo().username || 'Cliente').slice(0, 60).padEnd(2, ' ');
    data = await api('/auth/register', { name, email: c.email, password: c.password, acceptTerms: true, device: deviceName() });
  }
  writeJson(files.session, { token: data.token, email: data.user.email });
}

/** La cuenta toma el plan de la clave de licencia: Local o Claude (con la clave de Claude del cliente). */
async function syncPlan(plan) {
  await startLocalServer();
  const res = await fetch(`${serverUrl()}/api/interno/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-interno': internoSecreto },
    body: JSON.stringify({ plan }), signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('No se pudo aplicar el plan de tu licencia.');
}

// ---------- Ventana ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1020,
    minHeight: 680,
    show: false,
    backgroundColor: '#07070d',
    title: 'ClipViral',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#c9c9de', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !captureArg },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!captureArg) return win.show();
    win.setPosition(-3000, 0);
    win.showInactive();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (session && session.state !== 'done') {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning', buttons: ['Seguir grabando', 'Salir de todos modos'], defaultId: 0, cancelId: 0,
        title: 'Grabación en curso', message: 'Hay una grabación en curso. Si sales, se detiene y los clips que falten no se crearán.',
      });
      if (choice === 0) e.preventDefault();
      else session.stop({ now: true });
    }
  });

  if (captureArg) {
    const out = path.resolve(captureArg.split('=')[1]);
    win.webContents.on('console-message', (ev) => console.log(`[consola] ${ev.message || ''}`));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.CAPTURA_JS) { await win.webContents.executeJavaScript(process.env.CAPTURA_JS); await new Promise((r) => setTimeout(r, 1500)); }
      console.log('[estado]', await win.webContents.executeJavaScript("['splash','auth','main'].map((id) => id + ':' + (document.getElementById(id)?.className ?? 'quitado')).join(' ')"));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(out, img.toPNG());
      console.log(`Captura guardada en ${out}`);
      app.exit(0);
    }, Number(process.env.CAPTURA_ESPERA || 3500)));
  }
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

app.whenReady().then(async () => {
  run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeoutMs: 5000 })
    .then(({ out }) => {
      const [name, mem] = out.trim().split('\n')[0].split(',').map((x) => x.trim());
      gpu = { hasNvidia: true, name: name.replace(/^NVIDIA\s+/i, ''), vramGb: (Number(mem) || 0) / 1024 };
    })
    .catch(() => {});
  components.cleanLeftovers();
  createWindow();
  setupUploads();
  setupSugerencias();
  setupStats();
  setupPiloto();
  setupCompetencia();
  if (!CLIENTE) setupAgente();
  if (INTERNO) {
    // Se enciende ya, así está listo cuando el cliente activa o entra.
    startLocalServer().catch((err) => console.error('Servidor interno:', err.message));
    // Si la licencia vence con la app abierta: se detiene lo que esté grabando y vuelve la pantalla de activación.
    setInterval(() => {
      if (licenciaActiva()) return;
      if (session && session.state !== 'done') session.stop({ now: true });
      send('licencia:vencida', licencia.status());
    }, 5 * 60000);
  }
  // Mantiene yt-dlp al día (YouTube cambia seguido).
  setTimeout(() => components.updateYtdlp().then((r) => r.updated && console.log('yt-dlp actualizado')), 8000);
});

function notify(title, body) {
  if (!getSettings().notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'build', 'icon.png'), silent: false });
  n.on('click', () => { if (win) { win.show(); win.focus(); } });
  n.show();
}

// ---------- Subidas a redes ----------
let uploads;
const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
/** Sube el clip al servidor para que Instagram lo descargue (solo si la subida directa no funciona). */
async function relayPut(file) {
  const fd = new FormData();
  fd.append('file', await fs.openAsBlob(file, { type: 'video/mp4' }), 'clip.mp4');
  let res;
  try {
    res = await fetch(`${serverUrl()}/api/social/relay`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd, signal: AbortSignal.timeout(15 * 60000) });
  } catch {
    throw new Error('Instagram: no se pudo enviar el video. Revisa tu internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Instagram: ${data.error || `error ${res.status}`}`), { status: res.status });
  return data;
}

/**
 * Instagram (más de 40 s, si el ajuste está encendido) y Facebook (más de 90 s): se sube una copia más corta.
 * Claude mira el clip y deja lo más interesante con cortes saltados; sin Claude, el principio del clip.
 * La copia va a una carpeta temporal y se borra al terminar. El clip original no cambia.
 */
const trimCache = new Map(); // qué partes dejar de cada clip (para no preguntarle a Claude otra vez en un reintento)
async function trimCopy(job, onNote) {
  const target = trimTarget(job, getSettings().redes);
  if (!target) return null;
  const s = getSettings();
  const st = components.status();
  const whisperOk = !!st.whisper && !!st.models?.[s.whisperModel]?.installed;
  const transcribe = async (file, dir) => {
    if (!whisperOk) return null;
    const opts = { ffmpeg: components.paths.ffmpeg, whisper: components.paths.whisper, model: components.paths.model(s.whisperModel), language: s.language || 'auto' };
    const useGpu = st.whisperFlavor === 'gpu' && s.whisperGpu;
    return transcribeSegment({ ...opts, useGpu }, file, dir).catch((err) => (useGpu ? transcribeSegment({ ...opts, useGpu: false }, file, dir) : Promise.reject(err)));
  };
  if (trimCache.size > 200) trimCache.clear();
  return smartTrim(job, target, {
    ffmpeg: components.paths.ffmpeg,
    transcribe,
    ask: (body) => api('/ai/recorte', { ...body, precision: s.precision }, 'POST', 5 * 60000),
    gpu: gpu.hasNvidia && s.gpuEncode,
    tmpDir: os.tmpdir(),
    onNote,
    cache: trimCache,
  });
}

/** La PC estaba apagada a la hora sugerida: la próxima hora buena de esa red (sin chocar con otras subidas). */
function lateSlot(job) {
  const taken = uploads.list().filter((j) => j.id !== job.id && j.platform === job.platform && ['pendiente', 'subiendo', 'publicado'].includes(j.status))
    .map((j) => j.publishedAt || j.scheduledAt);
  const learnedHours = learned?.ready && Object.keys(learned.bestHours || {}).length ? learned.bestHours : null;
  return nextSlot({ platform: job.platform, taken, learnedHours });
}

// ---------- Publicar desde el servidor ----------
// El servidor (de esta PC o del VPS) dice si sabe publicar solo lo programado (/api/health → publica).
let serverCaps = { url: null, ok: false, publica: false, checkedAt: 0 };
async function refreshServerCaps(force = false) {
  const url = serverUrl();
  if (!force && serverCaps.url === url && Date.now() - serverCaps.checkedAt < 60000) return serverCaps;
  try {
    const h = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    serverCaps = { url, ok: h?.ok === true, publica: !!h?.publica, api: h?.api || 0, checkedAt: Date.now() };
  } catch {
    // Sin conexión: se mantiene lo último que se supo de ese mismo servidor.
    serverCaps = { ...(serverCaps.url === url ? serverCaps : { publica: false }), url, ok: false, checkedAt: Date.now() };
  }
  return serverCaps;
}
const SERVER_NETS = ['facebook', 'instagram', 'youtube', 'tiktok'];
const serverPublishes = (job) => getSettings().redes.servidorPublica !== false && serverCaps.publica && serverCaps.url === serverUrl()
  && !!token() && SERVER_NETS.includes(job.platform);
const remotePublisher = createRemote({ serverUrl, token, api, enabled: serverPublishes });

function setupUploads() {
  refreshServerCaps(true).catch(() => {});
  setInterval(() => refreshServerCaps().catch(() => {}), 5 * 60000);
  uploads = new UploadQueue({
    file: files.uploads,
    uploaders: UPLOADERS,
    getToken: (platform) => api(`/social/${platform}/token`, {}),
    onResult: (platform, ok) => api(`/social/${platform}/log`, { ok }).catch(() => {}),
    relay: { put: relayPut, remove: (id) => api(`/social/relay/${id}`, null, 'DELETE') },
    prepare: trimCopy,
    onLate: lateSlot,
    remote: remotePublisher,
  });
  uploads.on('update', (job) => send('uploads:update', job));
  uploads.on('done', (job) => {
    notify(`Publicado en ${NAMES[job.platform]}`, job.title);
    // En Clips sugeridos esa red queda como subida (aunque después se limpie la lista de subidas).
    if (sugerencias) { sugerencias.setHecha(job.clipId, job.platform, job.publishedAt); send('sug:update', sugSnapshot()); }
  });
  uploads.on('failed', (job) => {
    notify(`No se pudo subir a ${NAMES[job.platform]}`, job.error || job.title);
    // Si falló una publicación automática, no se vuelve a programar sola: el usuario decide (Reintentar).
    if (job.origen === 'sola') sugerencias?.skipAuto(job.clipId, job.platform);
  });
  // Lo que quedó programado por una versión anterior (otros ajustes) se cancela.
  const cancelled = uploads.cancelAuto();
  if (cancelled) {
    const n = cancelled === 1 ? 'publicación automática' : 'publicaciones automáticas';
    setTimeout(() => notify('Publicaciones de una versión anterior', `Se cancelaron ${cancelled} ${n}. Si quieres que ClipViral publique solo, enciéndelo en Clips sugeridos.`), 5000);
  }
  // Limpia del archivo de ajustes lo de la versión anterior.
  const saved = readJson(files.settings, null);
  if (saved && dropAutoPublish(saved)) writeJson(files.settings, saved);
}

/**
 * Prepara una subida (ahora o a su hora), con el texto de la plantilla o el que se pase.
 * overrides: title, caption, privacy, scheduledAt, origen ('manual' | 'sola' | 'aprobado'), tiktok (aprobación), sugId, reprogramar.
 */
function queueUpload(clip, platform, overrides = {}) {
  const s = getSettings();
  const cfg = s.redes[platform] || {};
  let title = overrides.title ?? clip.title;
  let caption = overrides.caption ?? buildCaption(s.redes.plantilla, clip, { minuto: fmtClock(clip.start || 0) });
  if (platform === 'youtube' && cfg.shortsTag && !/#shorts/i.test(`${title} ${caption}`)) caption = `${caption}\n\n#Shorts`;
  if (platform === 'youtube') title = title.slice(0, 100);
  return uploads.add({
    clip,
    platform,
    title,
    caption,
    tags: clip.hashtags,
    privacy: platform === 'youtube' ? (overrides.privacy ?? cfg.privacy) : undefined,
    shareToFeed: cfg.shareToFeed !== false,
    scheduledAt: overrides.scheduledAt || Date.now(),
    origen: overrides.origen || 'manual',
    tiktok: overrides.tiktok || null,
    sugId: overrides.sugId || null,
    reprogramar: !!overrides.reprogramar,
  });
}

// ---------- Publicación automática ----------
let autoBusy = false;
/**
 * Programa solos los clips sugeridos en las redes con "Publicar sola" encendido (Instagram y Facebook), a su hora sugerida
 * y con el texto de esa red. TikTok no entra aquí: ahí el usuario aprueba cada clip. Devuelve cuántos programó.
 */
async function autoSchedule() {
  if (autoBusy || !sugerencias || !uploads || !token()) return 0;
  const s = getSettings();
  const on = AUTO_REDES.filter((r) => s.redes[r]?.publicarSola);
  if (!on.length) return 0;
  autoBusy = true;
  try {
    const connected = (await socialList().catch(() => [])).filter((p) => p.connected).map((p) => p.id);
    const plan = autoPlan({ items: sugSnapshot().items, redesOn: on, connected, jobs: uploads.list() });
    if (!plan.length) return 0;
    const clips = readJson(files.clips, []);
    let n = 0;
    for (const p of plan) {
      const clip = clips.find((c) => c.id === p.clipId);
      if (clip && queueUpload(clip, p.red, { title: p.title, caption: p.caption, scheduledAt: p.at, origen: 'sola', sugId: p.sugId, reprogramar: true })) n += 1;
    }
    if (n) send('sug:update', sugSnapshot());
    return n;
  } finally {
    autoBusy = false;
  }
}
let autoTimer = null;
const autoSoon = () => { clearTimeout(autoTimer); autoTimer = setTimeout(() => autoSchedule().catch((err) => console.error('publicar sola:', err.message)), 2000); };

let socialCache = { at: 0, platforms: [] };
async function socialList(force) {
  if (!force && Date.now() - socialCache.at < 60000) return socialCache.platforms;
  const { platforms } = await api('/social');
  socialCache = { at: Date.now(), platforms };
  return platforms;
}

// ---------- Clips sugeridos (listos para que el usuario los publique) ----------
let sugerencias;
function sugSnapshot() {
  const s = getSettings();
  const ids = new Set(sugerencias.list().map((i) => i.clipId));
  const clips = readJson(files.clips, []).filter((c) => ids.has(c.id) && fs.existsSync(c.file));
  return buildSnapshot({
    store: sugerencias.list(),
    clips,
    jobs: uploads.list(),
    learnedHours: learned?.ready && Object.keys(learned.bestHours || {}).length ? learned.bestHours : null,
    redes: s.sugerencias.redes,
    plantilla: s.redes.plantilla,
    shortsTag: s.redes.youtube?.shortsTag !== false,
  });
}
function setupSugerencias() {
  sugerencias = new Sugerencias({ file: files.sugerencias });
  sugerencias.on('update', () => { send('sug:update', sugSnapshot()); autoSoon(); });
  // Revisa cada 30 minutos si hay clips por programar solos (por ejemplo, si se conectó una red o había días llenos).
  setInterval(autoSoon, 30 * 60000);
  setTimeout(autoSoon, 15000);
}
ipcMain.handle('sug:list', () => sugSnapshot());

/** Un botón de la tarjeta: "Programar a la hora sugerida" o "Publicar ahora" (Instagram y Facebook). */
ipcMain.handle('sug:publish', async (e, { id, red, when }) => {
  if (red === 'tiktok') throw new Error('TikTok pide que apruebes cada video: usa "Aprobar".');
  if (!AUTO_REDES.includes(red)) throw new Error('Esta red se sube con "Subir con ClipViral".');
  const it = sugSnapshot().items.find((i) => i.id === id);
  if (!it) throw new Error('No encontré esa sugerencia');
  const clip = readJson(files.clips, []).find((c) => c.id === it.clipId);
  if (!clip) throw new Error('No encontré el archivo de ese clip');
  const now = when === 'ahora';
  const at = now ? Date.now() : it.horas[red];
  if (!at) throw new Error('No queda una hora libre en los próximos 7 días para esa red. Usa "Publicar ahora".');
  const t = it.textos[red];
  const job = queueUpload(clip, red, { title: t.titulo, caption: t.texto, scheduledAt: at, origen: 'manual', sugId: id, reprogramar: !now });
  if (!job) throw new Error(`Ese clip ya está en la cola de ${NAMES[red]}`);
  send('sug:update', sugSnapshot());
  return job;
});

// TikTok: lo que dice la cuenta (apodo, foto, privacidad permitida…). Se pide cada vez que se abre la pantalla de TikTok.
ipcMain.handle('tiktok:info', async () => {
  const auth = await api('/social/tiktok/token', {});
  return tiktokCreatorInfo(auth.accessToken);
});

/**
 * TikTok: el usuario aprobó el clip en la pantalla de TikTok. Se vuelve a revisar contra su cuenta y se pone en la cola
 * para publicarlo ahora, a la hora sugerida o a la hora que eligió. El video no se envía a TikTok antes de esa hora.
 */
ipcMain.handle('tiktok:approve', async (e, a = {}) => {
  const clip = readJson(files.clips, []).find((c) => c.id === a.clipId);
  if (!clip || !fs.existsSync(clip.file)) throw new Error('No encontré el archivo de ese clip');
  const auth = await api('/social/tiktok/token', {});
  const info = await tiktokCreatorInfo(auth.accessToken);
  const problem = checkTiktokApproval(a, info, { duration: clip.duration });
  if (problem) throw new Error(problem);
  let at = Date.now();
  if (a.when === 'sugerida') {
    const it = sugSnapshot().items.find((i) => i.clipId === clip.id);
    at = it?.horas?.tiktok;
    if (!at) throw new Error('No queda una hora libre en los próximos 7 días para TikTok. Usa "Publicar ahora".');
  } else if (a.when === 'fecha') {
    at = Number(a.at);
    if (!Number.isFinite(at) || at < Date.now() - 60000) throw new Error('Elige una fecha y hora que todavía no pasó');
  }
  const job = queueUpload(clip, 'tiktok', {
    title: clip.title, caption: String(a.caption ?? ''), scheduledAt: at, origen: 'aprobado',
    sugId: a.sugId || null, reprogramar: a.when === 'sugerida', tiktok: tiktokPostOptions(a, info),
  });
  if (!job) throw new Error('Ese clip ya está en la cola de TikTok');
  send('sug:update', sugSnapshot());
  return job;
});

/**
 * Interruptor "Publicar sola" de una red. Al encender: (Instagram/Facebook) se programan los clips por subir a su hora.
 * Al apagar: se quitan de la cola las publicaciones automáticas que todavía no salieron.
 */
ipcMain.handle('auto:set', async (e, { red, on }) => {
  if (!SOLA_REDES.includes(red)) throw new Error('Esta red no tiene publicación automática');
  const s = getSettings();
  const patch = { redes: { [red]: { publicarSola: !!on } } };
  // Si la red no estaba en "Dónde publicas", se agrega (si no, no tendría hora sugerida).
  if (on && !s.sugerencias.redes.includes(red)) patch.sugerencias = { redes: ['tiktok', 'instagram', 'youtube', 'facebook'].filter((r) => r === red || s.sugerencias.redes.includes(r)) };
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), patch));
  let removed = 0;
  let scheduled = 0;
  if (!on) removed = uploads.removeWhere((j) => j.platform === red && j.origen === 'sola');
  else scheduled = await autoSchedule();
  return { settings: getSettings(), removed, scheduled, snap: sugSnapshot() };
});
ipcMain.handle('sug:add', (e, clipId) => {
  if (!readJson(files.clips, []).some((c) => c.id === clipId)) throw new Error('No encontré ese clip');
  if (!sugerencias.add(clipId)) {
    const it = sugerencias.get(clipId);
    if (it && it.status !== 'nueva') sugerencias.mark(clipId, 'volver');
  }
  return sugSnapshot();
});
ipcMain.handle('sug:mark', (e, { id, action, red }) => {
  const it = sugerencias.mark(id, action, { red, redes: getSettings().sugerencias.redes });
  if (!it) throw new Error('No encontré esa sugerencia');
  // Lo que ya no hace falta publicar sale de la cola: descartado, "ya la subí" o "ya lo subí a esta red" (a mano).
  if (action === 'descartar' || action === 'subida') uploads.cancelWhere((j) => j.clipId === it.clipId);
  if (action === 'red' && it.hechas?.[red]) uploads.cancelWhere((j) => j.clipId === it.clipId && j.platform === red);
  return sugSnapshot();
});
ipcMain.handle('sug:clear', () => { sugerencias.clearDone(); return sugSnapshot(); });

// ---------- Piloto automático (vigila canales y temas) ----------
let vigilante;
let pilotBlocker = null;
// Lo que la app aprendió de tus estadísticas (se llena en la sección Estadísticas).
let learned = null;

/** Corre yt-dlp con Deno y devuelve el JSON. */
async function ytdlpJson(args, timeoutMs = 90000) {
  try {
    const { out } = await run(components.paths.ytdlp, [...components.paths.ytdlpArgs(), ...args], { timeoutMs });
    return JSON.parse(out);
  } catch (err) {
    checkCookiesNeeded(`${err.err || ''} ${err.message || ''}`);
    throw err;
  }
}

function setupPiloto() {
  vigilante = new Vigilante({
    file: files.piloto,
    ytdlp: (args) => ytdlpJson(args),
    getConfig: () => getSettings().piloto,
    isBusy: () => !!session && session.state !== 'done',
    // Solo con IA Pro: Claude descarta lo que no tiene que ver con tus temas.
    rank: async (videos, temas) => {
      const me = await api('/me');
      if (!me.user.plan.usesAi) return {};
      const r = await api('/ai/rank', { temas, videos: videos.map((v) => ({ id: v.id, title: v.title, channel: v.channel, views: v.views, duration: v.duration })) });
      return Object.fromEntries((r.notes || []).map((n) => [n.id, n]));
    },
  });
  vigilante.on('update', () => send('piloto:update', vigilante.snapshot()));
  vigilante.on('log', (l) => { send('piloto:log', l); checkCookiesNeeded(l?.text); });
  vigilante.on('process', async (cand) => {
    try {
      await startSession({ url: cand.url }, { type: 'piloto', candidateId: cand.id, source: cand.source, kind: cand.kind });
    } catch (err) {
      const msg = err.message.replace(/^REQUISITOS: /, 'Falta instalar: ');
      // Si el problema no es del video (falta algo, venció el plan, sin internet), se pausa en vez de marcar todo con error.
      if (/^REQUISITOS|plan venció|conexión con el servidor|grabación en curso/.test(err.message)) {
        vigilante.pause(cand.id, msg);
        if (!/grabación en curso/.test(err.message)) notify('El piloto está en pausa', msg);
      } else {
        vigilante.finished(cand.id, { error: msg });
      }
    }
  });
  // Cada minuto mira si ya toca revisar.
  const tick = () => {
    const cfg = getSettings().piloto;
    // Con el piloto encendido la PC no se duerme (si no, se pierden los directos).
    if (cfg.activo && pilotBlocker === null) pilotBlocker = powerSaveBlocker.start('prevent-app-suspension');
    if (!cfg.activo && pilotBlocker !== null) { powerSaveBlocker.stop(pilotBlocker); pilotBlocker = null; }
    if (!cfg.activo || !token()) return;
    const last = vigilante.state.lastCheck || 0;
    if (Date.now() - last >= (cfg.revisarCadaMin || 20) * 60000) vigilante.check().catch((err) => console.error('piloto:', err.message));
    else vigilante.next();
  };
  setInterval(tick, 60000);
  setTimeout(tick, 20000);
}

ipcMain.handle('piloto:state', () => vigilante.snapshot());
ipcMain.handle('piloto:check', () => vigilante.check({ manual: true }));
ipcMain.handle('piloto:decide', (e, id, action) => vigilante.decide(id, action));
ipcMain.handle('piloto:clear', () => vigilante.clearDone());
ipcMain.handle('piloto:addChannel', async (e, input) => {
  const url = channelUrl(input);
  if (!url) throw new Error('No reconozco ese canal. Pega el enlace del canal (youtube.com/@nombre) o escribe @nombre.');
  let info;
  try {
    info = await ytdlpJson(['-J', '--flat-playlist', '--playlist-end', '1', `${url}/videos`], 60000);
  } catch {
    throw new Error('No encontré ese canal en YouTube. Revisa el nombre.');
  }
  const s = getSettings();
  const canales = s.piloto.canales || [];
  if (canales.some((c) => c.url.toLowerCase() === url.toLowerCase())) throw new Error('Ese canal ya está en la lista');
  const canal = { url, nombre: info.channel || info.uploader || url.split('/').pop(), id: info.channel_id || null, permiso: false, directos: true, videos: true };
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { piloto: { canales: [...canales, canal] } }));
  return getSettings();
});
ipcMain.handle('piloto:addVideo', async (e, url) => {
  if (!youtubeId(url)) throw new Error('Pega el enlace de un video de YouTube');
  const meta = await ytdlpJson(['-J', '--no-warnings', '--skip-download', '--no-playlist', url], 60000).catch(() => null);
  if (!meta) throw new Error('No pude abrir ese video');
  const item = vigilante.addManual({ id: meta.id, title: meta.title, channel: meta.channel || meta.uploader });
  if (!item) throw new Error('Ese video ya está en la cola');
  return vigilante.snapshot();
});

// ---------- Estadísticas y aprendizaje ----------
let estadisticas;
function statsSnapshot() {
  return { ...(learned || {}), lastRefresh: estadisticas.state.lastRefresh, errors: estadisticas.state.errors, busy: estadisticas.busy };
}
function relearn() {
  learned = learn({ clips: readJson(files.clips, []), jobs: uploads.list(), stats: estadisticas.state });
  send('stats:update', statsSnapshot());
  if (sugerencias) send('sug:update', sugSnapshot()); // las horas sugeridas usan lo aprendido
}
function setupStats() {
  estadisticas = new Estadisticas({
    file: files.stats,
    getJobs: () => uploads.list(),
    getToken: (platform) => api(`/social/${platform}/token`, {}),
    connected: () => socialList(),
  });
  estadisticas.on('update', () => send('stats:update', statsSnapshot()));
  relearn();
  // Cada 3 horas vuelve a leer los números de lo publicado.
  const tick = () => {
    if (!token() || Date.now() - (estadisticas.state.lastRefresh || 0) < 3 * 3600000) return;
    estadisticas.refresh().then(relearn).catch((err) => console.error('estadísticas:', err.message));
  };
  setInterval(tick, 15 * 60000);
  setTimeout(tick, 60000);
}
ipcMain.handle('stats:state', () => statsSnapshot());
ipcMain.handle('stats:refresh', async () => { await estadisticas.refresh(); relearn(); return statsSnapshot(); });

// ---------- Competencia ----------
let compState = null;
let compBusy = false;
function compSnapshot() { return { ...compState, busy: compBusy, cuentas: getSettings().competencia.cuentas }; }

async function analyzeCompetition({ withReport = false } = {}) {
  if (compBusy) return compSnapshot();
  compBusy = true;
  send('comp:update', compSnapshot());
  try {
    const cuentas = getSettings().competencia.cuentas || [];
    let fbAuth = null;
    const results = [];
    for (const c of cuentas) {
      try {
        if (c.plataforma === 'youtube') results.push({ ...(await youtubeChannel(c.usuario, (args) => ytdlpJson(args))), key: c.usuario });
        else if (c.plataforma === 'instagram') {
          fbAuth = fbAuth || await api('/social/facebook/token', {}).catch(() => ({}));
          results.push({ ...(await instagramAccount(c.usuario, fbAuth)), key: c.usuario });
        }
      } catch (err) {
        results.push({ platform: c.plataforma, name: c.usuario, key: c.usuario, error: err.message, posts: [] });
      }
    }
    compState = { ...compState, results, checkedAt: Date.now() };
    if (withReport && results.some((r) => !r.error)) {
      try {
        const me = await api('/me');
        if (!me.user.plan.usesAi) throw new Error('El informe con IA es parte del plan Claude. Los números de abajo sí están disponibles.');
        const r = await api('/ai/competencia', reportInput(results, learned));
        compState = { ...compState, report: r.report, reportAt: Date.now(), reportError: null };
      } catch (err) {
        compState = { ...compState, reportError: err.message };
      }
    }
    writeJson(files.competencia, compState);
  } finally {
    compBusy = false;
    send('comp:update', compSnapshot());
  }
  return compSnapshot();
}

function setupCompetencia() {
  compState = readJson(files.competencia, { results: [], report: null, reportAt: null, checkedAt: null });
  // Una vez por semana: números nuevos e informe (si está activado).
  const tick = () => {
    const cfg = getSettings().competencia;
    if (!token() || !cfg.cuentas?.length || !cfg.informeAuto) return;
    if (Date.now() - (compState.reportAt || compState.checkedAt || 0) >= 7 * 86400000) analyzeCompetition({ withReport: true }).catch(() => {});
  };
  setInterval(tick, 6 * 3600000);
  setTimeout(tick, 5 * 60000);
}
ipcMain.handle('comp:state', () => compSnapshot());
ipcMain.handle('comp:analyze', (e, opts) => analyzeCompetition(opts || {}));
ipcMain.handle('comp:add', (e, { plataforma, usuario }) => {
  const cfg = getSettings().competencia;
  let clean = String(usuario || '').trim();
  if (plataforma === 'youtube') { if (!channelUrl(clean)) throw new Error('Pega el enlace del canal (youtube.com/@nombre) o escribe @nombre'); }
  else if (plataforma === 'instagram') { const u = igUsername(clean); if (!u) throw new Error('Escribe el usuario de Instagram, por ejemplo @cuenta'); clean = `@${u}`; }
  else if (plataforma === 'tiktok') throw new Error('TikTok no deja que las apps vean los números de otras cuentas. Puedes agregar su canal de YouTube o su Instagram.');
  else throw new Error('Red no soportada');
  if ((cfg.cuentas || []).some((c) => c.plataforma === plataforma && c.usuario.toLowerCase() === clean.toLowerCase())) throw new Error('Esa cuenta ya está en la lista');
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { competencia: { cuentas: [...(cfg.cuentas || []), { plataforma, usuario: clean }] } }));
  return compSnapshot();
});
ipcMain.handle('comp:remove', (e, index) => {
  const cuentas = [...(getSettings().competencia.cuentas || [])];
  const [gone] = cuentas.splice(index, 1);
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { competencia: { cuentas } }));
  if (gone) compState = { ...compState, results: (compState.results || []).filter((r) => r.key !== gone.usuario) };
  return compSnapshot();
});

ipcMain.handle('social:list', () => socialList(true));
ipcMain.handle('social:connect', async (e, platform) => {
  // Si ya estaba conectada (reconectar), se espera a que la conexión sea una nueva, no la de antes.
  const before = (await socialList(true).catch(() => [])).find((p) => p.id === platform)?.connectedAt || null;
  const { url } = await api(`/social/${platform}/start`, {});
  shell.openExternal(url);
  // Esperamos a que el usuario acepte en el navegador (y en Facebook, elija la página): hasta 5 minutos.
  for (let i = 0; i < 100; i++) {
    await sleep(3000);
    const list = await socialList(true).catch(() => []);
    const p = list.find((x) => x.id === platform);
    if (p?.connected && p.connectedAt !== before) { autoSoon(); return list; }
  }
  throw new Error('No se completó la conexión. Inténtalo otra vez.');
});
ipcMain.handle('social:disconnect', async (e, platform) => {
  await api(`/social/${platform}`, null, 'DELETE');
  // Sin cuenta conectada no se puede publicar: lo automático sale de la cola (se vuelve a programar si reconecta)
  // y lo que programó el usuario queda cancelado (puede tocar Reintentar).
  const n = uploads.removeWhere((j) => j.platform === platform && j.origen === 'sola') + uploads.cancelWhere((j) => j.platform === platform);
  if (n) send('sug:update', sugSnapshot());
  return socialList(true);
});
// Uso personal: Facebook o Instagram con un token pegado (sin el botón de inicio de sesión de Meta).
ipcMain.handle('social:manual', async (e, { platform, token }) => {
  const result = await api(`/social/${platform}/manual`, { token: String(token || '').trim() });
  autoSoon();
  return { ...result, platforms: await socialList(true) };
});
// Facebook: el cliente elige en qué página publicar.
ipcMain.handle('social:setPage', async (e, pageId) => {
  await api('/social/facebook/page', { pageId });
  return socialList(true);
});
ipcMain.handle('uploads:list', () => uploads.list());
ipcMain.handle('uploads:add', (e, { clipId, platforms, title, caption, privacy, scheduledAt }) => {
  const clip = readJson(files.clips, []).find((c) => c.id === clipId);
  if (!clip) throw new Error('No encontré ese clip');
  // TikTok exige su propia pantalla (privacidad, interacciones, contenido comercial y confirmación): va por tiktok:approve.
  if (platforms.includes('tiktok')) throw new Error('Para TikTok usa su pantalla de aprobación.');
  return platforms.map((p) => queueUpload(clip, p, { title, caption, privacy, scheduledAt })).filter(Boolean);
});
ipcMain.handle('uploads:retry', (e, id) => uploads.retry(id));
ipcMain.handle('uploads:cancel', async (e, id) => {
  const job = await uploads.cancel(id);
  // Si era automática, ese clip no se vuelve a programar solo en esa red.
  if (job?.origen === 'sola' && job.status === 'cancelado') sugerencias.skipAuto(job.clipId, job.platform);
  if (job) send('sug:update', sugSnapshot());
});
ipcMain.handle('uploads:now', async (e, id) => {
  const job = await uploads.publishNow(id);
  if (job) send('sug:update', sugSnapshot());
  return job;
});

// Servidor de ClipViral: el de esta PC o el de tu VPS (Ajustes).
const serverInfo = (caps) => {
  const url = serverUrl();
  return { url, local: isLocalUrl(url), https: url.startsWith('https://'), ok: caps.ok, publica: caps.publica, saved: getSettings().serverUrl };
};
ipcMain.handle('server:info', async () => serverInfo(await refreshServerCaps()));
/** Revisa que en esa dirección conteste un servidor de ClipViral (sin cambiar nada). */
ipcMain.handle('server:test', async (e, raw) => {
  let url = String(raw || '').trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Esa dirección no es válida. Escríbela como https://tu-vps.duckdns.org'); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.pathname.length > 1 || parsed.search) throw new Error('Pon solo la dirección del servidor, sin nada después (por ejemplo https://tu-vps.duckdns.org).');
  let h;
  try {
    h = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  } catch {
    throw new Error(`No contesta nada en ${url}. Revisa que el servidor del VPS esté encendido y la dirección esté bien escrita.`);
  }
  if (h?.ok !== true || !h.api) throw new Error('Ahí contesta algo, pero no es un servidor de ClipViral.');
  return { url, https: url.startsWith('https://'), publica: !!h.publica, api: h.api, ai: !!h.ai };
});
/**
 * Cambia de servidor (null = el de esta PC). Lo programado en el servidor de antes se cancela allá y se manda al nuevo.
 * Para terminar el cambio (la sesión y las redes del otro servidor) hay que cerrar y abrir ClipViral.
 */
ipcMain.handle('server:use', async (e, url) => {
  const next = url ? String(url).trim().replace(/\/+$/, '') : appConfig.serverUrl;
  const { moved, kept } = await uploads.detachFromServer();
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { serverUrl: next }));
  return { ...serverInfo(await refreshServerCaps(true)), moved, kept };
});
ipcMain.handle('uploads:clear', () => uploads.clearFinished());
ipcMain.handle('uploads:preview', (e, { clipId, template }) => {
  const clip = readJson(files.clips, []).find((c) => c.id === clipId) || {
    title: 'No puedo creer lo que pasó', description: 'El momento más loco del directo.', hashtags: ['#clips', '#viral', '#stream'],
    stream: { channel: 'MiCanal', url: 'https://youtube.com/…' }, start: 125,
  };
  return buildCaption(template ?? getSettings().redes.plantilla, clip, { minuto: fmtClock(clip.start || 0) });
});
app.on('window-all-closed', () => app.quit());
// El agente apaga el Sintetizador de voz y SerieAI si estaban trabajando.
app.on('before-quit', () => agente?.stop());

// ---------- Agente de contenido (solo admin) ----------
// Maneja solo una página de Facebook nueva: piensa con Claude (por el servidor, con tope de gasto), hace videos con el
// Sintetizador de voz, SerieAI y ClipViral, los publica a su hora y lee los números. Trabaja mientras la app esté abierta.
let agente = null;
let agenteBlocker = null;
function agentePower() {
  const on = !!agente?.state.activo;
  if (on && agenteBlocker === null) agenteBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!on && agenteBlocker !== null) { powerSaveBlocker.stop(agenteBlocker); agenteBlocker = null; }
}
function setupAgente() {
  agente = new Agente({
    dir: path.join(userData, 'agente'),
    appDir: __dirname,
    api,
    server: () => ({ url: serverUrl(), token: token() }),
    paths: components.paths,
    whisper: () => {
      const st = components.status();
      const s = getSettings();
      return { ok: !!st.whisper && !!st.models?.[s.whisperModel]?.installed, model: s.whisperModel, gpu: st.whisperFlavor === 'gpu' && s.whisperGpu };
    },
    gpuEncode: () => gpu.hasNvidia && getSettings().gpuEncode,
    uploader: UPLOADERS.facebook,
    fetchers: FETCHERS,
    ocupado: () => !!session && session.state !== 'done',
  });
  let t = null;
  agente.on('update', () => { clearTimeout(t); t = setTimeout(() => send('agente:update', agente.snapshot()), 250); });
  agente.on('aviso', (a) => { if (!win?.isFocused()) notify(a.titulo, a.texto); });
  agentePower();
  agente.start();
}
// Trabajos largos del agente: se lanzan y la pantalla sigue el avance con agente:update.
function agenteEnFondo(job) {
  if (agente.busy) throw new Error('El agente ya está trabajando en algo. Espera a que termine o pulsa Detener.');
  job().catch((err) => (err.status === 402 ? agente.esperar('tope', err.message) : agente.log('error', err.message)));
  return agente.snapshot();
}
async function agenteRemoto() {
  agente.state.remoto = await api('/agente/estado');
  agente.changed();
  return agente.snapshot();
}
ipcMain.handle('agente:state', () => agente.snapshot());
ipcMain.handle('agente:remoto', () => agenteRemoto());
ipcMain.handle('agente:activar', (e, on) => { const s = agente.setActivo(on); agentePower(); return s; });
ipcMain.handle('agente:config', (e, patch) => agente.setConfig(patch));
ipcMain.handle('agente:pagina', async (e, pageId) => { await api('/agente/pagina', { pageId }); return agenteRemoto(); });
ipcMain.handle('agente:tope', async (e, usd) => { await api('/agente/tope', { usd }, 'PUT'); return agenteRemoto(); });
ipcMain.handle('agente:ahora', () => agenteEnFondo(() => agente.hacerAhora()));
ipcMain.handle('agente:replan', () => agenteEnFondo(() => agente.replanear()));
ipcMain.handle('agente:numeros', () => agenteEnFondo(() => agente.numeros()));
ipcMain.handle('agente:publicarYa', (e, id) => agenteEnFondo(() => agente.publicarYa(id)));
ipcMain.handle('agente:descartar', (e, id) => agente.descartar(id));
ipcMain.handle('agente:reprogramar', (e, id, at) => agente.reprogramar(id, at));
ipcMain.handle('agente:detener', () => { agente.detener(); return agente.snapshot(); });
// Carpetas: abrir la de fondos o la de videos; elegir dónde están el Sintetizador o SerieAI.
ipcMain.handle('agente:carpeta', async (e, kind) => {
  if (kind === 'fondos' || kind === 'videos') {
    const dir = kind === 'fondos' ? agente.fondosDir : path.join(agente.dir, 'videos');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return agente.snapshot();
  }
  if (!['sintetizador', 'serieai'].includes(kind)) throw new Error('Carpeta desconocida');
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], defaultPath: agente.state.config[kind] || undefined,
    title: kind === 'sintetizador' ? 'Carpeta del Sintetizador de voz' : 'Carpeta de SerieAI' });
  if (r.canceled) return agente.snapshot();
  return agente.setConfig({ [kind]: r.filePaths[0] });
});
// Ver un video del agente con el reproductor de Windows (solo archivos de su carpeta).
ipcMain.handle('agente:ver', async (e, file) => {
  const full = path.resolve(String(file || ''));
  if (!full.startsWith(path.resolve(agente.dir) + path.sep) || !fs.existsSync(full)) throw new Error('No encontré ese video');
  const err = await shell.openPath(full);
  if (err) throw new Error('Windows no pudo abrir el video');
});

// ---------- App ----------
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), gpu, serverUrl: serverUrl(), userData, edicion: CLIENTE ? 'cliente' : ADMIN_APP ? 'admin' : 'completa',
  central: !!CENTRAL,
  // "Claves de clientes" solo aparece en la PC que tiene tu clave privada.
  generaClaves: !CLIENTE && fs.existsSync(path.join(LICENCIAS_DIR, 'clave-privada.pem')),
}));

// ---------- Licencia ----------
ipcMain.handle('licencia:estado', () => (CLIENTE ? licencia.status() : { active: true, completa: true }));
ipcMain.handle('licencia:activar', (e, key) => {
  if (!CLIENTE) return { active: true, completa: true };
  return licencia.activate(String(key || ''));
});
// Generador de claves para tus clientes (solo en tu versión, con tu clave privada).
const PRIVADA = path.join(LICENCIAS_DIR, 'clave-privada.pem');
const EMITIDAS = path.join(LICENCIAS_DIR, 'emitidas.json');
ipcMain.handle('licencias:lista', () => {
  if (CLIENTE) throw new Error('No disponible');
  return { disponible: fs.existsSync(PRIVADA), carpeta: LICENCIAS_DIR, emitidas: readJson(EMITIDAS, []), planes: PLANES };
});
ipcMain.handle('licencias:generar', (e, { codigo, plan, dias = 30, nota = '' } = {}) => {
  if (CLIENTE) throw new Error('No disponible');
  if (!fs.existsSync(PRIVADA)) throw new Error(`Falta tu clave privada en ${PRIVADA}`);
  parseMachineCode(codigo);
  const machine = String(codigo).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^(.{4})/, '$1-');
  const key = generateKey({ privateKeyPem: fs.readFileSync(PRIVADA, 'utf8'), machine, plan, days: dias });
  const list = readJson(EMITIDAS, []);
  list.unshift({ at: Date.now(), codigo: machine, plan, dias: Number(dias), nota: String(nota).slice(0, 80), clave: key });
  writeJson(EMITIDAS, list.slice(0, 500));
  return { clave: key, emitidas: list.slice(0, 500) };
});
ipcMain.handle('shell:open', (e, url) => { if (/^https?:\/\//.test(String(url))) shell.openExternal(url); });
ipcMain.handle('clipboard:write', (e, text) => clipboard.writeText(String(text)));
ipcMain.handle('clipboard:read', () => clipboard.readText());

// ---------- Cuenta ----------
function deviceName() { return `${os.hostname()} (Windows)`; }

ipcMain.handle('auth:session', async () => {
  if (CLIENTE) {
    const lic = licencia.status();
    if (!lic.active) return { licencia: lic };
    try {
      if (!token()) await localLogin();
      await syncPlan(lic.plan);
      try { return { ...(await api('/me')), licencia: lic }; } catch (err) {
        if (err.status !== 401) throw err;
        writeJson(files.session, {});
        await localLogin();
        return { ...(await api('/me')), licencia: lic };
      }
    } catch (err) { return { error: err.message, offline: true, licencia: lic }; }
  }
  if (!token()) {
    // Versión de administradores: si todavía no hay cuenta, la app pide crear la del administrador.
    if (ADMIN_APP) {
      try { await startLocalServer(); } catch (err) {
        return { error: `No se pudo encender ClipViral por dentro: ${err.message}.`, offline: true };
      }
      const h = await fetch(`${serverUrl()}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
      if (!h?.ok) return { error: 'ClipViral no respondió por dentro. Ciérralo y vuelve a abrirlo.', offline: true };
      return h.sinCuentas ? { crearAdmin: true } : null;
    }
    return null;
  }
  try { return await api('/me'); } catch (err) {
    if (err.status === 401 || err.status === 403) { writeJson(files.session, {}); return { error: err.message, loggedOut: true }; }
    return { error: err.message, offline: true };
  }
});
ipcMain.handle('auth:login', async (e, { email, password }) => {
  const data = await api('/auth/login', { email, password, device: deviceName() });
  writeJson(files.session, { token: data.token, email: data.user.email });
  return api('/me');
});
ipcMain.handle('auth:register', async (e, { name, email, password, acceptTerms }) => {
  const data = await api('/auth/register', { name, email, password, acceptTerms, device: deviceName() });
  writeJson(files.session, { token: data.token, email: data.user.email });
  return api('/me');
});
ipcMain.handle('auth:logout', async () => {
  await api('/auth/logout', {}).catch(() => {});
  writeJson(files.session, {});
});
ipcMain.handle('auth:changePassword', (e, { current, next }) => api('/auth/change-password', { current, next }));
// Olvidé mi contraseña: el servidor manda un código de 6 números al correo.
ipcMain.handle('auth:forgot', (e, email) => api('/auth/olvide', { email: String(email || '') }));
ipcMain.handle('auth:reset', async (e, { email, code, password }) => {
  const data = await api('/auth/restablecer', { email, code, password, device: deviceName() });
  writeJson(files.session, { token: data.token, email: data.user.email });
  return api('/me');
});

// ---------- Pagos con tarjeta (PayPal) ----------
// La página de pago de PayPal se abre en una ventana aparte dentro de la app (sin guardar nada del navegador).
// Cuando PayPal vuelve a /api/pagos/vuelta el servidor cobra y activa el plan; aquí solo se espera y se confirma.
ipcMain.handle('pay:status', () => api('/pagos/estado').catch(() => ({ enabled: false })));
ipcMain.handle('pay:mine', () => api('/pagos/mios'));
ipcMain.handle('pay:verify', (e, id) => api(`/pagos/${encodeURIComponent(String(id))}/verificar`, {}));
let payWindow = null;
ipcMain.handle('pay:start', async (e, { plan, months }) => {
  if (payWindow && !payWindow.isDestroyed()) { payWindow.focus(); throw new Error('Ya tienes abierta la ventana de pago.'); }
  const order = await api('/pagos/crear', { plan, months: Number(months) || 1 });
  const result = await new Promise((resolve) => {
    let outcome = 'cerrada';
    payWindow = new BrowserWindow({
      width: 520, height: 760, parent: win || undefined, modal: false, autoHideMenuBar: true,
      title: 'Pagar con tarjeta · ClipViral', backgroundColor: '#ffffff',
      webPreferences: { partition: 'pagos-paypal', contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    const watch = (url) => {
      let path = '';
      try { path = new URL(url).pathname; } catch { return; }
      if (path.endsWith('/api/pagos/vuelta')) outcome = 'vuelta';
      else if (path.endsWith('/api/pagos/cancelado')) outcome = 'cancelado';
      else return;
      // Deja ver el mensaje del servidor un momento y cierra sola.
      setTimeout(() => { if (payWindow && !payWindow.isDestroyed()) payWindow.close(); }, 3500);
    };
    payWindow.webContents.on('did-navigate', (ev, url) => watch(url));
    payWindow.webContents.on('did-redirect-navigation', (ev, url) => watch(url));
    // Ventanas emergentes de PayPal o del banco (verificación 3-D Secure) se abren dentro de la app.
    payWindow.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, parent: payWindow } }));
    payWindow.on('closed', () => { payWindow = null; resolve(outcome); });
    payWindow.loadURL(order.url);
  });
  if (result === 'cancelado') return { outcome: result, id: order.id };
  // Pase lo que pase con la ventana, se le pregunta al servidor si el pago entró.
  const check = await api(`/pagos/${encodeURIComponent(order.id)}/verificar`, {}).catch((err) => ({ error: err.message }));
  return { outcome: result, id: order.id, payment: check.payment || null, error: check.error || null };
});

// ---------- Clave de Claude (IA Pro) ----------
// La clave va directo al servidor, que la prueba y la guarda cifrada en la cuenta. La app no la guarda.
// Cada cuenta pone la suya (cliente del plan Claude o admin). Un admin sin clave propia usa la del servidor si el dueño
// se lo permite (panel → Usuarios → Gestionar). La clave del servidor se cambia en el panel → Ajustes.
ipcMain.handle('claude:status', async () => api('/me/claude'));
ipcMain.handle('claude:save', async (e, key) => api('/me/claude', { key: String(key || '') }, 'PUT'));
ipcMain.handle('claude:remove', async () => api('/me/claude', null, 'DELETE'));

// ---------- Ajustes ----------
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:set', (e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  const next = { ...getSettings() };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.includes(k)) continue;
    next[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(next[k], v) : v;
  }
  writeJson(files.settings, next);
  return next;
});
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: getSettings().outputDir });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:image', async (e, kind) => {
  const fondo = kind === 'fondo';
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: fondo ? 'Imagen de fondo' : 'Imagen (PNG con fondo transparente)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (r.canceled) return null;
  // Copiamos la imagen a la carpeta de la app para que no se pierda si mueven el original.
  const dest = path.join(userData, `${fondo ? 'fondo' : 'logo'}${path.extname(r.filePaths[0]).toLowerCase()}`);
  fs.copyFileSync(r.filePaths[0], dest);
  return dest;
});

// ---------- Cookies de YouTube ----------
// Cuando YouTube pide "confirmar que no eres un robot", yt-dlp necesita tu sesión de YouTube (cookies).
/**
 * Deja solo las cookies de YouTube/Google de un cookies.txt (formato Netscape), bien escritas.
 * Las extensiones a veces exportan TODAS las cookies del navegador (msn.com, etc.) y una sola línea rara
 * (por ejemplo una cookie sin valor) hace que yt-dlp rechace el archivo entero.
 */
function cleanCookiesText(text) {
  const rows = [];
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim() || /^#(?!HttpOnly_)/.test(raw)) continue;
    const c = raw.split('\t');
    if (c.length < 7) continue;
    const [domain, sub, cpath, secure, expires, name] = c;
    const value = c.slice(6).join('\t').trim();
    const host = domain.replace(/^#HttpOnly_/, '').replace(/^\./, '').toLowerCase();
    // Solo lo que YouTube usa para saber que eres tú (nada de Gmail, Drive, etc.).
    if (!/(^|\.)youtube\.com$/.test(host) && host !== 'google.com' && host !== 'accounts.google.com') continue;
    if (!name || !value || !/^(TRUE|FALSE)$/i.test(secure)) continue;
    // yt-dlp exige que la 2.ª columna diga TRUE si el dominio empieza con punto (y FALSE si no); algunas extensiones lo ponen mal.
    const dotted = domain.replace(/^#HttpOnly_/, '').startsWith('.') ? 'TRUE' : 'FALSE';
    rows.push([domain, dotted, cpath || '/', secure.toUpperCase(), /^\d+$/.test(expires) ? expires : '0', name, value].join('\t'));
  }
  if (!rows.length) throw new Error('Ese archivo no tiene cookies de YouTube. Abre youtube.com con tu sesión iniciada, toca la extensión "Get cookies.txt LOCALLY" y exporta desde ahí.');
  if (!rows.some((r) => /youtube\.com\t/i.test(r))) throw new Error('Ese archivo no tiene cookies de youtube.com. Exporta estando en youtube.com con tu sesión iniciada.');
  return `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`;
}
/**
 * ¿YouTube pide las cookies (o las que hay ya no sirven)? Entonces se abre la pantalla que explica cómo exportarlas
 * desde Chrome o Edge y subirlas. Como mucho una vez cada 10 minutos, para no molestar.
 */
const COOKIES_NEEDED = /sign in to confirm|not a bot|no eres un robot|cookies are no longer valid|netscape format|does not look like a Netscape|archivo de cookies no sirve|could not (copy|find).*cookie|failed to decrypt|DPAPI|No pude leer las cookies/i;
let cookiesAskedAt = 0;
function checkCookiesNeeded(text) {
  if (!COOKIES_NEEDED.test(String(text || '')) || Date.now() - cookiesAskedAt < 10 * 60000) return;
  cookiesAskedAt = Date.now();
  const mode = getSettings().ytCookies || '';
  // vencidas: ya había un archivo y YouTube igual lo pide (YouTube cambia las cookies cada cierto tiempo).
  send('cookies:needed', { mode, vencidas: mode === 'archivo' && fs.existsSync(COOKIES_FILE) });
}
ipcMain.handle('cookies:guide-seen', () => { cookiesAskedAt = Date.now(); });

// Si ya habías elegido un archivo que yt-dlp rechazaba, se arregla solo al abrir la app.
try { if (fs.existsSync(COOKIES_FILE)) fs.writeFileSync(COOKIES_FILE, cleanCookiesText(fs.readFileSync(COOKIES_FILE, 'utf8'))); } catch {}
ipcMain.handle('cookies:info', () => ({ mode: getSettings().ytCookies || '', file: fs.existsSync(COOKIES_FILE) }));
ipcMain.handle('cookies:pick', async () => {
  const r = await dialog.showOpenDialog(win, { defaultPath: app.getPath('downloads'), properties: ['openFile'], filters: [{ name: 'cookies.txt', extensions: ['txt'] }] });
  if (r.canceled) return null;
  fs.writeFileSync(COOKIES_FILE, cleanCookiesText(fs.readFileSync(r.filePaths[0], 'utf8')));
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { ytCookies: 'archivo' }));
  return { mode: 'archivo', file: true };
});
ipcMain.handle('cookies:set', (e, mode) => {
  const m = mode === 'archivo' || COOKIE_BROWSERS.includes(mode) ? mode : '';
  if (!m && fs.existsSync(COOKIES_FILE)) fs.rmSync(COOKIES_FILE, { force: true });
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), { ytCookies: m }));
  return { mode: m, file: fs.existsSync(COOKIES_FILE) };
});
/** Prueba si yt-dlp ya puede leer un video de YouTube con las cookies elegidas. */
ipcMain.handle('cookies:test', async (e, url) => {
  const link = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(String(url || '')) ? String(url) : 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  try {
    const { out } = await run(components.paths.ytdlp, [...components.paths.ytdlpArgs(), '--dump-single-json', '--no-warnings', '--skip-download', '--no-playlist', link], { timeoutMs: 90000 });
    const meta = JSON.parse(out);
    return { ok: true, title: meta.title || '' };
  } catch (err) {
    return { ok: false, error: ytdlpProblem(err) };
  }
});

// ---------- Revisión del sistema ----------
async function systemCheck(mode) {
  const s = getSettings();
  const serverOk = await fetch(`${serverUrl()}/api/health`, { signal: AbortSignal.timeout(6000) }).then((r) => r.ok).catch(() => false);
  return checkSystem({
    comps: components.status(),
    settings: s,
    gpu,
    ollama: await localAi.status(),
    ollamaPath: findOllama(),
    diskFree: freeSpace(s.outputDir),
    totalMem: os.totalmem(),
    serverOk,
    mode: mode || s.mode,
  });
}
ipcMain.handle('system:check', (e, mode) => systemCheck(mode));

/** Abre Ollama (si ya está abierto, no hace nada) y espera hasta 20 s a que responda. */
async function startOllama() {
  const exe = findOllama();
  if (!exe) throw new Error('Ollama no está instalado');
  let st = await localAi.status();
  if (st.running) return st;
  spawn(exe, exe.endsWith('ollama.exe') ? ['serve'] : [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    st = await localAi.status();
    if (st.running) return st;
  }
  throw new Error('Ollama no respondió. Ábrelo desde el menú Inicio.');
}
ipcMain.handle('ollama:open', () => startOllama());
ipcMain.handle('ytdlp:update', () => components.updateYtdlp(true));

// ---------- Componentes ----------
const hwBasic = () => ({ vramGb: gpu.vramGb || 0, ramGb: os.totalmem() / 1024 ** 3, gpuName: gpu.name });
// Descargas en curso: si tocan "Instalar" otra vez, esperan la misma descarga en vez de decir "listo" antes de tiempo.
const installing = new Map();
ipcMain.handle('components:status', async () => {
  const ollama = await localAi.status();
  return {
    ...components.status(),
    gpu,
    ollama,
    ollamaModels: localAi.describeModels(ollama, hwBasic(), getSettings().ollamaModel),
    oido: oido.status(),
    visionModels: describeVision(ollama, getSettings().visionModel),
    installing: Object.fromEntries([...installing].map(([id, j]) => [id, { frac: j.frac, text: j.text }])),
  };
});
/** Modelos que miran el video: los del catálogo y los que ya tenga Ollama, con su recomendación para esta PC. */
function describeVision(st, selected) {
  const hw = hwBasic();
  const names = st.details.filter((m) => m.vision).map((m) => m.name);
  const best = vista.pickVisionModel(names, hw);
  const list = vista.VISION_CATALOG.map((c) => ({
    id: c.id, sizeGb: c.sizeGb, desc: c.desc, installed: names.some((n) => n === c.id || n.startsWith(c.id)),
    fit: localAi.modelFit(c.sizeGb, hw).fit, recommended: !!best && best.id === c.id,
  }));
  for (const m of st.details.filter((d) => d.vision && !list.some((l) => d.name.startsWith(l.id)))) {
    list.push({ id: m.name, sizeGb: Math.round(m.sizeGb * 10) / 10, desc: 'Ya lo tienes en Ollama.', installed: true, fit: localAi.modelFit(m.sizeGb, hw).fit, recommended: false });
  }
  if (selected && !list.some((l) => l.id === selected)) list.push({ id: selected, sizeGb: 0, desc: '', installed: false, fit: 'lento', recommended: false });
  return list;
}

ipcMain.handle('components:install', (e, id, opts = {}) => {
  if (id === 'oido' && !installing.has(id)) {
    const job = { frac: 0, text: 'Preparando…' };
    job.promise = oido.load((frac, text) => { job.frac = frac; job.text = text; send('components:progress', { id, frac, text }); })
      .then(() => components.status())
      .finally(() => { installing.delete(id); send('components:changed', { id }); });
    installing.set(id, job);
  }
  if (!installing.has(id)) {
    // Si ya está instalado no se vuelve a bajar (solo con "Reinstalar").
    if (!opts.force && components.isInstalled(id)) return { ...components.status(), alreadyInstalled: true };
    const job = { frac: 0, text: 'Preparando…' };
    job.promise = components.install(id, (frac, text) => { job.frac = frac; job.text = text; send('components:progress', { id, frac, text }); })
      .then(() => {
        if (id === 'whisper-gpu') writeJson(files.settings, { ...readJson(files.settings, {}), whisperGpu: true });
        return components.status();
      })
      .finally(() => {
        installing.delete(id);
        // Avisa a todas las pantallas para que dejen de mostrar "Falta" / "Arreglar".
        send('components:changed', { id });
      });
    installing.set(id, job);
  }
  return installing.get(id).promise;
});

// ---------- Rendimiento de la PC ----------
let perfRun = null;
let lastPerf = null;
function analyzePc() {
  if (perfRun) return perfRun;
  perfRun = (async () => {
    const s = getSettings();
    const hw = await perf.measure({ ffmpeg: components.paths.ffmpeg, outputDir: s.outputDir });
    if (hw.gpu) gpu = { hasNvidia: true, name: hw.gpu.name, vramGb: hw.gpu.vramGb };
    const result = perf.suggest(hw, { comps: components.status(), ollama: await localAi.status(), ollamaInstalled: !!findOllama(), settings: s });
    const saved = readJson(files.perf, {});
    writeJson(files.perf, { ...saved, last: { at: Date.now(), hw, levels: result.levels } });
    lastPerf = { ...result, at: Date.now(), firstTime: !saved.seen, dismissedKey: saved.dismissedKey || null };
    return lastPerf;
  })().finally(() => { perfRun = null; });
  return perfRun;
}
ipcMain.handle('perf:state', () => {
  const p = readJson(files.perf, {});
  return { seen: !!p.seen, dismissedKey: p.dismissedKey || null, last: lastPerf };
});
ipcMain.handle('perf:analyze', () => analyzePc());
ipcMain.handle('perf:dismiss', (e, key) => { writeJson(files.perf, { ...readJson(files.perf, {}), seen: true, dismissedKey: key ?? null }); });
ipcMain.handle('perf:apply', async () => {
  const r = lastPerf || await analyzePc();
  writeJson(files.settings, deepMerge(readJson(files.settings, {}), r.patch));
  writeJson(files.perf, { ...readJson(files.perf, {}), seen: true, dismissedKey: r.key });
  lastPerf = { ...r, changes: [], patch: {}, key: '' };
  return getSettings();
});
ipcMain.handle('ollama:pull', async (e, model) => {
  await localAi.pull(model, (frac, text) => send('ollama:progress', { model, frac, text }));
  return localAi.status();
});

// ---------- Motor de clips ----------
function addClipToIndex(entry) {
  const list = readJson(files.clips, []);
  list.unshift(entry);
  writeJson(files.clips, list.slice(0, 5000));
}

ipcMain.handle('engine:start', (e, opts) => startSession(opts));

/**
 * Empieza a clipear un directo o video. La usan el botón "Iniciar" y el piloto automático.
 * origin: de dónde vino (piloto, canal o tema) para las estadísticas.
 */
async function startSession(opts, origin = null) {
  if (session && session.state !== 'done') throw new Error('Ya hay una grabación en curso');
  if (!youtubeId(opts.url) && !/^https?:\/\//.test(opts.url || '')) throw new Error('Pega un enlace de YouTube válido');
  const st = components.status();
  const s = deepMerge(getSettings(), opts);
  // El piloto usa lo que aprendió de tus redes: la duración de clip que mejor te funciona.
  if (origin && s.piloto.usarAprendido && learned?.ready && learned.bestClipSeconds) s.clipSeconds = learned.bestClipSeconds;
  const check = await systemCheck(s.mode);
  if (!check.ok) {
    // El mensaje empieza con REQUISITOS para que la pantalla abra la lista de lo que falta.
    throw new Error(`REQUISITOS: ${check.items.filter((i) => i.estado === 'falta').map((i) => i.nombre).join(', ')}`);
  }
  await components.updateYtdlp();
  const me = await api('/me');
  if (!me.user.plan.active) throw new Error('Tu plan venció. Renuévalo en la sección Plan.');
  if (s.mode === 'ia' && !me.user.plan.usesAi) {
    if (!origin) throw new Error('Tu plan no incluye la IA Pro. Usa el modo Local o mejora tu plan.');
    s.mode = 'local'; // el piloto no se detiene por eso: sigue en modo Local
  }

  if (!origin) writeJson(files.settings, deepMerge(readJson(files.settings, {}), { ...opts, lastUrl: opts.url }));
  sessionLogs = [];
  session = new ClipSession({
    url: s.url, mode: s.mode, clipSeconds: Number(s.clipSeconds), style: s.style, subtitles: s.subtitles, look: s.look,
    sensitivity: s.sensitivity, maxPerHour: Number(s.maxPerHour), precision: s.precision, outputDir: s.outputDir,
    workRoot: path.join(userData, 'trabajo'), paths: components.paths, whisperModel: s.whisperModel, language: s.language,
    whisperGpu: st.whisperFlavor === 'gpu' && s.whisperGpu, gpuEncode: gpu.hasNvidia && s.gpuEncode,
    ollamaModel: s.mode === 'local' ? s.ollamaModel : '', api, origin,
    // Oído (si está bajado) en los dos modos: ayuda a encontrar momentos. Los ojos, solo en modo Local.
    oido: s.oido !== false && oido.installed() ? oido : null,
    visionModel: s.mode === 'local' ? s.visionModel : '',
    // Para "Cámara + juego" se usa la IA local en los dos modos (es gratis); si no está, Claude en el plan Claude.
    camModel: s.visionModel || '', camStore,
    // Si elegiste la IA que mira el video pero Ollama está cerrado, se abre solo para buscar la cámara.
    startOllama: s.visionModel && findOllama() ? startOllama : null,
    // Si no puede abrir el enlace, actualiza yt-dlp (aunque se haya revisado hace poco) y prueba otra vez.
    updateYtdlp: () => components.updateYtdlp(true),
    // Lo que mejor le funciona a tus redes se le pasa a Claude para elegir y titular los clips.
    hints: learned?.ready ? learned.hints : '',
  });
  const current = session;
  if (origin) send('engine:started', { origin, url: s.url });
  current.on('log', (l) => { sessionLogs.push(l); if (sessionLogs.length > 300) sessionLogs.shift(); send('engine:log', l); checkCookiesNeeded(l?.text); });
  current.on('stats', (st2) => send('engine:stats', st2));
  current.on('activity', (a) => send('engine:activity', a));
  current.on('producing', (p) => send('engine:producing', p));
  current.on('mode', (m) => send('engine:mode', m));
  current.on('clip', (c) => {
    addClipToIndex(c);
    // Cuenta el clip en el resumen del panel de admin (si falla no pasa nada).
    api('/clips/evento', { mode: s.mode, seconds: Math.round(Number(c.duration) || 0), origin: origin ? 'piloto' : 'manual' }).catch(() => {});
    send('engine:clip', c);
    // Cada clip nuevo queda en Clips sugeridos con la hora y el texto de cada red
    // (y se programa solo en las redes con "Publicar sola" encendido).
    sugerencias.add(c.id);
    if (!win?.isFocused()) {
      const tt = getSettings().redes.tiktok?.publicarSola ? ' Apruébalo para TikTok y se publica solo a su hora.' : '';
      notify('🔥 Nuevo clip sugerido', `${c.title}\nYa tiene la hora y el texto para subirlo.${tt}`);
    }
  });
  current.on('done', (d) => {
    if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    send('engine:done', d);
    notify(origin ? `Piloto: ${current.info?.title || 'video'} listo` : 'Directo terminado', `Se guardaron ${d.clips} clip${d.clips === 1 ? '' : 's'}`);
    if (origin?.candidateId) vigilante.finished(origin.candidateId, { clips: d.clips });
    else setTimeout(() => vigilante.next(), 3000); // si esperaba algo en la cola del piloto, sigue
  });
  blocker = powerSaveBlocker.start('prevent-app-suspension');
  try {
    await current.start();
  } catch (err) {
    current.state = 'done';
    if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
    session = null;
    checkCookiesNeeded(err.message);
    throw err;
  }
  return current.stats();
}
ipcMain.handle('engine:stop', () => { session?.stop(); });
ipcMain.handle('engine:state', () => (session ? { stats: session.stats(), logs: sessionLogs } : null));
// Cámara + juego: foto del directo con la cámara que se está usando, y guardar la que marques a mano (por canal).
ipcMain.handle('camara:foto', async () => {
  if (!session) throw new Error('Empieza un directo o video para marcar la cámara.');
  return session.camSnapshot();
});
ipcMain.handle('camara:guardar', (e, { channel, box }) => { camStore.set(channel, box || null); return camStore.list(); });
ipcMain.handle('camara:lista', () => camStore.list());

// ---------- Clips ----------
ipcMain.handle('clips:list', () => readJson(files.clips, []).filter((c) => fs.existsSync(c.file)));
ipcMain.handle('clips:delete', (e, id) => {
  const list = readJson(files.clips, []);
  const clip = list.find((c) => c.id === id);
  if (clip) {
    for (const f of [clip.file, clip.thumb, clip.file.replace(/\.mp4$/i, '.txt')]) if (f) fs.rmSync(f, { force: true });
    writeJson(files.clips, list.filter((c) => c.id !== id));
  }
  uploads.cancelWhere((j) => j.clipId === id);
  sugerencias.remove(id);
  return true;
});
ipcMain.handle('clips:reveal', (e, file) => { if (fs.existsSync(file)) shell.showItemInFolder(file); });
// Abre el video con el reproductor de Windows (solo archivos de la lista de clips).
ipcMain.handle('clips:openFile', async (e, id) => {
  const clip = readJson(files.clips, []).find((c) => c.id === id);
  if (!clip || !fs.existsSync(clip.file)) throw new Error('No encontré el archivo de ese clip');
  const err = await shell.openPath(clip.file);
  if (err) throw new Error('Windows no pudo abrir el video');
});
ipcMain.handle('clips:openFolder', () => {
  const dir = getSettings().outputDir;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// ---------- Actualizaciones ----------
let updateInfo = null;
ipcMain.handle('updates:check', async () => {
  try {
    const res = await fetch(`${serverUrl()}/api/updates/latest?current=${app.getVersion()}`, { signal: AbortSignal.timeout(15000) });
    updateInfo = await res.json();
    return updateInfo;
  } catch {
    return { available: false, error: 'No se pudo revisar si hay actualizaciones' };
  }
});
ipcMain.handle('updates:install', async () => {
  if (!updateInfo?.available) throw new Error('No hay actualización pendiente');
  if (session && session.state !== 'done') throw new Error('Detén la grabación antes de actualizar');
  const dest = path.join(os.tmpdir(), `ClipViral-Setup-${updateInfo.version}.exe`);
  const { sha256 } = await download(serverUrl() + updateInfo.url, dest, (got, total) => send('updates:progress', { frac: total ? got / total : 0, got, total }));
  if (updateInfo.sha256 && updateInfo.sha256 !== 'x' && sha256 !== updateInfo.sha256) {
    fs.rmSync(dest, { force: true });
    throw new Error('El archivo descargado está dañado. Intenta de nuevo.');
  }
  spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return true;
});

