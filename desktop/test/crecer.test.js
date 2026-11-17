// Pruebas del piloto automático, horas sugeridas, estadísticas, aprendizaje, competencia y Facebook.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Vigilante, channelUrl, pickVideos, nextInQueue } = require('../engine/vigilante');
const { nextSlot, planHours, DEFAULT_HOURS } = require('../engine/calendario');
const { learn } = require('../engine/aprendizaje');
const { Estadisticas } = require('../engine/estadisticas');
const { summarize, igUsername, reportInput } = require('../engine/competencia');
const { UPLOADERS } = require('../engine/redes');

const H = 3600000;
const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime(); // 4 nov 2026, 10:00 hora local
const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cv-crecer-')), name);

// ---------- Piloto ----------
test('piloto: entiende cualquier forma de escribir un canal', () => {
  assert.equal(channelUrl('@IbaiLlanos'), 'https://www.youtube.com/@IbaiLlanos');
  assert.equal(channelUrl('ibaillanos'), 'https://www.youtube.com/@ibaillanos');
  assert.equal(channelUrl('https://www.youtube.com/@IbaiLlanos/streams'), 'https://www.youtube.com/@IbaiLlanos');
  assert.equal(channelUrl('youtube.com/channel/UCaY_-ksFSQtTGk0y1HA_3YQ'), 'https://www.youtube.com/channel/UCaY_-ksFSQtTGk0y1HA_3YQ');
  assert.equal(channelUrl('https://www.youtube.com/watch?v=abc'), null, 'un video no es un canal');
  assert.equal(channelUrl('https://tiktok.com/@x'), null);
});

test('piloto: solo deja videos nuevos, del largo correcto y que están pegando', () => {
  const ts = (hoursAgo) => Math.round((NOW - hoursAgo * H) / 1000);
  const entries = [
    { id: 'ok', title: 'Bueno', view_count: 50000, duration: 1200, timestamp: ts(5) },
    { id: 'visto', title: 'Ya visto', view_count: 50000, duration: 1200, timestamp: ts(5) },
    { id: 'viejo', title: 'Viejo', view_count: 900000, duration: 1200, timestamp: ts(100) },
    { id: 'corto', title: 'Short', view_count: 900000, duration: 30, timestamp: ts(2) },
    { id: 'largo', title: '10 horas', view_count: 900000, duration: 36000, timestamp: ts(2) },
    { id: 'lento', title: 'Lento', view_count: 100, duration: 1200, timestamp: ts(5) },
    { id: 'vivo', title: 'En vivo', live_status: 'is_live' },
  ];
  const out = pickVideos(entries, { seen: { visto: 1 }, maxAgeHours: 48, minViewsPerHour: 1000, now: NOW });
  assert.deepEqual(out.map((v) => v.id), ['ok']);
  assert.equal(out[0].viewsPerHour, 10000);
});

test('piloto: los directos van primero en la cola', () => {
  const found = [
    { id: 'a', status: 'en-cola', kind: 'video', viewsPerHour: 99999 },
    { id: 'b', status: 'en-cola', kind: 'live', viewsPerHour: 0 },
    { id: 'c', status: 'sugerencia', kind: 'live', viewsPerHour: 0 },
  ];
  assert.equal(nextInQueue(found).id, 'b');
});

function fakeYoutube({ live = false } = {}) {
  const ts = Math.round((NOW - 3 * H) / 1000);
  return async (args) => {
    const url = args[args.length - 1];
    if (url.endsWith('/live')) {
      if (!live) throw new Error('ERROR: [youtube:tab] @canal: The channel is not currently live');
      return { id: 'LIVE1', is_live: true, title: 'Directo épico', channel: 'Canal Uno' };
    }
    if (url.endsWith('/videos')) return { entries: [{ id: 'V1', title: 'Video nuevo', view_count: 30000, duration: 1500, timestamp: ts }] };
    if (url.endsWith('/streams')) throw new Error('ERROR: This channel does not have a streams tab');
    if (url.includes('/results?')) {
      return { entries: [
        { id: 'T1', title: 'Reacción épica', channel: 'Otro Canal', view_count: 400000, duration: 900 },
        { id: 'T2', title: 'Receta de cocina', channel: 'Cocina', view_count: 900000, duration: 600 },
      ] };
    }
    throw new Error(`url inesperada ${url}`);
  };
}

test('piloto: clipea solo lo que tiene permiso y deja lo demás como sugerencia', async () => {
  const cfg = {
    activo: true, soloConPermiso: true, maxVideosDia: 6, edadMaxHoras: 48, duracionMaxMin: 180, minVistasTema: 20000,
    canales: [{ url: 'https://www.youtube.com/@uno', nombre: 'Canal Uno', permiso: true }],
    temas: [{ texto: 'reacciones' }],
  };
  let busy = false;
  const started = [];
  const v = new Vigilante({
    file: tmpFile('piloto.json'), ytdlp: fakeYoutube({ live: true }), getConfig: () => cfg, isBusy: () => busy, now: () => NOW,
    // La IA descarta la receta (no tiene que ver con "reacciones")
    rank: async (videos) => Object.fromEntries(videos.map((x) => [x.id, { score: x.id === 'T2' ? 2 : 8, reason: 'x' }])),
  });
  v.on('process', (c) => { started.push(c.id); busy = true; });
  const n = await v.check();
  assert.equal(n, 3, 'directo + video del canal + 1 del tema (la receta se descarta)');
  const st = Object.fromEntries(v.state.found.map((c) => [c.id, c.status]));
  assert.deepEqual(started, ['LIVE1'], 'el directo empieza primero');
  assert.equal(st.LIVE1, 'procesando');
  assert.equal(st.V1, 'en-cola');
  assert.equal(st.T1, 'sugerencia', 'canal sin permiso: espera que decidas');
  assert.ok(!st.T2, 'lo que la IA descartó no se muestra');
  assert.ok(v.state.seen.T2, 'y no se vuelve a preguntar');

  // Termina el directo: sigue con el video
  busy = false;
  v.finished('LIVE1', { clips: 3 });
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual(started, ['LIVE1', 'V1']);
  assert.equal(v.state.found.find((c) => c.id === 'LIVE1').clips, 3);

  // El usuario decide clipear la sugerencia
  busy = false;
  v.decide('T1', 'clipear');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(started, ['LIVE1', 'V1', 'T1']);

  // Una segunda revisión no repite nada
  assert.equal(await v.check(), 0);
});

test('piloto: respeta el máximo de videos por día y guarda su estado', async () => {
  const file = tmpFile('piloto.json');
  const cfg = { activo: true, soloConPermiso: false, maxVideosDia: 1, edadMaxHoras: 48, canales: [], temas: [{ texto: 'x' }], minVistasTema: 1000 };
  const started = [];
  const v = new Vigilante({ file, ytdlp: fakeYoutube(), getConfig: () => cfg, isBusy: () => false, now: () => NOW });
  v.on('process', (c) => { started.push(c.id); v.finished(c.id, { clips: 1 }); });
  await v.check();
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(started.length, 1, 'solo 1 video por día');
  assert.equal(v.state.found.filter((c) => c.status === 'en-cola').length, 1, 'el otro espera a mañana');
  // Al reabrir la app, el estado sigue ahí
  const again = new Vigilante({ file, ytdlp: fakeYoutube(), getConfig: () => cfg, isBusy: () => false, now: () => NOW });
  assert.equal(again.state.found.length, 2);
  assert.equal(again.snapshot().todayCount, 1);
});

test('piloto: apagado no revisa (salvo que lo pidas a mano)', async () => {
  let calls = 0;
  const cfg = { activo: false, canales: [{ url: 'https://www.youtube.com/@uno', nombre: 'Uno', permiso: true }], temas: [] };
  const v = new Vigilante({ file: tmpFile('p.json'), ytdlp: async (a) => { calls += 1; return fakeYoutube()(a); }, getConfig: () => cfg, isBusy: () => true, now: () => NOW });
  assert.equal(await v.check(), 0);
  assert.equal(calls, 0);
  await v.check({ manual: true });
  assert.ok(calls > 0);
});

// ---------- Horas sugeridas ----------
test('horas sugeridas: la próxima hora buena, sin repetir y sin pasar del máximo por día', () => {
  const at = (d, h) => new Date(2026, 10, 4 + d, h, 0, 0).getTime();
  const learnedHours = { tiktok: [12, 19, 21] };
  assert.equal(nextSlot({ platform: 'tiktok', now: NOW, learnedHours }), at(0, 12));
  assert.equal(nextSlot({ platform: 'tiktok', now: NOW, learnedHours, taken: [at(0, 12)] }), at(0, 19), 'no repite la hora ya ocupada');
  assert.equal(nextSlot({ platform: 'tiktok', now: NOW, learnedHours, taken: [at(0, 12) + 20 * 60000] }), at(0, 19), 'lo que subiste a las 12:20 también ocupa las 12:00');
  assert.equal(nextSlot({ platform: 'tiktok', now: NOW, learnedHours, taken: [at(0, 12), at(0, 19)], maxPerDay: 2 }), at(1, 12), 'hoy ya tiene 2: pasa a mañana');
  assert.equal(nextSlot({ platform: 'tiktok', now: at(0, 11) + 55 * 60000, learnedHours }), at(0, 19), 'a las 11:55 ya no da tiempo para las 12:00');
  const full = [];
  for (let d = 0; d <= 7; d++) for (const h of [12, 19, 21]) full.push(at(d, h));
  assert.equal(nextSlot({ platform: 'tiktok', now: NOW, learnedHours, taken: full }), null, 'semana llena');
});

test('horas sugeridas: usa tus horas aprendidas; sin datos, las recomendadas de cada red', () => {
  const at = (h) => new Date(2026, 10, 4, h, 0, 0).getTime();
  assert.equal(nextSlot({ platform: 'youtube', now: NOW, learnedHours: { youtube: [17] } }), at(17));
  assert.equal(nextSlot({ platform: 'youtube', now: NOW }), at(DEFAULT_HOURS.youtube[0]));
  assert.equal(nextSlot({ platform: 'facebook', now: NOW, learnedHours: { tiktok: [17] } }), at(13), 'sin datos de Facebook: 9:00 ya pasó, sigue 13:00');
});

test('horas sugeridas: reparte horas a varios clips sin repetir en la misma red', () => {
  const at = (d, h) => new Date(2026, 10, 4 + d, h, 0, 0).getTime();
  const plan = planHours({
    items: [{ id: 'a' }, { id: 'b' }, { id: 'c', platforms: ['tiktok'] }],
    platforms: ['tiktok', 'instagram'], now: NOW, learnedHours: { tiktok: [12, 19], instagram: [11, 14] },
  });
  assert.deepEqual(plan.a, { tiktok: at(0, 12), instagram: at(0, 11) });
  assert.deepEqual(plan.b, { tiktok: at(0, 19), instagram: at(0, 14) });
  assert.deepEqual(plan.c, { tiktok: at(1, 12) }, 'solo la red que le falta');
});

// ---------- Aprendizaje ----------
function fakeHistory() {
  const clips = [];
  const jobs = [];
  const posts = {};
  // 12 publicaciones: las de 19:00, de 30-45 s y con pregunta en el título rinden mucho más
  for (let i = 0; i < 12; i++) {
    const good = i % 2 === 0;
    const id = `c${i}`;
    clips.push({ id, title: good ? `¿Viste esto ${i}?` : `Momento ${i}`, duration: good ? 40 : 75, score: good ? 9 : 6, origin: { source: { name: good ? 'Ibai' : 'Otro' } } });
    const publishedAt = new Date(2026, 10, 1 + (i % 3), good ? 19 : 9 + (i % 3), 0, 0).getTime();
    jobs.push({ id: `j${i}`, clipId: id, platform: 'tiktok', status: 'publicado', remoteId: `r${i}`, title: clips[i].title, publishedAt, url: `https://t/${i}` });
    posts[`j${i}`] = { last: { views: good ? 50000 + i * 1000 : 5000 + i * 100, likes: good ? 4000 : 300, comments: 10, shares: 5 } };
  }
  return { clips, jobs, stats: { posts, followers: { tiktok: [{ at: NOW - 8 * 86400000, count: 1000 }, { at: NOW, count: 1500 }] } } };
}

test('aprendizaje: con pocos datos no saca conclusiones', () => {
  const h = fakeHistory();
  const r = learn({ clips: h.clips, jobs: h.jobs.slice(0, 3), stats: h.stats, now: NOW });
  assert.equal(r.ready, false);
  assert.equal(r.totals.posts, 3);
});

test('aprendizaje: encuentra horas, largo, canal y estilo de título que funcionan', () => {
  const h = fakeHistory();
  const r = learn({ ...h, now: NOW });
  assert.equal(r.ready, true);
  assert.equal(r.totals.posts, 12);
  assert.equal(r.followers.tiktok.week, 500);
  assert.equal(r.top[0].views, 60000);
  assert.ok(r.bestHours.tiktok.includes(19), `horas: ${r.bestHours.tiktok}`);
  assert.equal(r.bestClipSeconds, 40);
  assert.equal(r.bySource[0].name, 'Ibai');
  assert.ok(r.findings.some((f) => /pregunta/.test(f)), r.findings.join(' | '));
  assert.ok(r.findings.some((f) => /nota 8/.test(f)));
  assert.match(r.hints, /pregunta/);
});

// ---------- Estadísticas ----------
test('estadísticas: lee los números de cada red y anota los errores', async () => {
  const jobs = [
    { id: 'j1', clipId: 'c1', platform: 'youtube', status: 'publicado', remoteId: 'yt1', publishedAt: NOW - 86400000 },
    { id: 'j2', clipId: 'c2', platform: 'tiktok', status: 'publicado', remoteId: 'v_pub_file~v2.123', publishedAt: NOW - 86400000 },
    { id: 'j3', clipId: 'c3', platform: 'instagram', status: 'publicado', remoteId: 'ig1', publishedAt: NOW - 86400000 },
  ];
  const asked = [];
  const e = new Estadisticas({
    file: tmpFile('stats.json'), getJobs: () => jobs, now: () => NOW,
    getToken: async (p) => ({ accessToken: `tok-${p}`, accountId: 'A' }),
    connected: async () => [{ id: 'youtube', connected: true }, { id: 'tiktok', connected: true }, { id: 'instagram', connected: true }],
    fetchers: {
      youtube: async (ids) => { asked.push(['youtube', ids]); return { yt1: { views: 1234, likes: 50, comments: 3, shares: null } }; },
      youtubeFollowers: async () => 900,
      tiktok: async (ids) => { asked.push(['tiktok', ids]); return {}; },
      instagram: async () => { const err = new Error('Instagram: permiso'); err.status = 403; throw err; },
    },
  });
  await e.refresh();
  assert.equal(e.state.posts.j1.last.views, 1234);
  assert.equal(e.state.followers.youtube[0].count, 900);
  assert.ok(!asked.some((a) => a[0] === 'tiktok'), 'un TikTok privado (sin id público) no se consulta');
  assert.match(e.state.errors.instagram, /Vuelve a conectar/);
});

// ---------- Competencia ----------
test('competencia: resume publicaciones y arma lo que se manda a la IA', () => {
  assert.equal(igUsername('https://www.instagram.com/la.cuenta/'), 'la.cuenta');
  assert.equal(igUsername('@Otra_Cuenta'), 'otra_cuenta');
  assert.equal(igUsername('no válido!'), null);
  const posts = [
    { title: 'A', views: 100, at: NOW - 2 * 86400000, duration: 30, kind: 'short' },
    { title: 'B', views: 900, at: NOW - 3 * 86400000, duration: 50, kind: 'short' },
    { title: 'C', views: 500, at: NOW - 20 * 86400000, duration: 3000, kind: 'video' },
  ];
  const s = summarize(posts, NOW);
  assert.equal(s.postsWeek, 2);
  assert.equal(s.median, 500);
  assert.equal(s.best[0].title, 'B');
  assert.equal(s.avgDuration, 40, 'el largo típico es el de sus clips, no el de sus videos largos');
  const input = reportInput([{ name: 'Rival', platform: 'youtube', followers: 10, posts }, { name: 'Roto', error: 'x', posts: [] }], { followers: { tiktok: { count: 5 } }, ready: false, top: [] });
  assert.equal(input.competitors.length, 1, 'las cuentas con error no se mandan');
  assert.equal(input.own.followers.tiktok, 5);
  assert.ok(!JSON.stringify(input).includes('http'), 'no se mandan enlaces');
});

// ---------- Facebook ----------
test('Facebook Reels: pide lugar, sube, publica y espera a que esté listo', async () => {
  const file = tmpFile('clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 1));
  const realFetch = globalThis.fetch;
  const realTimeout = global.setTimeout;
  const steps = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body instanceof URLSearchParams ? Object.fromEntries(opts.body) : null;
    if (u.endsWith('/PAGE1/video_reels') && body?.upload_phase === 'start') { steps.push('start'); return Response.json({ video_id: 'VID9', upload_url: 'https://rupload.facebook.com/video-upload/v23.0/VID9' }); }
    if (u.startsWith('https://rupload.facebook.com/')) { steps.push(`upload:${opts.headers.file_size}`); return Response.json({ success: true }); }
    if (u.endsWith('/PAGE1/video_reels') && body?.upload_phase === 'finish') { steps.push(`finish:${body.description}`); return Response.json({ success: true }); }
    if (u.includes('/VID9?fields=status')) { steps.push('status'); return Response.json({ status: { video_status: 'ready' } }); }
    // El enlace real del Reel (Facebook lo da sin el dominio)
    if (u.includes('/VID9?fields=permalink_url')) { steps.push('link'); return link(); }
    throw new Error(`llamada inesperada ${u}`);
  };
  let link = () => Response.json({ permalink_url: '/reel/1234567890/' });
  global.setTimeout = (fn) => realTimeout(fn, 0); // no esperar 5 s entre revisiones
  try {
    const r = await UPLOADERS.facebook({ file, caption: 'Mi texto #viral', title: 'Título', token: 'tok', accountId: 'PAGE1' });
    assert.deepEqual(steps, ['start', 'upload:2048', 'finish:Mi texto #viral', 'status', 'link']);
    assert.equal(r.url, 'https://www.facebook.com/reel/1234567890/');
    assert.equal(r.id, 'VID9');
    // Con el enlace completo se usa tal cual; si Facebook no lo da (o da otra cosa), queda el enlace del Reel.
    link = () => Response.json({ permalink_url: 'https://www.facebook.com/MiPagina/videos/1234567890/' });
    assert.equal((await UPLOADERS.facebook({ file, caption: 'x', title: 't', token: 'tok', accountId: 'PAGE1' })).url, 'https://www.facebook.com/MiPagina/videos/1234567890/');
    link = () => Response.json({ error: { message: 'sin permiso' } }, { status: 400 });
    assert.equal((await UPLOADERS.facebook({ file, caption: 'x', title: 't', token: 'tok', accountId: 'PAGE1' })).url, 'https://www.facebook.com/reel/VID9');
    link = () => Response.json({ permalink_url: 'https://otro-sitio.test/reel' });
    assert.equal((await UPLOADERS.facebook({ file, caption: 'x', title: 't', token: 'tok', accountId: 'PAGE1' })).url, 'https://www.facebook.com/reel/VID9');
  } finally {
    globalThis.fetch = realFetch;
    global.setTimeout = realTimeout;
  }
});

test('piloto: si falta una herramienta se pausa en vez de marcar todo con error', async () => {
  let now = NOW;
  const cfg = { activo: true, soloConPermiso: false, maxVideosDia: 5, edadMaxHoras: 48, canales: [], temas: [{ texto: 'x' }], minVistasTema: 1000 };
  const started = [];
  const v = new Vigilante({ file: tmpFile('p.json'), ytdlp: fakeYoutube(), getConfig: () => cfg, isBusy: () => false, now: () => now });
  v.on('process', (c) => { started.push(c.id); v.pause(c.id, 'Falta instalar: Deno'); });
  await v.check();
  assert.equal(started.length, 1, 'no sigue probando con los demás');
  assert.equal(v.state.found.filter((c) => c.status === 'en-cola').length, 2, 'el video vuelve a la cola');
  assert.equal(v.snapshot().todayCount, 0, 'no cuenta para el máximo del día');
  assert.equal(v.next(), null, 'en pausa');
  now += 31 * 60000;
  assert.ok(v.next(), 'pasada la pausa, sigue');
});
