// Pruebas de la publicación automática (Instagram y Facebook), la aprobación de TikTok y los subidores (APIs simuladas).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { autoPlan, checkTiktokApproval, tiktokPostOptions, creatorInfo, igTrimNeeded, igTrimArgs } = require('../engine/publicar');
const { UPLOADERS, tiktokCreatorInfo } = require('../engine/redes');
const { UploadQueue } = require('../engine/subidas');
const { Sugerencias, buildSnapshot } = require('../engine/sugerencias');

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime(); // 4 nov 2026, 10:00
const PLANTILLA = '{gancho}\n\n{hashtags}';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cv-pub-'));
const clipLocal = (id, score, extra = {}) => ({
  id, score, title: `Clip ${id}`, hashtags: ['#clips'], reason: 'Explosión en el chat', file: `C:/clips/${id}.mp4`, thumb: null,
  start: 10, duration: 40, stream: { channel: 'Canal' }, ...extra,
});

/** Simula las APIs de las redes: cada prueba dice qué responder. Las esperas de 5 s pasan al instante. */
async function withFakeApis(handler, fn) {
  const realFetch = globalThis.fetch;
  const realTimeout = global.setTimeout;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body)
      : typeof opts.body === 'string' ? (() => { try { return JSON.parse(opts.body); } catch { return opts.body; } })() : null;
    calls.push({ url: u, method: opts.method, headers: opts.headers || {}, body });
    const r = await handler(u, body, opts);
    if (r) return r;
    throw new Error(`llamada inesperada ${u}`);
  };
  global.setTimeout = (cb, ms, ...args) => realTimeout(cb, ms >= 1000 ? 0 : ms, ...args);
  try { return await fn(calls); } finally { globalThis.fetch = realFetch; global.setTimeout = realTimeout; }
}
const ok = (data) => Response.json({ data, error: { code: 'ok', message: '' } });

// ---------- Publicación automática ----------
test('publicar sola: programa Instagram y Facebook a su hora sugerida, una sola vez y nunca TikTok ni YouTube', () => {
  const clips = [clipLocal('a', 9), clipLocal('b', 8), clipLocal('c', 7), clipLocal('d', 6)];
  const store = clips.map((c, i) => ({ id: c.id, clipId: c.id, status: 'nueva', addedAt: NOW - i, hechas: {} }));
  store[1].hechas = { instagram: NOW - 5000 };       // b: ya lo subió a Instagram a mano
  store[2].sinAuto = { facebook: true };             // c: canceló la automática en Facebook
  store[3].status = 'descartada';                    // d: descartado
  const jobs = [{ id: 'j1', clipId: 'a', platform: 'facebook', status: 'cancelado', scheduledAt: NOW }];
  const snap = buildSnapshot({ store, clips, jobs, plantilla: PLANTILLA, redes: ['tiktok', 'instagram', 'youtube', 'facebook'], now: NOW });
  const plan = autoPlan({ items: snap.items, redesOn: ['instagram', 'facebook', 'tiktok'], connected: ['instagram', 'facebook', 'tiktok', 'youtube'], jobs });
  const got = plan.map((p) => `${p.clipId}:${p.red}`).sort();
  assert.deepEqual(got, ['a:instagram', 'b:facebook', 'c:instagram'], 'a/facebook ya tuvo una subida (cancelada): no se repite');
  for (const p of plan) {
    const it = snap.items.find((i) => i.clipId === p.clipId);
    assert.equal(p.at, it.horas[p.red], 'usa la hora sugerida');
    assert.equal(p.caption, it.textos[p.red].texto, 'y el texto armado para esa red');
    assert.equal(p.title, it.textos[p.red].titulo);
  }
  assert.deepEqual(autoPlan({ items: snap.items, redesOn: ['instagram'], connected: [], jobs }), [], 'sin cuenta conectada no programa');
  assert.deepEqual(autoPlan({ items: snap.items, redesOn: [], connected: ['instagram'], jobs }), [], 'apagado no programa');
});

test('publicar sola: lo programado conserva su hora y las demás redes no la repiten', () => {
  const clips = [clipLocal('a', 9), clipLocal('b', 8)];
  const store = clips.map((c, i) => ({ id: c.id, clipId: c.id, status: 'nueva', addedAt: NOW - i, hechas: {} }));
  const first = buildSnapshot({ store, clips, plantilla: PLANTILLA, redes: ['instagram'], now: NOW });
  const hourA = first.items.find((i) => i.id === 'a').horas.instagram;
  const jobs = [{ id: 'j', clipId: 'a', platform: 'instagram', status: 'pendiente', scheduledAt: hourA, origen: 'sola' }];
  const snap = buildSnapshot({ store, clips, jobs, plantilla: PLANTILLA, redes: ['instagram'], now: NOW });
  const a = snap.items.find((i) => i.id === 'a');
  const b = snap.items.find((i) => i.id === 'b');
  assert.deepEqual(a.programadas.instagram, { id: 'j', at: hourA, status: 'pendiente', origen: 'sola' });
  assert.equal(a.horas.instagram, undefined, 'no se le busca otra hora');
  assert.ok(b.horas.instagram && b.horas.instagram !== hourA, 'el otro clip no choca con esa hora');
  assert.deepEqual(autoPlan({ items: snap.items, redesOn: ['instagram'], connected: ['instagram'], jobs }).map((p) => p.clipId), ['b']);
});

test('sugerencias: lo publicado y lo cancelado quedan anotados aunque se limpie la lista de subidas', () => {
  const file = path.join(tmpDir(), 's.json');
  const s = new Sugerencias({ file, now: () => NOW });
  s.add('a');
  assert.ok(s.setHecha('a', 'instagram', NOW + 1));
  assert.ok(s.skipAuto('a', 'facebook'));
  assert.equal(s.skipAuto('a', 'facebook'), null, 'no se guarda dos veces');
  const again = new Sugerencias({ file });
  assert.equal(again.get('a').hechas.instagram, NOW + 1);
  assert.equal(again.get('a').sinAuto.facebook, true);
  assert.equal(again.setHecha('zzz', 'instagram'), null);
});

// ---------- TikTok: reglas de la pantalla de aprobación ----------
const INFO = creatorInfo({
  creator_nickname: 'Ana', creator_username: 'ana.clips', creator_avatar_url: 'https://x/a.jpg',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY', 'ALGO_RARO'],
  comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 180,
});

test('TikTok: lee la cuenta (apodo, foto, privacidad permitida y lo que tiene apagado)', () => {
  assert.equal(INFO.nickname, 'Ana');
  assert.equal(INFO.username, 'ana.clips');
  assert.deepEqual(INFO.privacyOptions, ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], 'solo opciones conocidas');
  assert.equal(INFO.duetDisabled, true);
  assert.equal(INFO.maxDuration, 180);
});

test('TikTok: la aprobación exige privacidad elegida, aviso comercial completo y confirmación', () => {
  const base = { privacy: 'PUBLIC_TO_EVERYONE', consent: true, caption: 'Hola' };
  assert.equal(checkTiktokApproval(base, INFO, { duration: 40 }), null);
  assert.match(checkTiktokApproval({ ...base, privacy: '' }, INFO), /Elige quién puede ver/);
  assert.match(checkTiktokApproval({ ...base, privacy: 'MUTUAL_FOLLOW_FRIENDS' }, INFO), /no está disponible/);
  assert.match(checkTiktokApproval({ ...base, disclose: true }, INFO), /tu marca, a un tercero o ambos/);
  assert.equal(checkTiktokApproval({ ...base, disclose: true, brandOrganic: true }, INFO), null);
  assert.match(checkTiktokApproval({ ...base, privacy: 'SELF_ONLY', disclose: true, brandContent: true }, INFO), /no puede ser privado/);
  assert.equal(checkTiktokApproval({ ...base, privacy: 'SELF_ONLY', disclose: false, brandContent: true }, INFO), null, 'sin el aviso encendido no cuenta');
  assert.match(checkTiktokApproval({ ...base, consent: false }, INFO), /confirmación/);
  assert.match(checkTiktokApproval(base, INFO, { duration: 200 }), /hasta 3 min/);
  assert.match(checkTiktokApproval({ ...base, caption: 'x'.repeat(2201) }, INFO), /2200/);
});

test('TikTok: solo se guarda lo que la persona eligió y su cuenta permite', () => {
  const o = tiktokPostOptions({ privacy: 'FOLLOWER_OF_CREATOR', allowComment: true, allowDuet: true, allowStitch: false, disclose: false, brandContent: true, consent: true }, INFO, NOW);
  assert.deepEqual(o, {
    privacy: 'FOLLOWER_OF_CREATOR', allowComment: true, allowDuet: false, allowStitch: false,
    brandOrganic: false, brandContent: false, consentAt: NOW, account: 'ana.clips',
  });
});

// ---------- TikTok: subida (API simulada) ----------
const CREATOR = { creator_nickname: 'Ana', creator_username: 'ana.clips', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 600 };

test('TikTok: publica con lo que se aprobó (privacidad, interacciones y contenido comercial) y sigue el estado', async () => {
  const file = path.join(tmpDir(), 'c.mp4');
  fs.writeFileSync(file, Buffer.alloc(3000, 1));
  const approved = { privacy: 'PUBLIC_TO_EVERYONE', allowComment: true, allowDuet: false, allowStitch: true, brandOrganic: true, brandContent: false, consentAt: NOW };
  let polls = 0;
  await withFakeApis((u) => {
    if (u.endsWith('/creator_info/query/')) return ok(CREATOR);
    if (u.endsWith('/video/init/')) return ok({ publish_id: 'P1', upload_url: 'https://upload.tiktok.test/u1' });
    if (u.startsWith('https://upload.tiktok.test/')) return new Response(null, { status: 201 });
    if (u.endsWith('/status/fetch/')) { polls += 1; return ok(polls < 2 ? { status: 'PROCESSING_UPLOAD' } : { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7001] }); }
    return null;
  }, async (calls) => {
    const notes = [];
    const r = await UPLOADERS.tiktok({ file, caption: 'Mi texto #fyp', tiktok: approved, duration: 40, token: 'tk', onProgress: (p, n) => n && notes.push(n) });
    const init = calls.find((c) => c.url.endsWith('/video/init/')).body;
    assert.deepEqual(init.post_info, {
      title: 'Mi texto #fyp', privacy_level: 'PUBLIC_TO_EVERYONE',
      disable_comment: false, disable_duet: true, disable_stitch: true, // Stitch lo tiene apagado en su cuenta
      brand_organic_toggle: true, brand_content_toggle: false, video_cover_timestamp_ms: 1000,
    });
    assert.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 3000, chunk_size: 3000, total_chunk_count: 1 });
    assert.equal(calls.find((c) => c.url.startsWith('https://upload.tiktok.test/')).headers['Content-Range'], 'bytes 0-2999/3000');
    assert.equal(r.url, 'https://www.tiktok.com/@ana.clips/video/7001');
    assert.match(notes[0], /procesando/, 'avisa que TikTok tarda unos minutos');
  });
});

test('TikTok: sin aprobación no envía nada, y si la cuenta cambió no publica', async () => {
  const file = path.join(tmpDir(), 'c.mp4');
  fs.writeFileSync(file, Buffer.alloc(100, 1));
  await withFakeApis((u) => (u.endsWith('/creator_info/query/') ? ok(CREATOR) : null), async (calls) => {
    await assert.rejects(UPLOADERS.tiktok({ file, caption: 'x', token: 'tk' }), (e) => /falta tu aprobación/.test(e.message) && e.status === 400);
    assert.equal(calls.length, 0, 'ni siquiera se consulta TikTok');
    // Aprobó "Seguidores" pero su cuenta ya no lo ofrece: no se cambia la privacidad por su cuenta.
    await assert.rejects(UPLOADERS.tiktok({ file, caption: 'x', token: 'tk', tiktok: { privacy: 'FOLLOWER_OF_CREATOR', consentAt: NOW } }), /no está disponible/);
    assert.ok(!calls.some((c) => c.url.endsWith('/video/init/')), 'no se envía el video');
  });
});

test('TikTok: errores en palabras sencillas (límite del día, app sin aprobar, conexión vencida)', async () => {
  const fail = (code, status = 200) => Response.json({ data: {}, error: { code, message: 'x' } }, { status });
  await withFakeApis(() => fail('spam_risk_too_many_posts'), async () => {
    await assert.rejects(tiktokCreatorInfo('tk'), (e) => /máximo de videos de hoy/.test(e.message) && e.status === 403);
  });
  await withFakeApis((u) => (u.endsWith('/creator_info/query/') ? ok(CREATOR) : fail('unaudited_client_can_only_post_to_private_accounts', 403)), async () => {
    const file = path.join(tmpDir(), 'c.mp4');
    fs.writeFileSync(file, Buffer.alloc(100, 1));
    await assert.rejects(UPLOADERS.tiktok({ file, caption: 'x', token: 'tk', tiktok: { privacy: 'PUBLIC_TO_EVERYONE', consentAt: NOW } }), /todavía no aprobó ClipViral/);
  });
  await withFakeApis(() => fail('access_token_invalid', 401), async () => {
    await assert.rejects(tiktokCreatorInfo('tk'), (e) => e.reconnect === true);
  });
});

// ---------- Instagram y Facebook ----------
test('Instagram: si la subida directa no funciona, el video pasa por el servidor y se borra después', async () => {
  const file = path.join(tmpDir(), 'c.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  const relayLog = [];
  const relay = { put: async (f) => { relayLog.push(`put:${path.basename(f)}`); return { id: 'R1', url: 'https://api.clipviral.test/media/R1.mp4' }; }, remove: async (id) => { relayLog.push(`remove:${id}`); } };
  await withFakeApis((u, body) => {
    if (u.endsWith('/IG1/media') && body.upload_type === 'resumable') return Response.json({ error: { message: 'upload_type no soportado' } }, { status: 400 });
    if (u.endsWith('/IG1/media') && body.video_url) return Response.json({ id: 'CONT2' });
    if (u.includes('/CONT2?fields=status_code')) return Response.json({ status_code: 'FINISHED' });
    if (u.endsWith('/IG1/media_publish')) return Response.json({ id: 'MEDIA9' });
    if (u.includes('/MEDIA9?fields=permalink')) return Response.json({ permalink: 'https://www.instagram.com/reel/abc/' });
    return null;
  }, async (calls) => {
    const r = await UPLOADERS.instagram({ file, caption: 'Texto IG', token: 'tk', accountId: 'IG1', relay, duration: 40 });
    assert.equal(r.url, 'https://www.instagram.com/reel/abc/');
    assert.deepEqual(relayLog, ['put:c.mp4', 'remove:R1']);
    const viaUrl = calls.find((c) => c.body?.video_url);
    assert.equal(viaUrl.body.video_url, 'https://api.clipviral.test/media/R1.mp4');
    assert.equal(viaUrl.body.caption, 'Texto IG');
    assert.equal(viaUrl.body.media_type, 'REELS');
  });
});

test('Instagram: con la subida directa no usa el servidor', async () => {
  const file = path.join(tmpDir(), 'c.mp4');
  fs.writeFileSync(file, Buffer.alloc(1024, 1));
  let used = false;
  const relay = { put: async () => { used = true; return {}; }, remove: async () => {} };
  await withFakeApis((u, body) => {
    if (u.endsWith('/IG1/media') && body.upload_type === 'resumable') return Response.json({ id: 'CONT1', uri: 'https://rupload.facebook.com/ig-api-upload/v23.0/CONT1' });
    if (u.startsWith('https://rupload.facebook.com/')) return Response.json({ success: true });
    if (u.includes('/CONT1?fields=status_code')) return Response.json({ status_code: 'FINISHED' });
    if (u.endsWith('/IG1/media_publish')) return Response.json({ id: 'M1' });
    if (u.includes('/M1?fields=permalink')) return Response.json({ permalink: 'https://www.instagram.com/reel/x/' });
    return null;
  }, async () => {
    await UPLOADERS.instagram({ file, caption: 'x', token: 'tk', accountId: 'IG1', relay });
    assert.equal(used, false);
  });
});

test('Instagram a través de la página de Facebook: misma subida, con la dirección de Facebook y sin pasar por el servidor', async () => {
  const file = path.join(tmpDir(), 'd.mp4');
  fs.writeFileSync(file, Buffer.alloc(1024, 1));
  let used = false;
  const relay = { put: async () => { used = true; return {}; }, remove: async () => {} };
  const extra = { via: 'facebook', pageId: 'PAGE1' };
  await withFakeApis((u, body) => {
    if (!u.startsWith('https://graph.facebook.com/v23.0/') && !u.startsWith('https://rupload.facebook.com/')) throw new Error(`no debía llamar a ${u}`);
    if (u.endsWith('/IG77/media') && body.upload_type === 'resumable') return Response.json({ id: 'CONT9' });
    if (u === 'https://rupload.facebook.com/ig-api-upload/v23.0/CONT9') return Response.json({ success: true });
    if (u.includes('/CONT9?fields=status_code')) return Response.json({ status_code: 'FINISHED' });
    if (u.endsWith('/IG77/media_publish')) return Response.json({ id: 'M9' });
    if (u.includes('/M9?fields=permalink')) return Response.json({ permalink: 'https://www.instagram.com/reel/y/' });
    return null;
  }, async () => {
    const r = await UPLOADERS.instagram({ file, caption: 'x', token: 'token-pagina', accountId: 'IG77', relay, extra });
    assert.equal(r.url, 'https://www.instagram.com/reel/y/');
    assert.equal(used, false);
  });
  // Si la subida directa falla, se ve el error real (el paso por el servidor necesita Instagram conectado aparte).
  await withFakeApis((u, body) => {
    if (u.endsWith('/IG77/media') && body.upload_type === 'resumable') return Response.json({ error: { message: '(#10) Application does not have permission for this action' } }, { status: 403 });
    return null;
  }, async () => {
    await assert.rejects(UPLOADERS.instagram({ file, caption: 'x', token: 'token-pagina', accountId: 'IG77', relay, extra }), /does not have permission/);
    assert.equal(used, false);
  });
  // El error de la subida directa (debug_info) se explica en español.
  await withFakeApis((u, body) => {
    if (u.endsWith('/IG77/media') && body.upload_type === 'resumable') return Response.json({ id: 'CONT9' });
    if (u.startsWith('https://rupload.facebook.com/')) return Response.json({ debug_info: { retriable: false, type: 'ProcessingFailedError', message: 'Request processing failed' } }, { status: 400 });
    return null;
  }, async () => {
    await assert.rejects(UPLOADERS.instagram({ file, caption: 'x', token: 'tk', accountId: 'IG77', relay, extra }), /Meta no pudo recibir el video/);
    // Con un clip largo, dice que pruebe con uno de 40 s o menos (Instagram los rechaza a cuentas nuevas por la API).
    await assert.rejects(UPLOADERS.instagram({ file, caption: 'x', token: 'tk', accountId: 'IG77', relay, extra, duration: 80 }),
      (e) => /40 s o menos/.test(e.message) && /dura 80 s/.test(e.message) && e.status === 400);
  });
});

test('Facebook: no intenta subir Reels de más de 90 segundos', async () => {
  await withFakeApis(() => null, async (calls) => {
    await assert.rejects(UPLOADERS.facebook({ file: __filename, caption: 'x', title: 't', token: 'tk', accountId: 'P', duration: 120 }), (e) => /3 y 90 segundos/.test(e.message) && e.status === 400);
    assert.equal(calls.length, 0);
  });
});

// ---------- Cola de subidas ----------
test('cola: pasa la aprobación de TikTok, la duración y el paso por el servidor al subidor', async () => {
  const dir = tmpDir();
  const clipFile = path.join(dir, 'c.mp4');
  fs.writeFileSync(clipFile, 'x');
  const seen = [];
  const relay = { put: async () => ({}), remove: async () => {} };
  const q = new UploadQueue({
    file: path.join(dir, 'cola.json'), relay,
    getToken: async () => ({ accessToken: 't', accountId: 'a' }),
    uploaders: { tiktok: async (o) => { seen.push(o); o.onProgress(0.9, 'TikTok está procesando'); return { id: '1', url: 'https://www.tiktok.com/@a', privacy: 'SELF_ONLY' }; } },
  });
  try {
    const tiktok = { privacy: 'SELF_ONLY', consentAt: NOW };
    const job = q.add({ clip: { id: 'c1', file: clipFile, duration: 33 }, platform: 'tiktok', title: 'T', caption: 'C', origen: 'aprobado', tiktok, sugId: 'c1' });
    assert.equal(job.origen, 'aprobado');
    await q.tick();
    assert.equal(seen[0].tiktok, tiktok);
    assert.equal(seen[0].duration, 33);
    assert.equal(seen[0].relay, relay);
    assert.equal(job.status, 'publicado');
    assert.equal(job.note, 'Publicado como "Solo yo"');
  } finally { q.stop(); }
});

test('cola: si la PC estaba apagada a la hora sugerida, pasa a la próxima hora buena en vez de publicar a deshora', async () => {
  const dir = tmpDir();
  const clipFile = path.join(dir, 'c.mp4');
  fs.writeFileSync(clipFile, 'x');
  let uploads = 0;
  const later = Date.now() + 5 * 3600000;
  const q = new UploadQueue({
    file: path.join(dir, 'cola.json'),
    getToken: async () => ({}), onLate: () => later,
    uploaders: { instagram: async () => { uploads += 1; return { id: 'm', url: 'u' }; } },
  });
  try {
    const sched = q.add({ clip: { id: 'a', file: clipFile }, platform: 'instagram', title: 'T', caption: 'C', origen: 'sola', reprogramar: true, scheduledAt: Date.now() - 3 * 3600000 });
    await q.tick();
    assert.equal(uploads, 0);
    assert.equal(sched.scheduledAt, later);
    assert.match(sched.note, /PC estaba apagada/);
    // Lo que pidió "Publicar ahora" no se mueve aunque llegue tarde.
    const now = q.add({ clip: { id: 'b', file: clipFile }, platform: 'instagram', title: 'T', caption: 'C', scheduledAt: Date.now() - 3 * 3600000 });
    await q.tick();
    assert.equal(now.status, 'publicado');
    assert.equal(uploads, 1);
  } finally { q.stop(); }
});

test('cola: cancelar por clip, quitar las automáticas y publicar ya una programada', async () => {
  const dir = tmpDir();
  const q = new UploadQueue({ file: path.join(dir, 'cola.json'), getToken: async () => ({}), uploaders: {} });
  try {
    const later = Date.now() + 3600000;
    const a1 = q.add({ clip: { id: 'a', file: 'x' }, platform: 'instagram', scheduledAt: later, origen: 'sola' });
    const a2 = q.add({ clip: { id: 'a', file: 'x' }, platform: 'facebook', scheduledAt: later });
    const b1 = q.add({ clip: { id: 'b', file: 'x' }, platform: 'instagram', scheduledAt: later, origen: 'sola' });
    const b2 = q.add({ clip: { id: 'b', file: 'x' }, platform: 'facebook', scheduledAt: later });
    assert.equal(q.cancelWhere((j) => j.clipId === 'a'), 2);
    assert.equal(a1.status, 'cancelado');
    assert.equal(a2.status, 'cancelado');
    assert.equal(q.removeWhere((j) => j.platform === 'instagram' && j.origen === 'sola'), 1, 'solo las automáticas pendientes');
    assert.ok(!q.list().includes(b1));
    assert.ok(q.list().includes(a1), 'lo cancelado queda en la lista');
    await q.publishNow(b2.id);
    assert.ok(b2.scheduledAt <= Date.now());
    assert.equal((await q.cancel(b2.id)).status, 'cancelado');
  } finally { q.stop(); }
});

// ---------- Instagram: copia recortada ----------
test('Instagram: recorta solo los clips de más de 40 s, solo para Instagram y si el ajuste está encendido', () => {
  assert.equal(igTrimNeeded({ platform: 'instagram', duration: 80 }), true);
  assert.equal(igTrimNeeded({ platform: 'instagram', duration: 80 }, undefined), true, 'encendido si no está el ajuste');
  assert.equal(igTrimNeeded({ platform: 'instagram', duration: 80 }, false), false, 'apagado');
  assert.equal(igTrimNeeded({ platform: 'instagram', duration: 40 }), false, '40 s pasa entero');
  assert.equal(igTrimNeeded({ platform: 'instagram', duration: 0 }), false, 'sin duración conocida no toca nada');
  assert.equal(igTrimNeeded({ platform: 'facebook', duration: 80 }), false, 'Facebook recibe el clip entero');
  const args = igTrimArgs('C:/clips/a.mp4', 'C:/tmp/b.mp4');
  const at = (k) => args[args.indexOf(k) + 1];
  assert.equal(at('-i'), 'C:/clips/a.mp4');
  assert.equal(at('-t'), '39');
  assert.equal(at('-c:v'), 'copy', 'el video no se vuelve a codificar');
  assert.equal(at('-af'), 'afade=t=out:st=38.2:d=0.8', 'el sonido se apaga al final');
  assert.equal(args.at(-1), 'C:/tmp/b.mp4');
});

test('cola: sube la copia preparada (recortada) con su duración, guarda el aviso y la borra al terminar', async () => {
  const dir = tmpDir();
  const clipFile = path.join(dir, 'largo.mp4');
  const copy = path.join(dir, 'copia.mp4');
  fs.writeFileSync(clipFile, 'x');
  const seen = [];
  let cleaned = 0;
  let fail = false;
  const q = new UploadQueue({
    file: path.join(dir, 'cola.json'),
    getToken: async () => ({ accessToken: 't', accountId: 'IG1' }),
    uploaders: {
      instagram: async (o) => { seen.push(o); if (fail) throw Object.assign(new Error('Instagram: no'), { status: 400 }); return { id: 'M1', url: 'https://www.instagram.com/reel/z/' }; },
      facebook: async (o) => { seen.push(o); return { id: 'V1', url: 'https://www.facebook.com/reel/1' }; },
    },
    prepare: async (job) => (job.platform !== 'instagram' ? null : (fs.writeFileSync(copy, 'y'), { file: copy, duration: 39, note: 'Recortado a 39 s para Instagram', cleanup: () => { cleaned++; fs.rmSync(copy, { force: true }); } })),
  });
  try {
    const ig = q.add({ clip: { id: 'c1', file: clipFile, duration: 80 }, platform: 'instagram', title: 'T', caption: 'C' });
    await q.tick();
    assert.equal(seen[0].file, copy, 'a Instagram va la copia');
    assert.equal(seen[0].duration, 39);
    assert.equal(ig.status, 'publicado');
    assert.equal(ig.note, 'Recortado a 39 s para Instagram');
    assert.equal(cleaned, 1);
    assert.equal(fs.existsSync(copy), false, 'la copia se borra');
    assert.equal(fs.existsSync(clipFile), true, 'el clip original queda');
    const fb = q.add({ clip: { id: 'c1', file: clipFile, duration: 80 }, platform: 'facebook', title: 'T', caption: 'C' });
    await q.tick();
    assert.equal(seen[1].file, clipFile, 'a Facebook va el clip entero');
    assert.equal(seen[1].duration, 80);
    assert.equal(fb.status, 'publicado');
    // Si la subida falla, la copia también se borra.
    fail = true;
    const ig2 = q.add({ clip: { id: 'c2', file: clipFile, duration: 80 }, platform: 'instagram', title: 'T', caption: 'C' });
    await q.tick();
    assert.equal(ig2.status, 'error');
    assert.equal(cleaned, 2);
  } finally { q.stop(); }
});
