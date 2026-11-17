// Análisis de competencia: mira qué publican otras cuentas y cuánto les funciona.
// - YouTube: con yt-dlp (gratis, sin permisos): videos y Shorts recientes con sus vistas.
// - Instagram: con la cuenta profesional unida a tu página de Facebook (Meta lo llama "Business Discovery").
// - TikTok no deja que una app vea los números de otras cuentas.
const { FB_VERSION } = require('./redes');
const { channelUrl } = require('./vigilante');
const { median } = require('./aprendizaje');

const DAY = 86400000;
const ymd = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);

/** Normaliza una cuenta de Instagram: "@nombre", "nombre" o el enlace del perfil. */
function igUsername(input) {
  const s = String(input || '').trim();
  const m = /instagram\.com\/([\w.]+)/i.exec(s) || /^@?([\w.]{1,30})$/.exec(s);
  return m ? m[1].toLowerCase() : null;
}

/** Resumen de una lista de publicaciones: cuántas por semana, vistas típicas y las mejores. */
function summarize(posts, now = Date.now(), metric = 'views') {
  const recent = posts.filter((p) => !p.at || now - p.at < 30 * DAY);
  const week = posts.filter((p) => p.at && now - p.at < 7 * DAY);
  const values = recent.map((p) => p[metric]).filter((v) => Number.isFinite(v));
  return {
    metric,
    postsWeek: week.length,
    postsMonth: recent.filter((p) => p.at).length,
    median: Math.round(median(values)),
    best: [...recent].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 5),
    // Lo que importa es el largo de sus clips (Shorts/Reels), no el de sus videos largos.
    avgDuration: Math.round(median((recent.some((p) => p.kind === 'short' || p.kind === 'reel') ? recent.filter((p) => p.kind === 'short' || p.kind === 'reel') : recent)
      .map((p) => p.duration).filter(Boolean))) || null,
  };
}

/** YouTube: Shorts y videos recientes de un canal. ytdlp(args) devuelve el JSON. */
async function youtubeChannel(input, ytdlp, now = Date.now()) {
  const url = channelUrl(input);
  if (!url) throw new Error('No reconozco ese canal de YouTube');
  const posts = [];
  let name = null;
  let followers = null;
  for (const tab of ['shorts', 'videos']) {
    try {
      const d = await ytdlp(['-J', '--flat-playlist', '--playlist-end', '15', '--extractor-args', 'youtubetab:approximate_date', `${url}/${tab}`]);
      name = name || d.channel || d.uploader;
      followers = followers ?? d.channel_follower_count ?? null;
      for (const e of d.entries || []) {
        posts.push({
          id: e.id, title: e.title || '', views: Number(e.view_count) || 0, duration: Number(e.duration) || null,
          at: e.timestamp ? e.timestamp * 1000 : null, date: ymd(e.timestamp ? e.timestamp * 1000 : null), kind: tab === 'shorts' ? 'short' : 'video',
          url: tab === 'shorts' ? `https://www.youtube.com/shorts/${e.id}` : `https://www.youtube.com/watch?v=${e.id}`,
        });
      }
    } catch (err) {
      if (!/does not have a (shorts|videos) tab/i.test(err.message)) throw new Error('No pude leer ese canal de YouTube');
    }
  }
  // La lista de Shorts no trae fecha ni duración: se piden para los más nuevos (de a 3 a la vez).
  const noDate = posts.filter((p) => p.kind === 'short' && !p.at).slice(0, 6);
  for (let i = 0; i < noDate.length; i += 3) {
    await Promise.all(noDate.slice(i, i + 3).map(async (p) => {
      try {
        const d = await ytdlp(['-J', '--no-warnings', '--skip-download', '--no-playlist', p.url]);
        p.at = d.timestamp ? d.timestamp * 1000 : null;
        p.date = ymd(p.at);
        p.duration = Number(d.duration) || p.duration;
        p.views = Number(d.view_count) || p.views;
      } catch {}
    }));
  }
  return { platform: 'youtube', name: name || url.split('/').pop(), url, followers, posts, summary: summarize(posts, now) };
}

/** Instagram: necesita la cuenta de Instagram profesional unida a tu página de Facebook. */
async function instagramAccount(input, auth, now = Date.now()) {
  const user = igUsername(input);
  if (!user) throw new Error('Escribe el usuario de Instagram (por ejemplo @cuenta)');
  const igId = auth?.extra?.igBusinessId;
  if (!igId) throw new Error('Para ver cuentas de Instagram, conecta Facebook con una página que tenga tu Instagram profesional unido');
  const fields = `business_discovery.username(${user}){username,name,followers_count,media_count,media.limit(25){caption,like_count,comments_count,timestamp,media_type,media_product_type,permalink}}`;
  const res = await fetch(`https://graph.facebook.com/${FB_VERSION}/${igId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(auth.accessToken)}`, { signal: AbortSignal.timeout(30000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(`Instagram: ${d.error?.message || `HTTP ${res.status}`}`);
  const bd = d.business_discovery || {};
  const posts = (bd.media?.data || []).map((m) => {
    const at = m.timestamp ? Date.parse(m.timestamp) : null;
    return {
      id: m.id, title: String(m.caption || '').split('\n')[0].slice(0, 140), likes: Number(m.like_count) || 0, comments: Number(m.comments_count) || 0,
      views: null, at, date: ymd(at), kind: m.media_product_type === 'REELS' ? 'reel' : String(m.media_type || '').toLowerCase(), url: m.permalink,
    };
  });
  return { platform: 'instagram', name: `@${bd.username || user}`, url: `https://www.instagram.com/${user}/`, followers: bd.followers_count ?? null, posts, summary: summarize(posts, now, 'likes') };
}

/** Lo que se le manda a Claude para el informe (solo lo necesario, sin enlaces ni ids). */
function reportInput(results, learned) {
  const pick = (p) => ({ date: p.date, title: p.title, views: p.views ?? undefined, likes: p.likes ?? undefined, duration: p.duration ?? undefined });
  return {
    own: {
      followers: Object.fromEntries(Object.entries(learned?.followers || {}).map(([k, v]) => [k, v.count])),
      hints: learned?.ready ? `${learned.findings.join(' ')} ${learned.hints}` : '',
      posts: (learned?.top || []).map((t) => ({ date: ymd(t.publishedAt), title: t.title, views: t.views, likes: t.likes })),
    },
    competitors: results.filter((r) => !r.error).map((r) => ({
      name: r.name, platform: r.platform, followers: r.followers,
      posts: [...r.posts].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20).map(pick),
    })),
  };
}

module.exports = { youtubeChannel, instagramAccount, summarize, reportInput, igUsername };
