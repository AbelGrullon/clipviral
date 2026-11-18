// Agente de contenido (solo administradores): maneja solo una página de Facebook nueva.
// El servidor guarda qué página usa, le da su token a la app y es su "cerebro": cada pedido a Claude pasa por aquí,
// se anota lo que costó y, si se llega al tope de gasto del mes, se frena.
import { Router } from 'express';
import { db, getSetting, setSetting } from './db.js';
import { requireAdmin } from './auth.js';
import { getClient, withKey, aiErrorMessage, costOf, OPUS, cut } from './claude.js';
import { keyForUser } from './clave.js';
import { open } from './secretbox.js';

export const TOPE_DEFAULT = 10;
const TOPE_MAX = 500;
const EFFORTS = ['low', 'medium', 'high'];

const topeKey = (userId) => `agente_tope_${userId}`;
const paginaKey = (userId) => `agente_pagina_${userId}`;

/** Primer día del mes (UTC), como lo guarda SQLite en created_at. */
export function monthStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01 00:00:00`;
}

/** Lo que el agente gastó en Claude este mes (dólares). */
export function spentThisMonth(userId, now = new Date()) {
  return db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_usage WHERE user_id = ? AND kind LIKE 'agente%' AND created_at >= ?")
    .get(userId, monthStart(now)).s;
}

export function topeOf(userId) {
  const v = Number(getSetting(topeKey(userId), String(TOPE_DEFAULT)));
  return Number.isFinite(v) && v >= 0 ? v : TOPE_DEFAULT;
}

/** Las páginas de la conexión de Facebook del admin (con su token cifrado). */
function fbPages(userId) {
  const row = db.prepare("SELECT extra FROM social_accounts WHERE user_id = ? AND platform = 'facebook'").get(userId);
  if (!row) return null;
  try { return JSON.parse(row.extra || '{}').pages || []; } catch { return []; }
}

function chosenPage(userId) {
  const id = getSetting(paginaKey(userId), '');
  if (!id) return null;
  return (fbPages(userId) || []).find((p) => p.id === id) || null;
}

const publicPage = (p) => (p ? { id: p.id, name: p.name, avatar: p.avatar || null } : null);

const router = Router();
router.use(requireAdmin);

// Cómo está el agente en el servidor: página elegida, páginas para elegir y gasto del mes.
router.get('/estado', (req, res) => {
  const pages = fbPages(req.user.id);
  const savedId = getSetting(paginaKey(req.user.id), '');
  const pagina = chosenPage(req.user.id);
  res.json({
    facebook: pages !== null,
    paginas: (pages || []).map(publicPage),
    pagina: publicPage(pagina),
    // Eligió una página que ya no está en la conexión (la quitó al reconectar Facebook).
    paginaPerdida: !!savedId && !pagina,
    ia: !!withKey(keyForUser(req.user), () => getClient()),
    gastado: Number(spentThisMonth(req.user.id).toFixed(4)),
    tope: topeOf(req.user.id),
  });
});

router.put('/tope', (req, res) => {
  const usd = Number(req.body?.usd);
  if (!Number.isFinite(usd) || usd < 0 || usd > TOPE_MAX) return res.status(400).json({ error: `El tope debe ser un número entre 0 y ${TOPE_MAX} dólares.` });
  setSetting(topeKey(req.user.id), String(Math.round(usd * 100) / 100));
  res.json({ ok: true, tope: topeOf(req.user.id) });
});

// Qué página maneja el agente (una de las que trae la conexión de Facebook). Vacío = ninguna.
router.post('/pagina', (req, res) => {
  const id = String(req.body?.pageId || '');
  if (!id) { setSetting(paginaKey(req.user.id), ''); return res.json({ ok: true, pagina: null }); }
  const pages = fbPages(req.user.id);
  if (pages === null) return res.status(404).json({ error: 'Conecta Facebook primero (en Redes) con un token que incluya la página nueva.' });
  const page = pages.find((p) => p.id === id);
  if (!page) return res.status(404).json({ error: 'No encontré esa página. Vuelve a conectar Facebook marcando la página nueva.' });
  setSetting(paginaKey(req.user.id), id);
  res.json({ ok: true, pagina: publicPage(page) });
});

// Token de la página del agente (para subir y leer estadísticas desde la PC). Los tokens de página no vencen.
router.post('/token', (req, res) => {
  const page = chosenPage(req.user.id);
  if (!page) return res.status(404).json({ error: 'El agente todavía no tiene página de Facebook. Elígela en la pantalla Agente.' });
  let token = null;
  try { token = open(page.token); } catch {}
  if (!token) return res.status(401).json({ error: 'No pude leer el permiso de la página. Vuelve a conectar Facebook en Redes.', reconnect: true });
  res.json({ accessToken: token, accountId: page.id, accountName: page.name });
});

const textOf = (response) => (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

/**
 * El cerebro del agente: un pedido a Claude (Opus) con lo que la app arma (system + prompt y, si quiere JSON, el esquema).
 * También lo usa SerieAI cuando el agente le pide un episodio. Cada pedido se anota en ai_usage como "agente:<tarea>".
 */
router.post('/pensar', async (req, res) => {
  const b = req.body || {};
  const tarea = String(b.tarea || 'general').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'general';
  const system = String(b.system || '');
  const prompt = String(b.prompt || '');
  if (!prompt.trim()) return res.status(400).json({ error: 'Falta el pedido' });
  if (system.length > 60000 || prompt.length > 200000) return res.status(413).json({ error: 'El pedido es demasiado largo' });
  const schema = b.schema && typeof b.schema === 'object' ? b.schema : null;
  const effort = EFFORTS.includes(b.effort) ? b.effort : 'medium';
  const maxTokens = Math.min(32000, Math.max(4000, Number(b.maxTokens) || 16000));

  const tope = topeOf(req.user.id);
  const gastado = spentThisMonth(req.user.id);
  if (gastado >= tope) {
    return res.status(402).json({
      error: `El agente llegó a su tope de gasto de este mes (${tope.toFixed(2)} USD). Súbelo en Agente → Ajustes o espera al mes que viene.`,
      tope: true, gastado, limite: tope,
    });
  }

  try {
    const response = await withKey(keyForUser(req.user), async () => {
      const client = getClient();
      if (!client) throw Object.assign(new Error('nokey'), { nokey: true });
      return client.beta.messages.create({
        model: OPUS,
        max_tokens: maxTokens,
        // Si el modelo rechaza el pedido, la API lo reintenta sola con otro modelo.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
        ...(system ? { system: cut(system) } : {}),
        messages: [{ role: 'user', content: cut(prompt) }],
      });
    });
    const model = response.model || OPUS;
    const costo = costOf(model, response.usage);
    db.prepare(`INSERT INTO ai_usage (user_id, kind, model, input_tokens, output_tokens, cost_usd, seconds) VALUES (?, ?, ?, ?, ?, ?, 0)`)
      .run(req.user.id, `agente:${tarea}`, model, response.usage?.input_tokens || 0, response.usage?.output_tokens || 0, costo);
    const extra = { costo: Number(costo.toFixed(4)), gastado: Number((gastado + costo).toFixed(4)), tope, model };
    if (response.stop_reason === 'refusal') return res.status(422).json({ error: 'Claude no quiso hacer este pedido. El agente probará con otra idea.', ...extra });
    if (response.stop_reason === 'max_tokens') return res.status(502).json({ error: 'La respuesta de Claude quedó cortada. Se vuelve a intentar más tarde.', ...extra });
    const text = textOf(response);
    if (!schema) return res.json({ ok: true, text, ...extra });
    try {
      return res.json({ ok: true, json: JSON.parse(text), ...extra });
    } catch {
      return res.status(502).json({ error: 'Claude respondió algo que no se pudo leer. Se vuelve a intentar más tarde.', ...extra });
    }
  } catch (err) {
    if (err.nokey) return res.status(503).json({ error: 'Falta la clave de Claude del servidor. Ponla en Ajustes → Clave de Claude.' });
    console.error('Agente: error con Claude:', err.message);
    res.status(502).json({ error: aiErrorMessage(err, 'Claude no respondió. El agente lo intenta de nuevo más tarde.') });
  }
});

export const agenteRoutes = router;
