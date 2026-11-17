import { Router } from 'express';
import { db, getSetting, publicUser } from '../db.js';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, createSession, deleteSession, requireAuth, rateLimit } from '../auth.js';
import { sendMail, mailEnabled, mailConfig } from '../correo.js';

const router = Router();
const limiter = rateLimit({ max: 15, windowMs: 15 * 60 * 1000 });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

router.post('/register', limiter, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Escribe tu nombre (2 a 60 letras)' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'El correo no es válido' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  if (req.body?.acceptTerms !== true) {
    return res.status(400).json({ error: 'Debes aceptar los términos y confirmar que tienes permiso para usar el contenido' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  }
  // Versión para clientes: una sola cuenta en su PC, con el plan Claude (su propia clave) y sin vencer:
  // lo que vence es la licencia de la app.
  const cliente = process.env.EDICION === 'cliente';
  if (cliente && db.prepare('SELECT 1 FROM users').get()) return res.status(403).json({ error: 'Esta copia ya tiene su cuenta' });
  // Versión para administradores: solo se crea una cuenta (la del dueño de esa PC) y es administrador.
  const adminApp = process.env.EDICION === 'admin';
  if (adminApp && db.prepare('SELECT 1 FROM users').get()) return res.status(403).json({ error: 'Esta copia ya tiene su administrador. Entra con tu correo y contraseña.' });
  const days = Number(getSetting('trial_days', '3')) || 3;
  const expires = cliente ? null : new Date(Date.now() + days * 86400000).toISOString();
  const passHash = await hashPassword(password);
  const result = db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires, last_login)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`).run(email, name, passHash, adminApp ? 'admin' : 'user', cliente || adminApp ? 'pro' : 'trial', adminApp ? null : expires);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
  const token = createSession(user.id, req.body?.device);
  if (!cliente && !adminApp && mailConfig().auto.bienvenida) sendMail(user, 'bienvenida', { trialDays: days }).catch(() => {});
  res.status(201).json({ token, user: publicUser(user) });
});

router.post('/login', limiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await verifyPassword(password, user.pass_hash))) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  if (user.banned) return res.status(403).json({ error: 'Tu cuenta está suspendida. Contacta a soporte.' });
  db.prepare(`UPDATE users SET last_login = datetime('now') WHERE id = ?`).run(user.id);
  const token = createSession(user.id, req.body?.device);
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', requireAuth, (req, res) => {
  deleteSession(req.token);
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const current = String(req.body?.current || '');
  const next = String(req.body?.next || '');
  if (!(await verifyPassword(current, req.user.pass_hash))) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
  if (next.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
  res.json({ ok: true });
});

// ---------- Olvidé mi contraseña: un código de 6 números por correo ----------
const resetLimiter = rateLimit({ max: 8, windowMs: 15 * 60 * 1000 });
const RESET_MS = 30 * 60 * 1000;
const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

router.post('/olvide', resetLimiter, async (req, res) => {
  if (!mailEnabled()) return res.status(503).json({ error: 'Recuperar la contraseña por correo todavía no está activo. Contacta a soporte.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'El correo no es válido' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // Siempre la misma respuesta: así nadie puede averiguar qué correos tienen cuenta.
  if (user && !user.banned) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    db.prepare(`INSERT INTO password_resets (user_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`)
      .run(user.id, hashCode(code), Date.now() + RESET_MS);
    await sendMail(user, 'codigo', { code });
  }
  res.json({ ok: true });
});

router.post('/restablecer', resetLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const code = String(req.body?.code || '').replace(/\D/g, '');
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const reset = user && db.prepare('SELECT * FROM password_resets WHERE user_id = ?').get(user.id);
  const bad = () => res.status(400).json({ error: 'El código no es correcto o ya venció. Pide uno nuevo.' });
  if (!reset || reset.expires_at < Date.now() || reset.attempts >= 5) return bad();
  if (reset.code_hash !== hashCode(code)) {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
    return bad();
  }
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  sendMail(user, 'clave_cambiada').catch(() => {});
  const token = createSession(user.id, req.body?.device);
  res.json({ token, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

export default router;
