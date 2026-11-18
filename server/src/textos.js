// Limpia lo que devuelve Claude al elegir clips, antes de mandarlo a la app.
import { NETWORKS, cut } from './claude.js';

const clean = (text, max) => cut(String(text ?? '').replace(/\s+/g, ' ').trim(), max);

/** Hashtags como #palabra, sin espacios ni repetidos. */
export function cleanTags(list, max = 8) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = `#${String(raw ?? '').replace(/^#+/, '').replace(/[\s#]+/g, '')}`.slice(0, 40);
    if (t.length < 2 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** El texto de cada red. Una red que llegó vacía no se manda (la app la completa con su plantilla). */
export function cleanRedes(redes) {
  if (!redes || typeof redes !== 'object') return null;
  const out = {};
  for (const n of NETWORKS) {
    const t = redes[n];
    if (!t || typeof t !== 'object') continue;
    const item = {
      titulo: clean(t.titulo, 100),
      gancho: clean(t.gancho, 150),
      descripcion: clean(t.descripcion, 600),
      hashtags: cleanTags(t.hashtags),
    };
    if (item.titulo || item.gancho) out[n] = item;
  }
  return Object.keys(out).length ? out : null;
}

/** Un clip elegido por Claude, listo para la app. Devuelve null si los segundos no sirven. */
export function cleanPickedClip(c) {
  if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start) return null;
  return {
    id: clean(c.id, 20),
    start: c.start,
    end: c.end,
    title: clean(c.title, 100),
    hashtags: cleanTags(c.hashtags),
    description: clean(c.description, 500),
    score: Math.max(1, Math.min(10, Math.round(Number(c.score) || 1))),
    reason: clean(c.reason, 300),
    redes: cleanRedes(c.redes),
  };
}
