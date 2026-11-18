// Pasa el audio a texto con Whisper (whisper.cpp) y mide el volumen de cada segundo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('./util');

// Frases que Whisper inventa cuando hay silencio o música.
const HALLUCINATIONS = /(subt[ií]tulos (realizados|por)|amara\.org|suscr[ií]bete|gracias por ver|thanks for watching|\[m[uú]sica\]|\[music\]|♪)/i;

/** Lee un WAV de 16 bits mono y devuelve el volumen (dB) de cada segundo. */
function loudnessPerSecond(wavFile) {
  const buf = fs.readFileSync(wavFile);
  let pos = 12;
  let rate = 16000;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(pos + 12);
    if (id === 'data') { dataStart = pos + 8; dataLen = Math.min(size, buf.length - dataStart); break; }
    pos += 8 + size + (size % 2);
  }
  if (dataStart < 0) return [];
  const samples = Math.floor(dataLen / 2);
  const out = [];
  for (let sec = 0; sec * rate < samples; sec++) {
    let sum = 0;
    const end = Math.min(samples, (sec + 1) * rate);
    for (let i = sec * rate; i < end; i++) {
      const v = buf.readInt16LE(dataStart + i * 2) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - sec * rate));
    out.push(20 * Math.log10(rms + 1e-6));
  }
  return out;
}

/** Convierte la salida JSON de whisper.cpp en palabras con tiempos. */
function parseWhisperJson(json) {
  const items = Array.isArray(json?.transcription) ? json.transcription : [];
  const words = [];
  for (const it of items) {
    const text = String(it.text || '').trim();
    if (!text || HALLUCINATIONS.test(text) || /^\[.*\]$/.test(text)) continue;
    const s = (it.offsets?.from ?? 0) / 1000;
    const e = (it.offsets?.to ?? 0) / 1000;
    const prev = words[words.length - 1];
    // Whisper a veces parte una palabra en pedazos sin espacio inicial: los unimos.
    if (prev && !/^\s/.test(it.text) && s - prev.e < 0.05 && !/^[.,!?¿¡]/.test(text)) {
      prev.w += text;
      prev.e = e;
    } else if (prev && /^[.,!?;:]+$/.test(text)) {
      prev.w += text;
    } else {
      words.push({ s, e: Math.max(e, s + 0.05), w: text });
    }
  }
  return words;
}

// ---------- Tiempos precisos (DTW) ----------
// El modo normal (-ml 1) da tiempos de palabra muy malos: muchas palabras amontonadas en el mismo instante o en el
// segundo entero (frases hasta 10 s antes de tiempo). Con --dtw, whisper.cpp alinea cada pedazo de palabra con el audio.

/** Nombre del modelo (ggml-small-q5_1.bin) → el "preset" que pide --dtw (small). null si no se conoce. */
function dtwPreset(model) {
  const m = path.basename(String(model || '')).match(/^ggml-(tiny|base|small|medium|large-v1|large-v2|large-v3-turbo|large-v3)(\.en)?(?:-q\d+_\d+)?\.bin$/i);
  if (!m) return null;
  return m[1].toLowerCase().replace(/-/g, '.') + (m[2] ? '.en' : '');
}

const SOLO_SIGNOS = /^[^\p{L}\p{N}]+$/u;
const ABRE = /^[¿¡"«“(]+$/;
const letras = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length;
const normal = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Palabras con los tiempos de DTW (salida -ojf: cada pedazo trae t_dtw en centésimas de segundo).
 * duration: lo que dura el audio (ninguna palabra queda después). Devuelve null si la salida no trae DTW
 * (entonces se usa el modo normal).
 */
function parseWhisperDtw(json, duration = Infinity) {
  const items = Array.isArray(json?.transcription) ? json.transcription : [];
  const raw = [];
  let lastText = '';
  items.forEach((seg, si) => {
    const text = String(seg.text || '').trim();
    if (!text || HALLUCINATIONS.test(text)) return;
    // Whisper a veces repite la frase anterior entera (sobre todo al final del audio): es inventada.
    const norm = normal(text);
    if (norm && norm === lastText) return;
    lastText = norm;
    let cur = null;
    for (const tk of seg.tokens || []) {
      const piece = String(tk.text || '');
      if (/^\s*\[_/.test(piece)) continue; // marcas internas de Whisper ([_BEG_], [_TT_150]...)
      const t = Number(tk.t_dtw);
      if (!Number.isFinite(t) || t < 0) { raw.length = 0; raw.noDtw = true; return; }
      if (!cur || /^\s/.test(piece)) { cur = { s: t / 100, w: piece.trim(), seg: si }; raw.push(cur); } else cur.w += piece;
    }
  });
  if (raw.noDtw) return null;
  // Signos sueltos: "¿" va con la palabra que sigue, "?" "," "..." con la anterior; el guion de "cambio de persona" se va.
  const words = [];
  let prefix = '';
  for (const r of raw) {
    const w = r.w.trim();
    if (!w || /^\[.*\]$/.test(w) || /^\(.*\)$/.test(w) || HALLUCINATIONS.test(w)) continue; // [Música], (risas)
    if (SOLO_SIGNOS.test(w)) {
      if (/^[-–—]+$/.test(w)) continue;
      if (ABRE.test(w)) prefix += w;
      else if (words.length) words[words.length - 1].w += w;
      continue;
    }
    words.push({ s: Math.min(r.s, duration), w: prefix + w, seg: r.seg });
    prefix = '';
  }
  // La primera palabra de una frase a veces queda segundos antes que la segunda (una pausa real de 2,5 s dentro de
  // la misma frase es rara): se pone justo antes de ella.
  words.forEach((x, k) => {
    const next = words[k + 1];
    const first = !k || words[k - 1].seg !== x.seg;
    if (first && next && next.seg === x.seg && next.s - x.s > 2.5) x.s = Math.max(x.s, next.s - (0.1 + 0.07 * letras(x.w)));
  });
  for (let k = 1; k < words.length; k++) words[k].s = Math.max(words[k].s, words[k - 1].s);
  // Varias palabras en el mismo instante: se reparten hasta la palabra siguiente según lo largas que son.
  for (let i = 0; i < words.length;) {
    let j = i + 1;
    while (j < words.length && words[j].s - words[j - 1].s < 0.04) j++;
    if (j - i >= 3) {
      const total = words.slice(i, j).reduce((a, x) => a + letras(x.w) + 1, 0);
      const limit = Math.min(words[j]?.s ?? Infinity, duration) - words[i].s;
      const span = Math.max(0, Math.min(limit, total * 0.075));
      let t = words[i].s;
      for (let k = i; k < j; k++) { words[k].s = t; t += span * (letras(words[k].w) + 1) / total; }
    }
    i = j;
  }
  // Fin de cada palabra: hasta que empieza la siguiente, sin pasarse de lo que puede durar decirla.
  return words.map((x, k) => {
    const s = Math.min(x.s, Math.max(0, duration - 0.05));
    const cap = s + Math.min(1.5, 0.15 + 0.08 * letras(x.w));
    const e = Math.min(duration, Math.max(Math.min(words[k + 1]?.s ?? Infinity, cap), s + 0.05));
    return { s: Number(s.toFixed(3)), e: Number(e.toFixed(3)), w: x.w };
  });
}

// Qué sabe hacer el whisper-cli instalado (versiones viejas no traen --dtw o --no-flash-attn). Se pregunta una vez.
const features = new Map();
function whisperFeatures(whisper) {
  if (!features.has(whisper)) {
    features.set(whisper, run(whisper, ['--help'], { cwd: path.dirname(whisper), timeoutMs: 20000 })
      .catch((err) => err)
      .then((r) => {
        const t = `${r?.out || ''}${r?.err || ''}`;
        return { dtw: /--dtw\b/.test(t), nfa: /--no-flash-attn\b/.test(t) };
      }));
  }
  return features.get(whisper);
}

/** Argumentos de whisper-cli: con tiempos precisos (DTW) si se puede, y los del modo normal de respaldo. */
function whisperArgs({ model, wav, language, base, threads, useGpu, feats = {} }) {
  const common = ['-m', model, '-f', wav, '-l', language, '-of', base, '-t', String(threads), '-np', ...(useGpu ? [] : ['-ng'])];
  const preset = feats.dtw ? dtwPreset(model) : null;
  return {
    // DTW no funciona con "flash attention" (en las versiones nuevas viene encendida): se apaga.
    precise: preset ? [...common, '-ojf', '--dtw', preset, ...(feats.nfa ? ['-nfa'] : [])] : null,
    plain: [...common, '-oj', '-ml', '1', '-sow'],
  };
}

/**
 * Transcribe un segmento de video. Devuelve { words, loudness, duration }.
 */
async function transcribeSegment({ ffmpeg, whisper, model, language = 'auto', useGpu = true, threads: forcedThreads }, segmentFile, workDir) {
  const base = path.join(workDir, path.basename(segmentFile, path.extname(segmentFile)));
  const wav = `${base}.wav`;
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', segmentFile, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  try {
    const loudness = loudnessPerSecond(wav);
    const threads = String(forcedThreads || Math.max(2, Math.min(8, os.cpus().length - 1)));
    const { precise, plain } = whisperArgs({ model, wav, language, base, threads, useGpu, feats: await whisperFeatures(whisper) });
    const jsonFile = `${base}.json`;
    const readJson = () => { try { return JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } finally { fs.rmSync(jsonFile, { force: true }); } };
    if (precise) {
      try {
        await run(whisper, precise, { cwd: path.dirname(whisper), timeoutMs: 20 * 60 * 1000 });
        const words = parseWhisperDtw(readJson(), loudness.length || Infinity);
        if (words) return { words, loudness, duration: loudness.length };
      } catch {
        // Si el modo preciso falla, se intenta con el de siempre.
      }
    }
    try {
      await run(whisper, plain, { cwd: path.dirname(whisper), timeoutMs: 20 * 60 * 1000 });
    } catch (err) {
      // Whisper falla con pedazos muy cortos (el final de un video): seguimos sin texto.
      if (loudness.length < 20) return { words: [], loudness, duration: loudness.length };
      throw err;
    }
    return { words: parseWhisperJson(readJson()), loudness, duration: loudness.length };
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

module.exports = { transcribeSegment, parseWhisperJson, parseWhisperDtw, dtwPreset, whisperArgs, loudnessPerSecond };
