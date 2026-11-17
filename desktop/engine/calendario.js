// Horas sugeridas para subir cada clip en cada red (las usa Clips sugeridos y la publicación automática).
// Usa las horas que mejor le funcionan a tu cuenta (sección Estadísticas); si aún no hay datos, las recomendadas.

// Horas que suelen funcionar en Latinoamérica y España (hora de la PC).
const DEFAULT_HOURS = {
  youtube: [12, 15, 18, 21],
  tiktok: [12, 16, 19, 22],
  instagram: [11, 14, 19, 21],
  facebook: [9, 13, 19, 21],
};

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** Las horas buenas de una red, ordenadas: las aprendidas si hay, si no las recomendadas. */
function goodHours(platform, learnedHours = null) {
  const hours = learnedHours?.[platform]?.length ? learnedHours[platform] : DEFAULT_HOURS[platform] || [12, 19];
  return [...new Set(hours.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
}

/**
 * Próxima hora buena para subir algo a una red, sin repetir una hora ya ocupada.
 * taken: horas (ms) ya usadas en esa red (lo que ya subiste y lo que ya se sugirió a otros clips).
 * Devuelve null si no queda lugar en los próximos `maxDays` días.
 */
function nextSlot({ platform, now = Date.now(), taken = [], learnedHours = null, maxPerDay = 4, gapMin = 60, maxDays = 7 }) {
  const hours = goodHours(platform, learnedHours);
  const gapMs = Math.max(10, Number(gapMin) || 60) * 60000;
  const perDay = {};
  for (const t of taken) perDay[dayKey(t)] = (perDay[dayKey(t)] || 0) + 1;
  const start = new Date(now);
  for (let d = 0; d <= maxDays; d++) {
    for (const h of hours) {
      const t = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, h, 0, 0).getTime();
      if (t < now + 10 * 60000) continue; // muy encima: no da tiempo
      if ((perDay[dayKey(t)] || 0) >= Math.max(1, maxPerDay)) break; // ese día ya está lleno
      if (!taken.some((x) => Math.abs(x - t) < gapMs)) return t;
    }
  }
  return null;
}

/**
 * Reparte horas a varios clips sin repetir: el primero de la lista recibe la hora buena más cercana.
 * items: [{ id, platforms? }] en orden de prioridad (platforms: solo esas redes, por ejemplo las que faltan subir);
 * taken: { red: [ms] } ya ocupadas. Devuelve { id: { red: ms | null } }.
 */
function planHours({ items = [], platforms = [], now = Date.now(), taken = {}, learnedHours = null, maxPerDay = 4 }) {
  const used = Object.fromEntries(platforms.map((p) => [p, [...(taken[p] || [])]]));
  const out = {};
  for (const it of items) {
    out[it.id] = {};
    for (const p of (it.platforms || platforms).filter((x) => used[x])) {
      const t = nextSlot({ platform: p, now, taken: used[p], learnedHours, maxPerDay });
      out[it.id][p] = t;
      if (t) used[p].push(t);
    }
  }
  return out;
}

module.exports = { nextSlot, planHours, goodHours, DEFAULT_HOURS };
