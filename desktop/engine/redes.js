// Subida directa de clips desde la PC a YouTube Shorts, TikTok, Instagram Reels y Facebook Reels.
const fs = require('node:fs');
const { sleep } = require('./util');
const { checkTiktokApproval, creatorInfo, IG_SAFE_SECONDS } = require('./publicar');

const IG_VERSION = 'v23.0';

/**
 * Los errores de la subida directa de Meta (rupload) vienen en debug_info, a veces con otro JSON adentro.
 * "Request processing failed" casi siempre es por el tipo de token o por el video.
 */
function uploadError(info) {
  if (!info?.message) return '';
  let msg = info.message;
  try { msg = JSON.parse(msg).error?.message || msg; } catch {}
  if (/unauthorized user request/i.test(msg)) return 'Meta no dejó subir el video con esta conexión. Desconecta Facebook y conéctalo otra vez con un token nuevo (con instagram_content_publish).';
  if (/request processing failed/i.test(msg)) return 'Meta no pudo recibir el video (Request processing failed). Desconecta Facebook y conéctalo otra vez con un token nuevo; si sigue, prueba con otro clip.';
  return msg;
}

async function fail(res, red) {
  let detail = '';
  try {
    const data = await res.json();
    detail = data.error?.message || data.error?.errors?.[0]?.message || data.error_description || data.message || uploadError(data.debug_info) || JSON.stringify(data).slice(0, 200);
  } catch {
    detail = `HTTP ${res.status}`;
  }
  const err = new Error(`${red}: ${detail}`);
  err.status = res.status;
  if (res.status === 401) err.reconnect = true;
  return err;
}

const noAngles = (t) => String(t || '').replace(/[<>]/g, '');

// ---------- YouTube (subida reanudable en pedazos de 8 MB) ----------
async function youtube({ file, title, description, tags = [], privacy = 'public', token, onProgress }) {
  const size = fs.statSync(file).size;
  const tagList = [];
  let total = 0;
  for (const t of tags.map((x) => x.replace(/^#/, '')).filter(Boolean)) {
    if (total + t.length > 450) break;
    tagList.push(t);
    total += t.length + 1;
  }
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: { title: noAngles(title).slice(0, 100) || 'Clip', description: noAngles(description).slice(0, 4900), tags: tagList, categoryId: '24' },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) throw await fail(init, 'YouTube');
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube no dio dirección de subida');

  const CHUNK = 8 * 1024 * 1024;
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      const res = await fetch(location, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` },
        body: buf,
      });
      if (res.status === 308) {
        const range = res.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : offset + len;
        onProgress?.(offset / size);
        continue;
      }
      if (!res.ok) throw await fail(res, 'YouTube');
      const data = await res.json();
      onProgress?.(1);
      return { id: data.id, url: `https://www.youtube.com/shorts/${data.id}` };
    }
    throw new Error('YouTube no confirmó la subida');
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- TikTok (Content Posting API, publicación directa) ----------
// Mensajes en palabras sencillas para los errores de TikTok.
const TIKTOK_ERRORS = {
  spam_risk_too_many_posts: 'esta cuenta ya publicó el máximo de videos de hoy. Inténtalo mañana.',
  spam_risk_user_banned_from_posting: 'TikTok no deja publicar a esta cuenta por ahora.',
  reached_active_user_cap: 'ClipViral llegó al límite diario de cuentas que publican en TikTok. Inténtalo más tarde.',
  unaudited_client_can_only_post_to_private_accounts: 'TikTok todavía no aprobó ClipViral: por ahora solo se puede publicar en cuentas privadas y como "Solo yo".',
  privacy_level_option_mismatch: 'la privacidad que elegiste ya no está disponible en tu cuenta. Vuelve a aprobar el clip.',
  access_token_invalid: 'la conexión venció. Vuelve a conectar TikTok en la sección Redes.',
  scope_not_authorized: 'falta el permiso para publicar. Vuelve a conectar TikTok en la sección Redes.',
  rate_limit_exceeded: 'TikTok pidió esperar un poco. Se vuelve a intentar solo.',
};
// Estos errores no se arreglan reintentando enseguida.
const TIKTOK_GIVE_UP = new Set(['spam_risk_too_many_posts', 'spam_risk_user_banned_from_posting', 'reached_active_user_cap',
  'unaudited_client_can_only_post_to_private_accounts', 'privacy_level_option_mismatch', 'invalid_param']);

async function tiktokApi(path, token, body) {
  const res = await fetch(`https://open.tiktokapis.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  const code = data.error?.code;
  if (!res.ok || (code && code !== 'ok')) {
    const err = new Error(`TikTok: ${TIKTOK_ERRORS[code] || data.error?.message || code || `HTTP ${res.status}`}`);
    err.code = code;
    // Algunos errores de TikTok llegan con HTTP 200: se tratan como "no reintentar".
    err.status = TIKTOK_GIVE_UP.has(code) ? 403 : res.status === 200 ? 502 : res.status;
    if (res.status === 401 || code === 'access_token_invalid' || code === 'scope_not_authorized') err.reconnect = true;
    throw err;
  }
  return data.data || {};
}

/** Lo que TikTok dice de la cuenta: apodo, foto, opciones de privacidad, interacciones permitidas y duración máxima. */
async function tiktokCreatorInfo(token) {
  return creatorInfo(await tiktokApi('/v2/post/publish/creator_info/query/', token));
}

/**
 * Publica en TikTok lo que la persona aprobó en la pantalla de TikTok (job.tiktok).
 * Justo antes de enviar, vuelve a leer la cuenta: si algo cambió (privacidad, límite del día, duración), no publica.
 */
async function tiktok({ file, caption, tiktok: approved, duration = 0, token, onProgress }) {
  if (!approved?.consentAt || !approved.privacy) {
    throw Object.assign(new Error('TikTok: falta tu aprobación para este clip. Ábrelo en Clips sugeridos y toca "Aprobar".'), { status: 400 });
  }
  const info = await tiktokCreatorInfo(token);
  const problem = checkTiktokApproval({ ...approved, consent: true, disclose: approved.brandOrganic || approved.brandContent, caption }, info, { duration });
  if (problem) throw Object.assign(new Error(`TikTok: ${problem}`), { status: 400 });
  const size = fs.statSync(file).size;
  // Pedazos de 5 a 64 MB; hasta 64 MB va de una vez. El último pedazo lleva lo que sobra.
  const single = size <= 64 * 1024 * 1024;
  const chunk = single ? size : 10 * 1024 * 1024;
  const count = single ? 1 : Math.floor(size / chunk);
  const init = await tiktokApi('/v2/post/publish/video/init/', token, {
    post_info: {
      title: String(caption || '').slice(0, 2200),
      privacy_level: approved.privacy,
      // Lo que la persona permitió (y su cuenta deja): por defecto todo apagado.
      disable_comment: !approved.allowComment || info.commentDisabled,
      disable_duet: !approved.allowDuet || info.duetDisabled,
      disable_stitch: !approved.allowStitch || info.stitchDisabled,
      brand_organic_toggle: !!approved.brandOrganic,
      brand_content_toggle: !!approved.brandContent,
      video_cover_timestamp_ms: 1000,
    },
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count },
  });
  const fd = fs.openSync(file, 'r');
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? size - 1 : start + chunk - 1;
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      const res = await fetch(init.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}` },
        body: buf,
      });
      if (!res.ok && res.status !== 206) throw await fail(res, 'TikTok');
      onProgress?.((end + 1) / size * 0.9);
    }
  } finally {
    fs.closeSync(fd);
  }
  // TikTok procesa el video unos minutos antes de mostrarlo en el perfil: se revisa el estado hasta que termine.
  onProgress?.(0.92, 'TikTok está procesando el video (puede tardar unos minutos)');
  const profile = info.username ? `https://www.tiktok.com/@${info.username}` : 'https://www.tiktok.com/';
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const st = await tiktokApi('/v2/post/publish/status/fetch/', token, { publish_id: init.publish_id });
    if (st.status === 'PUBLISH_COMPLETE') {
      onProgress?.(1);
      const postId = st.publicaly_available_post_id?.[0];
      return { id: postId || init.publish_id, url: postId ? `${profile}/video/${postId}` : profile, privacy: approved.privacy };
    }
    if (st.status === 'FAILED') {
      const reason = TIKTOK_FAIL[st.fail_reason] || st.fail_reason || 'sin motivo';
      throw Object.assign(new Error(`TikTok rechazó el video: ${reason}`), { status: st.fail_reason === 'internal' ? 502 : 400 });
    }
  }
  return { id: init.publish_id, url: profile, privacy: approved.privacy, pending: true };
}

const TIKTOK_FAIL = {
  file_format_check_failed: 'el formato del archivo no es válido',
  duration_check_failed: 'la duración no es válida para tu cuenta',
  frame_rate_check_failed: 'los cuadros por segundo no son válidos (23 a 60 fps)',
  picture_size_check_failed: 'el tamaño de la imagen no es válido',
  internal: 'error de TikTok (se reintenta)',
  publish_cancelled: 'se canceló la publicación',
  auth_removed: 'quitaste el permiso a ClipViral en TikTok',
  spam_risk_too_many_posts: 'ya publicaste el máximo de hoy',
  spam_risk_user_banned_from_posting: 'TikTok no deja publicar a esta cuenta por ahora',
  spam_risk_text: 'a TikTok no le gustó el texto (revisa el título y los hashtags)',
  spam_risk: 'TikTok lo marcó como posible spam',
};

// ---------- Instagram Reels (subida reanudable) ----------
async function igJson(res) {
  if (!res.ok) throw await fail(res, 'Instagram');
  return res.json();
}

const IG_MAX_BYTES = 300 * 1024 * 1024;
// Por la API, Instagram rechaza a algunas cuentas (sobre todo nuevas o recién pasadas a profesionales) los Reels de más de
// unos 40 s, con un error genérico. Los mismos videos más cortos sí suben.
function longReelHint(err, duration) {
  if (!(duration > IG_SAFE_SECONDS) || !/Request processing failed|Meta no pudo recibir el video/i.test(err.message)) return err;
  return Object.assign(new Error(`Instagram rechazó el video. Con cuentas nuevas, Instagram suele rechazar por la API los Reels de más de unos ${IG_SAFE_SECONDS} segundos (este dura ${Math.round(duration)} s). Prueba con un clip de ${IG_SAFE_SECONDS} s o menos, o enciende "Recortar a 39 s para Instagram" en Redes.`), { status: 400 });
}
/** Dirección de la API de Instagram: la propia o, si se publica a través de la página, la de Facebook. */
const igBase = (extra) => (extra?.via === 'facebook' ? `https://graph.facebook.com/${IG_VERSION}` : `https://graph.instagram.com/${IG_VERSION}`);

/**
 * Reels en Instagram. Primero intenta subir el archivo directo desde la PC (subida reanudable).
 * Con "inicio de sesión de Instagram" Meta solo garantiza recibir el video desde un enlace público: si la subida directa
 * no funciona, el clip pasa un momento por el servidor de ClipViral (relay), Instagram lo descarga y se borra enseguida.
 * extra.via = 'facebook': el Instagram unido a la página de Facebook, con el token de la página (API de Instagram con
 * inicio de sesión con Facebook). Mismos pasos, otra dirección.
 */
async function instagram({ file, caption, token, accountId, shareToFeed = true, duration = 0, relay = null, extra = null, onProgress }) {
  const base = igBase(extra);
  const size = fs.statSync(file).size;
  if (size > IG_MAX_BYTES) throw Object.assign(new Error('Instagram: el video pesa más de 300 MB. Baja la calidad a 720p en Estilo del clip.'), { status: 400 });
  if (duration && (duration < 3 || duration > 900)) throw Object.assign(new Error('Instagram: los Reels deben durar entre 3 segundos y 15 minutos.'), { status: 400 });
  const fields = { media_type: 'REELS', caption: String(caption || '').slice(0, 2200), share_to_feed: String(!!shareToFeed), access_token: token };
  const newContainer = async (extra) => igJson(await fetch(`${base}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...fields, ...extra }),
  }));

  let containerId;
  let relayed = null;
  try {
    const container = await newContainer({ upload_type: 'resumable' });
    const uploadUri = container.uri || `https://rupload.facebook.com/ig-api-upload/${IG_VERSION}/${container.id}`;
    const up = await fetch(uploadUri, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size) },
      body: fs.readFileSync(file),
    });
    if (!up.ok) throw await fail(up, 'Instagram');
    containerId = container.id;
  } catch (err) {
    // Desde la PC, a través de la página no hay paso por el servidor (necesita Instagram conectado aparte): se muestra el
    // error real. Cuando publica el servidor con https (relay.anyAccount), Instagram descarga el video de ahí.
    if (err.reconnect || !relay || (extra?.via === 'facebook' && !relay.anyAccount)) throw longReelHint(err, duration);
    relayed = await relay.put(file);
    containerId = (await newContainer({ video_url: relayed.url })).id;
  }
  onProgress?.(0.8, 'Instagram está procesando el video');
  try {
    for (let i = 0; i < 90; i++) {
      await sleep(5000);
      const st = await igJson(await fetch(`${base}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`));
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw Object.assign(new Error(`Instagram no aceptó el video: ${st.status || st.status_code}`), { status: 400 });
      if (i === 89) throw new Error('Instagram tardó demasiado en procesar el video');
    }
  } finally {
    // Instagram ya descargó el video (o falló): se borra del servidor.
    if (relayed) await relay.remove(relayed.id).catch(() => {});
  }
  const pub = await igJson(await fetch(`${base}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  }));
  let url = 'https://www.instagram.com/';
  try {
    const m = await igJson(await fetch(`${base}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`));
    url = m.permalink || url;
  } catch {}
  onProgress?.(1);
  return { id: pub.id, url };
}

// ---------- Facebook Reels (en la página) ----------
const FB_VERSION = 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;

async function fbJson(res) {
  if (!res.ok) throw await fail(res, 'Facebook');
  return res.json();
}

async function facebook({ file, caption, title, token, accountId, duration = 0, onProgress }) {
  // Facebook solo acepta Reels de 3 a 90 segundos.
  if (duration && (duration < 3 || duration > 90)) {
    throw Object.assign(new Error(`Facebook: los Reels deben durar entre 3 y 90 segundos (este dura ${Math.round(duration)} s). Haz clips más cortos en Directo → Duración.`), { status: 400 });
  }
  const size = fs.statSync(file).size;
  // 1) Pedir permiso para subir
  const start = await fbJson(await fetch(`${FB_GRAPH}/${accountId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ upload_phase: 'start', access_token: token }),
  }));
  if (!start.video_id) throw new Error('Facebook no dio dónde subir el video');
  // 2) Subir el archivo de una vez
  const up = await fetch(start.upload_url || `https://rupload.facebook.com/video-upload/${FB_VERSION}/${start.video_id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, offset: '0', file_size: String(size) },
    body: fs.readFileSync(file),
  });
  if (!up.ok) throw await fail(up, 'Facebook');
  onProgress?.(0.7);
  // 3) Publicar con el texto
  await fbJson(await fetch(`${FB_GRAPH}/${accountId}/video_reels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED',
      description: String(caption || '').slice(0, 2200), title: noAngles(title).slice(0, 100), access_token: token,
    }),
  }));
  // 4) Esperar a que Facebook lo procese
  for (let i = 0; i < 90; i++) {
    await sleep(5000);
    const st = await fbJson(await fetch(`${FB_GRAPH}/${start.video_id}?fields=status&access_token=${encodeURIComponent(token)}`));
    const s = st.status || {};
    if (s.video_status === 'error' || s.processing_phase?.status === 'error') {
      throw new Error(`Facebook no aceptó el video: ${s.processing_phase?.error?.message || s.video_status}`);
    }
    if (s.video_status === 'ready' || s.publishing_phase?.status === 'complete') break;
    onProgress?.(Math.min(0.98, 0.7 + i * 0.01));
  }
  onProgress?.(1);
  return { id: start.video_id, url: await facebookLink(start.video_id, token) };
}

/** El enlace real de la publicación (botón "Ver en Facebook"). Facebook a veces lo da sin el dominio. */
async function facebookLink(videoId, token) {
  const fallback = `https://www.facebook.com/reel/${videoId}`;
  try {
    const v = await fbJson(await fetch(`${FB_GRAPH}/${videoId}?fields=permalink_url&access_token=${encodeURIComponent(token)}`));
    const link = String(v.permalink_url || '');
    if (/^https:\/\/([a-z0-9-]+\.)*facebook\.com\//i.test(link)) return link;
    if (link.startsWith('/')) return `https://www.facebook.com${link}`;
  } catch {}
  return fallback;
}

const UPLOADERS = { youtube, tiktok, instagram, facebook };

/** Arma el texto del post a partir de la plantilla. {gancho} es la primera frase que engancha (si no hay, el título). */
function buildCaption(template, clip, extra = {}) {
  const tags = (clip.hashtags || []).join(' ');
  const vars = {
    titulo: clip.title || '',
    gancho: clip.gancho || clip.title || '',
    descripcion: clip.description || '',
    hashtags: tags,
    canal: clip.stream?.channel || '',
    fuente: clip.stream?.url || '',
    minuto: extra.minuto || '',
    ...extra,
  };
  return String(template || '{titulo}\n\n{hashtags}')
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { UPLOADERS, buildCaption, tiktokCreatorInfo, igBase, IG_VERSION, FB_VERSION };
