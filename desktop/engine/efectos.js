// Efectos del clip: espejo, velocidad, fondo propio, quitar silencios (cortes) y efectos de voz.
// Todo se arma como filtros de FFmpeg y se aplica en la misma pasada que pone el video en vertical.
const fs = require('node:fs');
const { run } = require('./util');

const SPEEDS = [1, 1.1, 1.25, 1.5, 2];

// Efectos de voz. Lo que cambia el tono se hace a 48 kHz y luego se corrige la velocidad (el clip dura lo mismo).
const pitch = (f) => `aresample=48000,asetrate=${Math.round(48000 * f)},aresample=48000,atempo=${(1 / f).toFixed(4)}`;
const VOICES = {
  normal: { label: 'Normal', filter: '' },
  aguda: { label: 'Aguda (ardilla)', filter: pitch(1.35) },
  grave: { label: 'Grave (monstruo)', filter: pitch(0.75) },
  robot: { label: 'Robot', filter: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" },
  eco: { label: 'Eco', filter: 'aecho=0.8:0.85:120|240:0.35|0.2' },
  radio: { label: 'Radio / teléfono', filter: 'highpass=f=350,lowpass=f=3200,acompressor=threshold=0.1:ratio=6,volume=1.6' },
};

/** Deja los efectos en valores válidos (lo que venga de ajustes viejos o mal escritos no rompe nada). */
function normalize(e = {}) {
  const speed = Number(e.velocidad) || 1;
  return {
    espejo: !!e.espejo,
    velocidad: SPEEDS.reduce((best, s) => (Math.abs(s - speed) < Math.abs(best - speed) ? s : best), 1),
    fondo: e.fondo && fs.existsSync(e.fondo) ? e.fondo : '',
    silencios: !!e.silencios,
    voz: VOICES[e.voz] ? e.voz : 'normal',
  };
}

/** Lee la salida de silencedetect de FFmpeg → [{ start, end }] en segundos del clip. */
function parseSilences(text, duration) {
  const out = [];
  let open = null;
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) { open = Math.max(0, Number(s[1])); continue; }
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && open !== null) { out.push({ start: open, end: Math.min(duration, Number(e[1])) }); open = null; }
  }
  if (open !== null && open < duration) out.push({ start: open, end: duration }); // silencio hasta el final
  return out;
}

/**
 * Qué partes del clip se quedan. Cada silencio se recorta dejando un respiro (pad) a cada lado,
 * así los cortes no se comen el final ni el comienzo de las palabras.
 */
function keepRanges(silences, duration, { pad = 0.15, minCut = 0.35 } = {}) {
  const cuts = silences
    .map((s) => ({ start: s.start <= 0.01 ? 0 : s.start + pad, end: s.end >= duration - 0.01 ? duration : s.end - pad }))
    .filter((c) => c.end - c.start >= minCut);
  const keep = [];
  let t = 0;
  for (const c of cuts) {
    if (c.start > t) keep.push({ start: t, end: c.start });
    t = Math.max(t, c.end);
  }
  if (t < duration) keep.push({ start: t, end: duration });
  // Si casi todo era silencio, mejor no cortar nada.
  const kept = keep.reduce((n, r) => n + r.end - r.start, 0);
  if (kept < Math.min(5, duration * 0.3)) return [{ start: 0, end: duration }];
  return keep.map((r) => ({ start: Number(r.start.toFixed(3)), end: Number(r.end.toFixed(3)) }));
}

const isWhole = (ranges, duration) => ranges.length === 1 && ranges[0].start <= 0.01 && ranges[0].end >= duration - 0.01;
const selectExpr = (ranges) => ranges.map((r) => `between(t,${r.start},${r.end})`).join('+');
const keptSeconds = (ranges) => ranges.reduce((n, r) => n + r.end - r.start, 0);

/**
 * Escucha el pedazo del clip una vez (solo audio, rápido): dice si tiene sonido y dónde están los silencios.
 * inputArgs: los mismos -ss/-i que usa el clip.
 */
async function analyzeAudio(ffmpeg, inputArgs, duration, { noise = -32, minSilence = 0.6 } = {}) {
  const r = await run(ffmpeg, ['-hide_banner', '-nostats', ...inputArgs, '-t', duration.toFixed(2), '-vn',
    '-af', `silencedetect=noise=${noise}dB:d=${minSilence}`, '-f', 'null', '-'], { timeoutMs: 5 * 60 * 1000 })
    .catch((err) => ({ err: err.err || '' }));
  const hasAudio = /Stream #\d+:\d+.*Audio:/.test(r.err);
  return { hasAudio, silences: hasAudio ? parseSilences(r.err, duration) : [] };
}

/** Cadena de audio: cortes → voz → velocidad. Devuelve '' si no hay nada que hacer. */
function audioFilter(fx, ranges) {
  const parts = [];
  if (ranges) parts.push(`aselect='${selectExpr(ranges)}'`, 'asetpts=N/SR/TB');
  if (VOICES[fx.voz]?.filter) parts.push(VOICES[fx.voz].filter);
  if (fx.velocidad !== 1) parts.push(`atempo=${fx.velocidad}`);
  return parts.length ? `[0:a:0]${parts.join(',')}[a]` : '';
}

module.exports = { SPEEDS, VOICES, normalize, parseSilences, keepRanges, isWhole, selectExpr, keptSeconds, analyzeAudio, audioFilter };
