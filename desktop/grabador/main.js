// Kit "Grabar video para Meta": graba la pantalla con el FFmpeg que ya trae ClipViral mientras la persona
// sigue los pasos en un panel pequeño, y al final arma un .mp4 con subtítulos en inglés para la revisión de Meta.
// El panel NO sale en el video (Windows lo deja fuera de la captura).
// Uso: "Grabar video para Meta.bat". Prueba sin tocar nada: electron grabador --prueba [--salida=carpeta]
const { app, BrowserWindow, ipcMain, screen, globalShortcut, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { VIDEOS, PRUEBA, buildAss, buildSrt, buildResumen, recordArgs, finalArgs } = require('./pasos');

const ROOT = path.resolve(__dirname, '..', '..');
const argValue = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const TEST = process.argv.includes('--prueba');
const OUT_DIR = path.resolve(argValue('salida') || path.join(ROOT, 'Videos para Meta'));
const PERFIL = process.env.CLIPVIRAL_PERFIL || path.join(app.getPath('appData'), 'ClipViral');
const FFMPEG = process.env.CLIPVIRAL_FFMPEG || path.join(PERFIL, 'bin', 'ffmpeg.exe');
const FFPROBE = path.join(path.dirname(FFMPEG), 'ffprobe.exe');
const SETUP = { width: 660, height: 790 };
const PANEL = { width: 480, height: 330 };

app.setName('ClipViral - Video para Meta');
app.setPath('userData', path.join(os.tmpdir(), 'clipviral-grabador'));
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let rec = null;   // { proc, t0, work, area, stopped }
let state = { fase: 'inicio', tipo: 'facebook', paso: 0, marks: [], progreso: 0, salida: null, error: null, segundos: 0, atajos: true };

const video = () => (state.tipo === 'prueba' ? PRUEBA : VIDEOS[state.tipo] || VIDEOS.facebook);
const now = () => (rec ? Math.max(0, (Date.now() - rec.t0) / 1000) : 0);

function snapshot() {
  const v = video();
  return {
    ...state,
    ffmpeg: fs.existsSync(FFMPEG),
    carpeta: OUT_DIR,
    videos: Object.entries(VIDEOS).map(([id, x]) => ({ id, nombre: x.nombre, pasos: x.pasos.length, permisos: [...new Set(x.pasos.flatMap((p) => String(p.perm || '').split(', ')).filter((p) => /_/.test(p)))] })),
    pasos: v.pasos.map((p) => ({ es: p.es, en: p.en, perm: p.perm, optional: !!p.optional })),
    segundos: Math.round(now()),
  };
}
const send = () => { if (win && !win.isDestroyed()) win.webContents.send('kit:update', snapshot()); };
const set = (patch) => { Object.assign(state, patch); send(); };

function createWindow() {
  win = new BrowserWindow({
    ...SETUP, frame: false, resizable: false, show: false, backgroundColor: '#0d0d14', title: 'Grabar video para Meta',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  // El panel nunca sale en el video (Windows 10 2004 o más nuevo lo deja fuera de la captura).
  win.setContentProtection(true);
  win.loadFile(path.join(__dirname, 'panel.html'));
  win.once('ready-to-show', () => { win.show(); if (TEST) runTest(); if (CAPTURA) captureUi(); });
  win.on('closed', () => { win = null; });
}

/** Panel chico abajo a la derecha, siempre encima, que no le quita el foco a la app ni al navegador. */
function panelMode() {
  const wa = screen.getPrimaryDisplay().workArea;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setFocusable(false);
  win.setBounds({ x: wa.x + wa.width - PANEL.width - 16, y: wa.y + wa.height - PANEL.height - 16, ...PANEL });
}
function setupMode() {
  win.setAlwaysOnTop(false);
  win.setFocusable(true);
  win.setBounds({ ...SETUP });
  win.center();
  win.focus();
}

/** La pantalla principal en píxeles reales (con el zoom de Windows) y su lugar dentro del escritorio virtual. */
function captureArea() {
  const even = (n) => Math.floor(n / 2) * 2;
  const phys = (d) => screen.dipToScreenRect(null, d.bounds);
  const primary = phys(screen.getPrimaryDisplay());
  const all = screen.getAllDisplays().map(phys);
  const left = Math.min(...all.map((r) => r.x));
  const top = Math.min(...all.map((r) => r.y));
  return { x: primary.x - left, y: primary.y - top, width: even(primary.width), height: even(primary.height) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Fecha y hora local para el nombre del archivo: "2026-11-08 09-15-32". */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function start(tipo) {
  if (state.fase !== 'inicio' && state.fase !== 'listo' && state.fase !== 'error') return;
  if (!fs.existsSync(FFMPEG)) return set({ fase: 'error', error: 'Falta FFmpeg. Abre ClipViral una vez (con "Iniciar ClipViral.bat") para que lo instale, y vuelve a intentar.' });
  set({ fase: 'cuenta', tipo: TEST ? 'prueba' : (VIDEOS[tipo] ? tipo : 'facebook'), paso: 0, marks: [], progreso: 0, salida: null, error: null, cuenta: 3 });
  panelMode();
  for (let n = TEST ? 1 : 3; n > 0; n--) { set({ cuenta: n }); await sleep(1000); }
  const area = captureArea();
  const work = path.join(OUT_DIR, `.trabajo ${stamp()}`);
  fs.mkdirSync(work, { recursive: true });
  const proc = spawn(FFMPEG, recordArgs({ ...area, out: path.join(work, 'grabacion.mkv') }), { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  rec = { proc, t0: Date.now(), work, area, fixed: false, log: '', exited: false };
  // El primer "time=" de FFmpeg dice cuánto lleva grabado: con eso se ajusta el inicio (los subtítulos quedan en su lugar).
  proc.stderr.on('data', (d) => {
    const text = String(d);
    rec.log = (rec.log + text).slice(-4000);
    const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m && !rec.fixed) { rec.t0 = Date.now() - (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000; rec.fixed = true; }
  });
  proc.on('exit', () => { if (rec) rec.exited = true; });
  proc.on('error', (err) => { rec = null; set({ fase: 'error', error: `No se pudo grabar: ${err.message}` }); setupMode(); });
  await sleep(800);
  if (!rec || rec.exited) {
    const log = rec?.log || '';
    rec = null;
    setupMode();
    return set({ fase: 'error', error: `FFmpeg no pudo grabar la pantalla. ${log.trim().slice(-300)}` });
  }
  set({ fase: 'grabando' });
  shortcuts(true);
}

function shortcuts(on) {
  globalShortcut.unregisterAll();
  if (!on) return;
  const a = globalShortcut.register('F9', () => action('listo'));
  const b = globalShortcut.register('F8', () => action('atras'));
  state.atajos = a && b;
}

async function stopRecording() {
  shortcuts(false);
  const r = rec;
  const end = now();
  try { r.proc.stdin.write('q'); r.proc.stdin.end(); } catch {}
  for (let i = 0; i < 60 && !r.exited; i++) await sleep(250);
  if (!r.exited) r.proc.kill();
  rec = null;
  return { ...r, end };
}

/** Largo real del video grabado (si no se puede leer, el tiempo del reloj). */
function probeDuration(file, fallback) {
  return new Promise((resolve) => {
    if (!fs.existsSync(FFPROBE)) return resolve(fallback);
    const p = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(Number(out.trim()) > 0 ? Number(out.trim()) : fallback));
    p.on('error', () => resolve(fallback));
  });
}

async function finish() {
  const r = await stopRecording();
  setupMode();
  set({ fase: 'armando', progreso: 0 });
  const raw = path.join(r.work, 'grabacion.mkv');
  try {
    if (!fs.existsSync(raw) || fs.statSync(raw).size < 1000) throw new Error(`FFmpeg no guardó la grabación. ${r.log.trim().slice(-300)}`);
    const duration = await probeDuration(raw, r.end);
    const v = video();
    const marks = state.marks.map((m) => Math.min(m, duration));
    const info = { video: v, marks, duration, width: r.area.width, height: r.area.height };
    fs.writeFileSync(path.join(r.work, 'subs.ass'), buildAss(info), 'utf8');
    const base = path.join(OUT_DIR, `Meta - ${v.archivo} - ${stamp()}`);
    const out = `${base}.mp4`;
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, finalArgs({ input: 'grabacion.mkv', width: r.area.width, height: r.area.height, out }), { cwd: r.work, windowsHide: true });
      let err = '';
      p.stdout.on('data', (d) => {
        const m = String(d).match(/out_time_(?:us|ms)=(\d+)/g);
        if (m) set({ progreso: Math.min(0.99, Number(m.at(-1).split('=')[1]) / 1e6 / Math.max(1, duration)) });
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', reject);
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg no pudo armar el video (${code}). ${err.trim().slice(-300)}`))));
    });
    fs.writeFileSync(`${base} - subtitulos (en).srt`, buildSrt(info), 'utf8');
    fs.writeFileSync(`${base} - pasos.txt`, buildResumen(info), 'utf8');
    fs.rmSync(r.work, { recursive: true, force: true });
    set({ fase: 'listo', progreso: 1, salida: out, mb: Math.round(fs.statSync(out).size / 1048576 * 10) / 10, duracion: Math.round(duration) });
  } catch (err) {
    set({ fase: 'error', error: `${err.message}\nLa grabación sin subtítulos quedó en: ${raw}` });
  }
}

async function cancel() {
  if (!rec) return;
  const r = await stopRecording();
  fs.rmSync(r.work, { recursive: true, force: true });
  setupMode();
  set({ fase: 'inicio', paso: 0, marks: [] });
}

async function action(name, data) {
  const steps = video().pasos;
  if (name === 'empezar') return start(data);
  if (name === 'abrirCarpeta') { fs.mkdirSync(OUT_DIR, { recursive: true }); return shell.openPath(OUT_DIR); }
  if (name === 'verVideo' && state.salida) return shell.openPath(state.salida);
  if (name === 'otro') return set({ fase: 'inicio', salida: null, error: null });
  if (name === 'cerrar') { if (!rec) app.quit(); return; }
  if (name === 'cancelar') return cancel();
  if (state.fase !== 'grabando') return;
  if (name === 'atras' && state.marks.length) return set({ marks: state.marks.slice(0, -1), paso: state.paso - 1 });
  if (name === 'listo' || name === 'saltar') {
    // Saltar: el paso no sale en el video (su tiempo pasa al siguiente).
    const mark = name === 'saltar' ? (state.marks.at(-1) ?? 0) : now();
    const marks = [...state.marks, mark];
    if (marks.length >= steps.length) { state.marks = marks; return finish(); }
    return set({ marks, paso: state.paso + 1 });
  }
}

ipcMain.handle('kit:state', () => snapshot());
ipcMain.handle('kit:do', (e, name, data) => action(name, data));
setInterval(() => { if (state.fase === 'grabando') send(); }, 1000);

/** Prueba: graba unos segundos, avanza solo por 3 pasos y deja el video armado. Escribe el resultado y se cierra. */
async function runTest() {
  const done = (code, info) => { console.log(`[prueba] ${JSON.stringify(info)}`); app.exit(code); };
  await start('prueba');
  if (state.fase !== 'grabando') return done(1, { error: state.error });
  for (let i = 0; i < PRUEBA.pasos.length; i++) { await sleep(2200); await action('listo'); }
  for (let i = 0; i < 240 && state.fase === 'armando'; i++) await sleep(500);
  if (state.fase !== 'listo') return done(1, { error: state.error });
  done(0, { salida: state.salida, mb: state.mb, duracion: state.duracion, marks: state.marks });
}

/** Solo para revisar el diseño: --captura=foto.png --fase=inicio|grabando|armando|listo (no graba nada). */
const CAPTURA = argValue('captura');
async function captureUi() {
  const fase = argValue('fase') || 'inicio';
  if (fase !== 'inicio') {
    if (fase === 'grabando') panelMode();
    Object.assign(state, { fase, paso: Number(argValue('paso') || 3), marks: [4, 9, 20], segundos: 83, progreso: 0.42, salida: path.join(OUT_DIR, 'Meta - Facebook - 2026-11-08 10-15-02.mp4'), mb: 38.4, duracion: 412 });
    rec = fase === 'grabando' ? { t0: Date.now() - 83000 } : null;
    send();
  }
  await sleep(900);
  fs.writeFileSync(path.resolve(CAPTURA), (await win.webContents.capturePage()).toPNG());
  app.exit(0);
}

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (rec) { try { rec.proc.kill(); } catch {} } });
app.on('window-all-closed', () => app.quit());
