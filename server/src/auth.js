import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

export function createSession(userId, device) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, device) VALUES (?, ?, ?)')
    .run(sha256(token), userId, String(device || 'desconocido').slice(0, 120));
  return token;
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function readToken(req) {
  const header = req.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** Exige sesión iniciada. Deja el usuario en req.user. */
export function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  const hash = sha256(token);
  const user = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hash);
  if (!user) return res.status(401).json({ error: 'Tu sesión venció. Vuelve a entrar.' });
  if (user.banned) return res.status(403).json({ error: 'Tu cuenta está suspendida. Contacta a soporte.' });
  db.prepare(`UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ?`).run(hash);
  req.user = user;
  req.token = token;
  next();
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo para administradores' });
    next();
  });
}

/** Límite simple de intentos por IP (para login y registro). */
export function rateLimit({ max, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const minutes = Math.ceil((entry.reset - now) / 60000);
      return res.status(429).json({ error: `Demasiados intentos. Espera ${minutes} min.` });
    }
    next();
  };
}
