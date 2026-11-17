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
    const args = ['-m', model, '-f', wav, '-l', language, '-oj', '-of', base, '-ml', '1', '-sow', '-t', threads, '-np'];
    if (!useGpu) args.push('-ng');
    try {
      await run(whisper, args, { cwd: path.dirname(whisper), timeoutMs: 20 * 60 * 1000 });
    } catch (err) {
      // Whisper falla con pedazos muy cortos (el final de un video): seguimos sin texto.
      if (loudness.length < 20) return { words: [], loudness, duration: loudness.length };
      throw err;
    }
    const jsonFile = `${base}.json`;
    const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    fs.rmSync(jsonFile, { force: true });
    return { words: parseWhisperJson(json), loudness, duration: loudness.length };
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

module.exports = { transcribeSegment, parseWhisperJson, loudnessPerSecond };
