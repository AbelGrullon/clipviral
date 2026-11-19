import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const RELEASES_DIR = path.join(DATA_DIR, 'releases');
fs.mkdirSync(RELEASES_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'clipviral.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  plan TEXT NOT NULL DEFAULT 'trial',
  plan_expires TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  ai_seconds INTEGER NOT NULL DEFAULT 0,
  ai_period TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_usd REAL NOT NULL,
  ai_hours INTEGER NOT NULL,
  uses_ai INTEGER NOT NULL,
  description TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  public INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS social_accounts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  avatar TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, platform)
);

CREATE TABLE IF NOT EXISTS social_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  ok INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Columnas agregadas después (las bases viejas no las tienen).
function addColumn(table, column, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
// extra: datos propios de cada red (JSON). scope_v: versión de los permisos pedidos al conectar.
addColumn('social_accounts', 'extra', 'TEXT');
addColumn('social_accounts', 'scope_v', 'INTEGER NOT NULL DEFAULT 1');
// owner_ids: los ID de la persona en esa red (",id1,id2,"). Con ellos se borra la cuenta si la persona quita el permiso desde la red.
addColumn('social_accounts', 'owner_ids', 'TEXT');
// claude_key: la clave de Claude propia de cada cuenta (cifrada). El plan Claude usa la del cliente; un admin, la suya si la puso.
addColumn('users', 'claude_key', 'TEXT');
// clave_servidor: 1 = este admin puede usar la clave de Claude del servidor (la del dueño) cuando no tiene la suya.
// Los admins que ya existían la siguen usando; a uno nuevo se la das en el panel (Usuarios → Gestionar).
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'clave_servidor')) {
  db.exec('ALTER TABLE users ADD COLUMN clave_servidor INTEGER NOT NULL DEFAULT 0');
  db.exec("UPDATE users SET clave_servidor = 1 WHERE role = 'admin'");
}

db.exec(`
CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pedidos de borrado de datos que llegan de Meta (Instagram / Facebook). No guarda datos de la persona, solo el código.
CREATE TABLE IF NOT EXISTS deletion_requests (
  code TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  accounts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Videos que pasan un momento por el servidor para que Instagram los descargue (se borran al publicar o en 24 h).
CREATE TABLE IF NOT EXISTS relay_files (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Publicaciones que el servidor sube solo a su hora (aunque la PC esté apagada, si el servidor está en un VPS).
-- El video se guarda una vez por usuario (por su huella sha256) y se borra cuando ya nadie lo necesita.
CREATE TABLE IF NOT EXISTS post_files (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, hash)
);
-- status: pendiente | subiendo | publicado | error | cancelado | tarde (la hora pasó con el servidor apagado y la app elige otra)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT,
  platform TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  reprogramar INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendiente',
  attempts INTEGER NOT NULL DEFAULT 0,
  progress REAL NOT NULL DEFAULT 0,
  note TEXT,
  error TEXT,
  reconnect INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  remote_id TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_due ON posts (status, scheduled_at);

-- Pagos con PayPal. Cada pago aprobado suma un mes (30 días) de licencia del plan pagado.
-- status: creado | pagado | cancelado | error
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paypal',
  order_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL,
  months INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'creado',
  capture_id TEXT,
  payer_email TEXT,
  expires_before TEXT,
  expires_after TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_user ON payments (user_id, created_at);

-- Correos enviados (para el panel). No guarda el contenido, solo a quién, qué tipo y si salió.
CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Códigos para recuperar la contraseña (se guarda solo la huella del código; vence en 30 minutos).
CREATE TABLE IF NOT EXISTS password_resets (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Avisos de vencimiento ya enviados (uno por tipo y por fecha de vencimiento: no se repiten).
CREATE TABLE IF NOT EXISTS license_notices (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind, expires)
);

-- Clips que sacó cada usuario desde la app (para el resumen del panel).
CREATE TABLE IF NOT EXISTS clip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'local',
  seconds REAL NOT NULL DEFAULT 0,
  origin TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS clip_events_day ON clip_events (created_at);
CREATE INDEX IF NOT EXISTS clip_events_user ON clip_events (user_id);
CREATE INDEX IF NOT EXISTS posts_user ON posts (user_id, client_id);
`);

// Planes iniciales (el admin puede cambiar precios y horas desde el panel).
const seedPlan = db.prepare(`INSERT OR IGNORE INTO plans
  (id, name, price_usd, ai_hours, uses_ai, description, sort, public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
seedPlan.run('trial', 'Prueba gratis', 0, 2, 1, 'Prueba todo durante unos días, con 2 horas de IA Pro incluidas.', 0, 0);
seedPlan.run('local', 'Local', 10, 0, 0, 'Todo funciona en tu PC con IA local. Sin límite de horas.', 1, 1);
seedPlan.run('pro', 'Pro IA', 29, 150, 1, 'Claude elige los mejores momentos. 150 horas de análisis al mes (unas 5 h diarias) + todo lo del plan Local.', 2, 1);
seedPlan.run('pro247', 'Pro 24/7', 99, 750, 1, 'Para directos de todo el día. 750 horas de análisis con Claude al mes + todo lo del plan Local.', 3, 1);

// Planes que se venden desde noviembre de 2026: solo dos.
//  - Local (20 USD): la IA local de la PC (ve y escucha), sin Claude.
//  - Claude (30 USD desde el 16-11-2026; antes 150): Claude elige los clips con la clave de Claude del propio cliente.
// Se aplica una sola vez: después, el admin puede cambiar precios y textos desde el panel.
export const PLAN_DESCRIPTIONS = {
  local: 'La IA local de tu PC mira y escucha cada video (risas, gritos, reacciones) y saca los clips. Sin límite de horas.',
  pro: 'Claude elige los mejores momentos y escribe títulos y hashtags, con tu propia clave de Claude. Sin límite de horas + todo lo del plan Local.',
};
if (db.prepare("SELECT value FROM settings WHERE key = 'planes_v'").get()?.value !== '2') {
  db.prepare("UPDATE plans SET name = 'Local', price_usd = 20, ai_hours = 0, uses_ai = 0, description = ?, sort = 1, public = 1 WHERE id = 'local'").run(PLAN_DESCRIPTIONS.local);
  db.prepare("UPDATE plans SET name = 'Claude', price_usd = 150, ai_hours = 100000, uses_ai = 1, description = ?, sort = 2, public = 1 WHERE id = 'pro'").run(PLAN_DESCRIPTIONS.pro);
  db.prepare("UPDATE plans SET public = 0 WHERE id NOT IN ('local', 'pro')").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('planes_v', '2') ON CONFLICT(key) DO UPDATE SET value = '2'").run();
}

// Precios nuevos (una sola vez): Local 20 USD y Claude 30 USD.
if (db.prepare("SELECT value FROM settings WHERE key = 'precios_v'").get()?.value !== '3') {
  db.prepare("UPDATE plans SET price_usd = 20 WHERE id = 'local'").run();
  db.prepare("UPDATE plans SET price_usd = 30 WHERE id = 'pro'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('precios_v', '3') ON CONFLICT(key) DO UPDATE SET value = '3'").run();
}

const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
seedSetting.run('trial_days', '3');
seedSetting.run('payment_link', '');
seedSetting.run('support_contact', '');
seedSetting.run('announcement', '');

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

/** Soporte: lo que el admin puso en "Contacto de soporte"; si está vacío, el Discord de ClipViral (ahí el bot abre un ticket). */
export const SOPORTE_DISCORD = 'https://discord.gg/2k4Q3bBMh';
export function supportContact() {
  return String(getSetting('support_contact') || '').trim() || SOPORTE_DISCORD;
}
export const esEnlace = (v) => /^https?:\/\//i.test(String(v || ''));

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

/** Resumen del plan de un usuario, listo para mandar a la app. */
export function planInfo(user) {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(user.plan);
  const isAdmin = user.role === 'admin';
  const expired = !isAdmin && user.plan_expires && new Date(user.plan_expires) < new Date();
  const active = isAdmin || (!!plan && !expired && !user.banned);
  const used = user.ai_period === currentPeriod() ? user.ai_seconds : 0;
  return {
    id: plan?.id ?? user.plan,
    name: plan?.name ?? 'Sin plan',
    active,
    expired: !!expired,
    expires: user.plan_expires,
    usesAi: active && (isAdmin || !!plan?.uses_ai),
    aiHours: isAdmin ? 100000 : (plan?.ai_hours ?? 0),
    aiSecondsUsed: used,
    priceUsd: plan?.price_usd ?? 0,
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.created_at,
    plan: planInfo(user),
  };
}
