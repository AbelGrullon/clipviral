import Anthropic from '@anthropic-ai/sdk';
import { AsyncLocalStorage } from 'node:async_hooks';

// La clave vive solo en el servidor: la que el admin guarda desde el panel o la app (cifrada en la base,
// ver clave.js) o, como respaldo, ANTHROPIC_API_KEY del archivo .env. Nunca viaja a la app.
// clave.js cambia de dónde se lee; aquí solo se arma el cliente.
let keyProvider = () => process.env.ANTHROPIC_API_KEY || null;
const clients = new Map();
// Clave de quien hace el pedido: en el plan Claude cada cliente usa la suya (ver routes/ai.js → withKey).
const keyScope = new AsyncLocalStorage();

export function setKeyProvider(fn) {
  keyProvider = fn;
}

/** Corre fn usando esta clave de Claude (la del cliente que hizo el pedido). */
export function withKey(key, fn) {
  return keyScope.run({ key: key || null }, fn);
}

/** Cliente de Claude con la clave de ahora: la del pedido en curso o, si no hay, la del servidor. */
export function getClient() {
  const scope = keyScope.getStore();
  const key = (scope ? scope.key : keyProvider()) || null;
  if (!key) return null;
  if (!clients.has(key)) {
    if (clients.size > 200) clients.clear();
    // authToken: null para que use solo esta clave y no otra credencial que haya en la PC.
    clients.set(key, new Anthropic({ apiKey: key, authToken: null }));
  }
  return clients.get(key);
}

export function aiEnabled() {
  return !!getClient();
}

/**
 * Revisa una clave sin gastar: pide la lista de modelos (no cuesta nada).
 * Devuelve { ok: true } o { ok: false, error } con un mensaje en español sencillo.
 */
export async function checkApiKey(key) {
  const probe = new Anthropic({ apiKey: key, authToken: null, maxRetries: 1, timeout: 20000 });
  try {
    await probe.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'Claude dice que esa clave no es válida. Revisa que la copiaste completa (empieza con sk-ant-) y que no la borraste en console.anthropic.com.' };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: 'Esa clave no tiene permiso para usar Claude. Crea una clave nueva en console.anthropic.com → API Keys.' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Claude está ocupado ahora mismo. Espera un minuto y vuelve a intentar.' };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: 'No pude conectar con Claude para probar la clave. Revisa tu internet y vuelve a intentar.' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, error: `Claude no pudo revisar la clave (error ${err.status ?? '?'}). Intenta de nuevo en unos minutos.` };
    }
    throw err;
  }
}

/** Mensaje claro cuando falla una llamada a Claude por la clave o el saldo (para mostrarlo en la app). */
export function aiErrorMessage(err, fallback) {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return 'La clave de Claude dejó de funcionar. El administrador debe ponerla otra vez en Ajustes → Clave de Claude.';
  }
  if (err?.status === 402 || (err instanceof Anthropic.BadRequestError && /credit balance/i.test(String(err.message)))) {
    return 'Tu cuenta de Claude no tiene saldo. Recarga en console.anthropic.com → Billing y vuelve a intentar.';
  }
  return fallback;
}

export const HAIKU = 'claude-haiku-5-5';
export const SONNET = 'claude-sonnet-5-5';
export const OPUS = 'claude-opus-5-5';

// Precio en dólares por millón de tokens (entrada / salida).
const PRICES = {
  'claude-haiku-5-5': [0.10, 0.50],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
};

export function costOf(model, usage) {
  const [inPrice, outPrice] = PRICES[model] || PRICES[SONNET];
  const input = (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
  return (input * inPrice + (usage?.output_tokens || 0) * outPrice) / 1e6;
}

const SCAN_SYSTEM = `Eres un editor experto en clips virales para TikTok, YouTube Shorts y Reels.
Recibes un tramo de un directo de YouTube: la transcripción con segundos y la actividad del chat.
Tu trabajo es marcar los momentos que podrían volverse virales: algo muy gracioso, una reacción fuerte,
un error épico, una frase polémica o memorable, una sorpresa, una jugada increíble o una historia que engancha.

Reglas:
- Cada momento dura entre 15 y 90 segundos y debe entenderse solo, sin contexto.
- Usa los segundos que aparecen en la transcripción para "start" y "end".
- Empieza un poco antes del momento clave para dar contexto y termina cuando la reacción se calma.
- Un pico de chat suele llegar de 5 a 15 segundos DESPUÉS del momento.
- "score" va de 1 a 10. Pon 7 o más solo si de verdad lo subirías a redes.
- Si nada vale la pena, devuelve una lista vacía. Es mejor pocos clips buenos que muchos malos.`;

const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['start', 'end', 'score', 'reason'],
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          score: { type: 'integer' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const PICK_SYSTEM = `Eres el editor jefe de un canal de clips virales.
Recibes momentos candidatos de un directo, cada uno con su transcripción y la reacción del chat.
Elige solo los que de verdad funcionarían en TikTok, Shorts, Reels y Facebook, y déjalos listos para que el creador
los publique a mano: él va a copiar y pegar tus textos tal cual, así que tienen que estar terminados.

Para cada clip elegido:
- Ajusta "start" y "end" (en segundos) para que empiece con gancho y no corte frases a la mitad.
  Duración ideal: la que pida el usuario; nunca menos de 12 ni más de 120 segundos.
- "title": título corto y llamativo en el idioma del directo, sin comillas, máximo 70 caracteres.
- "hashtags": de 3 a 6 hashtags relevantes, cada uno empezando con #.
- "description": una o dos frases para la descripción del video.
- "score": de 1 a 10 qué tan viral crees que es.
- "reason": una frase sencilla en español que explique por qué este momento funcionaría en redes.
- "redes": el texto para cada red, en el idioma del directo. En cada una:
  · "titulo": título corto y llamativo, máximo 90 caracteres.
  · "gancho": la primera frase del texto, la que hace que la gente deje de deslizar. Máximo 120 caracteres, puede llevar un emoji.
  · "descripcion": una o dos frases que cuenten qué pasa sin arruinar la sorpresa.
  · "hashtags": hashtags del tema, del canal y de la comunidad, cada uno empezando con #.
  Adapta el tono a cada red:
  · "tiktok": directo y juvenil, frases cortas; de 3 a 5 hashtags.
  · "instagram": un poco más cuidado; termina la descripción con una pregunta que invite a comentar; de 5 a 8 hashtags.
  · "youtube": el "titulo" es el título del Short, con la palabra clave del tema al principio; de 3 a 4 hashtags.
  · "facebook": conversacional, para un público más adulto; de 2 a 3 hashtags.
  No pongas #Shorts, #fyp ni #parati: la app los agrega cuando hacen falta.
No inventes cosas que no pasaron en el directo. Si ninguno vale la pena, devuelve una lista vacía.
Si el mensaje trae "LO QUE MEJOR FUNCIONA EN SUS REDES", úsalo para elegir y titular (sin inventar momentos para cumplirlo).`;

// Texto listo para publicar en una red.
const NETWORK_TEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['titulo', 'gancho', 'descripcion', 'hashtags'],
  properties: {
    titulo: { type: 'string' },
    gancho: { type: 'string' },
    descripcion: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
};
export const NETWORKS = ['tiktok', 'instagram', 'youtube', 'facebook'];

export const PICK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clips'],
  properties: {
    clips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'start', 'end', 'title', 'hashtags', 'description', 'score', 'reason', 'redes'],
        properties: {
          id: { type: 'string' },
          start: { type: 'number' },
          end: { type: 'number' },
          title: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          score: { type: 'integer' },
          reason: { type: 'string' },
          redes: {
            type: 'object',
            additionalProperties: false,
            required: NETWORKS,
            properties: Object.fromEntries(NETWORKS.map((n) => [n, NETWORK_TEXT_SCHEMA])),
          },
        },
      },
    },
  },
};

function readJson(response) {
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- Piloto automático: ¿vale la pena clipear estos videos? ----------
const RANK_SYSTEM = `Ayudas a un creador de clips virales a decidir qué videos de YouTube revisar.
Recibes los temas que le interesan y una lista de videos recién subidos (título, canal, vistas de hoy, duración).
Para cada video da una nota "score" de 1 a 10:
- Alta (7-10): tiene que ver claramente con alguno de sus temas Y probablemente tiene momentos cortos que funcionen solos
  (reacciones, peleas, risas, jugadas, polémica, historias fuertes, retos).
- Baja (1-4): no tiene que ver con sus temas, es una noticia leída, un tutorial, música, un compilado ya editado,
  un podcast sin momentos fuertes o contenido para niños.
"reason" en español, máximo 12 palabras. Responde por cada id que recibiste.`;

const RANK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'score', 'reason'],
        properties: { id: { type: 'string' }, score: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
  },
};

/** Haiku (barato) le pone nota a los videos que encontró el piloto por temas. */
export async function rankVideos(prompt) {
  const response = await getClient().messages.create({
    model: HAIKU,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RANK_SCHEMA } },
    system: RANK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  const data = readJson(response);
  return { notes: Array.isArray(data?.notes) ? data.notes : [], model: response.model || HAIKU, usage: response.usage };
}

// ---------- Informe de competencia ----------
const REPORT_SYSTEM = `Eres el estratega de redes de un creador que publica clips verticales (TikTok, Reels, Shorts, Facebook).
Recibes sus propios números y los de otras cuentas que compiten con él (publicaciones recientes con vistas y fecha).
Escribe un informe corto y práctico en español sencillo, sin tecnicismos ni palabras en inglés si hay una en español.
- "resumen": 2 o 3 frases con lo más importante de la semana.
- "competidores": por cada cuenta, qué le está funcionando (temas, formato, largo, títulos, frecuencia) en frases cortas.
- "ideas": de 3 a 6 acciones concretas para esta semana (qué clipear, cómo titular, cuándo publicar). Empieza cada una con un verbo.
- "temasSugeridos": de 0 a 5 temas o canales de YouTube que conviene vigilar con el piloto automático.
- "alertas": cosas que van mal en sus propios números (si no hay, lista vacía).
Usa solo los datos que recibes; si faltan datos de algo, dilo en vez de inventarlo.`;

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumen', 'competidores', 'ideas', 'temasSugeridos', 'alertas'],
  properties: {
    resumen: { type: 'string' },
    competidores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nombre', 'queLeFunciona'],
        properties: { nombre: { type: 'string' }, queLeFunciona: { type: 'array', items: { type: 'string' } } },
      },
    },
    ideas: { type: 'array', items: { type: 'string' } },
    temasSugeridos: { type: 'array', items: { type: 'string' } },
    alertas: { type: 'array', items: { type: 'string' } },
  },
};

/** Opus escribe el informe semanal (una vez por semana por cliente, así que el costo es de centavos). */
export async function competitorReport(prompt) {
  const response = await getClient().beta.messages.create({
    model: OPUS,
    max_tokens: 16000,
    // Si el modelo rechaza el pedido, la API lo reintenta sola con otro modelo.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: REPORT_SCHEMA } },
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  return { report: readJson(response), model: response.model || OPUS, usage: response.usage };
}

/** Paso 1 (barato): Haiku lee el tramo completo y marca posibles momentos. */
export async function scanWindow(prompt) {
  const response = await getClient().messages.create({
    model: HAIKU,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCAN_SCHEMA } },
    system: SCAN_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  const data = readJson(response);
  return {
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    model: response.model || HAIKU,
    usage: response.usage,
  };
}

/** Paso 2 (preciso): Sonnet revisa solo los candidatos buenos y prepara título, hashtags y el texto de cada red. */
export async function pickClips(prompt) {
  const response = await getClient().beta.messages.create({
    model: SONNET,
    // Más lugar que antes: ahora también escribe el texto de 4 redes por clip.
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PICK_SCHEMA } },
    system: PICK_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  const data = readJson(response);
  return {
    clips: Array.isArray(data?.clips) ? data.clips : [],
    model: response.model || SONNET,
    usage: response.usage,
  };
}
