// Estadísticas: lee de cada red cuántas vistas, "me gusta", comentarios y veces compartido tiene cada clip publicado,
// y cuántos seguidores tiene cada cuenta. Todo sale directo de la PC con el token de la cuenta (no pasa por el servidor).
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { IG_VERSION, FB_VERSION, igBase } = require('./redes');

const DAY = 86400000;
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v) || 0);

async function getJson(url, opts, red) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.error && (data.error.code && data.error.code !== 'ok'))) {
    const err = new Error(`${red}: ${data.error?.message || data.error?.code || `HTTP ${res.status}`}`);
    err.status = res.status;
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// Facebook responde "código 100" cuando el video ya no existe o es de otra página: ese video se salta y no frena a los demás.
const notFound = (err) => err.code === 100;

// ---------- Cada red ----------
const FETCHERS = {
  async youtube(ids, auth) {
    const out = {};
    for (const part of chunks(ids, 50)) {
      const d = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${part.map(encodeURIComponent).join(',')}`,
        { headers: { Authorization: `Bearer ${auth.accessToken}` } }, 'YouTube');
      for (const v of d.items || []) {
        out[v.id] = { views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount), shares: null };
      }
    }
    return out;
  },
  async youtubeFollowers(auth) {
    const d = await getJson('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: { Authorization: `Bearer ${auth.accessToken}` } }, 'YouTube');
    return num(d.items?.[0]?.statistics?.subscriberCount);
  },

  async tiktok(ids, auth) {
    const out = {};
    for (const part of chunks(ids, 20)) {
      const d = await getJson('https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count', {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { video_ids: part } }),
      }, 'TikTok');
      for (const v of d.data?.videos || []) out[v.id] = { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) };
    }
    return out;
  },
  async tiktokFollowers(auth) {
    const d = await getJson('https://open.tiktokapis.com/v2/user/info/?fields=follower_count', { headers: { Authorization: `Bearer ${auth.accessToken}` } }, 'TikTok');
    return num(d.data?.user?.follower_count);
  },

  async instagram(ids, auth) {
    const out = {};
    // A través de la página de Facebook, la misma consulta va a la dirección de Facebook.
    const base = igBase(auth.extra);
    for (const id of ids) {
      try {
        const d = await getJson(`${base}/${id}/insights?metric=views,likes,comments,shares&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Instagram');
        const m = Object.fromEntries((d.data || []).map((x) => [x.name, x.values?.[0]?.value ?? x.total_value?.value]));
        out[id] = { views: num(m.views), likes: num(m.likes), comments: num(m.comments), shares: num(m.shares) };
      } catch (err) {
        // Sin permiso de estadísticas: al menos los "me gusta" y comentarios.
        try {
          const d = await getJson(`${base}/${id}?fields=like_count,comments_count&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Instagram');
          out[id] = { views: null, likes: num(d.like_count), comments: num(d.comments_count), shares: null, partial: true };
        } catch (err2) { if (!notFound(err2)) throw err2; }
      }
    }
    return out;
  },
  async instagramFollowers(auth) {
    // Con el token de la página, "me" sería la página: se pregunta por la cuenta de Instagram.
    const who = auth.extra?.via === 'facebook' ? auth.accountId : 'me';
    const d = await getJson(`${igBase(auth.extra)}/${who}?fields=followers_count&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Instagram');
    return num(d.followers_count);
  },

  async facebook(ids, auth) {
    const out = {};
    const base = `https://graph.facebook.com/${FB_VERSION}`;
    for (const id of ids) {
      const stat = { views: null, likes: null, comments: null, shares: null };
      try {
        const d = await getJson(`${base}/${id}/video_insights?metric=blue_reels_play_count,post_video_likes_by_reaction_type,post_video_social_actions&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Facebook');
        for (const m of d.data || []) {
          const v = m.values?.[0]?.value;
          if (m.name === 'blue_reels_play_count') stat.views = num(v);
          if (m.name === 'post_video_likes_by_reaction_type' && v && typeof v === 'object') stat.likes = Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0);
          if (m.name === 'post_video_social_actions' && v && typeof v === 'object') { stat.comments = num(v.COMMENT); stat.shares = num(v.SHARE); }
        }
      } catch {
        try {
          const d = await getJson(`${base}/${id}?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Facebook');
          Object.assign(stat, { likes: num(d.likes?.summary?.total_count), comments: num(d.comments?.summary?.total_count), partial: true });
        } catch (err2) { if (notFound(err2)) continue; throw err2; }
      }
      out[id] = stat;
    }
    return out;
  },
  async facebookFollowers(auth) {
    const d = await getJson(`https://graph.facebook.com/${FB_VERSION}/${auth.accountId}?fields=followers_count,fan_count&access_token=${encodeURIComponent(auth.accessToken)}`, {}, 'Facebook');
    return num(d.followers_count ?? d.fan_count);
  },
};

class Estadisticas extends EventEmitter {
  /**
   * file: dónde se guardan (JSON)
   * getJobs(): la cola de subidas (para saber qué se publicó y su id en cada red)
   * getToken(red): token vigente desde el servidor
   * connected(): redes conectadas [{ id, connected }]
   */
  constructor({ file, getJobs, getToken, connected, fetchers = FETCHERS, now = () => Date.now() }) {
    super();
    Object.assign(this, { file, getJobs, getToken, connected, fetchers, now });
    this.state = { posts: {}, followers: {}, errors: {}, lastRefresh: null };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
    this.busy = false;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state));
  }

  /** Vuelve a leer los números de lo publicado en los últimos 30 días. */
  async refresh() {
    if (this.busy) return this.state;
    this.busy = true;
    this.emit('update');
    try {
      const now = this.now();
      const jobs = this.getJobs().filter((j) => j.status === 'publicado' && j.remoteId && now - (j.publishedAt || 0) < 30 * DAY);
      let nets = [];
      try { nets = (await this.connected()).filter((p) => p.connected).map((p) => p.id); } catch {}
      for (const platform of nets) {
        if (!this.fetchers[platform]) continue;
        let auth;
        try { auth = await this.getToken(platform); } catch (err) { this.state.errors[platform] = err.message; continue; }
        // Lo publicado en otra cuenta o página (si después cambiaste de página) no se puede leer con este token.
        const mine = jobs.filter((j) => j.platform === platform && !(platform === 'tiktok' && /^v_pub|^p_pub/.test(j.remoteId))
          && !(j.accountId && auth.accountId && j.accountId !== auth.accountId));
        try {
          const got = mine.length ? await this.fetchers[platform](mine.map((j) => j.remoteId), auth) : {};
          for (const j of mine) {
            const s = got[j.remoteId];
            if (!s) continue;
            const prev = this.state.posts[j.id] || { platform, remoteId: j.remoteId, clipId: j.clipId, history: [] };
            prev.last = { at: now, ...s };
            // Un punto por día alcanza para ver cómo crece.
            const lastPoint = prev.history[prev.history.length - 1];
            if (!lastPoint || now - lastPoint.at > 20 * 3600000) prev.history.push({ at: now, views: s.views, likes: s.likes });
            prev.history = prev.history.slice(-30);
            this.state.posts[j.id] = prev;
          }
          delete this.state.errors[platform];
        } catch (err) {
          this.state.errors[platform] = err.status === 401 || err.status === 403
            ? `${err.message}. Vuelve a conectar la cuenta para ver estadísticas.` : err.message;
        }
        try {
          const f = await this.fetchers[`${platform}Followers`]?.(auth);
          if (f !== null && f !== undefined) {
            const list = this.state.followers[platform] || [];
            const last = list[list.length - 1];
            if (last && now - last.at < 20 * 3600000) last.count = f; else list.push({ at: now, count: f });
            this.state.followers[platform] = list.slice(-90);
          }
        } catch {}
      }
      this.state.lastRefresh = now;
      this.save();
    } finally {
      this.busy = false;
      this.emit('update');
    }
    return this.state;
  }
}

module.exports = { Estadisticas, FETCHERS };
