// Videos narrados del agente: guion de la IA → voz del Sintetizador → fondo → subtítulos y título con ClipViral.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../util');
const { transcribeSegment } = require('../transcribe');
const { makeClip } = require('../clipper');

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|m4v)$/i;
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const MUSIC_EXT = /\.(mp3|m4a|wav|ogg|flac)$/i;
const MAX_SECONDS = 88; // Facebook acepta Reels de hasta 90 s
const W = 1080;
const H = 1920;

// Colores para el fondo animado cuando no hay videos ni fotos en la carpeta de fondos.
const PALETAS = [
  ['#1e1b4b', '#7c3aed', '#ec4899'], ['#0f172a', '#0ea5e9', '#22d3ee'], ['#1c1917', '#ea580c', '#facc15'],
  ['#052e16', '#16a34a', '#a3e635'], ['#3b0764', '#c026d3', '#f472b6'], ['#111827', '#ef4444', '#f97316'],
];

/** Lo que hay en la carpeta de fondos: videos, fotos y (en "musica") canciones propias o libres de derechos. */
function listFondos(dir) {
  const ls = (d, re) => {
    try { return fs.readdirSync(d).filter((f) => re.test(f)).map((f) => path.join(d, f)); } catch { return []; }
  };
  return { videos: ls(dir, VIDEO_EXT), imagenes: ls(dir, IMG_EXT), musica: ls(path.join(dir, 'musica'), MUSIC_EXT) };
}

/** Elige un fondo distinto de los últimos usados (si se puede). */
function pickFondo(fondos, recientes = [], rnd = Math.random) {
  const all = [...fondos.videos, ...fondos.imagenes];
  if (!all.length) return null;
  const fresh = all.filter((f) => !recientes.includes(f));
  const list = fresh.length ? fresh : all;
  return list[Math.floor(rnd() * list.length)];
}

const hex = (c, fallback) => {
  const m = String(c || '').trim().match(/^#?([0-9a-f]{6})$/i);
  return `0x${(m ? m[1] : fallback.replace('#', '')).toLowerCase()}`;
};

/** Duración (segundos) de un video o audio, leída por FFmpeg. */
async function mediaDuration(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 60000 }).catch((e) => e);
  const m = String(r.err || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Entrada y filtro de FFmpeg para el fondo (video en bucle, foto con zoom lento o degradado animado). */
async function backgroundInput({ ffmpeg, fondo, seconds, colores, rnd = Math.random }) {
  if (fondo && VIDEO_EXT.test(fondo)) {
    const len = await mediaDuration(ffmpeg, fondo);
    const start = len > seconds + 5 ? Math.floor(rnd() * (len - seconds - 2)) : 0;
    return {
      args: ['-stream_loop', '-1', '-ss', String(start), '-i', fondo],
      filter: `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,eq=brightness=-0.07:saturation=1.05[bg]`,
    };
  }
  if (fondo && IMG_EXT.test(fondo)) {
    const frames = Math.ceil(seconds * 30) + 30;
    return {
      args: ['-i', fondo],
      filter: `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`
        + `zoompan=z='min(zoom+0.00035,1.2)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=30,setsar=1,eq=brightness=-0.05[bg]`,
    };
  }
  const pal = PALETAS[Math.floor(rnd() * PALETAS.length)];
  const [c0, c1, c2] = [0, 1, 2].map((i) => hex(colores?.[i], pal[i]));
  return {
    args: ['-f', 'lavfi', '-i', `gradients=s=${W}x${H}:r=30:c0=${c0}:c1=${c1}:c2=${c2}:n=3:speed=0.01:d=${(seconds + 1).toFixed(2)}`],
    filter: '[0:v]vignette=PI/5,setsar=1[bg]',
  };
}

/** Si Whisper oyó la misma cantidad de palabras que tiene el guion, se usa el texto del guion (ortografía exacta). */
function alignWords(words, guion) {
  const script = String(guion || '').replace(/\[pausa[^\]]*\]/gi, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length || script.length !== words.length) return words;
  return words.map((w, i) => ({ ...w, w: script[i] }));
}

/** Aspecto de los videos narrados: subtítulos grandes al centro y el título los primeros segundos. */
function narratedLook(base = {}) {
  return {
    subs: { color: 'amarillo', textColor: 'blanco', size: 'grande', position: 'centro', font: 'Arial Black', wordsPerLine: 3, uppercase: true, animation: 'pop', ...(base.subs || {}) },
    titleBanner: { enabled: true, seconds: 3, color: 'rosa', ...(base.titleBanner || {}) },
    watermark: { text: '', position: 'abajo-der', ...(base.watermark || {}) },
    logo: base.logo || {},
    quality: '1080',
    fps: 30,
    zoom: 1,
    efectos: {},
  };
}

/**
 * Hace un video narrado completo. idea: { titulo, guion, voz, emocion, colores }.
 * Devuelve { file, thumb, duration, fondo, voz }.
 */
async function makeNarrated({ idea, voz, paths, whisper = {}, workDir, outFile, fondosDir, recientes = [], look, gpuEncode = false, onStep = () => {}, rnd = Math.random }) {
  fs.mkdirSync(workDir, { recursive: true });
  const ffmpeg = paths.ffmpeg;

  onStep('voz', 'Grabando la voz con el Sintetizador…');
  const narr = path.join(workDir, 'narracion.wav');
  const spoken = await voz.hablar({ texto: idea.guion, voz: idea.voz, emocion: idea.emocion, salida: narr });
  let seconds = await mediaDuration(ffmpeg, narr);
  if (!seconds) throw new Error('La voz salió vacía.');
  // Si quedó un poco largo para Facebook, se acelera la voz (hasta 1,25×). Más que eso, el guion era muy largo.
  const factor = seconds > MAX_SECONDS ? seconds / MAX_SECONDS : 1;
  if (factor > 1.25) throw new Error(`El guion quedó muy largo (${Math.round(seconds)} s de voz; Facebook acepta hasta 90 s).`);
  seconds /= factor;

  onStep('subtitulos', 'Escuchando la voz para los subtítulos…');
  const txDir = path.join(workDir, 'whisper');
  fs.mkdirSync(txDir, { recursive: true });
  const tx = await transcribeSegment({
    ffmpeg, whisper: paths.whisper, model: paths.model(whisper.model || 'small'), language: 'es', useGpu: whisper.gpu !== false,
  }, narr, txDir).catch(async (err) => {
    if (whisper.gpu === false) throw err;
    return transcribeSegment({ ffmpeg, whisper: paths.whisper, model: paths.model(whisper.model || 'small'), language: 'es', useGpu: false }, narr, txDir);
  });
  const words = alignWords(tx.words, idea.guion).map((w) => ({ ...w, s: w.s / factor, e: w.e / factor }));

  onStep('fondo', 'Armando el fondo…');
  const fondos = listFondos(fondosDir);
  const fondo = pickFondo(fondos, recientes, rnd);
  const total = seconds + 0.6;
  const bg = await backgroundInput({ ffmpeg, fondo, seconds: total, colores: idea.colores, rnd });
  const music = fondos.musica.length ? fondos.musica[Math.floor(rnd() * fondos.musica.length)] : null;
  const audio = [`[1:a]aresample=48000${factor > 1 ? `,atempo=${factor.toFixed(4)}` : ''},apad=pad_dur=0.6[voz]`];
  if (music) audio.push('[2:a]aresample=48000,volume=0.09[mus]', '[voz][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
  const source = path.join(workDir, 'fuente.mp4');
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', ...bg.args, '-i', narr, ...(music ? ['-stream_loop', '-1', '-i', music] : []),
    '-filter_complex', [bg.filter, ...audio].join(';'),
    '-map', '[bg]', '-map', music ? '[a]' : '[voz]', '-t', total.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', source,
  ], { timeoutMs: 20 * 60000 });

  onStep('video', 'Poniendo subtítulos y título…');
  const clip = await makeClip({
    ffmpeg, segments: [{ file: source, start: 0, duration: total }], clip: { start: 0, end: total, title: idea.titulo, words },
    outFile, style: 'recorte', subtitles: true, look: look || narratedLook(), gpuEncode, tempDir: path.join(workDir, 'clip'),
  });
  return { ...clip, fondo, voz: spoken.voz, emocion: spoken.emocion, musica: music };
}

module.exports = { makeNarrated, listFondos, pickFondo, alignWords, narratedLook, mediaDuration, backgroundInput, MAX_SECONDS };
