// Pagos con tarjeta por PayPal (API de órdenes v2). El cliente paga en la página segura de PayPal
// (puede pagar con tarjeta sin tener cuenta PayPal) y cada pago aprobado suma un mes de licencia.
import { Router } from 'express';
import crypto from 'node:crypto';
import { db, getSetting, setSetting, planInfo } from './db.js';
import { seal, open } from './secretbox.js';
import { requireAuth } from './auth.js';
import { publicUrl } from './social.js';
import { sendMail, mailConfig } from './correo.js';

const SECRET_SETTING = 'paypal_secret';
const DAY = 86400000;
export const MONTH_DAYS = 30;
const BASE = { sandbox: 'https://api-m.sandbox.paypal.com', live: 'https://api-m.paypal.com' };

// Para las pruebas se puede cambiar cómo se habla con PayPal.
export const paypalHttp = { fetch: (...a) => globalThis.fetch(...a) };

export function paypalConfig() {
  return {
    clientId: getSetting('paypal_client_id'),
    mode: getSetting('paypal_mode') === 'live' ? 'live' : 'sandbox',
    hasSecret: !!getSetting(SECRET_SETTING),
  };
}
export const paymentsEnabled = () => { const c = paypalConfig(); return !!(c.clientId && c.hasSecret); };

export function savePaypalConfig(b = {}) {
  if (b.clientId !== undefined) setSetting('paypal_client_id', String(b.clientId).trim());
  if (b.mode !== undefined) setSetting('paypal_mode', b.mode === 'live' ? 'live' : 'sandbox');
  if (b.secret) setSetting(SECRET_SETTING, seal(String(b.secret).trim()));
  if (b.removeSecret) setSetting(SECRET_SETTING, '');
  token = null;
  return paypalConfig();
}

let token = null; // { value, until, key }
async function accessToken() {
  const c = paypalConfig();
  let secret = '';
  try { secret = open(getSetting(SECRET_SETTING)) || ''; } catch { secret = ''; }
  if (!c.clientId || !secret) throw Object.assign(new Error('Los pagos con tarjeta todavía no están activos. Contacta a soporte.'), { status: 503 });
  const key = `${c.mode}|${c.clientId}`;
  if (token && token.key === key && token.until > Date.now() + 60000) return token.value;
  const res = await paypalHttp.fetch(`${BASE[c.mode]}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${c.clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw Object.assign(new Error(res.status === 401
      ? `PayPal no aceptó el Client ID o el Secret (modo ${c.mode === 'live' ? 'real' : 'de prueba'}). Revisa que sean del mismo modo.`
      : `PayPal no respondió bien (${res.status}).`), { status: 502 });
  }
  token = { value: data.access_token, until: Date.now() + (Number(data.expires_in) || 3000) * 1000, key };
  return token.value;
}

async function paypal(method, path, body, extraHeaders = {}) {
  const c = paypalConfig();
  const res = await paypalHttp.fetch(`${BASE[c.mode]}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.details?.[0]?.issue || data?.name || res.status;
    throw Object.assign(new Error(`PayPal: ${detail}`), { status: res.status, paypal: data });
  }
  return data;
}

/** Prueba el Client ID y el Secret (no cobra nada). */
export async function testPaypal() {
  token = null;
  await accessToken();
  return { ok: true };
}

/** Nueva fecha de vencimiento: si renueva el mismo plan y sigue activo, se suma al final; si no, desde hoy. */
export function extendExpiry(user, planId, months, now = Date.now()) {
  const current = user.plan_expires ? new Date(user.plan_expires).getTime() : 0;
  const base = user.plan === planId && current > now ? current : now;
  return new Date(base + months * MONTH_DAYS * DAY).toISOString();
}

/** Marca el pago como pagado y suma el tiempo (una sola vez aunque PayPal avise dos veces). Devuelve la fila. */
export function applyPayment(orderId, { captureId, payerEmail, amount } = {}) {
  let applied = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const pay = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId);
    if (pay && pay.status !== 'pagado') {
      if (amount !== undefined && Math.abs(Number(amount) - pay.amount) > 0.009) {
        db.prepare("UPDATE payments SET status = 'error', note = ? WHERE id = ?").run(`Monto distinto: ${amount}`, pay.id);
      } else {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(pay.user_id);
        const after = extendExpiry(user, pay.plan, pay.months);
        db.prepare('UPDATE users SET plan = ?, plan_expires = ? WHERE id = ?').run(pay.plan, after, user.id);
        db.prepare("UPDATE payments SET status = 'pagado', capture_id = ?, payer_email = ?, expires_before = ?, expires_after = ?, paid_at = datetime('now') WHERE id = ?")
          .run(captureId || null, payerEmail || null, user.plan_expires, after, pay.id);
        applied = true;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const row = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId);
  if (applied && mailConfig().auto.pago) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    sendMail(user, 'pago', { planName: planInfo(user).name, amount: row.amount.toFixed(2), expires: row.expires_after }).catch(() => {});
  }
  return row;
}

/** Revisa la orden en PayPal y, si el cliente ya aprobó, la cobra. */
export async function settleOrder(orderId) {
  const pay = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId);
  if (!pay) throw Object.assign(new Error('No encontré ese pago'), { status: 404 });
  if (pay.status === 'pagado') return pay;
  let order = await paypal('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (order.status === 'APPROVED') {
    order = await paypal('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { 'PayPal-Request-Id': `cap-${orderId}` });
  }
  if (order.status === 'COMPLETED') {
    const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (cap && cap.status !== 'COMPLETED' && cap.status !== 'PENDING') {
      db.prepare("UPDATE payments SET status = 'error', note = ? WHERE id = ?").run(`Cobro ${cap.status}`, pay.id);
    } else {
      return applyPayment(orderId, { captureId: cap?.id, payerEmail: order.payer?.email_address, amount: cap?.amount?.value });
    }
  } else if (order.status === 'VOIDED') {
    db.prepare("UPDATE payments SET status = 'cancelado' WHERE id = ?").run(pay.id);
  }
  return db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId);
}

const publicPayment = (p) => ({
  id: p.order_id, plan: p.plan, months: p.months, amount: p.amount, currency: p.currency, status: p.status,
  expiresAfter: p.expires_after, createdAt: p.created_at, paidAt: p.paid_at,
});

// ---------- Rutas (/api/pagos) ----------
export const payRoutes = Router();

payRoutes.get('/estado', (req, res) => res.json({ enabled: paymentsEnabled(), mode: paypalConfig().mode }));

/** El cliente elige plan: se crea la orden y la app abre la página de pago. */
payRoutes.post('/crear', requireAuth, async (req, res, next) => {
  try {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND public = 1').get(String(req.body?.plan || ''));
    if (!plan || !(plan.price_usd > 0)) return res.status(400).json({ error: 'Elige un plan válido' });
    const months = Math.max(1, Math.min(12, Math.round(Number(req.body?.months) || 1)));
    const amount = Math.round(plan.price_usd * months * 100) / 100;
    const base = publicUrl();
    const order = await paypal('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: `u${req.user.id}`,
        custom_id: `${req.user.id}:${plan.id}:${months}`,
        description: `ClipViral · plan ${plan.name} · ${months} mes${months > 1 ? 'es' : ''}`.slice(0, 127),
        amount: { currency_code: 'USD', value: amount.toFixed(2) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'ClipViral',
            // Muestra primero el formulario de tarjeta (no hace falta cuenta PayPal).
            landing_page: 'GUEST_CHECKOUT',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            locale: 'es-ES',
            return_url: `${base}/api/pagos/vuelta`,
            cancel_url: `${base}/api/pagos/cancelado`,
          },
        },
      },
    }, { 'PayPal-Request-Id': `ord-${crypto.randomUUID()}` });
    const url = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
    if (!order.id || !url) throw new Error('PayPal no devolvió la página de pago');
    db.prepare('INSERT INTO payments (user_id, order_id, plan, months, amount) VALUES (?, ?, ?, ?, ?)').run(req.user.id, order.id, plan.id, months, amount);
    res.json({ id: order.id, url, amount, plan: plan.id, months });
  } catch (err) { next(err); }
});

/** La app pregunta cómo va (y si el cliente ya aprobó, se cobra aquí). */
payRoutes.post('/:id/verificar', requireAuth, async (req, res, next) => {
  try {
    const pay = db.prepare('SELECT * FROM payments WHERE order_id = ? AND user_id = ?').get(String(req.params.id), req.user.id);
    if (!pay) return res.status(404).json({ error: 'No encontré ese pago' });
    res.json({ payment: publicPayment(await settleOrder(pay.order_id)) });
  } catch (err) { next(err); }
});

payRoutes.get('/mios', requireAuth, (req, res) => {
  res.json({ payments: db.prepare("SELECT * FROM payments WHERE user_id = ? AND status != 'creado' ORDER BY id DESC LIMIT 50").all(req.user.id).map(publicPayment) });
});

const page = (title, text, ok) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0b1a;color:#ece9f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:420px;padding:32px;text-align:center;background:#1a1430;border-radius:18px"><div style="font-size:54px">${ok ? '✅' : '⚠️'}</div>
<h1 style="font-size:22px">${title}</h1><p style="color:#b9b2d0;line-height:1.5">${text}</p><p style="color:#8f88a8;font-size:13px">Ya puedes volver a ClipViral.</p></div></body></html>`;

/** PayPal manda aquí al cliente después de pagar: se cobra y se activa el plan. */
payRoutes.get('/vuelta', async (req, res) => {
  const orderId = String(req.query.token || '');
  try {
    const pay = await settleOrder(orderId);
    if (pay.status === 'pagado') {
      return res.send(page('¡Pago listo!', `Tu plan está activo hasta el ${new Date(pay.expires_after).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}.`, true));
    }
    res.send(page('Pago pendiente', 'PayPal todavía no confirmó el pago. Si ya pagaste, en unos minutos se activa solo.', false));
  } catch (err) {
    res.status(err.status === 404 ? 404 : 502).send(page('No pudimos confirmar el pago', 'Si ya pagaste, no te preocupes: abre ClipViral y toca "Ya pagué" en Mi plan. Si no se activa, contacta a soporte.', false));
  }
});

payRoutes.get('/cancelado', (req, res) => {
  const orderId = String(req.query.token || '');
  db.prepare("UPDATE payments SET status = 'cancelado' WHERE order_id = ? AND status = 'creado'").run(orderId);
  res.send(page('Pago cancelado', 'No se cobró nada. Puedes intentarlo otra vez cuando quieras.', false));
});
