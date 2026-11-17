// Publicar desde el servidor de ClipViral (el de esta PC o el de un VPS): mandarle el video, programar y seguir el estado.
// La cola de subidas (subidas.js) lo usa como `remote`. El servidor publica con el mismo código de redes.js.
const fs = require('node:fs');
const { hashFile } = require('./util');

/** ¿Es el servidor de esta PC? */
const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(String(u || '').trim());

/**
 * serverUrl(): dirección del servidor; token(): la sesión; api(path, body, method): llamadas JSON al servidor
 * (las de main.js, con sus mensajes de error); enabled(job): si esa subida la publica el servidor.
 */
function createRemote({ serverUrl, token, api, enabled }) {
  /** Manda el video al servidor (el .mp4 tal cual), con el avance. */
  async function upload(file, onProgress) {
    const size = fs.statSync(file).size;
    let sent = 0;
    async function* chunks() {
      for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
        sent += chunk.length;
        onProgress?.(Math.min(0.99, sent / (size || 1)));
        yield chunk;
      }
    }
    let res;
    try {
      res = await fetch(`${serverUrl()}/api/publicaciones/archivos`, {
        method: 'POST',
        duplex: 'half',
        headers: { 'Content-Type': 'video/mp4', Authorization: `Bearer ${token()}` },
        body: ReadableStream.from(chunks()),
        signal: AbortSignal.timeout(60 * 60000),
      });
    } catch {
      throw Object.assign(new Error('No se pudo mandar el video al servidor. Revisa tu internet.'), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
    onProgress?.(1);
    return data;
  }

  /** Programa la subida en el servidor. El video se manda una sola vez aunque vaya a varias redes. */
  async function send(job, { file, duration, note }, onProgress) {
    const hash = await hashFile(file);
    const body = {
      clientId: job.id, platform: job.platform, fileHash: hash, title: job.title, caption: job.caption, tags: job.tags,
      privacy: job.privacy, shareToFeed: job.shareToFeed, duration, tiktok: job.tiktok, scheduledAt: job.scheduledAt,
      reprogramar: !!job.reprogramar, note,
    };
    const has = await api(`/publicaciones/archivos/${hash}`).catch(() => ({ exists: false }));
    if (!has.exists) {
      const up = await upload(file, onProgress);
      if (up.hash && up.hash !== hash) throw new Error('El video llegó mal al servidor. Se vuelve a intentar.');
    }
    try {
      return await api('/publicaciones', body);
    } catch (err) {
      // El servidor lo borró justo (por ejemplo, ya se publicó en otra red): se manda otra vez.
      if (err.status !== 409) throw err;
      await upload(file, onProgress);
      return api('/publicaciones', body);
    }
  }

  const id = (v) => encodeURIComponent(v);
  return {
    enabled,
    base: () => serverUrl(),
    send,
    list: (ids) => api(`/publicaciones?ids=${ids.map(id).join(',')}`),
    cancel: (postId) => api(`/publicaciones/${id(postId)}/cancelar`, {}),
    now: (postId) => api(`/publicaciones/${id(postId)}/ahora`, {}),
    reschedule: (postId, scheduledAt, note) => api(`/publicaciones/${id(postId)}/hora`, { scheduledAt, note }),
  };
}

module.exports = { createRemote, isLocalUrl };
