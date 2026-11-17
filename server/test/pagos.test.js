// Pagos con PayPal, licencias de un mes, correos, recuperar contraseña y resumen de clips (sin internet: todo simulado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-pagos-'));
process.env.DATA_DIR = tmp;
process.env.SECRET_KEY = 'clave-de-prueba';

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { hashPassword, createSession } = await import('../src/auth.js');
const { mailer, checkExpirations } = await import('../src/correo.js');
const { paypalHttp, extendExpiry } = await import('../src/pagos.js');

// ---- Gmail simulado: guarda lo que se "envía" ----
const sent = [];
mailer.createTransport = () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } });
const lastMail = (to) => sent.filter((m) => m.to === to).at(-1);

// ---- PayPal simulado ----
const orders = new Map();
let paypalCalls = [];
paypalHttp.fetch = async (url, init = {}) => {
  const u = new URL(url);
  paypalCalls.push({ path: u.pathname, method: init.method || 'GET' });
  if (u.pathname === '/v1/oauth2/token') {
    const ok = init.headers.Authorization === `Basic ${Buffer.from('CLIENTE:SECRETO').toString('base64')}`;
    return ok ? Response.json({ access_token: 'tok', expires_in: 3600 }) : Response.json({ error: 'invalid_client' }, { status: 401 });
  }
  if (u.pathname === '/v2/checkout/orders' && init.method === 'POST') {
    const body = JSON.parse(init.body);
    const id = `ORD${orders.size + 1}`;
    orders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', amount: body.purchase_units[0].amount.value, body });
    return Response.json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] });
  }
  const m = u.pathname.match(/^\/v2\/checkout\/orders\/(\w+)(\/capture)?$/);
  if (m) {
    const o = orders.get(m[1]);
    if (!o) return Response.json({ name: 'RESOURCE_NOT_FOUND' }, { status: 404 });
    if (m[2]) { o.status = 'COMPLETED'; o.captures = (o.captures || 0) + 1; }
    return Response.json({
      id: o.id, status: o.status, payer: { email_address: 'comprador@paypal.test' },
      purchase_units: o.status === 'COMPLETED' ? [{ payments: { captures: [{ id: `CAP-${o.id}`, status: 'COMPLETED', amount: { value: o.amount } }] } }] : [],
    });
  }
  return Response.json({}, { status: 404 });
};

let server;
let base;
let adminToken;
let ana;
let anaId;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  const admin = db.prepare("INSERT INTO users (email, name, pass_hash, role, plan) VALUES ('jefe@clipviral.test', 'Jefe', ?, 'admin', 'pro247')").run(hash);
  adminToken = createSession(admin.lastInsertRowid, 'prueba');
});
after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, url, body, token) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
};

test('correo: sin configurar no se envía nada; con Gmail, la prueba sale', async () => {
  assert.equal((await call('POST', '/api/admin/correo/prueba', {}, adminToken)).status, 400);
  const cfg = await call('PUT', '/api/admin/correo/config', { user: 'yo@gmail.com', pass: 'abcd efgh ijkl mnop', fromName: 'ClipViral' }, adminToken);
  assert.equal(cfg.body.enabled, true);
  assert.equal(cfg.body.config.host, 'smtp.gmail.com');
  assert.equal(cfg.body.config.port, 465);
  assert.ok(!JSON.stringify(cfg.body).includes('abcd'), 'la contraseña nunca vuelve al panel');
  const r = await call('POST', '/api/admin/correo/prueba', {}, adminToken);
  assert.equal(r.status, 200);
  assert.equal(lastMail('jefe@clipviral.test').subject, 'Prueba de correo de ClipViral');
});

test('registro: crea la cuenta de prueba y manda la bienvenida', async () => {
  const r = await call('POST', '/api/auth/register', { name: 'Ana', email: 'Ana@Cliente.test', password: 'ClaveSegura123', acceptTerms: true });
  assert.equal(r.status, 201);
  ana = r.body.token;
  anaId = r.body.user.id;
  assert.equal(r.body.user.plan.id, 'trial');
  await new Promise((res) => setTimeout(res, 50));
  assert.match(lastMail('ana@cliente.test').subject, /Bienvenido/);
});

test('olvidé mi contraseña: código por correo, vence, máximo 5 intentos', async () => {
  // Un correo sin cuenta recibe la misma respuesta (no se puede averiguar quién tiene cuenta).
  assert.equal((await call('POST', '/api/auth/olvide', { email: 'nadie@cliente.test' })).status, 200);
  assert.equal(lastMail('nadie@cliente.test'), undefined);
  assert.equal((await call('POST', '/api/auth/olvide', { email: 'ana@cliente.test' })).status, 200);
  const code = lastMail('ana@cliente.test').subject.match(/(\d{6})/)[1];
  const wrong = await call('POST', '/api/auth/restablecer', { email: 'ana@cliente.test', code: '000000' === code ? '111111' : '000000', password: 'NuevaClave456' });
  assert.equal(wrong.status, 400);
  const ok = await call('POST', '/api/auth/restablecer', { email: 'ana@cliente.test', code, password: 'NuevaClave456' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  // La sesión vieja se cerró y el código ya no sirve.
  assert.equal((await call('GET', '/api/me', null, ana)).status, 401);
  ana = ok.body.token;
  assert.equal((await call('POST', '/api/auth/restablecer', { email: 'ana@cliente.test', code, password: 'OtraClave789' })).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { email: 'ana@cliente.test', password: 'NuevaClave456' })).status, 200);
  assert.match(lastMail('ana@cliente.test').subject, /contraseña de ClipViral cambió/);
});

test('pagos: sin PayPal configurado avisa; con claves malas lo explica', async () => {
  assert.equal((await call('GET', '/api/pagos/estado')).body.enabled, false);
  const no = await call('POST', '/api/pagos/crear', { plan: 'local' }, ana);
  assert.equal(no.status, 502);
  assert.match(no.body.error, /todavía no están activos/);
  await call('PUT', '/api/admin/pagos/config', { clientId: 'CLIENTE', secret: 'MALO', mode: 'sandbox' }, adminToken);
  const bad = await call('POST', '/api/admin/pagos/probar', {}, adminToken);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /no aceptó el Client ID o el Secret/);
  await call('PUT', '/api/admin/pagos/config', { secret: 'SECRETO' }, adminToken);
  assert.equal((await call('POST', '/api/admin/pagos/probar', {}, adminToken)).status, 200);
  const cfg = await call('GET', '/api/admin/pagos', null, adminToken);
  assert.ok(!JSON.stringify(cfg.body).includes('SECRETO'));
});

test('pagos: pagar con tarjeta suma un mes; renovar suma otro al final', async () => {
  const c = await call('POST', '/api/pagos/crear', { plan: 'local' }, ana);
  assert.equal(c.status, 200);
  assert.match(c.body.url, /paypal\.com\/checkoutnow/);
  assert.equal(c.body.amount, 20);
  const sentOrder = orders.get(c.body.id).body;
  assert.equal(sentOrder.payment_source.paypal.experience_context.landing_page, 'GUEST_CHECKOUT', 'abre con el formulario de tarjeta');
  assert.match(sentOrder.payment_source.paypal.experience_context.return_url, /\/api\/pagos\/vuelta$/);
  // Antes de pagar: nada cambia.
  assert.equal((await call('POST', `/api/pagos/${c.body.id}/verificar`, {}, ana)).body.payment.status, 'creado');
  // El cliente paga y PayPal lo manda de vuelta: se cobra y se activa.
  orders.get(c.body.id).status = 'APPROVED';
  const back = await call('GET', `/api/pagos/vuelta?token=${c.body.id}`);
  assert.equal(back.status, 200);
  assert.match(back.text, /Pago listo/);
  const me = (await call('GET', '/api/me', null, ana)).body.user;
  assert.equal(me.plan.id, 'local');
  assert.equal(me.plan.active, true);
  const days = (new Date(me.plan.expires) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `un mes (${days})`);
  assert.match(lastMail('ana@cliente.test').subject, /Pago recibido/);
  // Volver a la página o verificar otra vez no cobra ni suma dos veces.
  await call('GET', `/api/pagos/vuelta?token=${c.body.id}`);
  await call('POST', `/api/pagos/${c.body.id}/verificar`, {}, ana);
  assert.equal(orders.get(c.body.id).captures, 1);
  assert.equal((await call('GET', '/api/me', null, ana)).body.user.plan.expires, me.plan.expires);
  // Renueva el mismo plan antes de vencer: se suma al final (60 días).
  const c2 = await call('POST', '/api/pagos/crear', { plan: 'local' }, ana);
  orders.get(c2.body.id).status = 'APPROVED';
  assert.equal((await call('POST', `/api/pagos/${c2.body.id}/verificar`, {}, ana)).body.payment.status, 'pagado');
  const days2 = (new Date((await call('GET', '/api/me', null, ana)).body.user.plan.expires) - Date.now()) / 86400000;
  assert.ok(days2 > 59.9 && days2 <= 60, `dos meses (${days2})`);
  assert.equal((await call('GET', '/api/pagos/mios', null, ana)).body.payments.length, 2);
  // Otro cliente no puede ver ni verificar pagos ajenos.
  const otro = createSession(db.prepare("INSERT INTO users (email, name, pass_hash) VALUES ('otro@cliente.test', 'Otro', 'x')").run().lastInsertRowid, 'p');
  assert.equal((await call('POST', `/api/pagos/${c.body.id}/verificar`, {}, otro)).status, 404);
});

test('pagos: cambiar de plan empieza desde hoy; cancelar no cobra; planes ocultos no se venden', () => {
  const now = Date.now();
  const u = { plan: 'local', plan_expires: new Date(now + 20 * 86400000).toISOString() };
  assert.equal(new Date(extendExpiry(u, 'pro', 1, now)).getTime(), now + 30 * 86400000);
  assert.equal(new Date(extendExpiry(u, 'local', 1, now)).getTime(), now + 50 * 86400000);
});

test('pagos: cancelar en PayPal no cobra nada y no se vende un plan oculto', async () => {
  const c = await call('POST', '/api/pagos/crear', { plan: 'pro' }, ana);
  assert.equal(c.body.amount, 30);
  const cancel = await call('GET', `/api/pagos/cancelado?token=${c.body.id}`);
  assert.match(cancel.text, /No se cobró nada/);
  assert.equal(db.prepare('SELECT status FROM payments WHERE order_id = ?').get(c.body.id).status, 'cancelado');
  assert.equal((await call('POST', '/api/pagos/crear', { plan: 'pro247' }, ana)).status, 400);
});

test('admin: licencias (sumar días con aviso, pago manual), detalle y lista de pagos', async () => {
  const add = await call('PATCH', `/api/admin/users/${anaId}`, { addDays: 30, notify: true }, adminToken);
  assert.equal(add.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.match(lastMail('ana@cliente.test').subject, /se actualizó/);
  const manual = await call('POST', `/api/admin/users/${anaId}/pago-manual`, { plan: 'pro', months: 1, amount: 150, note: 'Transferencia' }, adminToken);
  assert.equal(manual.status, 200);
  assert.equal(manual.body.user.plan, 'pro');
  assert.equal(manual.body.user.paid, 190);
  const det = await call('GET', `/api/admin/users/${anaId}/detalle`, null, adminToken);
  assert.equal(det.body.payments.filter((p) => p.status === 'pagado').length, 3);
  assert.equal(det.body.payments.filter((p) => p.status === 'cancelado').length, 1);
  assert.ok(det.body.mails.length >= 3);
  const list = await call('GET', '/api/admin/pagos', null, adminToken);
  assert.equal(list.body.payments.filter((p) => p.status === 'pagado').length, 3);
  // Un cliente no entra a nada de esto.
  assert.equal((await call('GET', '/api/admin/pagos', null, ana)).status, 403);
  assert.equal((await call('POST', `/api/admin/users/${anaId}/pago-manual`, {}, ana)).status, 403);
});

test('resumen: la app avisa cada clip y el panel los cuenta', async () => {
  for (const mode of ['local', 'local', 'ia']) assert.equal((await call('POST', '/api/clips/evento', { mode, seconds: 45, origin: 'manual' }, ana)).status, 200);
  assert.equal((await call('POST', '/api/clips/evento', { mode: 'local' })).status, 401);
  const st = (await call('GET', '/api/admin/stats', null, adminToken)).body;
  assert.equal(st.clipsTotal, 3);
  assert.equal(st.clipsToday, 3);
  assert.deepEqual(st.clipsByMode, { local: 2, ia: 1 });
  assert.equal(st.topClippers[0].n, 3);
  assert.equal(st.incomeTotal, 190);
  assert.equal(st.paymentsEnabled, true);
  const users = (await call('GET', '/api/admin/users?q=ana', null, adminToken)).body.users;
  assert.equal(users[0].clips, 3);
});

test('avisos: correo a un grupo y aviso de vencimiento una sola vez', async () => {
  const pre = await call('POST', '/api/admin/correo/aviso', { to: 'todos', subject: 'Novedades', message: 'Hola\n\nHay versión nueva', preview: true }, adminToken);
  assert.equal(pre.body.count, 2);
  const r = await call('POST', '/api/admin/correo/aviso', { to: `user:${anaId}`, subject: 'Novedades', message: 'Hay versión nueva' }, adminToken);
  assert.equal(r.body.count, 1);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(lastMail('ana@cliente.test').subject, 'Novedades');
  // Vence en 2 días: un aviso, y no se repite.
  db.prepare('UPDATE users SET plan_expires = ? WHERE id = ?').run(new Date(Date.now() + 2 * 86400000).toISOString(), anaId);
  const before = sent.length;
  await checkExpirations();
  await checkExpirations();
  const notices = sent.slice(before).filter((m) => m.to === 'ana@cliente.test');
  assert.equal(notices.length, 1);
  assert.match(notices[0].subject, /vence en 2 días/);
  const log = (await call('GET', '/api/admin/correo', null, adminToken)).body.log;
  assert.ok(log.some((l) => l.kind === 'vence_pronto' && l.ok === 1));
});
