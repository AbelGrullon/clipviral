// Herramientas que la app descarga la primera vez (no vienen dentro del instalador para que pese poco).
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { download, run } = require('./util');

const MODELS = {
  base: { file: 'ggml-base.bin', label: 'Rápido (base)', sizeMb: 142 },
  small: { file: 'ggml-small-q5_1.bin', label: 'Equilibrado (small)', sizeMb: 181 },
  medium: { file: 'ggml-medium-q5_0.bin', label: 'Preciso (medium)', sizeMb: 514 },
};

const SOURCES = {
  ytdlp: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  // YouTube pide resolver unas pruebas en JavaScript; yt-dlp usa Deno para eso. Sin él faltan formatos y algún día dejará de leer.
  deno: 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip',
  ffmpeg: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  model: (name) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODELS[name].file}`,
};
const DENO_MB = 41;

// Whisper publica sus archivos en versiones "bNNNN" y a veces cambia los nombres, así que los buscamos.
const WHISPER_ASSETS = {
  'whisper-cpu': /^whisper-bin-x64\.zip$/,
  'whisper-gpu': /^whisper-(bin-win-cuda-12[\d.]*-x64|cublas-12[\d.]*-bin-x64)\.zip$/,
};
const WHISPER_FALLBACK = {
  'whisper-cpu': 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  'whisper-gpu': 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip',
};

async function whisperUrl(id) {
  try {
    const res = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15', {
      headers: { 'User-Agent': 'ClipViral', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    const releases = await res.json();
    for (const r of Array.isArray(releases) ? releases : []) {
      const asset = (r.assets || []).find((a) => WHISPER_ASSETS[id].test(a.name));
      if (asset) return asset.browser_download_url;
    }
  } catch {}
  return WHISPER_FALLBACK[id];
}

/** `sources` solo sirve para las pruebas (bajar de un servidor local). */
function createComponents(binDir, { sources = {}, extraYtdlpArgs = () => [] } = {}) {
  const src = { ...SOURCES, ...sources };
  const p = {
    ytdlp: path.join(binDir, 'yt-dlp.exe'),
    deno: path.join(binDir, 'deno.exe'),
    // Lo que se agrega a cada llamada de yt-dlp: dónde está nuestro Deno (se revisa cada vez por si se instaló después)
    // y, si las conectaste en Ajustes, tus cookies de YouTube (extraYtdlpArgs).
    ytdlpArgs: () => [...(fs.existsSync(p.deno) ? ['--js-runtimes', `deno:${p.deno}`] : []), ...(extraYtdlpArgs() || [])],
    ffmpeg: path.join(binDir, 'ffmpeg.exe'),
    ffprobe: path.join(binDir, 'ffprobe.exe'),
    whisperDir: path.join(binDir, 'whisper'),
    whisper: path.join(binDir, 'whisper', 'whisper-cli.exe'),
    whisperFlavor: path.join(binDir, 'whisper', 'tipo.txt'),
    models: path.join(binDir, 'models'),
    model: (name) => path.join(binDir, 'models', MODELS[name]?.file || MODELS.base.file),
  };

  function status() {
    const flavor = fs.existsSync(p.whisperFlavor) ? fs.readFileSync(p.whisperFlavor, 'utf8').trim() : null;
    return {
      ytdlp: fs.existsSync(p.ytdlp),
      deno: fs.existsSync(p.deno),
      denoMb: DENO_MB,
      ffmpeg: fs.existsSync(p.ffmpeg) && fs.existsSync(p.ffprobe),
      whisper: fs.existsSync(p.whisper),
      whisperFlavor: fs.existsSync(p.whisper) ? (flavor || 'cpu') : null,
      models: Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, { ...m, installed: fs.existsSync(p.model(k)) }])),
    };
  }

  function extract(zipFile, pick, destDir) {
    const zip = new AdmZip(zipFile);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const chosen = pick(entries);
    if (!chosen.length) throw new Error('El archivo descargado no tiene lo esperado');
    fs.mkdirSync(destDir, { recursive: true });
    for (const e of chosen) fs.writeFileSync(path.join(destDir, path.basename(e.entryName)), e.getData());
  }

  /** ¿Quedó instalado de verdad? (se revisa después de instalar) */
  function isInstalled(id, st = status()) {
    if (id === 'ytdlp') return st.ytdlp;
    if (id === 'deno') return st.deno;
    if (id === 'ffmpeg') return st.ffmpeg;
    if (id === 'whisper-cpu') return st.whisper;
    if (id === 'whisper-gpu') return st.whisperFlavor === 'gpu';
    if (id.startsWith('model-')) return !!st.models[id.slice(6)]?.installed;
    return false;
  }

  /** Cambia la carpeta de Whisper por la nueva sin dejarla a medias si algo falla. */
  function swapWhisper(staging) {
    const old = path.join(binDir, 'whisper-viejo');
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(p.whisperDir)) {
      try {
        fs.renameSync(p.whisperDir, old);
      } catch {
        throw new Error('Whisper está en uso. Detén la grabación (o cierra otra ventana de ClipViral) y vuelve a intentar.');
      }
    }
    try {
      fs.renameSync(staging, p.whisperDir);
    } catch (err) {
      if (fs.existsSync(old)) fs.renameSync(old, p.whisperDir); // deja la versión que funcionaba
      throw err;
    }
    try { fs.rmSync(old, { recursive: true, force: true }); } catch {}
  }

  /** Borra descargas a medias de hace días y carpetas temporales de Whisper. */
  function cleanLeftovers(maxAgeMs = 3 * 86400000) {
    if (!fs.existsSync(binDir)) return;
    for (const name of fs.readdirSync(binDir)) {
      // Las de la versión anterior llevaban la hora en el nombre y ya no se pueden continuar.
      const temp = name === 'whisper-nuevo' || name === 'whisper-viejo' || name === 'deno-nuevo' || /^descarga-.+-\d{13}(\.part)?$/.test(name);
      if (!/^descarga-/.test(name) && !temp) continue;
      const file = path.join(binDir, name);
      // Una descarga de algo que ya está instalado no sirve para nada.
      const id = /^descarga-(.+?)(\.part)?$/.exec(name)?.[1];
      const useless = !!id && isInstalled(id);
      try {
        if (temp || useless || Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { recursive: true, force: true });
      } catch {}
    }
  }

  /** Instala un componente. onProgress(fraccion 0..1, texto). */
  async function install(id, onProgress) {
    fs.mkdirSync(binDir, { recursive: true });
    // Nombre fijo: si la descarga se corta, la próxima vez sigue desde donde iba.
    const tmp = path.join(binDir, `descarga-${id}`);
    const report = (label) => (got, total) => onProgress?.(total ? got / total : 0, `${label} · ${(got / 1048576).toFixed(0)}${total ? ` de ${(total / 1048576).toFixed(0)}` : ''} MB`);
    if (id === 'ytdlp') {
      await download(src.ytdlp, tmp, report('Descargando yt-dlp'));
      fs.rmSync(p.ytdlp, { force: true });
      fs.renameSync(tmp, p.ytdlp);
    } else if (id === 'deno') {
      await download(src.deno, tmp, report('Descargando Deno'));
      onProgress?.(1, 'Descomprimiendo Deno…');
      const staging = path.join(binDir, 'deno-nuevo');
      fs.rmSync(staging, { recursive: true, force: true });
      try {
        extract(tmp, (es) => es.filter((e) => /(^|\/)deno\.exe$/i.test(e.entryName)).slice(0, 1), staging);
        try {
          fs.rmSync(p.deno, { force: true });
        } catch {
          throw new Error('Deno está en uso. Detén la grabación (o cierra otra ventana de ClipViral) y vuelve a intentar.');
        }
        fs.renameSync(path.join(staging, 'deno.exe'), p.deno);
      } finally {
        fs.rmSync(tmp, { force: true });
        fs.rmSync(staging, { recursive: true, force: true });
      }
    } else if (id === 'ffmpeg') {
      await download(src.ffmpeg, tmp, report('Descargando FFmpeg'));
      onProgress?.(1, 'Descomprimiendo FFmpeg…');
      try { extract(tmp, (es) => es.filter((e) => /\/bin\/(ffmpeg|ffprobe)\.exe$/i.test(e.entryName)), binDir); } finally { fs.rmSync(tmp, { force: true }); }
    } else if (id === 'whisper-cpu' || id === 'whisper-gpu') {
      await download(await whisperUrl(id), tmp, report(`Descargando Whisper (${id === 'whisper-gpu' ? 'NVIDIA' : 'procesador'})`));
      onProgress?.(1, 'Descomprimiendo Whisper…');
      const staging = path.join(binDir, 'whisper-nuevo');
      fs.rmSync(staging, { recursive: true, force: true });
      try {
        extract(tmp, (es) => {
          const cli = es.find((e) => /(^|\/)whisper-cli\.exe$/i.test(e.entryName));
          if (!cli) return [];
          const dir = cli.entryName.slice(0, cli.entryName.length - 'whisper-cli.exe'.length);
          return es.filter((e) => e.entryName.startsWith(dir) && !e.entryName.slice(dir.length).includes('/'));
        }, staging);
        if (!fs.existsSync(path.join(staging, 'whisper-cli.exe'))) throw new Error('El archivo de Whisper vino incompleto. Vuelve a intentar.');
        fs.writeFileSync(path.join(staging, 'tipo.txt'), id === 'whisper-gpu' ? 'gpu' : 'cpu');
        swapWhisper(staging);
      } finally {
        fs.rmSync(tmp, { force: true });
        fs.rmSync(staging, { recursive: true, force: true });
      }
    } else if (id.startsWith('model-')) {
      const name = id.slice(6);
      if (!MODELS[name]) throw new Error('Modelo desconocido');
      fs.mkdirSync(p.models, { recursive: true });
      await download(src.model(name), tmp, report(`Descargando modelo ${MODELS[name].label}`));
      fs.rmSync(p.model(name), { force: true });
      fs.renameSync(tmp, p.model(name));
    } else {
      throw new Error(`Componente desconocido: ${id}`);
    }
    if (!isInstalled(id)) throw new Error('La instalación no se completó. Vuelve a intentar.');
    onProgress?.(1, 'Listo');
  }

  /**
   * YouTube cambia seguido y un yt-dlp viejo deja de funcionar.
   * Lo actualizamos solo si pasaron más de 2 días desde la última vez (o si se fuerza).
   */
  async function updateYtdlp(force = false) {
    if (!fs.existsSync(p.ytdlp)) return { updated: false, reason: 'no instalado' };
    const stamp = path.join(binDir, 'yt-dlp.actualizado');
    const last = fs.existsSync(stamp) ? Number(fs.readFileSync(stamp, 'utf8')) || 0 : 0;
    if (!force && Date.now() - last < 2 * 86400000) return { updated: false, reason: 'reciente' };
    try {
      const { out } = await run(p.ytdlp, ['-U'], { timeoutMs: 180000 });
      fs.writeFileSync(stamp, String(Date.now()));
      return { updated: /Updated yt-dlp to|Updating to/i.test(out), output: out.trim().split('\n').pop() };
    } catch (err) {
      // Si yt-dlp no puede actualizarse solo, se baja la última versión de su página oficial (como al instalarlo).
      try {
        await install('ytdlp');
        fs.writeFileSync(stamp, String(Date.now()));
        return { updated: true, output: 'descargado de nuevo' };
      } catch (err2) {
        return { updated: false, reason: `${err.message.slice(0, 150)} / ${err2.message.slice(0, 150)}` };
      }
    }
  }

  return { paths: p, status, install, isInstalled, cleanLeftovers, updateYtdlp, MODELS };
}

module.exports = { createComponents, MODELS, DENO_MB };
