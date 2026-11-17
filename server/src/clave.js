// La clave de Claude que pone el administrador desde el panel, la app o el .bat de inicio.
// Se guarda cifrada en la base (tabla settings). Si no hay ninguna guardada, se usa ANTHROPIC_API_KEY del .env.
import { db, getSetting, setSetting } from './db.js';
import { seal, open } from './secretbox.js';
import { setKeyProvider, checkApiKey, aiEnabled } from './claude.js';

const SETTING = 'anthropic_api_key';
const MASK = '••••••';

// Se vuelve a leer de la base en cada uso (es una consulta mínima): así, si el .bat o el panel la cambian,
// el servidor la usa al momento. Solo se descifra cuando cambia.
let lastSealed;
let savedKey = null;
let unreadable = false;

function readSaved() {
  const sealed = getSetting(SETTING) || '';
  if (sealed !== lastSealed) {
    lastSealed = sealed;
    savedKey = null;
    unreadable = false;
    if (sealed) {
      try {
        savedKey = open(sealed);
      } catch {
        // Pasa si se perdió data/secret.key (o cambió SECRET_KEY): hay que volver a poner la clave.
        unreadable = true;
      }
    }
  }
  return savedKey;
}

const envKey = () => (process.env.ANTHROPIC_API_KEY || '').trim() || null;

/** La clave en uso: primero la guardada desde el panel o la app; si no hay, la del .env. */
export function activeKey() {
  const saved = readSaved();
  if (saved) return { key: saved, source: 'panel' };
  const env = envKey();
  return env ? { key: env, source: 'env' } : { key: null, source: null };
}

setKeyProvider(() => activeKey().key);

export const maskKey = (key) => (key ? `${MASK}${key.slice(-4)}` : '');

/** Estado para el panel y la app. Nunca incluye la clave completa. */
export function keyStatus() {
  const { key, source } = activeKey();
  return {
    enabled: aiEnabled(),
    source, // 'panel' (guardada aquí), 'env' (archivo .env) o null (no hay)
    masked: maskKey(key),
    hasEnv: !!envKey(),
    unreadable,
  };
}

/** Quita espacios, saltos de línea y comillas que se cuelan al copiar y pegar. */
export function cleanKey(raw) {
  return String(raw ?? '').replace(/\s+/g, '').replace(/^["'“”]+|["'“”]+$/g, '');
}

/** Revisión rápida antes de preguntarle a Claude (para no esperar por un error obvio). */
export function keyFormatError(key) {
  if (!key) return 'Pega tu clave de Claude.';
  if (key.startsWith(MASK)) return 'Pega la clave completa (la que se ve con puntos es la que ya está guardada).';
  if (/^sk-ant-admin/i.test(key)) return 'Esa es una clave de administración. Crea una clave normal en console.anthropic.com → API Keys → Create Key.';
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(key)) return 'Eso no parece una clave de Claude. Las claves empiezan con sk-ant- y son largas: cópiala completa desde console.anthropic.com → API Keys.';
  return null;
}

/** Prueba la clave con Claude (no cuesta nada) y, si sirve, la guarda cifrada. La IA queda activa al momento. */
export async function saveKey(raw) {
  const key = cleanKey(raw);
  const formatError = keyFormatError(key);
  if (formatError) return { ok: false, error: formatError };
  const result = await checkApiKey(key);
  if (!result.ok) return result;
  setSetting(SETTING, seal(key));
  return { ok: true, status: keyStatus() };
}

/** Borra la clave guardada. Si hay una en el .env, se vuelve a usar esa. */
export function removeKey() {
  setSetting(SETTING, '');
  return keyStatus();
}

// ---------- Clave de cada cliente (plan Claude) ----------

/** La clave que usa este usuario: el admin, la del servidor; un cliente, la suya. */
export function keyForUser(user) {
  if (!user) return null;
  if (user.role === 'admin') return activeKey().key;
  if (!user.claude_key) return null;
  try { return open(user.claude_key); } catch { return null; }
}

/** Estado de la clave del cliente para la app (nunca la clave completa). */
export function userKeyStatus(user) {
  const key = user.role === 'admin' ? activeKey().key : keyForUser(user);
  return { enabled: !!key, masked: maskKey(key), unreadable: !!user.claude_key && !key && user.role !== 'admin' };
}

/** Prueba la clave del cliente (no cuesta nada) y, si sirve, la guarda cifrada en su cuenta. */
export async function saveUserKey(user, raw) {
  const key = cleanKey(raw);
  const formatError = keyFormatError(key);
  if (formatError) return { ok: false, error: formatError };
  const result = await checkApiKey(key);
  if (!result.ok) return result;
  db.prepare('UPDATE users SET claude_key = ? WHERE id = ?').run(seal(key), user.id);
  return { ok: true, status: { enabled: true, masked: maskKey(key), unreadable: false } };
}

export function removeUserKey(user) {
  db.prepare('UPDATE users SET claude_key = NULL WHERE id = ?').run(user.id);
  return { enabled: false, masked: '', unreadable: false };
}
