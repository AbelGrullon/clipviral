// Avisos que mandan las redes al servidor (sin sesión de ClipViral: los firma la red).
//   Meta:   /api/meta/<instagram|facebook>/deauthorize    → la persona quitó el permiso a ClipViral
//           /api/meta/<instagram|facebook>/data-deletion  → la persona pidió borrar sus datos
//   TikTok: /api/tiktok/webhook                            → avisos de TikTok (por ejemplo, quitó el permiso)
import express, { Router } from 'express';
import { getSetting } from '../db.js';
import { publicUrl } from '../social.js';
import { parseSignedRequest, verifyTiktokSignature, forgetAccounts, recordDeletion } from '../privacidad.js';

const router = Router();
const urlencoded = express.urlencoded({ extended: false, limit: '64kb' });

// Instagram y Facebook pueden estar en la misma app de Meta pero con claves distintas: se prueba con las dos.
const META_SECRETS = {
  instagram: () => [getSetting('instagram_app_secret'), getSetting('facebook_app_secret')],
  facebook: () => [getSetting('facebook_app_secret'), getSetting('instagram_app_secret')],
};
const KINDS = ['deauthorize', 'data-deletion'];

router.post('/meta/:platform/:kind', urlencoded, (req, res) => {
  const { platform, kind } = req.params;
  if (!META_SECRETS[platform] || !KINDS.includes(kind)) return res.status(404).json({ error: 'No encontrado' });
  const data = parseSignedRequest(req.body?.signed_request, META_SECRETS[platform]());
  if (!data || !data.user_id) return res.status(400).json({ error: 'signed_request no válido' });
  const removed = forgetAccounts(platform, data.user_id);
  console.log(`[privacidad] ${platform} ${kind}: ${removed} cuenta(s) borrada(s)`);
  if (kind === 'deauthorize') return res.json({ ok: true });
  // Meta pide una dirección para ver el estado del pedido y un código de confirmación.
  const code = recordDeletion(platform, removed);
  res.json({ url: `${publicUrl()}/borrar-datos?codigo=${code}`, confirmation_code: code });
});

router.post('/tiktok/webhook', (req, res) => {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
  if (!verifyTiktokSignature(req.get('TikTok-Signature'), raw, getSetting('tiktok_client_secret'))) {
    return res.status(401).json({ error: 'Firma no válida' });
  }
  const ev = req.body || {};
  const key = getSetting('tiktok_client_key');
  // La persona quitó el permiso (o borró su cuenta): TikTok ya anuló el token; borramos lo que guardamos.
  if (ev.event === 'authorization.removed' && ev.user_openid && (!key || !ev.client_key || ev.client_key === key)) {
    const removed = forgetAccounts('tiktok', ev.user_openid);
    console.log(`[privacidad] tiktok authorization.removed: ${removed} cuenta(s) borrada(s)`);
  }
  // TikTok solo necesita un 200 rápido (si no, reintenta).
  res.json({ ok: true });
});

export default router;
