// Conexión con YouTube, TikTok, Instagram y Facebook (OAuth). Las claves secretas solo viven en el servidor.
import { getSetting } from './db.js';

export const IG_VERSION = 'v23.0';
export const FB_VERSION = 'v23.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
// El token de una página sacado de un token de usuario "largo" no vence; igual lo revisamos una vez al año.
const NEVER = 365 * 86400;

const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)).toString();

async function json(res, what) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error_description || data.error?.message || data.error?.description || data.message || (typeof data.error === 'string' ? data.error : '') || `HTTP ${res.status}`;
    throw new Error(`${what}: ${msg}`);
  }
  return data;
}

export function publicUrl() {
  return (getSetting('public_url') || `http://localhost:${process.env.PORT || 4600}`).replace(/\/+$/, '');
}

export function redirectUri(platform) {
  return `${publicUrl()}/api/social/${platform}/callback`;
}

/** Direcciones públicas que piden las redes (páginas legales y avisos). Las de inglés son para quienes revisan la app. */
export function publicLinks() {
  const base = publicUrl();
  return {
    home: `${base}/`, homeEn: `${base}/en`,
    privacy: `${base}/privacidad`, privacyEn: `${base}/privacy`,
    terms: `${base}/terminos`, termsEn: `${base}/terms`,
    deletion: `${base}/borrar-datos`, deletionEn: `${base}/data-deletion`,
    igDeauthorize: `${base}/api/meta/instagram/deauthorize`, igDataDeletion: `${base}/api/meta/instagram/data-deletion`,
    fbDeauthorize: `${base}/api/meta/facebook/deauthorize`, fbDataDeletion: `${base}/api/meta/facebook/data-deletion`,
    tiktokWebhook: `${base}/api/tiktok/webhook`,
  };
}

// Permisos que se piden a cada red. Solo los necesarios: cada uno hay que justificarlo en la revisión de la red.
export const SCOPES = {
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
  // video.publish: publicar directo (Direct Post). video.list y user.info.stats: leer las vistas de cada video y los seguidores.
  // (video.upload ya no se pide: solo sirve para mandar borradores a la bandeja de TikTok, y ClipViral no lo usa.)
  tiktok: ['user.info.basic', 'user.info.stats', 'video.publish', 'video.list'],
  // manage_insights: para leer vistas y alcance de cada Reel.
  instagram: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'],
  // pages_*: elegir la página y publicar Reels en ella. read_insights: vistas de cada Reel.
  // instagram_basic: ver la competencia en Instagram (con el Instagram unido a la página).
  // (business_management ya no se pide: ClipViral no administra portafolios comerciales.)
  facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'instagram_basic'],
};

/** Los datos de la cuenta cuando se publica como una página de Facebook. */
export function pageAccount(page) {
  return {
    accessToken: page.token, refreshToken: page.token, expiresIn: NEVER,
    accountId: page.id, accountName: page.name, avatar: page.avatar || null,
    // Si la página tiene un Instagram profesional unido, con él se puede mirar la competencia en Instagram.
    extra: { igBusinessId: page.igBusinessId || null, igUsername: page.igUsername || null, pageId: page.id },
  };
}

/**
 * Facebook: con un token de usuario largo, las páginas que administra la persona (cada una con su token, que no vence)
 * y el @usuario del Instagram unido a cada una. Se publica en la primera hasta que la persona elige.
 */
async function facebookPages(userToken) {
  // El ID de la persona en la app: con él se borra la conexión si quita el permiso desde Facebook.
  const me = await json(await fetch(`${FB_GRAPH}/me?${form({ fields: 'id', access_token: userToken })}`), 'Facebook');
  let pages;
  try {
    pages = await json(await fetch(`${FB_GRAPH}/me/accounts?${form({ fields: PAGE_FIELDS, access_token: userToken })}`), 'Facebook');
  } catch (err) {
    // Con un token de página (en vez del de usuario) /me/accounts no existe.
    if (/accounts|nonexisting field|\(#100\)/i.test(err.message)) throw new Error('Ese parece un token de página. En el Explorador elige "Token de usuario" y genera el token otra vez.');
    throw err;
  }
  let raw = pages.data || [];
  // Las páginas dentro de un portfolio comercial (Meta Business Suite) a veces no salen en /me/accounts: se buscan por el portfolio.
  if (!raw.some((p) => p.id && p.access_token)) raw = await businessPages(userToken);
  const list = raw.filter((p) => p.id && p.access_token).map((p) => ({
    id: String(p.id), name: p.name || 'Mi página', avatar: p.picture?.data?.url || null,
    igBusinessId: p.instagram_business_account?.id || null, igUsername: null, token: p.access_token,
  }));
  if (!list.length) {
    throw new Error('Facebook no le dio a ClipViral ninguna página. Si tu página está en un portfolio comercial (Meta Business Suite), agrega también el permiso business_management en el Explorador, genera el token otra vez y marca tu página y tu portfolio. Si no, revisa que creaste la página con esta misma cuenta de Facebook.');
  }
  // El @usuario del Instagram unido a cada página, para mostrar cuál quedó conectado. Si no se puede leer, se sigue sin él.
  await Promise.all(list.filter((p) => p.igBusinessId).map(async (p) => {
    try {
      const ig = await json(await fetch(`${FB_GRAPH}/${p.igBusinessId}?${form({ fields: 'username', access_token: p.token })}`, { signal: AbortSignal.timeout(10000) }), 'Facebook');
      p.igUsername = ig.username || null;
    } catch {}
  }));
  return { ...pageAccount(list[0]), ownerIds: [String(me.id)], pages: list };
}

const PAGE_FIELDS = 'id,name,access_token,picture{url},instagram_business_account';

/**
 * El token de usuario largo (unos 60 días). Para publicar en el Instagram unido a la página, Meta pide el token de usuario
 * (la subida directa del video no acepta el de la página). Se guarda cifrado junto a la conexión de Facebook.
 */
const userTokenOf = (long) => (long?.access_token
  ? { userToken: long.access_token, userTokenExpiresAt: Date.now() + (Number(long.expires_in) || 60 * 86400) * 1000 }
  : {});

/**
 * Páginas que están dentro de los portfolios comerciales de la persona (propias o de clientes). Necesita business_management.
 * Si alguna no trae su token, se pide aparte. Si algo falla, devuelve lo que encontró.
 */
async function businessPages(userToken) {
  const found = new Map();
  try {
    const biz = await json(await fetch(`${FB_GRAPH}/me/businesses?${form({ fields: 'id', access_token: userToken })}`), 'Facebook');
    for (const b of biz.data || []) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try {
          const r = await json(await fetch(`${FB_GRAPH}/${b.id}/${edge}?${form({ fields: PAGE_FIELDS, access_token: userToken })}`), 'Facebook');
          for (const p of r.data || []) if (p.id && !found.has(String(p.id))) found.set(String(p.id), p);
        } catch {}
      }
    }
  } catch {}
  for (const p of found.values()) {
    if (p.access_token) continue;
    try { p.access_token = (await json(await fetch(`${FB_GRAPH}/${p.id}?${form({ fields: 'access_token', access_token: userToken })}`), 'Facebook')).access_token; } catch {}
  }
  return [...found.values()];
}

/** Instagram: los datos de la cuenta conectada a partir de su token. */
async function instagramAccount(accessToken, expiresIn, moreOwnerIds = []) {
  const me = await json(await fetch(`https://graph.instagram.com/${IG_VERSION}/me?${form({ fields: 'id,user_id,username,account_type,profile_picture_url', access_token: accessToken })}`), 'Instagram');
  return {
    // Instagram no usa refresh token: el mismo token de 60 días se renueva.
    accessToken, refreshToken: accessToken, expiresIn,
    accountId: String(me.user_id || me.id), accountName: me.username ? `@${me.username}` : 'Mi Instagram', avatar: me.profile_picture_url || null,
    // Para mostrar en la app qué cuenta quedó conectada: @usuario y si es de empresa o de creador.
    extra: { username: me.username || null, accountType: me.account_type || null },
    // Meta puede avisar del borrado con cualquiera de estos ID (el de la app o el de la cuenta profesional).
    ownerIds: [...moreOwnerIds, me.id, me.user_id].filter((x) => x !== undefined && x !== null).map(String),
  };
}

export const PROVIDERS = {
  youtube: {
    name: 'YouTube',
    keys: ['google_client_id', 'google_client_secret'],
    configured: () => !!(getSetting('google_client_id') && getSetting('google_client_secret')),
    authUrl(state) {
      return `https://accounts.google.com/o/oauth2/v2/auth?${form({
        client_id: getSetting('google_client_id'),
        redirect_uri: redirectUri('youtube'),
        response_type: 'code',
        scope: SCOPES.youtube.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      })}`;
    },
    async exchange(code) {
      const t = await json(await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ code, client_id: getSetting('google_client_id'), client_secret: getSetting('google_client_secret'), redirect_uri: redirectUri('youtube'), grant_type: 'authorization_code' }),
      }), 'Google');
      const ch = await json(await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      }), 'YouTube');
      const channel = ch.items?.[0];
      if (!channel) throw new Error('Esta cuenta de Google no tiene un canal de YouTube');
      return {
        accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in,
        accountId: channel.id, accountName: channel.snippet?.title || 'Mi canal', avatar: channel.snippet?.thumbnails?.default?.url || null,
      };
    },
    async refresh(acc) {
      const t = await json(await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: getSetting('google_client_id'), client_secret: getSetting('google_client_secret'), refresh_token: acc.refreshToken, grant_type: 'refresh_token' }),
      }), 'Google');
      return { accessToken: t.access_token, refreshToken: t.refresh_token || acc.refreshToken, expiresIn: t.expires_in };
    },
  },

  tiktok: {
    name: 'TikTok',
    keys: ['tiktok_client_key', 'tiktok_client_secret'],
    configured: () => !!(getSetting('tiktok_client_key') && getSetting('tiktok_client_secret')),
    authUrl(state) {
      return `https://www.tiktok.com/v2/auth/authorize/?${form({
        client_key: getSetting('tiktok_client_key'),
        scope: SCOPES.tiktok.join(','),
        response_type: 'code',
        redirect_uri: redirectUri('tiktok'),
        state,
      })}`;
    },
    async exchange(code) {
      const t = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: getSetting('tiktok_client_key'), client_secret: getSetting('tiktok_client_secret'), code, grant_type: 'authorization_code', redirect_uri: redirectUri('tiktok') }),
      }), 'TikTok');
      const u = await json(await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      }), 'TikTok');
      const user = u.data?.user || {};
      const openId = t.open_id || user.open_id;
      return {
        accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in,
        accountId: openId, accountName: user.display_name || 'Mi TikTok', avatar: user.avatar_url || null,
        ownerIds: [openId],
      };
    },
    async refresh(acc) {
      const t = await json(await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: getSetting('tiktok_client_key'), client_secret: getSetting('tiktok_client_secret'), grant_type: 'refresh_token', refresh_token: acc.refreshToken }),
      }), 'TikTok');
      return { accessToken: t.access_token, refreshToken: t.refresh_token || acc.refreshToken, expiresIn: t.expires_in };
    },
    // Al desconectar, se le avisa a TikTok para que el permiso deje de valer.
    async revoke(acc) {
      await json(await fetch('https://open.tiktokapis.com/v2/oauth/revoke/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: getSetting('tiktok_client_key'), client_secret: getSetting('tiktok_client_secret'), token: acc.accessToken }),
        signal: AbortSignal.timeout(15000),
      }), 'TikTok');
    },
  },

  instagram: {
    name: 'Instagram',
    keys: ['instagram_app_id', 'instagram_app_secret'],
    configured: () => !!(getSetting('instagram_app_id') && getSetting('instagram_app_secret')),
    authUrl(state) {
      return `https://www.instagram.com/oauth/authorize?${form({
        client_id: getSetting('instagram_app_id'),
        redirect_uri: redirectUri('instagram'),
        response_type: 'code',
        scope: SCOPES.instagram.join(','),
        state,
      })}`;
    },
    async exchange(code) {
      const short = await json(await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_id: getSetting('instagram_app_id'), client_secret: getSetting('instagram_app_secret'), grant_type: 'authorization_code', redirect_uri: redirectUri('instagram'), code }),
      }), 'Instagram');
      const shortToken = short.access_token || short.data?.[0]?.access_token;
      const long = await json(await fetch(`https://graph.instagram.com/access_token?${form({ grant_type: 'ig_exchange_token', client_secret: getSetting('instagram_app_secret'), access_token: shortToken })}`), 'Instagram');
      return instagramAccount(long.access_token, long.expires_in, [short.user_id ?? short.data?.[0]?.user_id]);
    },
    /**
     * Uso personal: la persona pega el token que genera el panel de Meta (Instagram → Configuración de la API → Generar token).
     * Ese token ya dura 60 días; si fuera uno corto, se cambia por uno largo.
     */
    async fromToken(token) {
      let access = token;
      let expiresIn = 60 * 86400;
      try {
        const long = await json(await fetch(`https://graph.instagram.com/access_token?${form({ grant_type: 'ig_exchange_token', client_secret: getSetting('instagram_app_secret'), access_token: token })}`), 'Instagram');
        if (long.access_token) { access = long.access_token; expiresIn = Number(long.expires_in) || expiresIn; }
      } catch {} // ya era largo: se usa tal cual
      try {
        return await instagramAccount(access, expiresIn);
      } catch (err) {
        throw new Error(`Instagram no aceptó el token (${err.message.replace(/^Instagram: /, '')}). Cópialo de nuevo desde Instagram → Configuración de la API → "Generar token", entero.`);
      }
    },
    async refresh(acc) {
      const t = await json(await fetch(`https://graph.instagram.com/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: acc.accessToken })}`), 'Instagram');
      return { accessToken: t.access_token, refreshToken: t.access_token, expiresIn: t.expires_in };
    },
    // Instagram solo deja renovar si faltan menos de ~7 días; antes de eso el token sigue sirviendo.
    refreshWindowSec: 7 * 86400,
  },

  // Reels en una página de Facebook. Se publica como la página (no como la persona).
  facebook: {
    name: 'Facebook',
    keys: ['facebook_app_id', 'facebook_app_secret'],
    configured: () => !!(getSetting('facebook_app_id') && getSetting('facebook_app_secret')),
    authUrl(state) {
      // Con "Inicio de sesión con Facebook para empresas" Meta recomienda usar el ID de configuración en vez de la lista de permisos.
      const configId = getSetting('facebook_config_id');
      return `https://www.facebook.com/${FB_VERSION}/dialog/oauth?${form({
        client_id: getSetting('facebook_app_id'),
        redirect_uri: redirectUri('facebook'),
        response_type: 'code',
        ...(configId ? { config_id: configId, override_default_response_type: 'true' } : { scope: SCOPES.facebook.join(',') }),
        state,
      })}`;
    },
    async exchange(code) {
      const short = await json(await fetch(`${FB_GRAPH}/oauth/access_token?${form({
        client_id: getSetting('facebook_app_id'), client_secret: getSetting('facebook_app_secret'), redirect_uri: redirectUri('facebook'), code,
      })}`), 'Facebook');
      const long = await json(await fetch(`${FB_GRAPH}/oauth/access_token?${form({
        grant_type: 'fb_exchange_token', client_id: getSetting('facebook_app_id'), client_secret: getSetting('facebook_app_secret'), fb_exchange_token: short.access_token,
      })}`), 'Facebook');
      // La persona elige en el navegador en qué página publicar (y después puede cambiarla en la app, sección Redes).
      return { ...(await facebookPages(long.access_token)), ...userTokenOf(long) };
    },
    /**
     * Uso personal (sin el botón de inicio de sesión, que pide verificar el negocio): la persona pega el token de usuario que sacó
     * en el Explorador de la API Graph con su propia app. Se cambia por uno largo: así los tokens de sus páginas no vencen.
     */
    async fromToken(token) {
      let long;
      try {
        long = await json(await fetch(`${FB_GRAPH}/oauth/access_token?${form({
          grant_type: 'fb_exchange_token', client_id: getSetting('facebook_app_id'), client_secret: getSetting('facebook_app_secret'), fb_exchange_token: token,
        })}`), 'Facebook');
      } catch (err) {
        throw new Error(`Meta no aceptó el token (${err.message.replace(/^Facebook: /, '')}). Revisa que en el Explorador esté elegida tu app (no "Graph API Explorer"), que sea un "token de usuario" recién generado y que la clave secreta del panel sea la de esa app.`);
      }
      // Qué permisos dio: sin los de publicar no sirve; sin los de estadísticas o competencia, sí (con aviso).
      const warnings = [];
      try {
        const perms = await json(await fetch(`${FB_GRAPH}/me/permissions?${form({ access_token: long.access_token })}`), 'Facebook');
        const granted = new Set((perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission));
        const missing = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'].filter((p) => !granted.has(p));
        if (missing.length) throw Object.assign(new Error(`Al token le faltan permisos: ${missing.join(', ')}. En el Explorador agrégalos en "Permisos" y toca "Generate Access Token" otra vez.`), { fatal: true });
        if (!granted.has('read_insights')) warnings.push('Sin read_insights: Estadísticas no podrá leer las vistas de Facebook.');
        // Instagram a través de la página (sin conectarlo aparte): necesita publicar y, para las vistas, sus estadísticas.
        if (!granted.has('instagram_content_publish')) warnings.push('Sin instagram_content_publish: no se podrá publicar en el Instagram unido a tu página.');
        else if (!granted.has('instagram_manage_insights')) warnings.push('Sin instagram_manage_insights: Estadísticas no podrá leer las vistas de Instagram.');
        if (!granted.has('instagram_basic')) warnings.push('Sin instagram_basic: Competencia no podrá mirar cuentas de Instagram.');
      } catch (err) {
        if (err.fatal) throw err;
      }
      return { ...(await facebookPages(long.access_token)), ...userTokenOf(long), warnings };
    },
    async refresh(acc) {
      // Revisa que el token siga sirviendo (el usuario pudo quitar el permiso).
      await json(await fetch(`${FB_GRAPH}/me?${form({ fields: 'id', access_token: acc.accessToken })}`), 'Facebook');
      return { accessToken: acc.accessToken, refreshToken: acc.accessToken, expiresIn: NEVER };
    },
    refreshWindowSec: 7 * 86400,
  },
};
