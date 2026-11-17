// El agente de contenido: horario, metas, cerebro (sin llamar a Claude) y el ciclo publicar → leer números con piezas falsas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { nextSlot, progress, viewsByDay, minutes60, DAY, HOUR } = require('../engine/agente/horario');
const cerebro = require('../engine/agente/cerebro');
const { alignWords, pickFondo, listFondos } = require('../engine/agente/narrados');
const { Agente, DEFAULT_CONFIG } = require('../engine/agente/agente');

const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

test('agente/horario: la próxima hora libre respeta las horas del plan, el máximo por día y la separación', () => {
  const now = at(2026, 11, 16, 10, 0);
  assert.equal(nextSlot({ now, horas: [12, 19] }), at(2026, 11, 16, 12, 5));
  // Ya hay una a las 12:05 y el máximo es 1 al día → mañana a las 12.
  assert.equal(nextSlot({ now, horas: [12, 19], ocupados: [at(2026, 11, 16, 12, 5)], porDia: 1 }), at(2026, 11, 17, 12, 5));
  // Con 2 al día, la siguiente es a las 19 (más de 2 horas después).
  assert.equal(nextSlot({ now, horas: [12, 19], ocupados: [at(2026, 11, 16, 12, 5)], porDia: 2 }), at(2026, 11, 16, 19, 5));
  // Horas pegadas: 12 y 13 no caben el mismo día con 2 horas de separación.
  assert.equal(nextSlot({ now, horas: [12, 13], ocupados: [at(2026, 11, 16, 12, 5)], porDia: 2 }), at(2026, 11, 17, 12, 5));
  // Si la hora ya pasó (o faltan menos de 10 min), pasa a la siguiente.
  assert.equal(nextSlot({ now: at(2026, 11, 16, 11, 58), horas: [12, 19] }), at(2026, 11, 16, 19, 5));
  // Sin horas válidas usa las 19.
  assert.equal(nextSlot({ now, horas: [99] }), at(2026, 11, 16, 19, 5));
});

test('agente/horario: progreso hacia monetizar y vistas por día', () => {
  const now = at(2026, 11, 16, 12);
  const seguidores = [{ at: now - 8 * DAY, count: 100 }, { at: now - 2 * DAY, count: 300 }, { at: now, count: 650 }];
  const publicaciones = [
    { publicadoAt: now - 2 * DAY, stats: { views: 1000, viewTimeMin: 300 }, historial: [{ at: now - 2 * DAY + HOUR, views: 400 }, { at: now - DAY, views: 1000 }] },
    { publicadoAt: now - 45 * DAY, stats: { views: 5000, viewTimeMin: 2000 }, historial: [] },
    { publicadoAt: now - 70 * DAY, stats: { views: 9000, viewTimeMin: 9000 }, historial: [] },
  ];
  const p = progress({ seguidores, publicaciones, metas: { estrellas: 500, seguidores: 5000, minutos: 60000 }, now });
  assert.equal(p.seguidores, 650);
  assert.equal(p.seguidoresSemana, 550);
  assert.equal(p.minutos60, 2300); // la de hace 70 días no cuenta
  assert.equal(minutes60(publicaciones, now), 2300);
  assert.equal(p.vistas30, 1000);
  assert.equal(p.publicaciones30, 1);
  assert.equal(p.metas.estrellas.pct, 100);
  assert.equal(p.metas.seguidores.pct, 13);
  assert.equal(progress({ now }).seguidoresSemana, null);

  const days = viewsByDay(publicaciones, 14, now);
  assert.equal(days.length, 14);
  assert.equal(days.reduce((n, d) => n + d.views, 0), 1000);
  assert.equal(days[11].views, 400); // hace 2 días
  assert.equal(days[12].views, 600); // ayer: lo que creció
});

test('agente/cerebro: el plan queda en valores válidos y respeta los ajustes', () => {
  const config = { ...structuredClone(DEFAULT_CONFIG), maxDia: 2, tipos: { narrado: true, serie: false } };
  const plan = cerebro.normalizePlan({
    nicho: 'Curiosidades del Caribe', publico: 'Dominicanos', tono: 'cercano', publicacionesPorDia: 9, horas: [21, 12, 12, 30, -1, 'x', 19],
    mezcla: { narrado: 60, serie: 40 }, pilares: [{ nombre: 'Historia', descripcion: 'Datos' }, { nombre: '' }], ideaSerie: 'no debe quedar', lecciones: ['a', '', 'b'], resumen: 'ok',
  }, config, 123);
  assert.equal(plan.at, 123);
  assert.equal(plan.publicacionesPorDia, 2);
  assert.deepEqual(plan.horas, [12, 19, 21]);
  assert.deepEqual(plan.mezcla, { narrado: 60, serie: 0 });
  assert.equal(plan.ideaSerie, '');
  assert.equal(plan.pilares.length, 1);
  assert.deepEqual(plan.lecciones, ['a', 'b']);
  assert.deepEqual(cerebro.normalizePlan({}, config).horas, [12, 19, 21]);
});

test('agente/cerebro: la idea usa solo tipos y voces que existen; el texto lleva el aviso de IA', () => {
  const voces = { maria: { nombre: 'María' }, andres: { nombre: 'Andrés' } };
  const idea = cerebro.normalizeIdea({
    tipo: 'serie', voz: 'Pedro', emocion: 'rara', titulo: 'Un dato', guion: 'Hola   mundo', colores: ['#ff0000', 'rojo', '#00FF00'],
    hashtags: ['#Dato', 'curioso!', '##RD', '#'],
  }, { tiposOk: ['narrado'], voces });
  assert.equal(idea.tipo, 'narrado');
  assert.equal(idea.voz, 'andres');
  assert.equal(idea.emocion, 'normal');
  assert.equal(idea.guion, 'Hola mundo');
  assert.deepEqual(idea.colores, ['#ff0000', '#00FF00']);
  assert.deepEqual(idea.hashtags, ['#Dato', '#curioso', '#RD']);
  assert.equal(cerebro.normalizeIdea({ voz: 'MARIA' }, { tiposOk: ['narrado'], voces }).voz, 'maria');

  const cap = cerebro.buildCaption({ tipo: 'narrado', gancho: '¿Sabías esto?', descripcion: 'Un dato.', hashtags: ['#a', '#b'] });
  assert.equal(cap, '¿Sabías esto?\n\nUn dato.\n\n#a #b\n\n🤖 Voz creada con IA');
  assert.match(cerebro.buildCaption({ tipo: 'serie' }), /Animación y voces creadas con IA/);
  assert.doesNotMatch(cerebro.buildCaption({ tipo: 'narrado', gancho: 'x' }, { avisoIa: false }), /IA/);
});

test('agente/cerebro: los números se resumen para Claude', () => {
  const now = at(2026, 11, 16, 12);
  assert.match(cerebro.statsText({ pagina: 'Mi página', now }), /Todavía no se ha publicado nada/);
  const t = cerebro.statsText({
    pagina: 'Mi página', now, seguidores: [{ at: now - 8 * DAY, count: 10 }, { at: now, count: 40 }],
    publicaciones: [{ publicadoAt: now - 5 * HOUR, tipo: 'narrado', pilar: 'Historia', titulo: 'El faro', duracion: 50, stats: { views: 1234, likes: 50, avgWatch: 20 } }],
  });
  assert.match(t, /Seguidores ahora: 40 \(hace una semana: 10\)/);
  assert.match(t, /hace 5 h/);
  assert.match(t, /vista en promedio 20 s de 50 s/);
  assert.ok(cerebro.systemPrompt({ narrado: true, serie: true }).length > 200);
});

test('agente/narrados: subtítulos con las palabras del guion y fondos que no se repiten', () => {
  const words = [{ w: 'ola', s: 0, e: 0.3 }, { w: 'mundo', s: 0.3, e: 0.7 }];
  assert.deepEqual(alignWords(words, 'Hola [pausa] mundo.').map((w) => w.w), ['Hola', 'mundo.']);
  assert.deepEqual(alignWords(words, 'Solo una palabra más'), words); // no cuadran: se quedan las de Whisper
  const fondos = { videos: ['a.mp4', 'b.mp4'], imagenes: ['c.jpg'], musica: [] };
  assert.equal(pickFondo(fondos, ['a.mp4', 'b.mp4'], () => 0.99), 'c.jpg');
  assert.equal(pickFondo(fondos, ['a.mp4', 'b.mp4', 'c.jpg'], () => 0), 'a.mp4');
  assert.equal(pickFondo({ videos: [], imagenes: [], musica: [] }), null);
});

// ---------- El agente completo, con piezas falsas (sin Facebook ni Claude de verdad) ----------

function fakeTools(root) {
  const sinte = path.join(root, 'Sintetizadorai');
  fs.mkdirSync(path.join(sinte, 'venv-qwen', 'Scripts'), { recursive: true });
  fs.mkdirSync(path.join(sinte, 'voces', 'maria'), { recursive: true });
  fs.writeFileSync(path.join(sinte, 'motor.py'), '');
  fs.writeFileSync(path.join(sinte, 'venv-qwen', 'Scripts', 'python.exe'), '');
  fs.writeFileSync(path.join(sinte, 'voces', 'maria', 'normal.wav'), '');
  return sinte;
}

function makeAgent({ remoto = {}, uploader, fetchers, now, apiOverride } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-agente-'));
  const calls = [];
  let clock = now || at(2026, 11, 16, 12);
  const estado = { facebook: true, pagina: { id: 'p1', name: 'Página del agente' }, ia: true, gastado: 1, tope: 10, ...remoto };
  const api = async (p, body, method) => {
    calls.push({ p, body, method });
    if (apiOverride) { const r = await apiOverride(p, body); if (r !== undefined) return r; }
    if (p === '/agente/estado') return estado;
    if (p === '/agente/token') return { accessToken: 'tok', accountId: 'p1', accountName: 'Página del agente' };
    throw new Error(`api inesperada ${p}`);
  };
  const ag = new Agente({
    dir: path.join(root, 'agente'), appDir: path.join(root, 'app', 'desktop'), api, server: () => ({ url: 'http://x', token: 't' }),
    paths: {}, whisper: () => ({ ok: true, model: 'small', gpu: false }), uploader, fetchers,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ name: 'post_video_avg_time_watched', values: [{ value: 21000 }] }, { name: 'post_video_view_time', values: [{ value: 600000 }] }] }) }),
    now: () => clock,
  });
  ag.setConfig({ sintetizador: fakeTools(root), serieai: '' });
  ag.state.plan = cerebro.normalizePlan({ nicho: 'Datos', publicacionesPorDia: 1, horas: [12, 19] }, ag.state.config, clock);
  ag.state.activo = true;
  // Voces ya leídas: así la prueba nunca abre el Sintetizador de verdad.
  ag.state.voces = { maria: { nombre: 'María' } };
  ag.state.vocesAt = clock;
  return { ag, root, calls, estado, setNow: (ms) => { clock = ms; } };
}

test('agente: publica a su hora, lee los números y avisa al llegar a una meta', async () => {
  const uploads = [];
  const uploader = async (o) => { uploads.push(o); o.onProgress?.(0.5); return { id: 'v123', url: 'https://facebook.com/reel/v123' }; };
  const fetchers = {
    facebook: async (ids, auth) => { assert.equal(auth.accessToken, 'tok'); return Object.fromEntries(ids.map((id) => [id, { views: 1500, likes: 80, comments: 4, shares: 2 }])); },
    facebookFollowers: async () => 520,
  };
  const { ag, root, setNow } = makeAgent({ uploader, fetchers });
  const avisos = [];
  ag.on('aviso', (a) => avisos.push(a));
  const now = at(2026, 11, 16, 12);
  const file = path.join(ag.dir, 'videos', 'x.mp4');
  fs.writeFileSync(file, 'video');
  ag.state.statsAt = now; // que no lea números antes de publicar
  ag.state.cola.push({ id: 'x', tipo: 'narrado', titulo: 'El faro', gancho: '¿Sabías?', descripcion: 'Dato', hashtags: ['#rd'], archivo: file, duracion: 50, estado: 'listo', creadoAt: now - HOUR, publicarEn: now - 60000 });

  await ag.tick();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].token, 'tok');
  assert.match(uploads[0].caption, /Voz creada con IA/);
  assert.equal(ag.state.cola.length, 0);
  assert.equal(ag.state.publicaciones[0].remoteId, 'v123');
  assert.ok(avisos.some((a) => /publicó/.test(a.titulo)));
  assert.equal(ag.busy, false);

  setNow(now + 4 * HOUR);
  await ag.tick();
  const p = ag.state.publicaciones[0];
  assert.equal(p.stats.views, 1500);
  assert.equal(p.stats.avgWatch, 21);
  assert.equal(p.stats.viewTimeMin, 10);
  assert.equal(p.historial.length, 1);
  assert.equal(ag.state.seguidores.at(-1).count, 520);
  assert.ok(ag.state.logros.estrellas);
  assert.ok(ag.state.diario.some((d) => d.tipo === 'logro'));

  const snap = ag.snapshot();
  assert.equal(snap.progreso.seguidores, 520);
  assert.equal(snap.progreso.minutos60, 10);
  assert.equal(snap.herramientas.voz.ok, true);
  assert.deepEqual(snap.herramientas.voz.voces, ['maria']);
  assert.ok(JSON.parse(fs.readFileSync(path.join(ag.dir, 'estado.json'), 'utf8')).publicaciones.length === 1, 'se guarda en disco');
  fs.rmSync(root, { recursive: true, force: true });
});

test('agente: si Facebook falla reintenta más tarde, y a la tercera queda con error', async () => {
  const uploader = async () => { throw new Error('Facebook no respondió'); };
  const { ag, root, setNow } = makeAgent({ uploader, fetchers: {} });
  const now = at(2026, 11, 16, 12);
  const file = path.join(ag.dir, 'videos', 'y.mp4');
  fs.writeFileSync(file, 'video');
  ag.state.statsAt = now + DAY;
  ag.state.cola.push({ id: 'y', tipo: 'narrado', titulo: 'Y', archivo: file, duracion: 30, estado: 'listo', creadoAt: now, publicarEn: now - 1 });
  await ag.tick();
  assert.equal(ag.state.cola[0].estado, 'listo');
  assert.equal(ag.state.cola[0].reintentoEn, now + 30 * 60000);
  setNow(now + 31 * 60000); await ag.tick();
  setNow(now + 95 * 60000); await ag.tick();
  assert.equal(ag.state.cola[0].estado, 'error');
  assert.equal(ag.state.cola[0].intentos, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('agente: espera sin gastar cuando falta la página o llegó al tope', async () => {
  let pensar = 0;
  const apiOverride = async (p) => { if (p === '/agente/pensar') { pensar++; throw Object.assign(new Error('tope'), { status: 402 }); } };
  const a = makeAgent({ remoto: { pagina: null }, apiOverride });
  await a.ag.tick();
  assert.equal(a.ag.state.espera.motivo, 'pagina');
  a.ag.state.statsAt = Date.now() * 2;

  const b = makeAgent({ remoto: { gastado: 10, tope: 10 }, apiOverride });
  b.ag.state.statsAt = at(2026, 11, 16, 12);
  await b.ag.tick();
  assert.equal(b.ag.state.espera.motivo, 'tope');
  // Un aviso de espera se anota una sola vez en el diario.
  await b.ag.tick();
  assert.equal(b.ag.state.diario.filter((d) => d.tipo === 'espera').length, 1);

  // Sin plan y con el servidor diciendo "tope" (402) al pensar: queda esperando, no da error.
  const c = makeAgent({ apiOverride });
  c.ag.state.plan = null;
  c.ag.state.statsAt = at(2026, 11, 16, 12);
  await c.ag.tick();
  assert.equal(pensar, 1);
  assert.equal(c.ag.state.espera.motivo, 'tope');
  assert.equal(pensar, 1);
  for (const x of [a, b, c]) fs.rmSync(x.root, { recursive: true, force: true });
});

test('agente: decide cuándo hacer un video nuevo', () => {
  const { ag, root } = makeAgent();
  const now = at(2026, 11, 16, 12);
  assert.equal(ag.faltaProducir(now), true);
  assert.deepEqual(ag.tiposDisponibles(now).ok, ['narrado']); // SerieAI no está en esta prueba
  ag.state.cola.push({ id: 'a', tipo: 'narrado', estado: 'listo', creadoAt: now, publicarEn: now + HOUR });
  assert.equal(ag.faltaProducir(now), false, 'ya tiene el video del día');
  ag.state.cola = [];
  ag.state.fallos.produccion = { n: 2, at: now - 30 * 60000 };
  assert.equal(ag.faltaProducir(now), false, 'espera después de fallar (1 h tras el 2.º fallo)');
  assert.equal(ag.faltaProducir(now + 31 * 60000), true);
  ag.state.fallos = {};
  ag.state.publicaciones = [0, 1, 2].map((i) => ({ id: `p${i}`, tipo: 'narrado', creadoAt: now - i * 60000, publicadoAt: now }));
  assert.equal(ag.faltaProducir(now), false, 'no hace más de porDia*2+1 al día');
  ag.state.publicaciones = [];
  ag.setConfig({ tipos: { narrado: false, serie: false } });
  assert.match(ag.faltaProducir(now), /ningún tipo/);
  assert.ok(ag.state.plan.rehacer, 'cambiar los tipos pide rehacer el plan');
  ag.setConfig({ tipos: { narrado: true }, maxDia: 99, modoSerie: 'x', metas: { estrellas: -1, minutos: 1000 } });
  assert.equal(ag.state.config.maxDia, 6);
  assert.equal(ag.state.config.modoSerie, '3d');
  assert.equal(ag.state.config.metas.estrellas, 500);
  assert.equal(ag.state.config.metas.minutos, 1000);
  fs.rmSync(root, { recursive: true, force: true });
});

test('agente: descartar y cambiar la hora desde la pantalla', () => {
  const { ag, root } = makeAgent();
  const file = path.join(ag.dir, 'videos', 'z.mp4');
  fs.writeFileSync(file, 'v');
  ag.state.cola.push({ id: 'z', titulo: 'Z', archivo: file, estado: 'error', reintentoEn: 5, publicarEn: 1 });
  ag.reprogramar('z', 999);
  assert.equal(ag.state.cola[0].publicarEn, 999);
  assert.equal(ag.state.cola[0].estado, 'listo');
  assert.throws(() => ag.reprogramar('nada', 1));
  ag.descartar('z');
  assert.equal(ag.state.cola.length, 0);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(listFondos(ag.fondosDir), { videos: [], imagenes: [], musica: [] });
  assert.ok(fs.existsSync(path.join(ag.fondosDir, 'LEEME.txt')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('agente: la pantalla está conectada (solo admin) y no repite nombres', () => {
  const dir = path.join(__dirname, '..', 'renderer');
  const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  assert.match(app, /id: 'agente', soloAdmin: true/);
  assert.match(app, /agente: renderAgente/);
  assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /<script src="agente.js"><\/script>/);
  const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const ui = fs.readFileSync(path.join(dir, 'agente.js'), 'utf8');
  for (const m of ui.matchAll(/api\.(agent\w+|onAgentUpdate)\(/g)) assert.match(pre, new RegExp(`${m[1]}:`), `falta ${m[1]} en preload`);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  for (const m of pre.matchAll(/invoke\('(agente:\w+)'/g)) assert.match(main, new RegExp(`ipcMain.handle\\('${m[1]}'`), `falta ${m[1]} en main`);
});
