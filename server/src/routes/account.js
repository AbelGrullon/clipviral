import { Router } from 'express';
import { db, getSetting, publicUser, supportContact } from '../db.js';
import { requireAuth } from '../auth.js';
import { keyForUser, userKeyStatus, saveUserKey, removeUserKey } from '../clave.js';

const router = Router();

function publicPlans() {
  return db.prepare('SELECT id, name, price_usd AS priceUsd, ai_hours AS aiHours, uses_ai AS usesAi, description FROM plans WHERE public = 1 ORDER BY sort')
    .all()
    .map((p) => ({ ...p, usesAi: !!p.usesAi }));
}

router.get('/plans', (req, res) => {
  res.json({ plans: publicPlans() });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: publicUser(req.user),
    plans: publicPlans(),
    info: {
      paymentLink: getSetting('payment_link'),
      supportContact: supportContact(),
      announcement: getSetting('announcement'),
      // La app lo usa para avisar que falta poner la clave de Claude (la del servidor para el admin, la propia para un cliente).
      aiEnabled: !!keyForUser(req.user),
      // Publicar en redes (automático o a mano desde la app) es solo para administradores.
      publicar: req.user.role === 'admin' && process.env.EDICION !== 'cliente',
    },
  });
});

// Clave de Claude del cliente (plan Claude). Se guarda cifrada y nunca vuelve completa a la app.
router.get('/me/claude', requireAuth, (req, res) => res.json(userKeyStatus(req.user)));
router.put('/me/claude', requireAuth, async (req, res) => {
  const result = await saveUserKey(req.user, req.body?.key);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result.status);
});
router.delete('/me/claude', requireAuth, (req, res) => res.json(removeUserKey(req.user)));

// La app avisa cada clip que saca (para el resumen del panel). Solo cuenta: no guarda el video ni el texto.
router.post('/clips/evento', requireAuth, (req, res) => {
  const mode = req.body?.mode === 'ia' ? 'ia' : 'local';
  const seconds = Math.max(0, Math.min(3600, Number(req.body?.seconds) || 0));
  const origin = ['manual', 'piloto'].includes(req.body?.origin) ? req.body.origin : 'manual';
  db.prepare('INSERT INTO clip_events (user_id, mode, seconds, origin) VALUES (?, ?, ?, ?)').run(req.user.id, mode, seconds, origin);
  res.json({ ok: true });
});

export default router;
