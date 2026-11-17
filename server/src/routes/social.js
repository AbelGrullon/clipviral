import express, { Router } from 'express';
import crypto from 'node:crypto';
import { db, planInfo } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { PROVIDERS, pageAccount } from '../social.js';
import { seal, open } from '../secretbox.js';
import { ownerIdsText } from '../privacidad.js';
import { relayRoutes } from '../relay.js';

const router = Router();
const STATE_TTL = 15 * 60 * 1000;
// Cuando se piden permisos nuevos a una red, se sube su número: las cuentas conectadas antes deben reconectar.
// v2: estadísticas (TikTok video.list + user.info.stats, Instagram manage_insights).
export const SCOPE_VERSION = { youtube: 1, tiktok: 2, instagram: 2, facebook: 1 };

function provider(req, res) {
  const p = PROVIDERS[req.params.platform];
  if (!p) { res.status(404).json({ error: 'Red social no soportada' }); return null; }
  return p;
}

/** Guarda la cuenta. `scopeV` solo se pasa al conectar (al renovar el token se mantiene el que tenía). */
function saveAccount(userId, platform, data, scopeV) {
  db.prepare(`INSERT INTO social_accounts (user_id, platform, account_id, account_name, avatar, access_token, refresh_token, expires_at, extra, scope_v, owner_ids, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, platform) DO UPDATE SET account_id = excluded.account_id, account_name = excluded.account_name,
      avatar = excluded.avatar, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at, extra = COALESCE(excluded.extra, social_accounts.extra),
      owner_ids = COALESCE(excluded.owner_ids, social_accounts.owner_ids),
      scope_v = CASE WHEN ? THEN excluded.scope_v ELSE social_accounts.scope_v END, updated_at = excluded.updated_at`)
    .run(userId, platform, data.accountId, data.accountName, data.avatar ?? null, seal(data.accessToken), seal(data.refreshToken),
      Date.now() + (Number(data.expiresIn) || 3600) * 1000, data.extra ? JSON.stringify(data.extra) : null, scopeV || 1,
      ownerIdsText(data.ownerIds), scopeV ? 1 : 0);
}

const parseExtra = (row) => { try { return JSON.parse(row.extra || '{}') || {}; } catch { return {}; } };

/** La página de Facebook que había elegido antes (si vuelve a conectar, se propone la misma). */
function previousPageId(userId) {
  const before = db.prepare("SELECT extra FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(userId);
  return before ? parseExtra(before).pageId : null;
}

/**
 * Facebook: guarda todas las páginas que administra la persona (con su token cifrado) para que pueda cambiar dónde publicar.
 * Se publica en `pageId` (la que eligió en el navegador); si no vino, en la de antes o en la primera.
 */
function withPages(userId, data, pageId = null) {
  if (!Array.isArray(data.pages)) return data;
  const keep = pageId || previousPageId(userId);
  const chosen = data.pages.find((p) => p.id === keep) || data.pages[0];
  const pages = data.pages.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, igBusinessId: p.igBusinessId, igUsername: p.igUsername || null, token: seal(p.token) }));
  const acc = pageAccount(chosen);
  // El token de usuario (cifrado): con él se publica en el Instagram unido a la página.
  const user = data.userToken ? { userToken: seal(data.userToken), userTokenExpiresAt: data.userTokenExpiresAt } : {};
  return { ...acc, ownerIds: data.ownerIds, extra: { ...acc.extra, pages, ...user } };
}

/** El Instagram unido a la página de Facebook conectada (si hay): con él se publica en Instagram sin conectarlo aparte. */
function instagramViaFacebook(rows) {
  const fb = rows.find((r) => r.platform === 'facebook');
  if (!fb) return null;
  const extra = parseExtra(fb);
  return extra.igBusinessId ? { igBusinessId: extra.igBusinessId, igUsername: extra.igUsername || null, pageName: fb.account_name, updated_at: fb.updated_at } : null;
}

/** Lo que la app ve de las páginas (sin tokens). */
const publicPages = (extra) => (extra.pages || []).map((p) => ({
  id: p.id, name: p.name, avatar: p.avatar || null, hasInstagram: !!p.igBusinessId, instagram: p.igUsername ? `@${p.igUsername}` : null,
}));

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070d;color:#f1f1f7;font:16px "Segoe UI",system-ui,sans-serif}
.c{text-align:center;padding:36px 40px;border-radius:20px;background:rgba(30,30,50,.8);border:1px solid rgba(255,255,255,.1);max-width:480px;margin:24px}
.i{font-size:56px}h1{margin:10px 0 6px}p{color:#a5a5c0;margin:8px 0}.es{font-size:13px;color:#7c7c99;border-top:1px solid rgba(255,255,255,.08);margin-top:18px;padding-top:12px}
.brand{font-weight:700;color:#c4b5fd;letter-spacing:.3px;margin-bottom:6px}
form{text-align:left;margin-top:18px}.pg{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);margin:10px 0;cursor:pointer;background:rgba(255,255,255,.03)}
.pg:hover{border-color:#8b5cf6}.pg input{width:20px;height:20px;accent-color:#8b5cf6}.pg img,.pg .ph{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#1877f2;display:grid;place-items:center;font-weight:700}
.pg b{display:block}.pg small{color:#a5a5c0}.pg:has(input:checked){border-color:#8b5cf6;background:rgba(139,92,246,.12)}
button{width:100%;margin-top:14px;padding:14px;border:0;border-radius:12px;background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;font:600 16px "Segoe UI",system-ui,sans-serif;cursor:pointer}`;

/**
 * Páginas que ve el navegador al volver de la red. Van en inglés (las revisa Meta) con el español debajo.
 * en / es: [título, texto]. `body`: HTML extra (por ejemplo, la lista de páginas para elegir).
 */
function page({ en, es }, ok, body = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(en[0])} · ClipViral</title>
<style>${STYLE}</style></head>
<body><div class="c"><div class="brand">▶ ClipViral</div><div class="i">${ok === null ? '📘' : ok ? '✅' : '⚠️'}</div><h1>${h(en[0])}</h1><p>${en[1]}</p>${body}
${ok === null ? '' : '<p>You can close this window and go back to ClipViral.</p>'}
<div class="es"><b>${h(es[0])}</b><br>${es[1]}${ok === null ? '' : '<br>Ya puedes cerrar esta ventana y volver a ClipViral.'}</div></div></body></html>`;
}

// Facebook: después de autorizar, la persona elige en qué página publicar. Mientras tanto la conexión espera aquí (15 min).
const pendingPicks = new Map();
function savePick(userId, data) {
  for (const [k, v] of pendingPicks) if (Date.now() - v.createdAt > STATE_TTL) pendingPicks.delete(k);
  const id = crypto.randomBytes(24).toString('hex');
  pendingPicks.set(id, { userId, data, createdAt: Date.now() });
  return id;
}

function pickPage(pick, data, selected) {
  const options = data.pages.map((p, i) => `<label class="pg"><input type="radio" name="pageId" value="${h(p.id)}" ${(selected ? p.id === selected : i === 0) ? 'checked' : ''}>
    ${p.avatar ? `<img src="${h(p.avatar)}" alt="">` : `<span class="ph">${h((p.name || '?')[0])}</span>`}
    <span><b>${h(p.name)}</b><small>${p.igUsername ? `Instagram: @${h(p.igUsername)}` : p.igBusinessId ? 'Instagram account linked' : 'No Instagram account linked'}</small></span></label>`).join('');
  return page({
    en: ['Choose your Facebook Page', 'ClipViral will publish your Reels to the Page you choose. You can change it later in the app (Networks).'],
    es: ['Elige tu página de Facebook', 'ClipViral publicará tus Reels en la página que elijas. Puedes cambiarla después en la app (Redes).'],
  }, null, `<form method="post" action="pick"><input type="hidden" name="pick" value="${h(pick)}">${options}
    <button type="submit">Publish to this Page · Publicar en esta página</button></form>`);
}

// Instagram: tipo de cuenta profesional (lo devuelve /me como account_type).
const IG_TYPE = { BUSINESS: ['Business account', 'cuenta de empresa'], MEDIA_CREATOR: ['Creator account', 'cuenta de creador'] };

const connectedPage = (p, data) => {
  const type = IG_TYPE[data.extra?.accountType];
  return page({
    en: [`${p.name} connected`, `Account: <b>${h(data.accountName)}</b>${type ? ` · ${type[0]}` : ''}`],
    es: [`${p.name} conectado`, `Cuenta: <b>${h(data.accountName)}</b>${type ? ` · ${type[1]}` : ''}`],
  }, true);
};

// Videos que pasan un momento por el servidor para que Instagram los descargue.
router.use('/relay', relayRoutes);

// Lista de redes y si el usuario ya las conectó.
router.get('/', requireAuth, (req, res) => {
  // Publicar en redes es solo para administradores (la app de Meta/TikTok está en modo desarrollo).
  if (req.user.role !== 'admin') return res.json({ platforms: [], publicar: false });
  const rows = db.prepare('SELECT platform, account_id, account_name, avatar, extra, scope_v, updated_at FROM social_accounts WHERE user_id = ?').all(req.user.id);
  const viaFb = instagramViaFacebook(rows);
  res.json({
    platforms: Object.entries(PROVIDERS).map(([id, p]) => {
      const acc = rows.find((r) => r.platform === id);
      const extra = acc ? parseExtra(acc) : {};
      // Instagram sin conexión propia, pero unido a la página de Facebook conectada: se publica a través de la página.
      if (id === 'instagram' && !acc && viaFb) {
        return {
          id, name: p.name, configured: true, connected: true, viaFacebook: true, connectedAt: viaFb.updated_at, needsReconnect: false,
          account: { name: viaFb.igUsername ? `@${viaFb.igUsername}` : 'Instagram de tu página', avatar: null, username: viaFb.igUsername, accountType: null, viaFacebook: true, pageName: viaFb.pageName },
        };
      }
      return {
        id, name: p.name, configured: p.configured(), connected: !!acc,
        // Cambia cada vez que se conecta (la app espera a que cambie para saber que terminó).
        connectedAt: acc?.updated_at || null,
        account: acc ? {
          name: acc.account_name, avatar: acc.avatar, igBusinessId: extra.igBusinessId || null,
          // Facebook: las páginas que administra, en cuál se publica y el Instagram unido a ella.
          ...(id === 'facebook' ? { pageId: acc.account_id, pages: publicPages(extra), instagram: extra.igUsername ? `@${extra.igUsername}` : null } : {}),
          // Instagram: @usuario y tipo de cuenta (BUSINESS = empresa, MEDIA_CREATOR = creador).
          ...(id === 'instagram' ? { username: extra.username || null, accountType: extra.accountType || null } : {}),
        } : null,
        // Conectada antes de que pidiéramos permisos de estadísticas: sube igual, pero no se pueden leer sus números.
        needsReconnect: !!acc && (acc.scope_v || 1) < (SCOPE_VERSION[id] || 1),
      };
    }),
  });
});

// La app pide el enlace para conectar una cuenta y lo abre en el navegador.
router.post('/:platform/start', requireAdmin, (req, res) => {
  const p = provider(req, res);
  if (!p) return;
  if (!p.configured()) return res.status(503).json({ error: `La conexión con ${p.name} todavía no está activada. Contacta a soporte.` });
  if (!planInfo(req.user).active) return res.status(402).json({ error: 'Tu plan venció. Renuévalo para conectar redes.' });
  db.prepare('DELETE FROM social_states WHERE created_at < ?').run(Date.now() - STATE_TTL);
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO social_states (state, user_id, platform, created_at) VALUES (?, ?, ?, ?)').run(state, req.user.id, req.params.platform, Date.now());
  res.json({ url: p.authUrl(state) });
});

// La red social nos devuelve aquí después de que el usuario acepta.
router.get('/:platform/callback', async (req, res) => {
  const p = PROVIDERS[req.params.platform];
  if (!p) return res.status(404).send(page({ en: ['Network not supported', 'This link is not valid.'], es: ['Red no soportada', 'Este enlace no es válido.'] }, false));
  const state = String(req.query.state || '');
  const row = db.prepare('SELECT * FROM social_states WHERE state = ? AND platform = ?').get(state, req.params.platform);
  if (row) db.prepare('DELETE FROM social_states WHERE state = ?').run(state);
  if (!row || Date.now() - row.created_at > STATE_TTL) {
    return res.status(400).send(page({ en: ['This link expired', 'Go back to the app and click "Connect" again.'], es: ['El enlace venció', 'Vuelve a la app y toca "Conectar" otra vez.'] }, false));
  }
  if (req.query.error || !req.query.code) {
    return res.status(400).send(page({ en: ['Not connected', 'You cancelled the permission or the network returned an error.'], es: ['No se conectó', 'Cancelaste el permiso o la red social dio un error.'] }, false));
  }
  try {
    const data = await p.exchange(String(req.query.code));
    // Facebook: primero la persona elige en qué página publicar (se ve en el video para la revisión de Meta).
    if (Array.isArray(data.pages)) return res.send(pickPage(savePick(row.user_id, data), data, previousPageId(row.user_id)));
    saveAccount(row.user_id, req.params.platform, data, SCOPE_VERSION[req.params.platform] || 1);
    res.send(connectedPage(p, data));
  } catch (err) {
    console.error(`Error conectando ${p.name}:`, err.message);
    const msg = h(String(err.message).slice(0, 300));
    res.status(502).send(page({ en: ['Could not connect', msg], es: ['No se pudo conectar', msg] }, false));
  }
});

// Facebook: la persona eligió la página en el navegador. Recién aquí queda conectada.
router.post('/facebook/pick', express.urlencoded({ extended: false, limit: '8kb' }), (req, res) => {
  const pick = pendingPicks.get(String(req.body?.pick || ''));
  if (!pick || Date.now() - pick.createdAt > STATE_TTL) {
    return res.status(400).send(page({ en: ['This link expired', 'Go back to the app and click "Connect" again.'], es: ['El enlace venció', 'Vuelve a la app y toca "Conectar" otra vez.'] }, false));
  }
  const pageId = String(req.body?.pageId || '');
  if (!pick.data.pages.some((pg) => pg.id === pageId)) return res.status(400).send(pickPage(req.body.pick, pick.data, null));
  pendingPicks.delete(req.body.pick);
  const data = withPages(pick.userId, pick.data, pageId);
  saveAccount(pick.userId, 'facebook', data, SCOPE_VERSION.facebook || 1);
  res.send(page({
    en: ['Facebook connected', `ClipViral will publish to the Page <b>${h(data.accountName)}</b>.${data.extra.igUsername ? `<br>Linked Instagram: <b>@${h(data.extra.igUsername)}</b>` : ''}`],
    es: ['Facebook conectado', `ClipViral publicará en la página <b>${h(data.accountName)}</b>.${data.extra.igUsername ? ` Instagram unido: <b>@${h(data.extra.igUsername)}</b>` : ''}`],
  }, true));
});

// Uso personal: conectar pegando un token sacado de las herramientas de Meta (sin el botón de inicio de sesión,
// que en apps nuevas pide verificar el negocio). Solo sirve con las cuentas de quien tiene un rol en la app de Meta.
router.post('/:platform/manual', requireAdmin, async (req, res) => {
  const p = PROVIDERS[req.params.platform];
  if (!p?.fromToken) return res.status(404).json({ error: 'Esta red no se puede conectar con un token' });
  if (!p.configured()) return res.status(503).json({ error: `Primero pega el identificador y la clave secreta de la app de ${p.name} en el panel de admin (Ajustes → Conexión con redes).` });
  if (!planInfo(req.user).active) return res.status(402).json({ error: 'Tu plan venció. Renuévalo para conectar redes.' });
  const token = String(req.body?.token || '').trim();
  if (token.length < 30 || /\s/.test(token)) return res.status(400).json({ error: 'Ese token no parece completo. Cópialo de nuevo, entero (es un texto largo sin espacios).' });
  try {
    const { warnings = [], ...raw } = await p.fromToken(token);
    const data = withPages(req.user.id, raw);
    saveAccount(req.user.id, req.params.platform, data, SCOPE_VERSION[req.params.platform] || 1);
    res.json({
      ok: true, account: data.accountName, warnings,
      ...(data.extra?.pages ? { pageId: data.accountId, pages: publicPages(data.extra) } : {}),
    });
  } catch (err) {
    console.error(`Error conectando ${p.name} con token:`, err.message);
    res.status(400).json({ error: String(err.message).slice(0, 400) });
  }
});

const httpError = (status, message, more = {}) => Object.assign(new Error(message), { status, ...more });

/**
 * Un token vigente para subir a una red (lo renueva si está por vencer). Lo usan la app, para subir desde la PC,
 * y el propio servidor, para las publicaciones programadas (publicaciones.js). Los errores traen `status` y, si hay que
 * volver a conectar la red, `reconnect`.
 */
export async function platformToken(user, platform) {
  const p = PROVIDERS[platform];
  if (!p) throw httpError(404, 'Red social no soportada');
  if (!planInfo(user).active) throw httpError(402, 'Tu plan venció. Renuévalo para subir a redes.');
  const row = db.prepare('SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?').get(user.id, platform);
  if (!row && platform === 'instagram') {
    // Instagram a través de la página de Facebook (API de Instagram con inicio de sesión con Facebook): token de la página.
    const fb = db.prepare("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(user.id);
    const via = fb ? instagramViaFacebook([fb]) : null;
    if (via) {
      // Meta pide el token de usuario para subir el video a Instagram. Si no hay (conexiones viejas), el de la página.
      const fx = parseExtra(fb);
      let token = open(fb.access_token);
      let expiresAt = fb.expires_at;
      if (fx.userToken) {
        if ((fx.userTokenExpiresAt || 0) < Date.now()) {
          throw httpError(401, 'La conexión de Facebook que usa Instagram venció (dura unos 60 días). En Redes, desconecta Facebook y conéctalo otra vez con un token nuevo.', { reconnect: true });
        }
        try { token = open(fx.userToken); expiresAt = fx.userTokenExpiresAt; } catch {}
      }
      return { accessToken: token, accountId: via.igBusinessId, accountName: via.igUsername ? `@${via.igUsername}` : 'Instagram', expiresAt, extra: { via: 'facebook', pageId: fb.account_id } };
    }
  }
  if (!row) throw httpError(404, `Conecta tu cuenta de ${p.name} primero`);
  let acc = { accessToken: open(row.access_token), refreshToken: open(row.refresh_token), expiresAt: row.expires_at };
  const window = (p.refreshWindowSec || 300) * 1000;
  if (acc.expiresAt - Date.now() < window) {
    try {
      const fresh = await p.refresh(acc);
      saveAccount(user.id, platform, { ...fresh, accountId: row.account_id, accountName: row.account_name, avatar: row.avatar });
      acc = { ...fresh, expiresAt: Date.now() + (Number(fresh.expiresIn) || 3600) * 1000 };
    } catch (err) {
      if (acc.expiresAt < Date.now()) throw httpError(401, `La conexión con ${p.name} venció. Vuelve a conectarla.`, { reconnect: true });
    }
  }
  const { pages, userToken, userTokenExpiresAt, ...extra } = parseExtra(row);
  return { accessToken: acc.accessToken, accountId: row.account_id, accountName: row.account_name, expiresAt: acc.expiresAt, extra };
}

// La app pide un token vigente para subir el video directo desde la PC.
router.post('/:platform/token', requireAdmin, async (req, res) => {
  try {
    res.json(await platformToken(req.user, req.params.platform));
  } catch (err) {
    if (!err.status) throw err;
    res.status(err.status).json({ error: err.message, ...(err.reconnect ? { reconnect: true } : {}) });
  }
});

// Facebook: el cliente elige en qué página publicar (de las que administra).
router.post('/facebook/page', requireAdmin, (req, res) => {
  const row = db.prepare("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Conecta tu cuenta de Facebook primero' });
  const extra = parseExtra(row);
  const chosen = (extra.pages || []).find((p) => p.id === String(req.body?.pageId || ''));
  if (!chosen) return res.status(404).json({ error: 'No encontré esa página. Vuelve a conectar Facebook.' });
  db.prepare(`UPDATE social_accounts SET account_id = ?, account_name = ?, avatar = ?, access_token = ?, refresh_token = ?, extra = ?, updated_at = datetime('now')
    WHERE user_id = ? AND platform = 'facebook'`)
    .run(chosen.id, chosen.name, chosen.avatar || null, chosen.token, chosen.token,
      JSON.stringify({ ...extra, igBusinessId: chosen.igBusinessId || null, igUsername: chosen.igUsername || null, pageId: chosen.id }), req.user.id);
  res.json({ ok: true, pageId: chosen.id, name: chosen.name });
});

// La app avisa si una subida salió bien o mal (para las estadísticas del admin).
router.post('/:platform/log', requireAdmin, (req, res) => {
  if (!PROVIDERS[req.params.platform]) return res.status(404).json({ error: 'Red social no soportada' });
  db.prepare('INSERT INTO uploads_log (user_id, platform, ok) VALUES (?, ?, ?)').run(req.user.id, req.params.platform, req.body?.ok ? 1 : 0);
  res.json({ ok: true });
});

// Desconectar: se borra la cuenta (tokens incluidos) y, si la red lo permite, se le avisa para que el permiso deje de valer.
router.delete('/:platform', requireAdmin, async (req, res) => {
  const p = PROVIDERS[req.params.platform];
  const row = db.prepare('SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?').get(req.user.id, req.params.platform);
  db.prepare('DELETE FROM social_accounts WHERE user_id = ? AND platform = ?').run(req.user.id, req.params.platform);
  // Lo que el servidor tenía programado para esa red ya no se publica (Instagram por la página se va con Facebook).
  const nets = req.params.platform === 'facebook' && !db.prepare("SELECT 1 FROM social_accounts WHERE user_id = ? AND platform = 'instagram'").get(req.user.id)
    ? ['facebook', 'instagram'] : [req.params.platform];
  db.prepare(`UPDATE posts SET status = 'cancelado', note = 'Cancelado al desconectar la red', updated_at = ?
    WHERE user_id = ? AND status IN ('pendiente', 'tarde') AND platform IN (${nets.map(() => '?').join(',')})`).run(Date.now(), req.user.id, ...nets);
  if (row && p?.revoke) {
    let accessToken = null;
    try { accessToken = open(row.access_token); } catch {}
    if (accessToken) await p.revoke({ accessToken }).catch((err) => console.error(`No se pudo revocar ${p.name}:`, err.message));
  }
  res.json({ ok: true });
});

export default router;
