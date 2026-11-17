// IA local con Ollama (plan Local): revisa cada momento y le pone título y hashtags.
const OLLAMA = 'http://127.0.0.1:11434';

// Modelos que sugerimos descargar, de mejor a más liviano.
const CATALOG = [
  { id: 'qwen3:8b', sizeGb: 5.2, desc: 'La mejor calidad para títulos en español.' },
  { id: 'qwen3:4b', sizeGb: 2.5, desc: 'Muy buena calidad y más liviano.' },
  { id: 'gemma3:4b', sizeGb: 3.3, desc: 'Buena alternativa, también liviana.' },
  { id: 'llama3.2:3b', sizeGb: 2.0, desc: 'El más liviano, para PCs sencillas.' },
];

const FAMILIES = {
  qwen3: 'Qwen 3', 'qwen3-vl': 'Qwen 3 VL', 'qwen2.5': 'Qwen 2.5', 'qwen2.5vl': 'Qwen 2.5 VL', 'qwen2.5-coder': 'Qwen 2.5 Coder',
  'llama3.2': 'Llama 3.2', 'llama3.1': 'Llama 3.1', llama3: 'Llama 3', gemma3: 'Gemma 3', gemma2: 'Gemma 2',
  mistral: 'Mistral', 'mistral-nemo': 'Mistral Nemo', phi4: 'Phi 4', phi3: 'Phi 3', 'deepseek-r1': 'DeepSeek R1', 'gpt-oss': 'GPT-OSS',
};

/** "qwen3-vl:8b-instruct" → "Qwen 3 VL · 8B" */
function prettyName(id, paramSize) {
  const [repo, tag = 'latest'] = String(id || '').split(':');
  const base = repo.split('/').pop().toLowerCase();
  const family = FAMILIES[base] || base.replace(/[-_]+/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const size = tag.match(/(?:^|[-_])(\d+(?:\.\d+)?)b(?=$|[-_])/i)?.[1] || String(paramSize || '').match(/^(\d+(?:\.\d+)?)B$/i)?.[1];
  return size ? `${family} · ${size}B` : family;
}

const sameModel = (a, b) => a === b || a === `${b}:latest` || b === `${a}:latest`;

/** Qué tan bien corre un modelo de este tamaño en la PC. */
function modelFit(sizeGb, hw = {}) {
  const need = sizeGb + 0.8;
  if ((hw.vramGb || 0) >= need) return { fit: 'rapido', note: `Rápido: cabe en tu tarjeta de video${hw.gpuName ? ` (${hw.gpuName})` : ''}.` };
  if ((hw.ramGb || 0) >= need + 4.5) return { fit: 'lento', note: 'Funciona, pero más lento: lo hará el procesador.' };
  return { fit: 'pesado', note: 'Muy pesado para tu PC: puede trabarla mientras graba.' };
}

/** Elige el mejor modelo para la PC: primero uno ya instalado, si no, uno para descargar. */
function pickModel(installed, hw) {
  const usable = installed.filter((m) => !m.vision && !m.embedding);
  const candidates = [
    ...usable.map((m) => ({ id: m.name, sizeGb: m.sizeGb, installed: true })),
    ...CATALOG.filter((c) => !installed.some((m) => sameModel(m.name, c.id))).map((c) => ({ id: c.id, sizeGb: c.sizeGb, installed: false })),
  ].map((c) => ({ ...c, fit: modelFit(c.sizeGb, hw).fit }));
  // En la tarjeta de video: el más grande que quepa (más calidad). Si no, en el procesador: uno chico.
  const fast = candidates.filter((c) => c.fit === 'rapido' && c.sizeGb <= 9).sort((a, b) => b.sizeGb - a.sizeGb || b.installed - a.installed);
  if (fast.length) return fast[0];
  const slow = candidates.filter((c) => c.fit === 'lento' && c.sizeGb <= 3.5).sort((a, b) => b.installed - a.installed || b.sizeGb - a.sizeGb);
  return slow[0] || null;
}

/** Lista para la app: nombre claro, tamaño, si está instalado y una recomendación. */
function describeModels(st, hw, selected) {
  const installed = st.details || [];
  const best = pickModel(installed, hw);
  const item = (id, sizeGb, extra) => {
    const fit = modelFit(sizeGb, hw);
    const cat = CATALOG.find((c) => sameModel(c.id, id));
    const notes = [];
    if (extra.vision) notes.push('Este modelo también lee imágenes: aquí no hace falta y pesa más.');
    else if (cat) notes.push(cat.desc);
    notes.push(fit.note);
    return {
      id, label: prettyName(id, extra.params), sizeGb: Math.round(sizeGb * 10) / 10, installed: extra.installed, fit: fit.fit,
      vision: !!extra.vision, recommended: !!best && sameModel(best.id, id), note: notes.join(' '),
    };
  };
  const list = [
    ...installed.filter((m) => !m.embedding).map((m) => item(m.name, m.sizeGb, { installed: true, vision: m.vision, params: m.params })),
    ...CATALOG.filter((c) => !installed.some((m) => sameModel(m.name, c.id))).map((c) => item(c.id, c.sizeGb, { installed: false })),
  ];
  if (selected && !list.some((m) => sameModel(m.id, selected))) list.push(item(selected, 5, { installed: false }));
  return list;
}

async function status() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const data = await res.json();
    const details = (data.models || []).map((m) => {
      const caps = m.capabilities || [];
      return {
        name: m.name,
        sizeGb: (m.size || 0) / 1e9,
        params: m.details?.parameter_size || '',
        vision: caps.includes('vision') || /(^|[-:])vl\b|llava|vision/i.test(m.name),
        embedding: caps.length ? !caps.includes('completion') : /embed/i.test(m.name),
      };
    });
    return { running: true, models: details.map((d) => d.name), details };
  } catch {
    return { running: false, models: [], details: [] };
  }
}

/** Descarga un modelo en Ollama mostrando el progreso. */
async function pull(model, onProgress) {
  const res = await fetch(`${OLLAMA}/api/pull`, { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) throw new Error('Ollama no respondió. ¿Está abierto?');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(msg.error);
      onProgress?.(msg.total ? (msg.completed || 0) / msg.total : 0, msg.status || '');
    }
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    viral: { type: 'integer' },
    title: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
  },
  required: ['viral', 'title', 'hashtags', 'description'],
};

/** Pide a la IA local una nota (1-10), título y hashtags para un momento. */
async function review(model, data) {
  // Modelos como Qwen 3 "piensan" antes de responder y tardan mucho; aquí no hace falta.
  let res = await askReview(model, data, false);
  if (res.status === 400) {
    const text = await res.text();
    if (!/think/i.test(text)) throw new Error(`Ollama respondió 400: ${text.slice(0, 200)}`);
    res = await askReview(model, data, undefined);
  }
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
  const body = await res.json();
  const parsed = JSON.parse(body.message?.content || '{}');
  return {
    viral: Math.max(1, Math.min(10, Number(parsed.viral) || 5)),
    title: String(parsed.title || '').slice(0, 100),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 6).map(String) : [],
    description: String(parsed.description || '').slice(0, 400),
  };
}

function askReview(model, { streamTitle, transcript, chatSummary }, think) {
  return fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model,
      stream: false,
      ...(think === undefined ? {} : { think }),
      format: SCHEMA,
      options: { temperature: 0.4 },
      messages: [
        {
          role: 'system',
          content: 'Eres editor de clips virales para TikTok y Shorts. Evalúa el momento de un directo. '
            + 'Responde en JSON: viral (1 a 10, sé exigente), title (corto, llamativo, idioma del directo, máx 70 letras), '
            + 'hashtags (3 a 6, con #), description (1 frase). No inventes cosas que no pasaron.',
        },
        {
          role: 'user',
          content: `Directo: ${streamTitle}\nChat en ese momento: ${chatSummary || 'sin datos'}\nTranscripción:\n${transcript.slice(0, 6000)}`,
        },
      ],
    }),
  });
}

module.exports = { status, pull, review, CATALOG, prettyName, modelFit, pickModel, describeModels, sameModel };
