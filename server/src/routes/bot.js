// Para el bot de Discord (carpeta discord-bot): cuando un cliente abre un ticket y escribe su correo, el bot pregunta
// aquí qué cuenta tiene, para que el equipo vea su plan. Solo contesta con la clave del bot, que el instalador del bot
// guarda en DATA_DIR/bot-discord.clave (o DISCORD_BOT_CLAVE en server/.env). Sin clave, estas rutas no existen.
import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR, planInfo } from '../db.js';

export const ARCHIVO_CLAVE_BOT = 'bot-discord.clave';

/** Se lee en cada pedido: así el instalador del bot puede ponerla sin reiniciar el servidor. */
export function claveBot() {
  const env = String(process.env.DISCORD_BOT_CLAVE || '').trim();
  if (env) return env;
  try { return fs.readFileSync(path.join(DATA_DIR, ARCHIVO_CLAVE_BOT), 'utf8').trim(); } catch { return ''; }
}

const resumen = (s) => crypto.createHash('sha256').update(String(s)).digest();
const iguales = (a, b) => crypto.timingSafeEqual(resumen(a), resumen(b));

/** Fechas de SQLite ("2026-11-18 19:00:00", en UTC) → ISO con Z. */
export function fechaIso(s) {
  if (!s) return null;
  const t = String(s);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t) ? `${t.replace(' ', 'T')}Z` : t;
}

const router = Router();

router.use((req, res, next) => {
  const clave = claveBot();
  if (clave.length < 24) return res.status(404).json({ error: 'No encontrado' });
  if (!iguales(req.get('x-bot-clave') || '', clave)) return res.status(401).json({ error: 'Clave del bot incorrecta' });
  next();
});

router.get('/estado', (req, res) => res.json({ ok: true }));

router.get('/cliente', (req, res) => {
  const correo = String(req.query.correo || '').trim().toLowerCase();
  if (!correo || correo.length > 200 || !correo.includes('@')) return res.status(400).json({ error: 'Correo no válido' });
  const u = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(correo);
  if (!u) return res.json({ encontrada: false });
  const plan = planInfo(u);
  const pagos = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments WHERE user_id = ? AND status = 'pagado'").get(u.id);
  res.json({
    encontrada: true,
    nombre: u.name,
    correo: u.email,
    rol: u.role,
    bloqueado: !!u.banned,
    plan: { id: plan.id, nombre: plan.name, activo: plan.active, vencido: plan.expired, vence: fechaIso(plan.expires) },
    pagos: pagos.n,
    pagado: pagos.total,
    clips: db.prepare('SELECT COUNT(*) AS n FROM clip_events WHERE user_id = ?').get(u.id).n,
    creada: fechaIso(u.created_at),
    ultimaEntrada: fechaIso(u.last_login),
  });
});

export default router;
