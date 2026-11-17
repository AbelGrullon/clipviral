// Clips sugeridos: cada clip nuevo queda listo con la hora sugerida y el texto (título, gancho, descripción y hashtags)
// de cada red. Lo publicas tú, o se publica solo en las redes donde encendiste "Publicar sola" (ver publicar.js).
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { buildCaption } = require('./redes');
const { planHours } = require('./calendario');
const { fmtClock } = require('./util');

const REDES = ['tiktok', 'instagram', 'youtube', 'facebook'];
const LIMIT = { titulo: 100, gancho: 150, descripcion: 600 };
// Hashtags que se agregan en cada red y cuántos poner como máximo.
const EXTRA_TAGS = { tiktok: ['#parati', '#fyp'], instagram: ['#reels', '#viral'], youtube: [], facebook: ['#reels'] };
const MAX_TAGS = { tiktok: 6, instagram: 8, youtube: 5, facebook: 4 };

const cut = (t, max) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** Deja los hashtags como #palabra, sin espacios ni repetidos. */
function normTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const t = `#${String(raw || '').replace(/^#+/, '').replace(/[\s#]+/g, '')}`;
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t.slice(0, 40));
  }
  return out;
}

function tagsFor(red, base, { shortsTag = true } = {}) {
  const extra = red === 'youtube' && shortsTag ? ['#Shorts'] : EXTRA_TAGS[red] || [];
  const own = normTags(base).filter((t) => !extra.some((e) => e.toLowerCase() === t.toLowerCase()));
  return normTags([...own.slice(0, Math.max(1, MAX_TAGS[red] - extra.length)), ...extra]);
}

// Frases para enganchar cuando no hay IA (se elige una fija por clip).
const HOOKS = {
  chat: ['El chat explotó con esto 🔥', 'Nadie en el chat lo podía creer 😳'],
  volumen: ['Escucha cómo reaccionó 😳', 'Sube el volumen para esto 🔊'],
  otro: ['Espera al final 👀', 'Nadie esperaba esto 😳', 'Mira lo que pasó 🔥'],
};
const pickFor = (id, list) => list[[...String(id || '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % list.length];

function hookFor(clip) {
  const r = String(clip.reason || '').toLowerCase();
  return pickFor(clip.id, r.includes('chat') ? HOOKS.chat : r.includes('volumen') ? HOOKS.volumen : HOOKS.otro);
}

/** Por qué funcionaría, en palabras sencillas. */
function porQue(clip) {
  const r = String(clip.reason || '').trim();
  if (r === 'Explosión en el chat') return 'El chat explotó en ese momento: a la gente le encantó.';
  if (r === 'Subida fuerte de volumen') return 'Hubo una reacción fuerte: el volumen subió de golpe.';
  return r || 'Es uno de los mejores momentos del video.';
}

/** Textos con plantilla (modo Local o clips sin texto de la IA). */
function textosLocales(clip, opts = {}) {
  const canal = clip.stream?.channel || '';
  const gancho = hookFor(clip);
  const descripcion = cut(clip.description || (canal ? `Lo mejor de ${canal} 🎬` : 'Un momento que no te puedes perder 🎬'), LIMIT.descripcion);
  const out = {};
  for (const red of REDES) {
    out[red] = { titulo: cut(clip.title || 'Clip', LIMIT.titulo), gancho, descripcion, hashtags: tagsFor(red, clip.hashtags, opts) };
  }
  return out;
}

/** Textos de cada red: los que escribió Claude si los hay (completando lo que falte con la plantilla). */
function textosPara(clip, opts = {}) {
  const local = textosLocales(clip, opts);
  const ia = clip.redes && typeof clip.redes === 'object' ? clip.redes : null;
  const out = {};
  let fromAi = 0;
  for (const red of REDES) {
    const t = ia?.[red];
    if (!t || !String(t.titulo || t.gancho || '').trim()) { out[red] = local[red]; continue; }
    fromAi += 1;
    out[red] = {
      titulo: cut(t.titulo, LIMIT.titulo) || local[red].titulo,
      gancho: cut(t.gancho, LIMIT.gancho) || local[red].gancho,
      descripcion: cut(t.descripcion, LIMIT.descripcion) || local[red].descripcion,
      hashtags: tagsFor(red, t.hashtags?.length ? t.hashtags : clip.hashtags, opts),
    };
  }
  return { textos: out, de: fromAi ? 'ia' : 'plantilla' };
}

/** El texto completo para pegar en cada red (usa la plantilla de la sección Redes). */
function textoCompleto(plantilla, clip, t) {
  return buildCaption(plantilla, { ...clip, title: t.titulo, description: t.descripcion, hashtags: t.hashtags, gancho: t.gancho }, { minuto: fmtClock(clip.start || 0) });
}

const CLIP_FIELDS = ['id', 'title', 'description', 'hashtags', 'file', 'thumb', 'score', 'reason', 'duration', 'start', 'end', 'stream', 'origin', 'mode', 'createdAt'];

/**
 * Lo que muestra la pantalla: cada sugerencia con su clip, por qué funcionaría, el texto y la hora de cada red.
 * store: lo guardado; clips: la lista de clips; jobs: subidas hechas con ClipViral (también cuentan como "subido").
 */
function buildSnapshot({ store = [], clips = [], jobs = [], learnedHours = null, redes = REDES, plantilla, shortsTag = true, now = Date.now() }) {
  const active = REDES.filter((r) => redes.includes(r));
  const byId = new Map(clips.map((c) => [c.id, c]));
  const taken = Object.fromEntries(REDES.map((r) => [r, new Set()]));
  for (const j of jobs) {
    if (!['pendiente', 'subiendo', 'publicado'].includes(j.status) || !taken[j.platform]) continue;
    taken[j.platform].add(j.publishedAt || j.scheduledAt);
  }
  const items = [];
  for (const s of store) {
    const clip = byId.get(s.clipId);
    if (!clip) continue;
    const hechas = { ...(s.hechas || {}) };
    // Programadas: ya tienen su subida en la cola (a su hora o subiendo ahora). No se les busca otra hora.
    const programadas = {};
    for (const j of jobs) {
      if (j.clipId !== s.clipId || !REDES.includes(j.platform)) continue;
      if (j.status === 'publicado' && !hechas[j.platform]) hechas[j.platform] = j.publishedAt || j.scheduledAt;
      if (['pendiente', 'subiendo'].includes(j.status)) programadas[j.platform] = { id: j.id, at: j.scheduledAt, status: j.status, origen: j.origen || 'manual' };
    }
    for (const [r, at] of Object.entries(hechas)) taken[r]?.add(at);
    const { textos, de } = textosPara(clip, { shortsTag });
    for (const red of REDES) textos[red].texto = textoCompleto(plantilla, clip, textos[red]);
    const status = s.status === 'nueva' && active.length && active.every((r) => hechas[r]) ? 'subida' : s.status;
    const c = Object.fromEntries(CLIP_FIELDS.map((k) => [k, clip[k]]));
    items.push({ ...s, status, hechas, programadas, clip: c, porQue: porQue(clip), textos, textosDe: de, horas: {} });
  }
  // Los mejores clips reciben las horas más cercanas; nunca dos clips a la misma hora en la misma red.
  const pending = items.filter((i) => i.status === 'nueva')
    .sort((a, b) => (b.clip.score || 0) - (a.clip.score || 0) || a.addedAt - b.addedAt);
  const plan = planHours({
    items: pending.map((i) => ({ id: i.id, platforms: active.filter((r) => !i.hechas[r] && !i.programadas[r]) })),
    platforms: active,
    now,
    taken: Object.fromEntries(REDES.map((r) => [r, [...taken[r]].filter(Boolean)])),
    learnedHours,
  });
  for (const i of pending) i.horas = plan[i.id] || {};
  const order = new Map(pending.map((i, k) => [i.id, k]));
  items.sort((a, b) => (order.has(a.id) ? order.get(a.id) : 1e9) - (order.has(b.id) ? order.get(b.id) : 1e9) || (b.doneAt || 0) - (a.doneAt || 0));
  const counts = { nueva: 0, subida: 0, descartada: 0 };
  for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
  return { items, counts, redes: active, horasDe: learnedHours && Object.keys(learnedHours).length ? 'aprendidas' : 'recomendadas' };
}

class Sugerencias extends EventEmitter {
  /** file: dónde se guarda la lista (JSON) */
  constructor({ file, now = () => Date.now() }) {
    super();
    Object.assign(this, { file, now });
    this.items = [];
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (!Array.isArray(this.items)) this.items = [];
  }

  save() {
    // Se guardan como mucho 500: primero se van las más viejas ya subidas o descartadas.
    if (this.items.length > 500) {
      const done = this.items.filter((i) => i.status !== 'nueva').sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0));
      const drop = new Set(done.slice(0, this.items.length - 500).map((i) => i.id));
      this.items = this.items.filter((i) => !drop.has(i.id)).slice(-500);
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.items, null, 1));
    this.emit('update');
  }

  list() { return this.items; }
  get(id) { return this.items.find((i) => i.id === id) || null; }

  /** Agrega un clip. Si ya estaba, no lo repite. */
  add(clipId) {
    if (!clipId || this.get(clipId)) return null;
    const item = { id: clipId, clipId, status: 'nueva', addedAt: this.now(), doneAt: null, hechas: {} };
    this.items.push(item);
    this.save();
    return item;
  }

  /**
   * El usuario decide:
   *   'red'       → marca o desmarca "ya lo subí" en una red (si están todas, la sugerencia pasa a subida)
   *   'subida'    → ya la subió a todas sus redes
   *   'descartar' → no la quiere
   *   'volver'    → vuelve a "por subir"
   */
  mark(id, action, { red = null, redes = REDES } = {}) {
    const it = this.get(id);
    if (!it) return null;
    const now = this.now();
    it.hechas = it.hechas || {};
    if (action === 'red' && REDES.includes(red)) {
      if (it.hechas[red]) delete it.hechas[red]; else it.hechas[red] = now;
      const all = redes.length && redes.every((r) => it.hechas[r]);
      if (all && it.status === 'nueva') Object.assign(it, { status: 'subida', doneAt: now });
      if (!all && it.status === 'subida') Object.assign(it, { status: 'nueva', doneAt: null });
    } else if (action === 'subida') {
      for (const r of redes) if (!it.hechas[r]) it.hechas[r] = now;
      Object.assign(it, { status: 'subida', doneAt: now });
    } else if (action === 'descartar') {
      Object.assign(it, { status: 'descartada', doneAt: now });
    } else if (action === 'volver') {
      if (it.status === 'subida') it.hechas = {};
      Object.assign(it, { status: 'nueva', doneAt: null });
    } else {
      return null;
    }
    this.save();
    return it;
  }

  /** Se publicó con ClipViral en una red: queda anotado aunque después se limpie la lista de subidas. */
  setHecha(clipId, red, at) {
    const it = this.items.find((i) => i.clipId === clipId);
    if (!it || !REDES.includes(red)) return null;
    it.hechas = it.hechas || {};
    if (it.hechas[red]) return it;
    it.hechas[red] = at || this.now();
    this.save();
    return it;
  }

  /** El usuario canceló (o falló) la publicación automática de este clip en esa red: no se vuelve a programar sola. */
  skipAuto(clipId, red) {
    const it = this.items.find((i) => i.clipId === clipId);
    if (!it || !REDES.includes(red) || it.sinAuto?.[red]) return null;
    it.sinAuto = { ...(it.sinAuto || {}), [red]: true };
    this.save();
    return it;
  }

  /** El clip se borró de Mis clips: su sugerencia también se va. */
  remove(clipId) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.clipId !== clipId);
    if (this.items.length !== before) this.save();
  }

  /** Quita de la lista lo ya subido y lo descartado (los clips siguen en Mis clips). */
  clearDone() {
    this.items = this.items.filter((i) => i.status === 'nueva');
    this.save();
  }
}

module.exports = { Sugerencias, buildSnapshot, textosPara, textosLocales, normTags, porQue, REDES };
