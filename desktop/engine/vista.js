// Ojos de la IA local: saca unas fotos del momento y se las muestra a un modelo que entiende imágenes
// (Qwen3-VL en Ollama), junto con lo que se dice, el chat y lo que oyó el detector de sonidos.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');

const OLLAMA = 'http://127.0.0.1:11434';

// Modelos que ven video, de mejor a más liviano (versiones "instruct": responden directo, sin "pensar" minutos).
const VISION_CATALOG = [
  { id: 'qwen3-vl:8b-instruct', sizeGb: 6.2, desc: 'La mejor calidad. Necesita una tarjeta de video de 10 GB o más (en un directo la tarjeta también pasa la voz a texto).' },
  { id: 'qwen3-vl:4b-instruct', sizeGb: 3.3, desc: 'Muy buena y más liviana. Para tarjetas de 6 a 8 GB.' },
  { id: 'qwen3-vl:2b-instruct', sizeGb: 1.9, desc: 'La más liviana, para PCs sencillas (más lenta sin tarjeta de video).' },
];

/** Elige el modelo de visión según la tarjeta de video y la memoria (primero uno ya instalado). */
function pickVisionModel(installed = [], hw = {}) {
  const vram = hw.vramGb || 0;
  const ram = hw.ramGb || 0;
  const has = (c) => installed.some((m) => m === c.id || m.startsWith(c.id));
  const out = (c) => ({ id: c.id, sizeGb: c.sizeGb, installed: has(c) });
  // Primero lo que cabe en la tarjeta de video (rápido): el más grande, y mejor si ya está instalado.
  // Se deja lugar para Whisper (pasar a texto), la grabación y Windows: si la tarjeta se llena, el modelo pasa
  // a la memoria normal y tarda más de 3 minutos en responder.
  const fast = VISION_CATALOG.filter((c) => vram >= c.sizeGb + 2.5);
  if (fast.length) return out(fast.find(has) || fast[0]);
  // Si no, con el procesador: uno chico (lento pero funciona).
  const slow = VISION_CATALOG.filter((c) => c.sizeGb <= 3.5 && ram >= c.sizeGb + 6);
  if (slow.length) return out(slow.find(has) || slow[slow.length - 1]);
  return null;
}

/** Momentos (en segundos absolutos) en los que se sacan las fotos: repartidas, más juntas cerca del pico. */
function frameTimes(start, end, peakT, count = 6) {
  const len = Math.max(1, end - start);
  const times = [];
  for (let i = 0; i < count - 2; i++) times.push(start + ((i + 0.5) / (count - 2)) * len);
  if (Number.isFinite(peakT) && peakT > start && peakT < end) times.push(Math.max(start, peakT - 1.5), Math.min(end - 0.2, peakT + 1.5));
  return [...new Set(times.map((t) => Math.round(t * 10) / 10))].sort((a, b) => a - b).slice(0, count);
}

/**
 * Saca fotos chicas (JPG en base64) del video.
 * segments: [{ file, start, duration }] que cubren el tramo (los mismos que usa el cortador de clips).
 */
async function grabFrames({ ffmpeg, segments, times, tempDir, width = 640 }) {
  fs.mkdirSync(tempDir, { recursive: true });
  const frames = [];
  for (const [i, t] of times.entries()) {
    const seg = segments.find((s) => t >= s.start && t < s.start + s.duration) || segments[segments.length - 1];
    if (!seg) continue;
    const out = path.join(tempDir, `foto-${i}.jpg`);
    try {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t - seg.start).toFixed(2), '-i', seg.file,
        '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '5', out]);
      if (fs.existsSync(out) && fs.statSync(out).size > 500) frames.push({ t, b64: fs.readFileSync(out).toString('base64') });
    } catch {
      // Un pedazo sin video (o que se borró) no frena todo: se usan las fotos que salieron.
    } finally {
      fs.rmSync(out, { force: true });
    }
  }
  return frames;
}

const SCHEMA = {
  type: 'object',
  properties: {
    que_pasa: { type: 'string' },
    imagen: { type: 'integer' },
    viral: { type: 'integer' },
    title: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: ['que_pasa', 'imagen', 'viral', 'title', 'hashtags', 'description'],
};

function prompt({ streamTitle, transcript, chatSummary, sounds, frames, start }) {
  const fmt = (t) => `${Math.floor((t - start) / 60)}:${String(Math.floor((t - start) % 60)).padStart(2, '0')}`;
  return `Directo o video: ${streamTitle || 'sin título'}
Te muestro ${frames.length} fotos del momento, en orden (segundo dentro del clip: ${frames.map((f) => fmt(f.t)).join(', ')}).
Lo que se oye (detector de sonidos): ${sounds || 'nada especial'}
Chat en ese momento: ${chatSummary || 'sin datos'}
Lo que se dice:
${String(transcript || '(sin voz)').slice(0, 5000)}`;
}

/**
 * Le pide al modelo de visión su opinión del momento.
 * Devuelve { imagen (1-10: qué tan fuerte se VE), viral (1-10), que_pasa, title, hashtags, description }.
 */
// Cuánto se queda el modelo en la tarjeta de video sin usarse: cargarlo de nuevo tarda minutos con un directo grabando.
const KEEP = '30m';
const warming = new Map();

/**
 * Carga el modelo antes de que haga falta (al empezar la sesión), así el primer momento no espera a que se lea del disco.
 * Devuelve true si quedó listo.
 */
function warmUp(model, { timeoutMs = 600000 } = {}) {
  if (!warming.has(model)) {
    const p = fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, messages: [], keep_alive: KEEP }),
    }).then((r) => r.ok).catch(() => false).finally(() => warming.delete(model));
    warming.set(model, p);
  }
  return warming.get(model);
}

async function reviewMoment(model, data, { timeoutMs = 180000 } = {}) {
  // Si se está cargando, el tiempo para responder empieza a contar cuando ya está listo.
  if (warming.has(model)) await warming.get(model);
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      stream: false,
      format: SCHEMA,
      keep_alive: KEEP,
      options: { temperature: 0.3, num_ctx: 8192 },
      messages: [
        {
          role: 'system',
          content: 'Eres editor de clips virales para TikTok, Reels y Shorts. Miras fotos de un momento de un video, '
            + 'lees lo que se dice y lo que se oye, y decides si vale un clip. Responde en JSON: '
            + 'que_pasa (1 frase: qué se ve y qué pasa), '
            + 'imagen (1 a 10: qué tan llamativo se VE: reacciones fuertes, caras, acción, algo raro o gracioso. Una persona hablando quieta = 3), '
            + 'viral (1 a 10 en total, sé exigente: 8+ solo si de verdad engancha), '
            + 'title (corto, llamativo, en el idioma del video, máx 70 letras), hashtags (3 a 6, con #), description (1 frase). '
            + 'No inventes cosas que no se ven ni se dicen.',
        },
        { role: 'user', content: prompt(data), images: data.frames.map((f) => f.b64) },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`El modelo de visión respondió ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`);
  }
  const body = await res.json();
  return parseReview(body.message?.content);
}

function parseReview(content) {
  let parsed = {};
  try { parsed = JSON.parse(content || '{}'); } catch { parsed = {}; }
  const clamp = (v, d) => Math.max(1, Math.min(10, Math.round(Number(v)) || d));
  return {
    que_pasa: String(parsed.que_pasa || '').slice(0, 200),
    imagen: clamp(parsed.imagen, 4),
    viral: clamp(parsed.viral, 5),
    title: String(parsed.title || '').slice(0, 100),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 6).map(String) : [],
    description: String(parsed.description || '').slice(0, 400),
  };
}

module.exports = { VISION_CATALOG, pickVisionModel, frameTimes, grabFrames, warmUp, reviewMoment, parseReview };
