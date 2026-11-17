import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-social-'));
process.env.DATA_DIR = tmp;
process.env.SECRET_KEY = 'clave-de-prueba';

const { app } = await import('../src/index.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

// Simulamos Google: cualquier llamada a sus servidores responde con datos falsos.
const realFetch = globalThis.fetch;
const calls = [];
let fbPerms = [];
let negocios = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    const body = new URLSearchParams(opts.body);
    calls.push(body.get('grant_type'));
    if (body.get('grant_type') === 'authorization_code') {
      return Response.json({ access_token: 'acceso-1', refresh_token: 'renovar-1', expires_in: 3600 });
    }
    return Response.json({ access_token: 'acceso-2', expires_in: 3600 });
  }
  if (u.startsWith('https://www.googleapis.com/youtube/v3/channels')) {
    return Response.json({ items: [{ id: 'UC123', snippet: { title: 'Canal de Prueba', thumbnails: { default: { url: 'https://x/y.jpg' } } } }] });
  }
  // Facebook: código → token corto → token largo → páginas que administra
  if (u.startsWith('https://graph.facebook.com/v23.0/oauth/access_token')) {
    const q = new URL(u).searchParams;
    calls.push(q.get('grant_type') || 'fb_code');
    // Un token de otra app (o vencido) no se puede cambiar por uno largo.
    if (String(q.get('fb_exchange_token')).startsWith('EAAOTRA')) return Response.json({ error: { message: 'Error validating application. Invalid application ID.' } }, { status: 400 });
    // Persona cuya página está dentro de un portfolio comercial (Meta Business Suite).
    if (String(q.get('fb_exchange_token')).startsWith('EAANEG')) return Response.json({ access_token: 'fb-largo-negocio' });
    return Response.json(q.get('grant_type') === 'fb_exchange_token' ? { access_token: 'fb-largo' } : { access_token: 'fb-corto' });
  }
  // Permisos que dio la persona (se cambian en cada prueba)
  if (u.startsWith('https://graph.facebook.com/v23.0/me/permissions')) return Response.json({ data: fbPerms.map((permission) => ({ permission, status: 'granted' })) });
  // Página en un portfolio: /me/accounts viene vacío y se encuentra por el portfolio (owned_pages), con su token aparte.
  if (u.includes('access_token=fb-largo-negocio')) {
    if (u.startsWith('https://graph.facebook.com/v23.0/me/accounts')) return Response.json({ data: [] });
    if (u.startsWith('https://graph.facebook.com/v23.0/me/businesses')) return Response.json({ data: negocios });
    if (u.startsWith('https://graph.facebook.com/v23.0/BIZ1/owned_pages')) return Response.json({ data: [{ id: 'PAGE9', name: 'Página Nueva', instagram_business_account: { id: 'IG99' } }] });
    if (u.startsWith('https://graph.facebook.com/v23.0/BIZ1/client_pages')) return Response.json({ data: [{ id: 'PAGE9', name: 'Página Nueva' }] });
    if (u.startsWith('https://graph.facebook.com/v23.0/PAGE9?')) return Response.json({ id: 'PAGE9', access_token: 'token-p9' });
  }
  if (u.startsWith('https://graph.facebook.com/v23.0/IG99?')) return Response.json({ id: 'IG99', username: 'nueva.ig' });
  if (u.startsWith('https://graph.facebook.com/v23.0/me/accounts')) {
    assert.equal(new URL(u).searchParams.get('access_token'), 'fb-largo');
    return Response.json({ data: [
      { id: 'PAGE1', name: 'Mi Página', access_token: 'token-pagina', picture: { data: { url: 'https://x/p.jpg' } }, instagram_business_account: { id: 'IG77' } },
      { id: 'PAGE2', name: 'Otra Página', access_token: 'token-pagina-2' },
    ] });
  }
  if (u.startsWith('https://graph.facebook.com/v23.0/me?')) return Response.json({ id: 'FBUSER1' });
  // El Instagram unido a la página: se lee su @usuario con el token de la página
  if (u.startsWith('https://graph.facebook.com/v23.0/IG77?')) {
    assert.equal(new URL(u).searchParams.get('access_token'), 'token-pagina');
    return Response.json({ id: 'IG77', username: 'ana.ig' });
  }
  // TikTok: código → token, datos del usuario y anular el permiso al desconectar
  if (u.startsWith('https://open.tiktokapis.com/v2/oauth/token/')) return Response.json({ access_token: 'tt-acceso', refresh_token: 'tt-renovar', expires_in: 86400, open_id: 'tt-open-1' });
  if (u.startsWith('https://open.tiktokapis.com/v2/user/info/')) return Response.json({ data: { user: { open_id: 'tt-open-1', display_name: 'Ana TT', avatar_url: 'https://x/a.jpg' } } });
  if (u.startsWith('https://open.tiktokapis.com/v2/oauth/revoke/')) { calls.push(`revoke:${new URLSearchParams(opts.body).get('token')}`); return Response.json({}); }
  // Instagram: código → token corto → token largo → datos de la cuenta
  if (u.startsWith('https://api.instagram.com/oauth/access_token')) return Response.json({ access_token: 'ig-corto', user_id: 9001 });
  if (u.startsWith('https://graph.instagram.com/access_token')) {
    // Los tokens que da el panel de Meta ya son largos: no se pueden volver a cambiar.
    if (String(new URL(u).searchParams.get('access_token')).startsWith('IG')) return Response.json({ error: { message: 'Session key invalid' } }, { status: 400 });
    return Response.json({ access_token: 'ig-largo', expires_in: 5184000 });
  }
  if (u.startsWith('https://graph.instagram.com/v23.0/me')) {
    assert.match(new URL(u).searchParams.get('fields'), /account_type/);
    if (String(new URL(u).searchParams.get('access_token')).startsWith('IGMALO')) return Response.json({ error: { message: 'Invalid OAuth access token' } }, { status: 400 });
    return Response.json({ id: 'IGAPP1', user_id: 'IGPRO1', username: 'ana.clips', account_type: 'MEDIA_CREATOR' });
  }
  return realFetch(url, opts);
};

let server;
let base;
let adminToken, clienteToken;
let userToken;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const hash = await hashPassword('ClipViral-Prueba-2026');
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan) VALUES ('admin@clipviral.test', 'Admin', ?, 'admin', 'pro247')`).run(hash);
  db.prepare(`INSERT INTO users (email, name, pass_hash, role, plan, plan_expires) VALUES ('ana@clipviral.test', 'Ana', ?, 'admin', 'local', ?)`).run(hash, new Date(Date.now() + 86400000).toISOString());
  const login = async (email) => (await (await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'ClipViral-Prueba-2026' }) })).json()).token;
  adminToken = await login('admin@clipviral.test');
  userToken = await login('ana@clipviral.test');
  // Un cliente normal: no publica en redes ni entra al panel.
  db.prepare(`INSERT INTO users (email, name, pass_hash, plan, plan_expires) VALUES ('carla@clipviral.test', 'Carla', ?, 'local', ?)`).run(hash, new Date(Date.now() + 86400000).toISOString());
  clienteToken = await login('carla@clipviral.test');
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = async (method, url, body, token) => {
  const res = await realFetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json, text };
};

const postForm = (url, fields) => realFetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
});
const anaId = () => db.prepare("SELECT id FROM users WHERE email = 'ana@clipviral.test'").get().id;
const account = (platform) => db.prepare('SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?').get(anaId(), platform);

test('sin claves configuradas no deja conectar', async () => {
  const r = await call('POST', '/api/social/youtube/start', {}, userToken);
  assert.equal(r.status, 503);
});

test('el admin guarda claves y el secreto no se devuelve completo', async () => {
  await call('PUT', '/api/admin/settings', { google_client_id: 'id-google', google_client_secret: 'secreto-google-1234' }, adminToken);
  const r = await call('GET', '/api/admin/settings', null, adminToken);
  assert.equal(r.body.settings.google_client_id, 'id-google');
  assert.ok(!r.body.settings.google_client_secret.includes('secreto'));
  assert.ok(r.body.settings.google_client_secret.endsWith('1234'));
  assert.equal(r.body.social.youtube, true);
  assert.match(r.body.redirects.youtube, /\/api\/social\/youtube\/callback$/);
  // Guardar de nuevo con el valor enmascarado no borra el secreto real
  await call('PUT', '/api/admin/settings', { google_client_secret: r.body.settings.google_client_secret }, adminToken);
  const again = await call('GET', '/api/admin/settings', null, adminToken);
  assert.ok(again.body.settings.google_client_secret.endsWith('1234'));
});

test('conectar YouTube: enlace, regreso de Google y token cifrado', async () => {
  const start = await call('POST', '/api/social/youtube/start', {}, userToken);
  assert.equal(start.status, 200);
  const url = new URL(start.body.url);
  assert.equal(url.host, 'accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  const state = url.searchParams.get('state');

  const bad = await call('GET', '/api/social/youtube/callback?code=abc&state=falso');
  assert.equal(bad.status, 400);

  const cb = await call('GET', `/api/social/youtube/callback?code=abc&state=${state}`);
  assert.equal(cb.status, 200);
  assert.match(cb.text, /Canal de Prueba/);

  // El mismo enlace no sirve dos veces
  assert.equal((await call('GET', `/api/social/youtube/callback?code=abc&state=${state}`)).status, 400);

  const row = db.prepare("SELECT * FROM social_accounts WHERE platform = 'youtube'").get();
  assert.ok(!row.access_token.includes('acceso-1'), 'el token se guarda cifrado');

  const list = await call('GET', '/api/social', null, userToken);
  const yt = list.body.platforms.find((p) => p.id === 'youtube');
  assert.equal(yt.connected, true);
  assert.equal(yt.account.name, 'Canal de Prueba');
  assert.equal(list.body.platforms.find((p) => p.id === 'tiktok').configured, false);
});

test('token vigente y renovación cuando está por vencer', async () => {
  const t1 = await call('POST', '/api/social/youtube/token', {}, userToken);
  assert.equal(t1.body.accessToken, 'acceso-1');
  assert.equal(t1.body.accountId, 'UC123');
  db.prepare("UPDATE social_accounts SET expires_at = ? WHERE platform = 'youtube'").run(Date.now() + 1000);
  const t2 = await call('POST', '/api/social/youtube/token', {}, userToken);
  assert.equal(t2.body.accessToken, 'acceso-2');
  assert.ok(calls.includes('refresh_token'));
});

test('otro usuario no ve la cuenta y se puede desconectar', async () => {
  assert.equal((await call('POST', '/api/social/youtube/token', {}, adminToken)).status, 404);
  await call('DELETE', '/api/social/youtube', null, userToken);
  assert.equal((await call('POST', '/api/social/youtube/token', {}, userToken)).status, 404);
});

test('conectar Facebook: elige la página en el navegador, publica como ella y guarda su Instagram unido', async () => {
  await call('PUT', '/api/admin/settings', { facebook_app_id: 'fb-app', facebook_app_secret: 'secreto-fb-9999' }, adminToken);
  const start = await call('POST', '/api/social/facebook/start', {}, userToken);
  assert.equal(start.status, 200);
  const url = new URL(start.body.url);
  assert.equal(url.host, 'www.facebook.com');
  assert.match(url.searchParams.get('scope'), /pages_manage_posts/);
  const cb = await call('GET', `/api/social/facebook/callback?code=xyz&state=${url.searchParams.get('state')}`);
  assert.equal(cb.status, 200);
  assert.ok(calls.includes('fb_exchange_token'), 'cambia el token corto por uno largo');

  // Lista de páginas para elegir (en inglés para quien revisa en Meta), con el Instagram unido a cada una.
  assert.match(cb.text, /Choose your Facebook Page/);
  assert.match(cb.text, /Elige tu página de Facebook/);
  assert.match(cb.text, /Mi Página/);
  assert.match(cb.text, /Otra Página/);
  assert.match(cb.text, /Instagram: @ana\.ig/);
  assert.match(cb.text, /No Instagram account linked/);
  assert.match(cb.text, /value="PAGE1" checked/);
  const pick = cb.text.match(/name="pick" value="([a-f0-9]{48})"/)?.[1];
  assert.ok(pick, 'el formulario lleva un código de un solo uso');
  // Hasta que elige, no queda conectado (la app sigue esperando).
  assert.equal(account('facebook'), undefined);

  const bad = await postForm('/api/social/facebook/pick', { pick, pageId: 'NOPE' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Choose your Facebook Page/, 'vuelve a mostrar la lista');
  assert.equal(account('facebook'), undefined);
  assert.equal((await postForm('/api/social/facebook/pick', { pick: 'f'.repeat(48), pageId: 'PAGE1' })).status, 400);

  const ok = await postForm('/api/social/facebook/pick', { pick, pageId: 'PAGE1' });
  assert.equal(ok.status, 200);
  const okText = await ok.text();
  assert.match(okText, /Facebook connected/);
  assert.match(okText, /Mi Página/);
  assert.match(okText, /@ana\.ig/);
  assert.equal((await postForm('/api/social/facebook/pick', { pick, pageId: 'PAGE1' })).status, 400, 'el código no sirve dos veces');

  const t = await call('POST', '/api/social/facebook/token', {}, userToken);
  assert.equal(t.body.accessToken, 'token-pagina');
  assert.equal(t.body.accountId, 'PAGE1');
  assert.equal(t.body.extra.igBusinessId, 'IG77');
  const fb = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'facebook');
  assert.equal(fb.connected, true);
  assert.ok(fb.connectedAt);
  assert.equal(fb.needsReconnect, false);
  assert.equal(fb.account.igBusinessId, 'IG77');
  assert.equal(fb.account.instagram, '@ana.ig');
  assert.deepEqual(fb.account.pages.map((p) => p.instagram), ['@ana.ig', null]);
});

test('cuentas conectadas antes de pedir permisos de estadísticas piden reconectar', async () => {
  const ana = db.prepare("SELECT id FROM users WHERE email = 'ana@clipviral.test'").get();
  db.prepare(`INSERT INTO social_accounts (user_id, platform, account_id, account_name, access_token, refresh_token, expires_at)
    VALUES (?, 'tiktok', 'tt1', 'Mi TikTok', 'x', 'y', ?)`).run(ana.id, Date.now() + 86400000);
  const tt = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'tiktok');
  assert.equal(tt.connected, true);
  assert.equal(tt.needsReconnect, true);
});

// ---------- Publicación automática: permisos, páginas legales y avisos de borrado ----------
const { makeSignedRequest, makeTiktokSignature, parseSignedRequest, verifyTiktokSignature } = await import('../src/privacidad.js');
const { cleanRelay } = await import('../src/relay.js');

test('firmas: signed_request de Meta y aviso de TikTok', () => {
  const sr = makeSignedRequest({ user_id: '123' }, 'clave');
  assert.equal(parseSignedRequest(sr, ['otra', 'clave']).user_id, '123');
  assert.equal(parseSignedRequest(sr, ['otra']), null, 'con otra clave no vale');
  assert.equal(parseSignedRequest(`x${sr}`, ['clave']), null, 'firma alterada');
  assert.equal(parseSignedRequest('basura', ['clave']), null);
  const body = '{"event":"authorization.removed"}';
  assert.ok(verifyTiktokSignature(makeTiktokSignature(body, 's1'), body, 's1'));
  assert.ok(!verifyTiktokSignature(makeTiktokSignature(body, 's1'), `${body} `, 's1'), 'cuerpo cambiado');
  assert.ok(!verifyTiktokSignature(makeTiktokSignature(body, 's1', 1000), body, 's1'), 'aviso demasiado viejo');
  assert.ok(!verifyTiktokSignature('t=1,s=zz', body, 's1'));
});

test('Facebook: pide solo los permisos necesarios y usa el ID de configuración si hay', async () => {
  let url = new URL((await call('POST', '/api/social/facebook/start', {}, userToken)).body.url);
  const scope = url.searchParams.get('scope').split(',');
  assert.deepEqual(scope, ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'instagram_basic']);
  assert.ok(!scope.includes('business_management'));
  await call('PUT', '/api/admin/settings', { facebook_config_id: 'CFG1' }, adminToken);
  url = new URL((await call('POST', '/api/social/facebook/start', {}, userToken)).body.url);
  assert.equal(url.searchParams.get('config_id'), 'CFG1');
  assert.equal(url.searchParams.get('scope'), null);
  await call('PUT', '/api/admin/settings', { facebook_config_id: '' }, adminToken);
});

test('Facebook: guarda todas las páginas y deja elegir en cuál publicar', async () => {
  const fb = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'facebook');
  assert.equal(fb.account.pageId, 'PAGE1');
  assert.deepEqual(fb.account.pages.map((p) => p.id), ['PAGE1', 'PAGE2']);
  assert.ok(!JSON.stringify(fb).includes('token'), 'la app no recibe tokens de páginas');
  assert.equal((await call('POST', '/api/social/facebook/page', { pageId: 'NOPE' }, userToken)).status, 404);
  const r = await call('POST', '/api/social/facebook/page', { pageId: 'PAGE2' }, userToken);
  assert.equal(r.status, 200);
  const t = await call('POST', '/api/social/facebook/token', {}, userToken);
  assert.equal(t.body.accessToken, 'token-pagina-2');
  assert.equal(t.body.accountId, 'PAGE2');
  assert.equal(t.body.extra.pages, undefined, 'no se mandan las páginas con su token');
  assert.equal(account('facebook').account_name, 'Otra Página');
  assert.match(account('facebook').owner_ids, /,FBUSER1,/);
});

test('Meta: quitar el permiso desde Facebook borra la conexión (solo con firma válida)', async () => {
  const bad = await postForm('/api/meta/facebook/deauthorize', { signed_request: makeSignedRequest({ user_id: 'FBUSER1' }, 'clave-falsa') });
  assert.equal(bad.status, 400);
  assert.ok(account('facebook'), 'con firma falsa no se borra nada');
  const ok = await postForm('/api/meta/facebook/deauthorize', { signed_request: makeSignedRequest({ user_id: 'FBUSER1' }, 'secreto-fb-9999') });
  assert.equal(ok.status, 200);
  assert.equal(account('facebook'), undefined);
});

test('Instagram: conectar guarda los ID de la persona para poder borrarla después', async () => {
  await call('PUT', '/api/admin/settings', { instagram_app_id: 'ig-app', instagram_app_secret: 'secreto-ig-7777' }, adminToken);
  const start = new URL((await call('POST', '/api/social/instagram/start', {}, userToken)).body.url);
  assert.equal(start.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights');
  const cb = await call('GET', `/api/social/instagram/callback?code=c1&state=${start.searchParams.get('state')}`);
  assert.equal(cb.status, 200);
  assert.match(cb.text, /Instagram connected/);
  assert.match(cb.text, /@ana\.clips/);
  assert.match(cb.text, /Creator account/);
  const row = account('instagram');
  assert.equal(row.account_id, 'IGPRO1');
  for (const id of ['9001', 'IGAPP1', 'IGPRO1']) assert.ok(row.owner_ids.includes(`,${id},`));
  // La app muestra qué cuenta quedó conectada.
  const ig = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'instagram');
  assert.equal(ig.account.name, '@ana.clips');
  assert.equal(ig.account.username, 'ana.clips');
  assert.equal(ig.account.accountType, 'MEDIA_CREATOR');
});

test('Instagram: el video pasa un momento por el servidor y se borra', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(4096, 7)], { type: 'video/mp4' }), 'clip.mp4');
  const up = await realFetch(`${base}/api/social/relay`, { method: 'POST', headers: { Authorization: `Bearer ${userToken}` }, body: fd });
  assert.equal(up.status, 201);
  const { id, url } = await up.json();
  assert.match(url, new RegExp(`/media/${id}\\.mp4$`));
  const media = await realFetch(`${base}/media/${id}.mp4`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  assert.equal((await media.arrayBuffer()).byteLength, 4096);
  assert.equal((await realFetch(`${base}/media/..%2Fclipviral.db`)).status, 404);
  // Otro usuario no lo puede borrar; el dueño sí.
  await call('DELETE', `/api/social/relay/${id}`, null, adminToken);
  assert.equal((await realFetch(`${base}/media/${id}.mp4`)).status, 200);
  await call('DELETE', `/api/social/relay/${id}`, null, userToken);
  assert.equal((await realFetch(`${base}/media/${id}.mp4`)).status, 404);
  // Sin Instagram conectado no se puede usar.
  assert.equal((await realFetch(`${base}/api/social/relay`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd })).status, 404);
  // Lo de más de 24 horas se borra solo.
  db.prepare('INSERT INTO relay_files (id, user_id, size, created_at) VALUES (?, ?, 1, ?)').run('a'.repeat(32), anaId(), Date.now() - 25 * 3600000);
  assert.equal(cleanRelay(), 1);
});

test('Meta: pedido de borrado de datos devuelve código y la página muestra el estado', async () => {
  const r = await postForm('/api/meta/instagram/data-deletion', { signed_request: makeSignedRequest({ user_id: 'IGAPP1' }, 'secreto-ig-7777') });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.match(body.confirmation_code, /^[A-F0-9]{16}$/);
  assert.ok(body.url.endsWith(`/borrar-datos?codigo=${body.confirmation_code}`));
  assert.equal(account('instagram'), undefined, 'se borró la cuenta con sus tokens');
  const es = await call('GET', `/borrar-datos?codigo=${body.confirmation_code}`);
  assert.equal(es.status, 200);
  assert.match(es.text, /completado/);
  assert.match(es.text, /1 conexión\(es\) de Instagram/);
  assert.match((await call('GET', `/data-deletion?code=${body.confirmation_code}`)).text, /completed/);
  assert.match((await call('GET', '/borrar-datos?codigo=FFFFFFFFFFFFFFFF')).text, /No encontramos ese código/);
});

test('TikTok: pide solo los permisos necesarios, anula el permiso al desconectar y escucha el aviso firmado', async () => {
  await call('PUT', '/api/admin/settings', { tiktok_client_key: 'tt-key', tiktok_client_secret: 'secreto-tt-5555' }, adminToken);
  const connect = async () => {
    const url = new URL((await call('POST', '/api/social/tiktok/start', {}, userToken)).body.url);
    assert.equal(url.searchParams.get('scope'), 'user.info.basic,user.info.stats,video.publish,video.list');
    assert.equal((await call('GET', `/api/social/tiktok/callback?code=t1&state=${url.searchParams.get('state')}`)).status, 200);
  };
  await connect();
  assert.equal(account('tiktok').owner_ids, ',tt-open-1,');
  await call('DELETE', '/api/social/tiktok', null, userToken);
  assert.ok(calls.includes('revoke:tt-acceso'), 'se le avisa a TikTok');
  assert.equal(account('tiktok'), undefined);

  await connect();
  const raw = JSON.stringify({ client_key: 'tt-key', event: 'authorization.removed', create_time: Math.floor(Date.now() / 1000), user_openid: 'tt-open-1', content: '{"reason":1}' });
  const send = (sig) => realFetch(`${base}/api/tiktok/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'TikTok-Signature': sig }, body: raw });
  assert.equal((await send(makeTiktokSignature(raw, 'otra-clave'))).status, 401);
  assert.ok(account('tiktok'), 'sin firma válida no se borra');
  assert.equal((await send(makeTiktokSignature(raw, 'secreto-tt-5555'))).status, 200);
  assert.equal(account('tiktok'), undefined);
});

test('páginas públicas: inicio, privacidad, términos y borrar datos en español e inglés', async () => {
  for (const url of ['/', '/en', '/privacidad', '/privacy', '/terminos', '/terms', '/borrar-datos', '/data-deletion']) {
    const r = await call('GET', url);
    assert.equal(r.status, 200, url);
    assert.match(r.text, /<html lang="(es|en)">/);
  }
  assert.match((await call('GET', '/privacidad')).text, /\[nombre del responsable\]/, 'marca lo que falta completar');
  await call('PUT', '/api/admin/settings', { legal_name: 'Clips SRL', legal_email: 'privacidad@clipviral.test', legal_country: 'República Dominicana' }, adminToken);
  const priv = (await call('GET', '/privacy')).text;
  assert.match(priv, /Clips SRL/);
  assert.match(priv, /mailto:privacidad@clipviral\.test/);
  assert.match(priv, /Limited Use/);
  assert.match(priv, /video\.publish/);
  assert.doesNotMatch(priv, /<mark>/);
  assert.match((await call('GET', '/terms')).text, /Music Usage Confirmation/);
  assert.match((await call('GET', '/terminos')).text, /República Dominicana/);
  assert.match((await call('GET', '/borrar-datos')).text, /Desconectar/);
  assert.match((await call('GET', '/admin/')).text, /Panel de admin/, 'el panel sigue en /admin/');
});

test('admin: lista de lo que falta por red con las direcciones para copiar', async () => {
  assert.equal((await call('GET', '/api/admin/settings', null, clienteToken)).status, 403);
  let c = (await call('GET', '/api/admin/settings', null, adminToken)).body.checklist;
  assert.equal(c.https, false, 'localhost no sirve para las redes');
  assert.equal(c.common[0].ok, false);
  await call('PUT', '/api/admin/settings', { public_url: 'https://api.clipviral.test/' }, adminToken);
  c = (await call('GET', '/api/admin/settings', null, adminToken)).body.checklist;
  assert.equal(c.https, true);
  assert.equal(c.commonReady, c.commonTotal, 'https y datos legales listos');
  const copy = (net, re) => c.networks[net].items.find((i) => re.test(i.label))?.copy;
  assert.equal(copy('instagram', /Deauthorize/), 'https://api.clipviral.test/api/meta/instagram/deauthorize');
  assert.equal(copy('instagram', /eliminación de datos/), 'https://api.clipviral.test/api/meta/instagram/data-deletion');
  assert.equal(copy('facebook', /eliminación de datos/), 'https://api.clipviral.test/api/meta/facebook/data-deletion');
  assert.equal(copy('tiktok', /Webhook/), 'https://api.clipviral.test/api/tiktok/webhook');
  assert.equal(copy('tiktok', /Redirect URI/), 'https://api.clipviral.test/api/social/tiktok/callback');
  assert.equal(copy('tiktok', /Privacy/), 'https://api.clipviral.test/privacy');
  assert.equal(copy('tiktok', /scopes/), 'user.info.basic, user.info.stats, video.publish, video.list');
  assert.equal(c.networks.tiktok.ready, c.networks.tiktok.total, 'claves de TikTok cargadas');
  assert.equal(c.networks.youtube.ready, c.networks.youtube.total);
  await call('PUT', '/api/admin/settings', { public_url: '' }, adminToken);
});

// ---------- Uso personal: conectar pegando un token (sin el botón de inicio de sesión) ----------
test('uso personal: Facebook con un token de usuario del Explorador (se cambia por uno largo y lista las páginas)', async () => {
  const { setSetting, getSetting } = await import('../src/db.js');
  const manual = (platform, token, who = userToken) => call('POST', `/api/social/${platform}/manual`, { token }, who);
  const long = (s) => `${s}${'x'.repeat(60)}`;
  assert.equal((await manual('tiktok', long('tt'))).status, 404, 'TikTok no se conecta con token');
  assert.equal((await manual('facebook', 'corto')).status, 400);
  assert.equal((await manual('facebook', `${long('EAA')} con espacios`)).status, 400);
  // Sin la clave secreta en el panel no se puede (el token no podría durar).
  const secret = getSetting('facebook_app_secret');
  setSetting('facebook_app_secret', '');
  const noKeys = await manual('facebook', long('EAAuser'));
  assert.equal(noKeys.status, 503);
  assert.match(noKeys.body.error, /panel de admin/);
  setSetting('facebook_app_secret', secret);

  // Token de otra app: mensaje claro.
  const other = await manual('facebook', long('EAAOTRA'));
  assert.equal(other.status, 400);
  assert.match(other.body.error, /elegida tu app/);
  // Le falta el permiso para publicar.
  fbPerms = ['pages_show_list', 'pages_read_engagement', 'public_profile'];
  const noPost = await manual('facebook', long('EAAuser'));
  assert.equal(noPost.status, 400);
  assert.match(noPost.body.error, /faltan permisos: pages_manage_posts/);
  assert.equal(account('facebook'), undefined);

  // Con todo: queda conectado como la página, con el token de la página (no el pegado).
  fbPerms = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'public_profile'];
  const ok = await manual('facebook', long('EAAuser'));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.account, 'Mi Página');
  assert.equal(ok.body.pageId, 'PAGE1');
  assert.deepEqual(ok.body.pages.map((p) => [p.id, p.instagram]), [['PAGE1', '@ana.ig'], ['PAGE2', null]]);
  assert.equal(ok.body.warnings.length, 3, 'avisa que faltan read_insights, instagram_basic e instagram_content_publish');
  assert.match(ok.body.warnings.join(' '), /instagram_content_publish/);
  assert.ok(!JSON.stringify(ok.body).includes('token-pagina'), 'la app no recibe tokens');
  const t = await call('POST', '/api/social/facebook/token', {}, userToken);
  assert.equal(t.body.accessToken, 'token-pagina');
  assert.match(account('facebook').owner_ids, /,FBUSER1,/, 'se puede borrar si quita el permiso desde Facebook');
  assert.ok(account('facebook').expires_at > Date.now() + 300 * 86400000, 'el token de página no vence');
  // Después elige otra página como siempre.
  assert.equal((await call('POST', '/api/social/facebook/page', { pageId: 'PAGE2' }, userToken)).status, 200);
  fbPerms = [];
});

test('uso personal: Instagram con el token que genera el panel de Meta', async () => {
  const manual = (token) => call('POST', '/api/social/instagram/manual', { token }, userToken);
  const bad = await manual(`IGMALO${'x'.repeat(60)}`);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Instagram no aceptó el token/);
  // El token del panel ya dura 60 días: no se puede cambiar y se usa tal cual.
  const token = `IGAA${'y'.repeat(60)}`;
  const ok = await manual(token);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.account, '@ana.clips');
  const t = await call('POST', '/api/social/instagram/token', {}, userToken);
  assert.equal(t.body.accessToken, token);
  assert.equal(t.body.accountId, 'IGPRO1');
  const ig = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'instagram');
  assert.equal(ig.account.accountType, 'MEDIA_CREATOR');
});

test('uso personal: página dentro de un portfolio comercial (no sale en /me/accounts)', async () => {
  const manual = (token) => call('POST', '/api/social/facebook/manual', { token }, userToken);
  await call('DELETE', '/api/social/facebook', null, userToken);
  fbPerms = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'instagram_basic'];
  // Sin business_management Facebook no muestra los portfolios: mensaje que dice qué hacer.
  negocios = [];
  const none = await manual(`EAANEG${'z'.repeat(60)}`);
  assert.equal(none.status, 400);
  assert.match(none.body.error, /business_management/);
  assert.equal(account('facebook'), undefined);
  // Con business_management: la encuentra por el portfolio y pide su token aparte.
  negocios = [{ id: 'BIZ1' }];
  const ok = await manual(`EAANEG${'z'.repeat(60)}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.account, 'Página Nueva');
  assert.deepEqual(ok.body.pages.map((p) => [p.id, p.instagram]), [['PAGE9', '@nueva.ig']], 'sin repetir la página');
  assert.equal((await call('POST', '/api/social/facebook/token', {}, userToken)).body.accessToken, 'token-p9');
  fbPerms = [];
  negocios = [];
});

test('Instagram a través de la página: sin conectarlo aparte, se publica con el Instagram unido a la página de Facebook', async () => {
  // Facebook conectado a PAGE9 (con su Instagram @nueva.ig) por la prueba anterior; se quita el Instagram conectado aparte.
  await call('DELETE', '/api/social/instagram', null, userToken);
  let ig = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'instagram');
  assert.equal(ig.connected, true);
  assert.equal(ig.viaFacebook, true);
  assert.equal(ig.account.name, '@nueva.ig');
  assert.equal(ig.account.pageName, 'Página Nueva');
  assert.ok(!JSON.stringify(ig).includes('token'), 'la app no recibe tokens');
  const t = await call('POST', '/api/social/instagram/token', {}, userToken);
  assert.equal(t.status, 200);
  assert.equal(t.body.accessToken, 'fb-largo-negocio', 'usa el token de usuario (Meta lo pide para subir el video)');
  assert.equal(t.body.accountId, 'IG99');
  assert.deepEqual(t.body.extra, { via: 'facebook', pageId: 'PAGE9' });
  // Facebook sigue con el token de la página, y el de usuario no sale del servidor.
  const fbTok = await call('POST', '/api/social/facebook/token', {}, userToken);
  assert.equal(fbTok.body.accessToken, 'token-p9');
  assert.ok(!JSON.stringify(fbTok.body.extra).includes('userToken'));
  assert.ok(!account('facebook').extra.includes('fb-largo-negocio'), 'el token de usuario se guarda cifrado');
  // Cuando el token de usuario vence, pide reconectar.
  const row = account('facebook');
  db.prepare("UPDATE social_accounts SET extra = ? WHERE user_id = ? AND platform = 'facebook'").run(JSON.stringify({ ...JSON.parse(row.extra), userTokenExpiresAt: Date.now() - 1000 }), anaId());
  const expired = await call('POST', '/api/social/instagram/token', {}, userToken);
  assert.equal(expired.status, 401);
  assert.equal(expired.body.reconnect, true);
  // Sin Facebook, Instagram vuelve a "sin conectar".
  await call('DELETE', '/api/social/facebook', null, userToken);
  ig = (await call('GET', '/api/social', null, userToken)).body.platforms.find((p) => p.id === 'instagram');
  assert.equal(ig.connected, false);
  assert.equal((await call('POST', '/api/social/instagram/token', {}, userToken)).status, 404);
});
