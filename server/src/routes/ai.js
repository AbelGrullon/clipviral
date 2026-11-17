import { Router } from 'express';
import { db, currentPeriod, planInfo } from '../db.js';
import { requireAuth } from '../auth.js';
import { withKey, aiErrorMessage, scanWindow, pickClips, rankVideos, competitorReport, costOf } from '../claude.js';
import { cleanPickedClip } from '../textos.js';
import { keyForUser } from '../clave.js';

const router = Router();
router.use(requireAuth);
// Cada pedido usa la clave de quien lo hace: el admin, la del servidor; un cliente del plan Claude, la suya.
router.use((req, res, next) => {
  req.claudeKey = keyForUser(req.user);
  withKey(req.claudeKey, next);
});

const fmt = (s) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const clean = (text, max) => String(text ?? '').replace(/\s+/g, ' ').slice(0, max);

function checkAccess(req, res) {
  const plan = planInfo(req.user);
  if (plan.active && plan.usesAi && !req.claudeKey) {
    res.status(503).json({ error: 'Falta tu clave de Claude. Ponla en Ajustes → Clave de Claude, o usa el modo Local.' });
    return null;
  }
  if (!plan.active) {
    res.status(402).json({ error: 'Tu plan venció. Renuévalo para seguir usando la IA Pro.' });
    return null;
  }
  if (!plan.usesAi) {
    res.status(402).json({ error: 'Tu plan no incluye la IA Pro. Mejora tu plan o usa el modo Local.' });
    return null;
  }
  return plan;
}

function logUsage(userId, kind, model, usage, seconds) {
  const cost = costOf(model, usage);
  db.prepare(`INSERT INTO ai_usage (user_id, kind, model, input_tokens, output_tokens, cost_usd, seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, kind, model, usage?.input_tokens || 0, usage?.output_tokens || 0, cost, seconds);
  return cost;
}

function addSeconds(user, seconds) {
  const period = currentPeriod();
  if (user.ai_period === period) {
    db.prepare('UPDATE users SET ai_seconds = ai_seconds + ? WHERE id = ?').run(seconds, user.id);
  } else {
    db.prepare('UPDATE users SET ai_seconds = ?, ai_period = ? WHERE id = ?').run(seconds, period, user.id);
  }
}

/**
 * Paso 1: la app manda un tramo del directo (unos 10 min) y Haiku marca momentos posibles.
 * Aquí se descuentan las horas del plan.
 */
router.post('/scan', async (req, res) => {
  const plan = checkAccess(req, res);
  if (!plan) return;
  const body = req.body || {};
  const seconds = Math.round(Number(body.windowSeconds) || 0);
  if (seconds <= 0 || seconds > 1800) return res.status(400).json({ error: 'Tramo no válido' });
  if (plan.aiSecondsUsed + seconds > plan.aiHours * 3600) {
    return res.status(402).json({ error: 'Se acabaron tus horas de IA de este mes. Mejora tu plan o usa el modo Local.' });
  }

  const transcript = (Array.isArray(body.transcript) ? body.transcript : []).slice(0, 2000)
    .map((l) => `[${Math.round(Number(l.t) || 0)}] ${clean(l.text, 400)}`).join('\n');
  const chat = (Array.isArray(body.chat) ? body.chat : []).slice(0, 400)
    .map((c) => `[${Math.round(Number(c.t) || 0)}] ${Number(c.count) || 0} mensajes${c.laughs ? `, ${c.laughs} risas` : ''}${c.samples?.length ? ` | ${c.samples.slice(0, 4).map((s) => `"${clean(s, 80)}"`).join(', ')}` : ''}`).join('\n');
  const peaks = (Array.isArray(body.peaks) ? body.peaks : []).slice(0, 40)
    .map((p) => `[${Math.round(Number(p.t) || 0)}] ${clean(p.kind, 40)} x${Number(p.strength || 0).toFixed(1)}`).join(', ');

  if (!transcript.trim()) return res.json({ candidates: [] });

  const start = Number(body.windowStart) || 0;
  const prompt = `Título del directo: ${clean(body.title, 200) || 'sin título'}
Tramo: ${fmt(start)} a ${fmt(start + seconds)} (segundos ${Math.round(start)} a ${Math.round(start + seconds)})
Duración deseada de cada clip: unos ${Math.round(Number(body.clipSeconds) || 45)} segundos

TRANSCRIPCIÓN (segundo | texto):
${transcript}

CHAT (cada 10 s):
${chat || 'sin datos de chat'}

PICOS DETECTADOS EN LA PC (volumen o chat):
${peaks || 'ninguno'}`;

  try {
    const result = await scanWindow(prompt);
    const cost = logUsage(req.user.id, 'scan', result.model, result.usage, seconds);
    addSeconds(req.user, seconds);
    const candidates = result.candidates
      .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .map((c) => ({ start: c.start, end: c.end, score: Math.max(1, Math.min(10, Math.round(c.score))), reason: clean(c.reason, 300) }));
    res.json({ candidates, costUsd: cost, secondsUsed: plan.aiSecondsUsed + seconds });
  } catch (err) {
    console.error('Error en /ai/scan:', err?.status, err?.message);
    res.status(502).json({ error: aiErrorMessage(err, 'La IA no respondió. Se reintentará en el siguiente tramo.') });
  }
});

/** Paso 2: Sonnet revisa los candidatos buenos y devuelve los clips finales con título, hashtags y el texto de cada red. */
router.post('/pick', async (req, res) => {
  const plan = checkAccess(req, res);
  if (!plan) return;
  const body = req.body || {};
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 12);
  if (!candidates.length) return res.json({ clips: [] });

  const blocks = candidates.map((c, i) => {
    const lines = (Array.isArray(c.transcript) ? c.transcript : []).slice(0, 400)
      .map((l) => `  [${Math.round(Number(l.t) || 0)}] ${clean(l.text, 300)}`).join('\n');
    return `### Candidato ${clean(c.id ?? i, 20)} (segundos ${Math.round(c.start)} a ${Math.round(c.end)}, nota previa ${Number(c.score) || 0})
Motivo: ${clean(c.reason, 300)}
Chat: ${clean(c.chatSummary, 400) || 'sin datos'}
Transcripción:
${lines}`;
  }).join('\n\n');

  const hints = clean(body.hints, 1500);
  const prompt = `Título del directo: ${clean(body.title, 200) || 'sin título'}
Duración deseada de cada clip: unos ${Math.round(Number(body.clipSeconds) || 45)} segundos
Máximo de clips a devolver: ${Math.max(1, Math.min(10, Number(body.maxClips) || 4))}
${hints ? `\nLO QUE MEJOR FUNCIONA EN SUS REDES (según sus estadísticas):\n${hints}\n` : ''}
${blocks}`;

  try {
    const result = await pickClips(prompt);
    const cost = logUsage(req.user.id, 'pick', result.model, result.usage, 0);
    const clips = result.clips.map(cleanPickedClip).filter(Boolean);
    res.json({ clips, costUsd: cost });
  } catch (err) {
    console.error('Error en /ai/pick:', err?.status, err?.message);
    res.status(502).json({ error: aiErrorMessage(err, 'La IA no respondió al elegir clips. Se reintentará.') });
  }
});

/** Piloto automático: Haiku le pone nota a los videos encontrados por tema (no descuenta horas). */
router.post('/rank', async (req, res) => {
  if (!checkAccess(req, res)) return;
  const body = req.body || {};
  const temas = (Array.isArray(body.temas) ? body.temas : []).slice(0, 20).map((t) => clean(t, 80)).filter(Boolean);
  const videos = (Array.isArray(body.videos) ? body.videos : []).slice(0, 40);
  if (!videos.length) return res.json({ notes: [] });
  const lines = videos.map((v) => `- id=${clean(v.id, 20)} | "${clean(v.title, 150)}" | canal: ${clean(v.channel, 60) || '?'} | ${Number(v.views) || 0} vistas hoy | ${Math.round((Number(v.duration) || 0) / 60)} min`).join('\n');
  try {
    const result = await rankVideos(`TEMAS: ${temas.join(', ') || 'sin temas'}\n\nVIDEOS:\n${lines}`);
    logUsage(req.user.id, 'rank', result.model, result.usage, 0);
    const ids = new Set(videos.map((v) => String(v.id)));
    const notes = result.notes
      .filter((n) => ids.has(String(n.id)))
      .map((n) => ({ id: String(n.id), score: Math.max(1, Math.min(10, Math.round(n.score))), reason: clean(n.reason, 120) }));
    res.json({ notes });
  } catch (err) {
    console.error('Error en /ai/rank:', err?.status, err?.message);
    res.status(502).json({ error: aiErrorMessage(err, 'La IA no pudo revisar los videos.') });
  }
});

const REPORT_EVERY_MS = 20 * 3600 * 1000;

/** Informe de competencia (como mucho uno cada 20 horas por cliente). */
router.post('/competencia', async (req, res) => {
  if (!checkAccess(req, res)) return;
  const last = db.prepare("SELECT created_at FROM ai_reports WHERE user_id = ? AND kind = 'competencia' ORDER BY id DESC LIMIT 1").get(req.user.id);
  if (last && Date.now() - new Date(`${last.created_at.replace(' ', 'T')}Z`).getTime() < REPORT_EVERY_MS) {
    return res.status(429).json({ error: 'Ya hiciste un informe hoy. Puedes pedir otro mañana.' });
  }
  const body = req.body || {};
  const post = (p) => `  · ${clean(p.date, 10) || '?'} | ${Number(p.views) || 0} vistas${p.likes != null ? ` | ${Number(p.likes) || 0} me gusta` : ''}${p.duration ? ` | ${Math.round(Number(p.duration))} s` : ''} | "${clean(p.title, 140)}"`;
  const competitors = (Array.isArray(body.competitors) ? body.competitors : []).slice(0, 10).map((c) => {
    const posts = (Array.isArray(c.posts) ? c.posts : []).slice(0, 25).map(post).join('\n');
    return `### ${clean(c.name, 80)} (${clean(c.platform, 20)})${c.followers ? ` · ${Number(c.followers)} seguidores` : ''}\n${posts || '  (sin publicaciones)'}`;
  }).join('\n\n');
  if (!competitors) return res.status(400).json({ error: 'Agrega al menos una cuenta de la competencia' });
  const own = body.own || {};
  const ownPosts = (Array.isArray(own.posts) ? own.posts : []).slice(0, 25).map(post).join('\n');
  const prompt = `MIS REDES:
Seguidores: ${clean(JSON.stringify(own.followers || {}), 300)}
Lo que la app aprendió: ${clean(own.hints, 800) || 'todavía no hay datos suficientes'}
Mis publicaciones recientes:
${ownPosts || '  (sin datos todavía)'}

COMPETENCIA:
${competitors}`;
  try {
    const result = await competitorReport(prompt);
    const cost = logUsage(req.user.id, 'competencia', result.model, result.usage, 0); // se cobra aunque no salga el informe
    if (!result.report) return res.status(502).json({ error: 'La IA no pudo escribir el informe. Intenta más tarde.' });
    db.prepare("INSERT INTO ai_reports (user_id, kind, data) VALUES (?, 'competencia', ?)").run(req.user.id, JSON.stringify(result.report));
    res.json({ report: result.report, costUsd: cost });
  } catch (err) {
    console.error('Error en /ai/competencia:', err?.status, err?.message);
    res.status(502).json({ error: aiErrorMessage(err, 'La IA no respondió. Intenta en unos minutos.') });
  }
});

export default router;
