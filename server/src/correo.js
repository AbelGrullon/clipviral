// Correos de ClipViral: bienvenida, recuperar contraseña, pagos, avisos de vencimiento y avisos del admin.
// Se envían por SMTP (pensado para Gmail con una "contraseña de aplicación"). La contraseña se guarda cifrada.
import nodemailer from 'nodemailer';
import { db, getSetting, setSetting } from './db.js';
import { seal, open } from './secretbox.js';

const DEFAULTS = { host: 'smtp.gmail.com', port: 465 };
const PASS_SETTING = 'smtp_pass';

// Para las pruebas: se puede cambiar cómo se envía (sin internet).
export const mailer = { createTransport: (opts) => nodemailer.createTransport(opts) };

export function mailConfig() {
  return {
    host: getSetting('smtp_host') || DEFAULTS.host,
    port: Number(getSetting('smtp_port')) || DEFAULTS.port,
    user: getSetting('smtp_user'),
    fromName: getSetting('mail_from_name') || 'ClipViral',
    hasPass: !!getSetting(PASS_SETTING),
    // Qué correos automáticos se mandan (todos encendidos al empezar).
    auto: {
      bienvenida: getSetting('mail_bienvenida', '1') !== '0',
      pago: getSetting('mail_pago', '1') !== '0',
      vencimiento: getSetting('mail_vencimiento', '1') !== '0',
    },
  };
}

export const mailEnabled = () => { const c = mailConfig(); return !!(c.user && c.hasPass); };

/** Guarda la configuración del correo. La contraseña solo se cambia si viene una nueva. */
export function saveMailConfig(b = {}) {
  if (b.host !== undefined) setSetting('smtp_host', String(b.host).trim());
  if (b.port !== undefined) setSetting('smtp_port', String(Number(b.port) || DEFAULTS.port));
  if (b.user !== undefined) setSetting('smtp_user', String(b.user).trim());
  if (b.fromName !== undefined) setSetting('mail_from_name', String(b.fromName).trim().slice(0, 60));
  // Gmail muestra la contraseña de aplicación en grupos con espacios: se quitan.
  if (b.pass) setSetting(PASS_SETTING, seal(String(b.pass).replace(/\s+/g, '')));
  if (b.removePass) setSetting(PASS_SETTING, '');
  for (const k of ['bienvenida', 'pago', 'vencimiento']) if (b.auto?.[k] !== undefined) setSetting(`mail_${k}`, b.auto[k] ? '1' : '0');
  return mailConfig();
}

let transport = null;
let transportKey = '';
function getTransport() {
  const c = mailConfig();
  let pass = '';
  try { pass = open(getSetting(PASS_SETTING)) || ''; } catch { pass = ''; }
  if (!c.user || !pass) return null;
  const key = `${c.host}|${c.port}|${c.user}|${pass}`;
  if (key !== transportKey) {
    transportKey = key;
    transport = mailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass }, connectionTimeout: 15000 });
  }
  return transport;
}

/** Explica en simple por qué no salió un correo. */
export function mailErrorMessage(err) {
  const text = String(err?.message || err || '');
  if (/535|Username and Password not accepted|Invalid login|BadCredentials/i.test(text)) {
    return 'Gmail no aceptó el usuario o la contraseña. Usa una "contraseña de aplicación" (no tu contraseña normal): myaccount.google.com → Seguridad → Verificación en 2 pasos → Contraseñas de aplicaciones.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(text)) return 'No pude conectar con el servidor de correo. Revisa el servidor, el puerto y tu internet.';
  return `No se pudo enviar el correo: ${text.slice(0, 200)}`;
}

// ---------- Plantillas ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

function layout(title, body) {
  const support = getSetting('support_contact');
  return `<!doctype html><html><body style="margin:0;background:#0f0b1a;font-family:Arial,Helvetica,sans-serif;color:#ece9f5">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px">
    <div style="font-size:20px;font-weight:bold;margin-bottom:18px"><span style="background:linear-gradient(90deg,#ff3d8b,#ff8a3d);border-radius:8px;padding:4px 10px;color:#fff">▶</span> ClipViral</div>
    <div style="background:#1a1430;border-radius:16px;padding:26px 24px;line-height:1.55">
      <h1 style="font-size:22px;margin:0 0 14px;color:#fff">${esc(title)}</h1>
      ${body}
    </div>
    <p style="color:#8f88a8;font-size:12px;margin-top:18px">${support ? `¿Dudas? Escríbenos: ${esc(support)}<br>` : ''}Recibes este correo porque tienes una cuenta en ClipViral.</p>
  </div></body></html>`;
}
const p = (t) => `<p style="margin:0 0 12px">${t}</p>`;
const big = (t) => `<div style="font-size:30px;letter-spacing:8px;font-weight:bold;background:#0f0b1a;border-radius:12px;padding:14px;text-align:center;margin:8px 0 16px;color:#fff">${esc(t)}</div>`;

export const TEMPLATES = {
  bienvenida: ({ name, trialDays }) => ({
    subject: '¡Bienvenido a ClipViral! 🎬',
    html: layout(`¡Hola, ${name}!`, p('Tu cuenta de ClipViral ya está lista. Pega el enlace de un directo o un video de YouTube y la app saca los mejores momentos con subtítulos, listos para TikTok, Reels y Shorts.')
      + (trialDays ? p(`Tienes <b>${esc(trialDays)} días de prueba</b> para probar todo. Cuando quieras seguir, elige un plan en la app (sección <b>Mi plan</b>) y paga con tarjeta.`) : '')),
  }),
  codigo: ({ name, code }) => ({
    subject: `Tu código para cambiar la contraseña: ${code}`,
    html: layout('Cambiar tu contraseña', p(`Hola, ${esc(name)}. Usa este código en la app para elegir una contraseña nueva:`) + big(code)
      + p('Vence en 30 minutos. Si no lo pediste tú, ignora este correo: tu contraseña sigue igual.')),
  }),
  clave_cambiada: ({ name }) => ({
    subject: 'Tu contraseña de ClipViral cambió',
    html: layout('Contraseña cambiada', p(`Hola, ${esc(name)}. La contraseña de tu cuenta se acaba de cambiar y se cerraron las sesiones abiertas.`)
      + p('Si no fuiste tú, responde este correo cuanto antes.')),
  }),
  pago: ({ name, planName, amount, expires }) => ({
    subject: `Pago recibido: plan ${planName} activo ✅`,
    html: layout('¡Gracias por tu pago!', p(`Hola, ${esc(name)}. Recibimos tu pago de <b>${esc(amount)} USD</b>.`)
      + p(`Tu plan <b>${esc(planName)}</b> está activo hasta el <b>${esc(fecha(expires))}</b>.`)
      + p('Cada pago suma un mes. Unos días antes del vencimiento te avisamos por aquí.')),
  }),
  licencia: ({ name, planName, expires, cambio }) => ({
    subject: `Tu plan ${planName} se actualizó`,
    html: layout('Tu plan se actualizó', p(`Hola, ${esc(name)}. ${esc(cambio || 'Actualizamos tu licencia.')}`)
      + p(expires ? `Plan <b>${esc(planName)}</b>, activo hasta el <b>${esc(fecha(expires))}</b>.` : `Plan <b>${esc(planName)}</b>, sin fecha de vencimiento.`)),
  }),
  vence_pronto: ({ name, planName, expires, days }) => ({
    subject: `Tu plan ${planName} vence en ${days} día${days === 1 ? '' : 's'}`,
    html: layout('Tu plan está por vencer', p(`Hola, ${esc(name)}. Tu plan <b>${esc(planName)}</b> vence el <b>${esc(fecha(expires))}</b>.`)
      + p('Para no quedarte sin clips, renuévalo en la app: <b>Mi plan → Pagar con tarjeta</b>. Cada pago suma un mes.')),
  }),
  vencio: ({ name, planName }) => ({
    subject: `Tu plan ${planName} venció`,
    html: layout('Tu plan venció', p(`Hola, ${esc(name)}. Tu plan <b>${esc(planName)}</b> llegó a su fecha de vencimiento.`)
      + p('Renuévalo cuando quieras en la app: <b>Mi plan → Pagar con tarjeta</b>. Tus clips y ajustes siguen guardados.')),
  }),
  aviso: ({ name, subject, message }) => ({
    subject,
    html: layout(subject, p(`Hola, ${esc(name)}.`) + String(message || '').split(/\n{2,}/).map((x) => p(esc(x).replace(/\n/g, '<br>'))).join('')),
  }),
  prueba: () => ({ subject: 'Prueba de correo de ClipViral', html: layout('¡El correo funciona!', p('Si lees esto, ClipViral ya puede enviar correos a tus clientes.')) }),
};

/**
 * Envía un correo con una plantilla. Nunca rompe lo que lo llamó: devuelve { ok, error }.
 * user: { id, email, name } · kind: nombre de la plantilla.
 */
export async function sendMail(user, kind, data = {}) {
  const tpl = TEMPLATES[kind];
  if (!tpl) return { ok: false, error: 'Plantilla desconocida' };
  const { subject, html } = tpl({ name: user.name, ...data });
  const t = getTransport();
  const log = (ok, error) => db.prepare('INSERT INTO mail_log (user_id, email, kind, subject, ok, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id ?? null, user.email, kind, subject.slice(0, 200), ok ? 1 : 0, error || null);
  if (!t) { log(false, 'Correo sin configurar'); return { ok: false, error: 'El envío de correos no está configurado.' }; }
  const c = mailConfig();
  try {
    await t.sendMail({ from: { name: c.fromName, address: c.user }, to: user.email, subject, html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
    log(true);
    return { ok: true };
  } catch (err) {
    const error = mailErrorMessage(err);
    log(false, error);
    return { ok: false, error };
  }
}

// ---------- Avisos de vencimiento (cada hora) ----------
const DAY = 86400000;
export async function checkExpirations(now = Date.now()) {
  if (!mailEnabled() || !mailConfig().auto.vencimiento) return 0;
  const rows = db.prepare(`SELECT u.*, p.name AS plan_name FROM users u LEFT JOIN plans p ON p.id = u.plan
    WHERE u.role != 'admin' AND u.banned = 0 AND u.plan_expires IS NOT NULL`).all();
  const already = db.prepare('SELECT 1 FROM license_notices WHERE user_id = ? AND kind = ? AND expires = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO license_notices (user_id, kind, expires) VALUES (?, ?, ?)');
  let sent = 0;
  for (const u of rows) {
    const exp = new Date(u.plan_expires).getTime();
    if (!Number.isFinite(exp)) continue;
    const left = exp - now;
    let kind = null;
    if (left > 0 && left <= 3 * DAY) kind = 'vence_pronto';
    else if (left <= 0 && left > -7 * DAY) kind = 'vencio';
    if (!kind || already.get(u.id, kind, u.plan_expires)) continue;
    mark.run(u.id, kind, u.plan_expires);
    const r = await sendMail(u, kind, { planName: u.plan_name || u.plan, expires: u.plan_expires, days: Math.max(1, Math.ceil(left / DAY)) });
    if (r.ok) sent += 1;
  }
  return sent;
}

export function startMailJobs() {
  const run = () => checkExpirations().catch((err) => console.error('correos:', err.message));
  setTimeout(run, 30000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}
