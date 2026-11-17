// Cuándo publica el agente y cómo va camino a monetizar (funciones puras, fáciles de probar).
const HOUR = 3600000;
const DAY = 24 * HOUR;

const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/**
 * La próxima hora libre para publicar: a una de las `horas` del plan (hora local), sin pasar de `porDia`
 * publicaciones en un día y dejando al menos `gapH` horas entre una y otra. `ocupados`: horas ya tomadas (ms).
 */
function nextSlot({ now, horas, ocupados = [], porDia = 1, gapH = 2, minLeadMin = 10, minute = 5 }) {
  const hs = [...new Set(horas)].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);
  if (!hs.length) hs.push(19);
  for (let d = 0; d < 14; d++) {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + d);
    const sameDay = ocupados.filter((t) => dayKey(t) === dayKey(base.getTime())).length;
    if (sameDay >= porDia) continue;
    for (const h of hs) {
      const t = new Date(base);
      t.setHours(h, minute, 0, 0);
      const ms = t.getTime();
      if (ms < now + minLeadMin * 60000) continue;
      if (ocupados.some((o) => Math.abs(o - ms) < gapH * HOUR)) continue;
      return ms;
    }
  }
  return now + DAY;
}

/** Minutos vistos de lo publicado en los últimos 60 días (aproximado: Facebook da el total de cada video). */
function minutes60(publicaciones, now = Date.now()) {
  return publicaciones
    .filter((p) => p.publicadoAt && now - p.publicadoAt <= 60 * DAY)
    .reduce((n, p) => n + (Number(p.stats?.viewTimeMin) || 0), 0);
}

/** Cómo va la página hacia las metas de monetización. */
function progress({ seguidores = [], publicaciones = [], metas = {}, now = Date.now() }) {
  const last = seguidores[seguidores.length - 1];
  const followers = last ? last.count : 0;
  const weekAgo = [...seguidores].reverse().find((p) => now - p.at >= 6.5 * DAY);
  const minutos = Math.round(minutes60(publicaciones, now));
  const posts30 = publicaciones.filter((p) => p.publicadoAt && now - p.publicadoAt <= 30 * DAY);
  const pct = (v, goal) => (goal ? Math.min(100, Math.round((v / goal) * 100)) : 0);
  return {
    seguidores: followers,
    seguidoresSemana: weekAgo ? followers - weekAgo.count : null,
    minutos60: minutos,
    vistas30: posts30.reduce((n, p) => n + (Number(p.stats?.views) || 0), 0),
    publicaciones30: posts30.length,
    metas: {
      estrellas: { meta: metas.estrellas || 500, pct: pct(followers, metas.estrellas || 500) },
      seguidores: { meta: metas.seguidores || 5000, pct: pct(followers, metas.seguidores || 5000) },
      minutos: { meta: metas.minutos || 60000, pct: pct(minutos, metas.minutos || 60000) },
    },
  };
}

/** Vistas por día (para el gráfico): suma lo que creció cada publicación entre lecturas. */
function viewsByDay(publicaciones, days = 14, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push({ day: d.getTime(), views: 0 });
  }
  const idx = (ms) => out.findIndex((o, k) => ms >= o.day && (k === out.length - 1 || ms < out[k + 1].day));
  for (const p of publicaciones) {
    let prev = 0;
    for (const h of p.historial || []) {
      const v = Number(h.views) || 0;
      const i = idx(h.at);
      if (i >= 0) out[i].views += Math.max(0, v - prev);
      prev = Math.max(prev, v);
    }
  }
  return out;
}

module.exports = { nextSlot, minutes60, progress, viewsByDay, dayKey, DAY, HOUR };
