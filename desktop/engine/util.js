const { spawn } = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');

/** Ejecuta un programa y devuelve su salida. Rechaza si termina con error. */
function run(cmd, args, { cwd, timeoutMs = 0, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    let timer;
    if (timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; onStderr?.(String(d)); if (err.length > 200000) err = err.slice(-100000); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(Object.assign(new Error(`${cmd.split(/[\\/]/).pop()} terminó con código ${code}: ${err.slice(-600)}`), { code, out, err }));
    });
  });
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Descarga un archivo mostrando el progreso.
 * Si la conexión se traba (stallMs sin recibir nada) o se corta, sigue desde donde iba (hasta `retries` veces).
 * Lo descargado queda en `<dest>.part`, así que también continúa si la app se cerró a mitad.
 */
async function download(url, dest, onProgress, signal, { stallMs = 30000, retries = 5 } = {}) {
  const part = `${dest}.part`;
  let attempt = 0;
  for (;;) {
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    let stalled = false;
    let timer;
    const kick = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ctrl.abort(); }, stallMs); };
    try {
      kick();
      const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'ClipViral', ...(have ? { Range: `bytes=${have}-` } : {}) } });
      if (have && res.status === 416) { fs.rmSync(part, { force: true }); throw new Error('Hay que empezar la descarga de nuevo'); }
      if (!res.ok || !res.body) {
        const fatal = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        throw Object.assign(new Error(`No se pudo descargar (${res.status})`), { fatal });
      }
      if (res.status !== 206) have = 0; // el servidor no deja continuar: empieza de cero
      const length = Number(res.headers.get('content-length')) || 0;
      const total = length ? have + length : 0;
      const file = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let received = have;
      let lastEmit = 0;
      await new Promise((resolve, reject) => {
        const body = Readable.fromWeb(res.body);
        body.on('data', (chunk) => {
          kick();
          received += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 150) { lastEmit = now; onProgress?.(received, total); }
        });
        body.on('error', (err) => { file.destroy(); reject(err); });
        file.on('error', reject);
        file.on('finish', resolve);
        body.pipe(file);
      });
      clearTimeout(timer);
      if (total && received < total) throw new Error('La descarga quedó incompleta');
      onProgress?.(received, total || received);
      break;
    } catch (err) {
      clearTimeout(timer);
      if (signal?.aborted) throw err;
      attempt += 1;
      if (err.fatal || attempt > retries) {
        throw new Error(stalled ? 'La descarga se quedó trabada. Revisa tu internet y vuelve a intentar: seguirá desde donde iba.' : err.message);
      }
      await sleep(Math.min(1000 * attempt, 5000));
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }
  const size = fs.statSync(part).size;
  const sha256 = await hashFile(part);
  fs.rmSync(dest, { force: true });
  fs.renameSync(part, dest);
  return { size, sha256 };
}

function slug(text, max = 50) {
  return String(text || 'clip')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase().slice(0, max) || 'clip';
}

function fmtClock(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

/** Saca el ID del video de cualquier enlace de YouTube. */
function youtubeId(url) {
  const text = String(url || '').trim();
  const m = text.match(/(?:v=|youtu\.be\/|\/live\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{11}$/.test(text) ? text : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { run, download, slug, fmtClock, youtubeId, sleep, hashFile };
