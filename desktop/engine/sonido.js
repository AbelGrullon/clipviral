// Oído de la IA local: un modelo especializado en sonidos (AST, entrenado con AudioSet de Google)
// escucha el audio cada 10 segundos y dice si hay risas, gritos, aplausos, sorpresa, llanto o explosiones.
// Corre en la PC (sin internet después de bajarlo una vez, unos 90 MB).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODEL_ID = 'Xenova/ast-finetuned-audioset-10-10-0.4593';
const MODEL_MB = 90;
const RATE = 16000;
const WINDOW = 10; // segundos que escucha de una vez (el modelo está hecho para 10 s)

// Qué etiquetas de AudioSet cuentan para cada cosa que nos importa, y desde qué probabilidad es "fuerte".
const CATEGORIAS = {
  risas: { labels: ['Laughter', 'Baby laughter', 'Giggle', 'Snicker', 'Belly laugh', 'Chuckle, chortle'], fuerte: 0.25, texto: 'risas' },
  gritos: { labels: ['Screaming', 'Shout', 'Yell', 'Bellow', 'Whoop', 'Children shouting', 'Battle cry'], fuerte: 0.2, texto: 'gritos' },
  euforia: { labels: ['Cheering', 'Applause', 'Crowd', 'Clapping', 'Hubbub, speech noise, speech babble'], fuerte: 0.3, texto: 'aplausos o euforia' },
  sorpresa: { labels: ['Gasp', 'Groan', 'Sigh'], fuerte: 0.35, texto: 'sorpresa' },
  llanto: { labels: ['Crying, sobbing', 'Wail, moan', 'Whimper'], fuerte: 0.25, texto: 'llanto' },
  golpe: { labels: ['Explosion', 'Boom', 'Gunshot, gunfire', 'Smash, crash', 'Bang', 'Slam'], fuerte: 0.25, texto: 'golpe o explosión' },
};
const PESO = { risas: 1.2, gritos: 1.1, euforia: 1, sorpresa: 0.6, llanto: 0.8, golpe: 0.7 };

/** Convierte las probabilidades del modelo (por etiqueta) en nuestras categorías (0 a 1). */
function categorize(probs, id2label) {
  const out = {};
  for (const [cat, def] of Object.entries(CATEGORIAS)) {
    let best = 0;
    for (const [i, label] of Object.entries(id2label)) if (def.labels.includes(label)) best = Math.max(best, probs[i] || 0);
    out[cat] = Math.round(best * 100) / 100;
  }
  return out;
}

/** Puntaje de sonido de 0 a ~4: cuánto "pasa algo" en ese tramo, según lo fuerte que suena cada categoría. */
function soundScore(cats = {}) {
  let s = 0;
  for (const [cat, def] of Object.entries(CATEGORIAS)) {
    const p = cats[cat] || 0;
    if (p >= def.fuerte * 0.5) s += PESO[cat] * Math.min(2, p / def.fuerte);
  }
  return Math.round(Math.min(4, s) * 100) / 100;
}

/** Lo más fuerte que se oyó, en palabras ("risas y gritos"). Vacío si no hubo nada claro. */
function describe(cats = {}) {
  const hits = Object.entries(CATEGORIAS)
    .filter(([cat, def]) => (cats[cat] || 0) >= def.fuerte)
    .sort((a, b) => (cats[b[0]] / b[1].fuerte) - (cats[a[0]] / a[1].fuerte))
    .map(([, def]) => def.texto);
  if (!hits.length) return '';
  return hits.length === 1 ? hits[0] : `${hits.slice(0, -1).join(', ')} y ${hits[hits.length - 1]}`;
}

/** Junta varias ventanas: lo más fuerte de cada categoría. */
function merge(list) {
  const out = {};
  for (const cats of list) for (const [k, v] of Object.entries(cats || {})) out[k] = Math.max(out[k] || 0, v);
  return out;
}

class Oido {
  constructor(dir) {
    this.dir = dir; // carpeta donde se guarda el modelo
    this.loading = null;
  }

  installed() {
    const base = path.join(this.dir, ...MODEL_ID.split('/'));
    return fs.existsSync(path.join(base, 'onnx', 'model_quantized.onnx')) && fs.existsSync(path.join(base, 'config.json'));
  }

  status() {
    return { installed: this.installed(), mb: MODEL_MB, ready: !!this.model };
  }

  /** Carga el modelo (y lo baja la primera vez, mostrando el avance). */
  load(onProgress) {
    if (this.model) return Promise.resolve(this);
    if (!this.loading) {
      this.loading = (async () => {
        const T = await import('@huggingface/transformers');
        T.env.cacheDir = this.dir;
        T.env.allowLocalModels = false;
        const files = {};
        const progress_callback = (p) => {
          if (p.status !== 'progress' || !p.total) return;
          files[p.file] = { loaded: p.loaded, total: p.total };
          const all = Object.values(files);
          const frac = all.reduce((a, f) => a + f.loaded, 0) / all.reduce((a, f) => a + f.total, 0);
          onProgress?.(frac, `Bajando el detector de sonidos… ${Math.round(frac * 100)}%`);
        };
        this.processor = await T.AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
        this.model = await T.AutoModelForAudioClassification.from_pretrained(MODEL_ID, { dtype: 'q8', progress_callback });
        this.labels = this.model.config.id2label;
        return this;
      })().catch((err) => { this.loading = null; throw err; });
    }
    return this.loading;
  }

  /** Escucha 10 s de audio (Float32 a 16 kHz) y devuelve las categorías. */
  async classify(pcm) {
    await this.load();
    const inputs = await this.processor(pcm);
    const { logits } = await this.model(inputs);
    const probs = Array.from(logits.data, (x) => 1 / (1 + Math.exp(-x)));
    return categorize(probs, this.labels);
  }

  /**
   * Escucha un pedazo de audio o video completo, en ventanas de 10 s.
   * Devuelve [{ t (segundo dentro del archivo), cats, score }].
   */
  async listenFile(ffmpeg, file, { shouldStop } = {}) {
    const pcm = await readPcm(ffmpeg, file);
    const out = [];
    const step = WINDOW * RATE;
    for (let s = 0; s + RATE * 2 <= pcm.length; s += step) {
      if (shouldStop?.()) break;
      const cats = await this.classify(pcm.subarray(s, Math.min(pcm.length, s + step)));
      out.push({ t: s / RATE, cats, score: soundScore(cats) });
    }
    return out;
  }
}

/** Saca el audio como números (mono, 16 kHz) con FFmpeg. */
function readPcm(ffmpeg, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { windowsHide: true });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`FFmpeg no pudo leer el audio: ${err.trim()}`));
      const buf = Buffer.concat(chunks);
      const copy = new Float32Array(Math.floor(buf.length / 4));
      Buffer.from(copy.buffer).set(buf.subarray(0, copy.length * 4));
      resolve(copy);
    });
  });
}

module.exports = { Oido, CATEGORIAS, categorize, soundScore, describe, merge, MODEL_ID, MODEL_MB, WINDOW };
