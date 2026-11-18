import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, RELEASES_DIR, currentPeriod, getSetting, setSetting, planInfo } from '../db.js';
import { requireAdmin, hashPassword } from '../auth.js';
import { aiEnabled } from '../claude.js';
import { keyStatus, saveKey, removeKey } from '../clave.js';
import { PROVIDERS, redirectUri } from '../social.js';
import { socialChecklist } from '../checklist.js';
import { mailConfig, saveMailConfig, sendMail, mailEnabled } from '../correo.js';
import { paypalConfig, savePaypalConfig, testPaypal, paymentsEnabled, MONTH_DAYS } from '../pagos.js';
import { descargaInfo, guardarDescarga, borrarDescarga } from '../descarga.js';

const router = Router();
router.use(requireAdmin);

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const upload = multer({
  storage: multer.diskStorage({
    destination: RELEASES_DIR,
    filename: (req, file, cb) => cb(null, `subida-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname) || '.exe'}`),
  }),
  limits: { fileSize: 800 * 1024 * 1024 },
});

function userRow(u) {
  const plan = planInfo(u);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, banned: !!u.banned,
    plan: u.plan, planName: plan.name, planActive: plan.active, planExpires: u.plan_expires,
    aiHoursUsed: +(plan.aiSecondsUsed / 3600).toFixed(2), aiHours: plan.aiHours,
    createdAt: u.created_at, lastLogin: u.last_login,
    clips: db.prepare('SELECT COUNT(*) AS n FROM clip_events WHERE user_id = ?').get(u.id).n,
    paid: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE user_id = ? AND status = 'pagado'").get(u.id).s,
  };
}

router.get('/stats', (req, res) => {
  const period = currentPeriod();
  const users = db.prepare('SELECT * FROM users').all();
  const plans = Object.fromEntries(db.prepare('SELECT * FROM plans').all().map((p) => [p.id, p]));
  let paying = 0;
  let mrr = 0;
  const byPlan = {};
  for (const u of users) {
    const info = planInfo(u);
    const key = info.active ? u.plan : 'vencido';
    byPlan[key] = (byPlan[key] || 0) + 1;
    if (info.active && u.role !== 'admin' && (plans[u.plan]?.price_usd || 0) > 0) {
      paying += 1;
      mrr += plans[u.plan].price_usd;
    }
  }
  const usage = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(seconds),0) AS seconds, COUNT(*) AS calls
    FROM ai_usage WHERE substr(created_at,1,7) = ?`).get(period);
  const signups = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM users
    WHERE created_at >= datetime('now','-13 days') GROUP BY day ORDER BY day`).all();
  const aiDaily = db.prepare(`SELECT substr(created_at,1,10) AS day, SUM(cost_usd) AS cost, SUM(seconds) AS seconds FROM ai_usage
    WHERE created_at >= datetime('now','-13 days') GROUP BY day ORDER BY day`).all();
  const recent = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 6').all().map(userRow);
  const latest = db.prepare('SELECT version, created_at, downloads FROM releases ORDER BY id DESC LIMIT 1').get() || null;
  // Clips sacados desde la app (todas las cuentas).
  const clipsTotal = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(seconds),0) AS s FROM clip_events').get();
  const clipsToday = db.prepare("SELECT COUNT(*) AS n FROM clip_events WHERE created_at >= datetime('now','start of day')").get().n;
  const clips7d = db.prepare("SELECT COUNT(*) AS n FROM clip_events WHERE created_at >= datetime('now','-7 days')").get().n;
  const clipsDaily = db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS n FROM clip_events
    WHERE created_at >= datetime('now','-13 days') GROUP BY day ORDER BY day`).all();
  const clipsByMode = Object.fromEntries(db.prepare('SELECT mode, COUNT(*) AS n FROM clip_events GROUP BY mode').all().map((r) => [r.mode, r.n]));
  const topClippers = db.prepare(`SELECT u.name, u.email, COUNT(*) AS n FROM clip_events c JOIN users u ON u.id = c.user_id
    GROUP BY c.user_id ORDER BY n DESC LIMIT 5`).all();
  // Cobros con PayPal.
  const incomeMonth = db.prepare("SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM payments WHERE status = 'pagado' AND substr(paid_at,1,7) = ?").get(period);
  const incomeTotal = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'pagado'").get().s;
  const incomeDaily = db.prepare(`SELECT substr(paid_at,1,10) AS day, SUM(amount) AS s FROM payments
    WHERE status = 'pagado' AND paid_at >= datetime('now','-13 days') GROUP BY day ORDER BY day`).all();
  res.json({
    totalUsers: users.length,
    newUsers7d: users.filter((u) => Date.now() - new Date(u.created_at.replace(' ', 'T') + 'Z').getTime() < 7 * 86400000).length,
    paying,
    mrr,
    aiCostMonth: usage.cost,
    aiHoursMonth: usage.seconds / 3600,
    aiCallsMonth: usage.calls,
    profitMonth: mrr - usage.cost,
    byPlan,
    signups,
    aiDaily,
    recent,
    latestRelease: latest,
    aiEnabled: aiEnabled(),
    clipsTotal: clipsTotal.n, clipsHours: clipsTotal.s / 3600, clipsToday, clips7d, clipsDaily, clipsByMode, topClippers,
    incomeMonth: incomeMonth.s, paymentsMonth: incomeMonth.n, incomeTotal, incomeDaily,
    paymentsEnabled: paymentsEnabled(), mailEnabled: mailEnabled(),
  });
});

router.get('/users', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare('SELECT * FROM users WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC LIMIT 500').all(q, q);
  res.json({ users: rows.map(userRow) });
});

router.patch('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const b = req.body || {};
  if (b.plan !== undefined) {
    if (!db.prepare('SELECT 1 FROM plans WHERE id = ?').get(b.plan)) return res.status(400).json({ error: 'Plan no válido' });
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(b.plan, id);
  }
  if (b.addDays !== undefined) {
    const days = Number(b.addDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650) return res.status(400).json({ error: 'Días no válidos' });
    const base = user.plan_expires && new Date(user.plan_expires) > new Date() ? new Date(user.plan_expires) : new Date();
    db.prepare('UPDATE users SET plan_expires = ? WHERE id = ?').run(new Date(base.getTime() + days * 86400000).toISOString(), id);
  }
  if (b.planExpires !== undefined) {
    const value = b.planExpires ? new Date(b.planExpires) : null;
    if (value && Number.isNaN(value.getTime())) return res.status(400).json({ error: 'Fecha no válida' });
    db.prepare('UPDATE users SET plan_expires = ? WHERE id = ?').run(value ? value.toISOString() : null, id);
  }
  if (b.banned !== undefined) {
    if (id === req.user.id) return res.status(400).json({ error: 'No puedes suspender tu propia cuenta' });
    db.prepare('UPDATE users SET banned = ? WHERE id = ?').run(b.banned ? 1 : 0, id);
    if (b.banned) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) return res.status(400).json({ error: 'Rol no válido' });
    if (id === req.user.id && b.role !== 'admin') return res.status(400).json({ error: 'No puedes quitarte el rol de admin' });
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, id);
  }
  if (b.resetUsage) db.prepare('UPDATE users SET ai_seconds = 0 WHERE id = ?').run(id);
  if (b.newPassword) {
    if (String(b.newPassword).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(String(b.newPassword)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  const after = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  // "Avisar por correo": si cambió el plan o el vencimiento, el cliente recibe un correo con su licencia nueva.
  if (b.notify && (after.plan !== user.plan || after.plan_expires !== user.plan_expires)) {
    const cambio = b.addDays ? `Te sumamos ${Number(b.addDays)} días de licencia.` : after.plan !== user.plan ? 'Cambiamos tu plan.' : 'Actualizamos la fecha de tu licencia.';
    sendMail(after, 'licencia', { planName: planInfo(after).name, expires: after.plan_expires, cambio }).catch(() => {});
  }
  res.json({ user: userRow(after) });
});

// Detalle de una cuenta: pagos, clips y correos.
router.get('/users/:id/detalle', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({
    user: userRow(user),
    payments: db.prepare("SELECT order_id, plan, months, amount, status, paid_at, created_at, expires_after FROM payments WHERE user_id = ? AND status != 'creado' ORDER BY id DESC LIMIT 30").all(id),
    clipsByMode: Object.fromEntries(db.prepare('SELECT mode, COUNT(*) AS n FROM clip_events WHERE user_id = ? GROUP BY mode').all(id).map((r) => [r.mode, r.n])),
    clipsLast: db.prepare('SELECT created_at FROM clip_events WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(id)?.created_at || null,
    mails: db.prepare('SELECT kind, subject, ok, error, created_at FROM mail_log WHERE user_id = ? ORDER BY id DESC LIMIT 15').all(id),
  });
});

// Pago registrado a mano (efectivo, transferencia…): suma meses igual que PayPal.
router.post('/users/:id/pago-manual', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(String(req.body?.plan || user.plan));
  const months = Math.max(1, Math.min(24, Math.round(Number(req.body?.months) || 1)));
  const amount = Number(req.body?.amount ?? (plan?.price_usd || 0) * months);
  if (!plan || !Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Revisa el plan y el monto' });
  const base = user.plan === plan.id && user.plan_expires && new Date(user.plan_expires) > new Date() ? new Date(user.plan_expires).getTime() : Date.now();
  const expires = new Date(base + months * MONTH_DAYS * 86400000).toISOString();
  db.prepare('UPDATE users SET plan = ?, plan_expires = ? WHERE id = ?').run(plan.id, expires, id);
  db.prepare(`INSERT INTO payments (user_id, provider, order_id, plan, months, amount, status, expires_before, expires_after, note, paid_at)
    VALUES (?, 'manual', ?, ?, ?, ?, 'pagado', ?, ?, ?, datetime('now'))`)
    .run(id, `manual-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, plan.id, months, amount, user.plan_expires, expires, String(req.body?.note || '').slice(0, 200) || null);
  const after = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (req.body?.notify !== false) sendMail(after, 'pago', { planName: plan.name, amount: amount.toFixed(2), expires }).catch(() => {});
  res.json({ user: userRow(after) });
});

// ---------- Pagos con PayPal ----------
router.get('/pagos', (req, res) => {
  const rows = db.prepare(`SELECT p.*, u.name, u.email FROM payments p JOIN users u ON u.id = p.user_id
    WHERE p.status != 'creado' ORDER BY p.id DESC LIMIT 300`).all();
  res.json({ config: paypalConfig(), enabled: paymentsEnabled(), payments: rows });
});
router.put('/pagos/config', (req, res) => res.json({ config: savePaypalConfig(req.body || {}), enabled: paymentsEnabled() }));
router.post('/pagos/probar', async (req, res) => {
  try { res.json(await testPaypal()); } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------- Correos ----------
router.get('/correo', (req, res) => {
  res.json({
    config: mailConfig(), enabled: mailEnabled(),
    log: db.prepare('SELECT email, kind, subject, ok, error, created_at FROM mail_log ORDER BY id DESC LIMIT 60').all(),
  });
});
router.put('/correo/config', (req, res) => res.json({ config: saveMailConfig(req.body || {}), enabled: mailEnabled() }));
router.post('/correo/prueba', async (req, res) => {
  const to = String(req.body?.to || req.user.email);
  const r = await sendMail({ id: req.user.id, email: to, name: req.user.name }, 'prueba');
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, to });
});

/** A quiénes va un aviso: todos, activos, vencidos, un plan o una sola cuenta. */
function audience(to) {
  const users = db.prepare("SELECT * FROM users WHERE banned = 0 AND role != 'admin'").all();
  if (to === 'todos') return users;
  if (to === 'activos') return users.filter((u) => planInfo(u).active);
  if (to === 'vencidos') return users.filter((u) => !planInfo(u).active);
  if (String(to).startsWith('plan:')) return users.filter((u) => u.plan === String(to).slice(5));
  if (String(to).startsWith('user:')) return db.prepare('SELECT * FROM users WHERE id = ?').all(Number(String(to).slice(5)));
  return [];
}
router.post('/correo/aviso', async (req, res) => {
  const subject = String(req.body?.subject || '').trim().slice(0, 150);
  const message = String(req.body?.message || '').trim().slice(0, 5000);
  if (!subject || !message) return res.status(400).json({ error: 'Escribe el asunto y el mensaje' });
  if (!mailEnabled()) return res.status(400).json({ error: 'Primero configura el correo (Gmail) en esta misma pestaña.' });
  const list = audience(req.body?.to || 'todos');
  if (!list.length) return res.status(400).json({ error: 'No hay cuentas para ese grupo' });
  if (req.body?.preview) return res.json({ count: list.length });
  // Se envían de a uno, en segundo plano (Gmail no deja mandar cientos de golpe).
  (async () => { for (const u of list) { await sendMail(u, 'aviso', { subject, message }); await new Promise((r) => setTimeout(r, 400)); } })().catch(() => {});
  res.json({ ok: true, count: list.length });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes borrar tu propia cuenta' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.get('/plans', (req, res) => {
  res.json({ plans: db.prepare('SELECT * FROM plans ORDER BY sort').all() });
});

router.put('/plans/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  const b = req.body || {};
  const name = String(b.name ?? plan.name).trim().slice(0, 40);
  const price = Number(b.price_usd ?? plan.price_usd);
  const hours = Math.round(Number(b.ai_hours ?? plan.ai_hours));
  const description = String(b.description ?? plan.description).trim().slice(0, 400);
  if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(hours) || hours < 0) {
    return res.status(400).json({ error: 'Revisa nombre, precio y horas' });
  }
  db.prepare('UPDATE plans SET name = ?, price_usd = ?, ai_hours = ?, description = ?, public = ? WHERE id = ?')
    .run(name, price, hours, description, b.public === undefined ? plan.public : (b.public ? 1 : 0), plan.id);
  res.json({ plan: db.prepare('SELECT * FROM plans WHERE id = ?').get(plan.id) });
});

router.get('/releases', (req, res) => {
  res.json({ releases: db.prepare('SELECT * FROM releases ORDER BY id DESC').all() });
});

router.post('/releases', upload.single('file'), async (req, res) => {
  const file = req.file;
  const cleanup = () => file && fs.rmSync(file.path, { force: true });
  const version = String(req.body?.version || '').trim().replace(/^v/i, '');
  if (!file) return res.status(400).json({ error: 'Sube el instalador (.exe)' });
  if (!VERSION_RE.test(version)) { cleanup(); return res.status(400).json({ error: 'La versión debe tener el formato 1.2.3' }); }
  if (db.prepare('SELECT 1 FROM releases WHERE version = ?').get(version)) { cleanup(); return res.status(409).json({ error: 'Esa versión ya existe' }); }

  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(file.path).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject);
  });
  const finalName = `ClipViral-${version}${path.extname(file.originalname) || '.exe'}`;
  fs.renameSync(file.path, path.join(RELEASES_DIR, finalName));
  db.prepare(`INSERT INTO releases (version, notes, filename, original_name, size, sha256, mandatory) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(version, String(req.body?.notes || '').slice(0, 4000), finalName, finalName, file.size, hash.digest('hex'),
      req.body?.mandatory === 'true' || req.body?.mandatory === '1' ? 1 : 0);
  res.status(201).json({ ok: true });
});

// El .zip para el botón "Descargar ClipViral" de la web.
router.get('/descarga', (req, res) => res.json({ descarga: descargaInfo() }));
router.post('/descarga', upload.single('zip'), async (req, res, next) => {
  const file = req.file;
  try {
    const version = String(req.body?.version || '').trim().replace(/^v/i, '') || (file?.originalname.match(/(\d+\.\d+\.\d+)/) || [])[1] || '';
    if (!file) return res.status(400).json({ error: 'Sube el .zip para la web' });
    if (!/\.zip$/i.test(file.originalname)) { fs.rmSync(file.path, { force: true }); return res.status(400).json({ error: 'Para la web sube un archivo .zip' }); }
    if (!VERSION_RE.test(version)) { fs.rmSync(file.path, { force: true }); return res.status(400).json({ error: 'Pon la versión (formato 1.2.3)' }); }
    res.status(201).json({ descarga: await guardarDescarga(file.path, { version, originalName: file.originalname }) });
  } catch (err) {
    if (file) fs.rmSync(file.path, { force: true });
    next(err);
  }
});
router.delete('/descarga', (req, res) => { borrarDescarga(); res.json({ ok: true }); });

router.delete('/releases/:id', (req, res) => {
  const release = db.prepare('SELECT * FROM releases WHERE id = ?').get(Number(req.params.id));
  if (!release) return res.status(404).json({ error: 'Versión no encontrada' });
  fs.rmSync(path.join(RELEASES_DIR, release.filename), { force: true });
  db.prepare('DELETE FROM releases WHERE id = ?').run(release.id);
  res.json({ ok: true });
});

const SETTING_KEYS = ['trial_days', 'payment_link', 'support_contact', 'announcement', 'public_url',
  'google_client_id', 'tiktok_client_key', 'instagram_app_id', 'facebook_app_id', 'facebook_config_id',
  // Datos que salen en la política de privacidad y los términos (los piden TikTok y Meta).
  'legal_name', 'legal_email', 'legal_country'];
// Los secretos nunca se devuelven completos al panel.
const SECRET_KEYS = ['google_client_secret', 'tiktok_client_secret', 'instagram_app_secret', 'facebook_app_secret'];
const MASK = '••••••';

router.get('/settings', (req, res) => {
  const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)]));
  for (const k of SECRET_KEYS) {
    const v = getSetting(k);
    settings[k] = v ? `${MASK}${v.slice(-4)}` : '';
  }
  res.json({
    settings,
    aiEnabled: aiEnabled(),
    redirects: Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, redirectUri(p)])),
    social: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, p.configured()])),
    uploads: db.prepare(`SELECT platform, SUM(ok) AS ok, COUNT(*) - SUM(ok) AS failed FROM uploads_log
      WHERE substr(created_at,1,7) = ? GROUP BY platform`).all(currentPeriod()),
    // Lo que falta para pedir los permisos de cada red, con las direcciones para copiar.
    checklist: socialChecklist(),
    deletions: db.prepare('SELECT COUNT(*) AS n FROM deletion_requests').get().n,
  });
});

router.put('/settings', (req, res) => {
  for (const key of SETTING_KEYS) {
    if (req.body?.[key] !== undefined) setSetting(key, String(req.body[key]).trim().slice(0, 1000));
  }
  for (const key of SECRET_KEYS) {
    const v = req.body?.[key];
    if (v !== undefined && !String(v).startsWith(MASK)) setSetting(key, String(v).trim().slice(0, 1000));
  }
  res.json({ ok: true });
});

// ---------- Clave de Claude (IA Pro) ----------
// Se guarda cifrada y nunca se devuelve completa. Antes de guardarla se prueba con Claude (sin costo).
router.get('/claude', (req, res) => res.json(keyStatus()));

router.put('/claude', async (req, res) => {
  const result = await saveKey(req.body?.key);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result.status);
});

router.delete('/claude', (req, res) => res.json(removeKey()));

export default router;
