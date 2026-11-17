// Aprende de tus números: qué horas, qué largo de clip, qué canales/temas y qué títulos te dan más vistas.
// Usa la mediana (no el promedio) para que un solo clip que explotó no engañe.

const MIN_POSTS = 5;      // con menos datos no se saca ninguna conclusión
const MIN_AGE_MS = 24 * 3600000; // los recién publicados todavía no tienen sus vistas finales

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function groupMedian(rows, keyFn, minCount = 2) {
  const g = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null || k === undefined) continue;
    (g[k] = g[k] || []).push(r.metric);
  }
  return Object.entries(g).filter(([, v]) => v.length >= minCount).map(([key, v]) => ({ key, posts: v.length, median: median(v) }));
}

const LENGTHS = [
  { label: 'menos de 30 s', max: 30, seconds: 25 },
  { label: '30 a 45 s', max: 45, seconds: 40 },
  { label: '45 a 60 s', max: 60, seconds: 55 },
  { label: 'más de 60 s', max: Infinity, seconds: 75 },
];
const lengthOf = (d) => LENGTHS.find((l) => (d || 0) < l.max) || LENGTHS[LENGTHS.length - 1];

const TITLE_TRAITS = [
  { id: 'pregunta', label: 'con una pregunta', test: (t) => /[¿?]/.test(t) },
  { id: 'numero', label: 'con números', test: (t) => /\d/.test(t) },
  { id: 'mayusculas', label: 'con palabras en MAYÚSCULAS', test: (t) => (t.match(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/g) || []).length >= 1 },
  { id: 'emoji', label: 'con emojis', test: (t) => /\p{Extended_Pictographic}/u.test(t) },
  { id: 'corto', label: 'cortos (menos de 40 letras)', test: (t) => t.length < 40 },
];

const ratio = (a, b) => (b > 0 ? a / b : a > 0 ? 2 : 1);
const fmtRatio = (r) => `${r.toFixed(1).replace('.0', '')} veces`;

/**
 * clips: lista de clips; jobs: cola de subidas; stats: estado de Estadisticas
 * Devuelve números para la pantalla, recomendaciones y un texto corto para Claude.
 */
function learn({ clips = [], jobs = [], stats = {}, now = Date.now() }) {
  const clipById = Object.fromEntries(clips.map((c) => [c.id, c]));
  const rows = [];
  for (const j of jobs) {
    const st = stats.posts?.[j.id]?.last;
    if (j.status !== 'publicado' || !st) continue;
    const clip = clipById[j.clipId] || {};
    // En Instagram/Facebook sin permiso de estadísticas no hay vistas: se usan los "me gusta" × 20 como aproximación.
    const views = st.views ?? (st.likes !== null && st.likes !== undefined ? st.likes * 20 : null);
    if (views === null) continue;
    rows.push({
      job: j, clip, platform: j.platform, views, likes: st.likes || 0, comments: st.comments || 0, shares: st.shares || 0,
      metric: views, publishedAt: j.publishedAt || j.scheduledAt, title: j.title || clip.title || '',
      duration: clip.duration || (clip.end - clip.start) || null, mature: now - (j.publishedAt || 0) > MIN_AGE_MS,
    });
  }

  const totals = { posts: rows.length, views: 0, likes: 0, comments: 0, shares: 0, byPlatform: {} };
  for (const r of rows) {
    totals.views += r.views; totals.likes += r.likes; totals.comments += r.comments; totals.shares += r.shares;
    const p = (totals.byPlatform[r.platform] = totals.byPlatform[r.platform] || { posts: 0, views: 0, likes: 0 });
    p.posts += 1; p.views += r.views; p.likes += r.likes;
  }
  const followers = Object.fromEntries(Object.entries(stats.followers || {}).map(([p, list]) => {
    const last = list[list.length - 1];
    const weekAgo = [...list].reverse().find((x) => now - x.at >= 6.5 * 86400000) || list[0];
    return [p, { count: last?.count ?? null, week: last && weekAgo ? last.count - weekAgo.count : null }];
  }));

  const top = [...rows].sort((a, b) => b.views - a.views).slice(0, 10).map((r) => ({
    jobId: r.job.id, title: r.title, platform: r.platform, views: r.views, likes: r.likes, comments: r.comments, url: r.job.url, thumb: r.job.thumb, publishedAt: r.publishedAt,
  }));

  const mature = rows.filter((r) => r.mature);
  const ready = mature.length >= MIN_POSTS;
  const findings = [];
  const out = { ready, totals, followers, top, findings, bestHours: {}, bestClipSeconds: null, bySource: [], byLength: [], hints: '', minPosts: MIN_POSTS, maturePosts: mature.length };
  if (!ready) return out;

  const overall = median(mature.map((r) => r.metric));

  // Horas: por red, las 4 con más vistas (con al menos 2 publicaciones en esa hora).
  for (const platform of new Set(mature.map((r) => r.platform))) {
    const hours = groupMedian(mature.filter((r) => r.platform === platform), (r) => new Date(r.publishedAt).getHours())
      .sort((a, b) => b.median - a.median);
    if (hours.length >= 3) out.bestHours[platform] = hours.slice(0, 4).map((h) => Number(h.key)).sort((a, b) => a - b);
  }
  const allHours = groupMedian(mature, (r) => new Date(r.publishedAt).getHours()).sort((a, b) => b.median - a.median);
  if (allHours.length >= 3) findings.push(`Tus mejores horas para publicar: ${allHours.slice(0, 3).map((h) => `${h.key}:00`).join(', ')}.`);

  // Largo del clip
  out.byLength = groupMedian(mature.filter((r) => r.duration), (r) => lengthOf(r.duration).label)
    .map((g) => ({ label: g.key, posts: g.posts, median: g.median }))
    .sort((a, b) => LENGTHS.findIndex((l) => l.label === a.label) - LENGTHS.findIndex((l) => l.label === b.label));
  const bestLen = [...out.byLength].sort((a, b) => b.median - a.median)[0];
  if (out.byLength.length >= 2 && bestLen && ratio(bestLen.median, overall) >= 1.15) {
    out.bestClipSeconds = LENGTHS.find((l) => l.label === bestLen.label).seconds;
    findings.push(`Los clips de ${bestLen.label} te dan ${fmtRatio(ratio(bestLen.median, overall))} las vistas normales.`);
  }

  // De dónde salen los mejores clips (canal del directo o tema del piloto)
  out.bySource = groupMedian(mature, (r) => r.clip.origin?.source?.name || r.clip.stream?.channel || null, 1)
    .map((g) => ({ name: g.key, posts: g.posts, median: g.median }))
    .sort((a, b) => b.median - a.median);
  const bestSrc = out.bySource.find((s) => s.posts >= 2);
  if (bestSrc && ratio(bestSrc.median, overall) >= 1.3) findings.push(`Lo que más funciona sale de "${bestSrc.name}" (${fmtRatio(ratio(bestSrc.median, overall))} lo normal).`);

  // Títulos
  const titleHints = [];
  for (const t of TITLE_TRAITS) {
    const yes = mature.filter((r) => t.test(r.title));
    const no = mature.filter((r) => !t.test(r.title));
    if (yes.length < 3 || no.length < 3) continue;
    const r = ratio(median(yes.map((x) => x.metric)), median(no.map((x) => x.metric)));
    if (r >= 1.3) { findings.push(`Los títulos ${t.label} tienen ${fmtRatio(r)} más vistas.`); titleHints.push(`títulos ${t.label}`); }
    else if (r <= 0.7) { findings.push(`Los títulos ${t.label} te funcionan peor (${Math.round((1 - r) * 100)}% menos vistas).`); titleHints.push(`evitar títulos ${t.label}`); }
  }

  // ¿La nota de la IA acierta?
  const hi = mature.filter((r) => (r.clip.score || 0) >= 8);
  const lo = mature.filter((r) => r.clip.score && r.clip.score < 8);
  if (hi.length >= 3 && lo.length >= 3) {
    const r = ratio(median(hi.map((x) => x.metric)), median(lo.map((x) => x.metric)));
    if (r >= 1.3) findings.push(`Los clips con nota 8 o más tienen ${fmtRatio(r)} más vistas: conviene subir primero los de nota alta (Clips sugeridos ya los pone arriba).`);
  }

  // Texto corto para que Claude elija y titule como le gusta a tu público.
  const parts = [];
  if (titleHints.length) parts.push(`Prefiere ${titleHints.join(', ')}.`);
  if (bestLen && out.bestClipSeconds) parts.push(`Los clips de ${bestLen.label} rinden más.`);
  const topTitles = top.slice(0, 5).map((t) => `"${t.title}" (${t.views} vistas)`);
  if (topTitles.length) parts.push(`Sus clips con más vistas: ${topTitles.join('; ')}.`);
  out.hints = parts.join(' ');
  return out;
}

module.exports = { learn, median, MIN_POSTS };
