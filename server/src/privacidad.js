// Avisos de las redes cuando una persona quita el permiso o pide borrar sus datos.
// Meta (Instagram y Facebook) manda un "signed_request"; TikTok manda un webhook firmado.
import crypto from 'node:crypto';
import { db } from './db.js';

const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export const toB64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Lee y verifica el signed_request de Meta (firma HMAC-SHA256 con la clave secreta de la app).
 * secrets: claves con las que puede venir firmado. Devuelve el contenido, o null si la firma no es válida.
 */
export function parseSignedRequest(signed, secrets = []) {
  const parts = String(signed || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sig, payload] = parts;
  let data;
  try { data = JSON.parse(fromB64url(payload).toString('utf8')); } catch { return null; }
  if (!data || String(data.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null;
  const got = fromB64url(sig);
  for (const secret of secrets.filter(Boolean)) {
    const want = crypto.createHmac('sha256', secret).update(payload).digest();
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return data;
  }
  return null;
}

/** Arma un signed_request como los de Meta (para las pruebas). */
export function makeSignedRequest(data, secret) {
  const payload = toB64url(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: Math.floor(Date.now() / 1000), ...data }));
  return `${toB64url(crypto.createHmac('sha256', secret).update(payload).digest())}.${payload}`;
}

// TikTok reintenta un aviso hasta 72 horas; aceptamos firmas de hasta 3 días para no perder un pedido de borrado.
const TIKTOK_TOLERANCE_SEC = 3 * 86400;

/**
 * Verifica el encabezado TikTok-Signature ("t=<segundos>,s=<firma>"):
 * la firma es HMAC-SHA256 de "<t>.<cuerpo>" con el client secret.
 */
export function verifyTiktokSignature(header, rawBody, secret, nowMs = Date.now()) {
  if (!secret || !header) return false;
  const fields = Object.fromEntries(String(header).split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const t = Number(fields.t);
  if (!Number.isFinite(t) || !/^[a-f0-9]{64}$/i.test(fields.s || '')) return false;
  if (Math.abs(nowMs / 1000 - t) > TIKTOK_TOLERANCE_SEC) return false;
  const want = crypto.createHmac('sha256', secret).update(`${fields.t}.${rawBody}`).digest();
  return crypto.timingSafeEqual(Buffer.from(fields.s, 'hex'), want);
}

/** Arma el encabezado TikTok-Signature (para las pruebas). */
export function makeTiktokSignature(rawBody, secret, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},s=${crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

/** Guarda los ID de la persona en esa red como ",id1,id2," para poder encontrarla después. */
export const ownerIdsText = (ids) => {
  const clean = [...new Set((ids || []).map((x) => String(x ?? '').trim()).filter(Boolean))];
  return clean.length ? `,${clean.join(',')},` : null;
};

/**
 * Borra las cuentas conectadas de una persona en una red (tokens incluidos).
 * Busca por el ID de la cuenta o por cualquiera de los ID de la persona. Devuelve cuántas se borraron.
 */
export function forgetAccounts(platform, personId) {
  const id = String(personId ?? '').trim();
  if (!id || id.includes(',')) return 0;
  return Number(db.prepare(`DELETE FROM social_accounts WHERE platform = ? AND (account_id = ? OR instr(COALESCE(owner_ids, ''), ?) > 0)`)
    .run(platform, id, `,${id},`).changes);
}

/** Anota un pedido de borrado y devuelve su código (solo letras y números). */
export function recordDeletion(platform, accounts) {
  const code = crypto.randomBytes(8).toString('hex').toUpperCase();
  db.prepare('INSERT INTO deletion_requests (code, platform, accounts) VALUES (?, ?, ?)').run(code, platform, accounts);
  return code;
}

export function findDeletion(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(clean)) return null;
  return db.prepare('SELECT * FROM deletion_requests WHERE code = ?').get(clean) || null;
}
