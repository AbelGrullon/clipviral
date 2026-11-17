// Kit "Grabar video para Meta": pasos, subtítulos en inglés y órdenes para FFmpeg (sin grabar nada).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { VIDEOS, PRUEBA, layout, segments, buildAss, buildSrt, buildResumen, recordArgs, finalArgs } = require('../grabador/pasos');

// Los permisos que pide ClipViral hoy, leídos de server/src/social.js.
const social = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'src', 'social.js'), 'utf8');
const scopes = (net) => [...social.match(new RegExp(`^  ${net}: \\[([^\\]]+)\\]`, 'm'))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const permsOf = (video) => new Set(video.pasos.flatMap((p) => String(p.perm || '').split(', ')));

test('grabador: cada permiso que pide ClipViral sale en algún paso de su video', () => {
  assert.deepEqual(scopes('facebook'), ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'instagram_basic']);
  for (const p of scopes('facebook')) assert.ok(permsOf(VIDEOS.facebook).has(p), `Facebook: falta ${p}`);
  for (const p of scopes('instagram')) assert.ok(permsOf(VIDEOS.instagram).has(p), `Instagram: falta ${p}`);
  for (const p of [...scopes('facebook'), ...scopes('instagram')]) assert.ok(permsOf(VIDEOS.todo).has(p), `Los dos: falta ${p}`);
  // Los pasos que pide la guía de Meta están en el video de Facebook, en orden.
  const ids = VIDEOS.facebook.pasos.map((p) => p.id);
  const order = ['entrar', 'fb-conectar', 'fb-login', 'fb-permisos', 'fb-pagina', 'fb-crear', 'fb-programar', 'fb-publicar', 'fb-ver'];
  assert.deepEqual(order.map((id) => ids.indexOf(id)), [...order.map((id) => ids.indexOf(id))].sort((a, b) => a - b));
  assert.ok(order.every((id) => ids.includes(id)));
});

test('grabador: subtítulos en inglés cortos y sin tildes; instrucciones en español', () => {
  for (const v of [...Object.values(VIDEOS), PRUEBA]) {
    for (const p of v.pasos) {
      assert.ok(p.en.length <= 170, `subtítulo largo (${p.en.length}): ${p.en}`);
      assert.doesNotMatch(p.en, /[áéíóúñ¿¡]/i, `subtítulo con español: ${p.en}`);
      assert.ok(p.es.length > 20);
    }
  }
});

test('grabador: medidas del video final (hasta 1920 de ancho, franja abajo, todo par)', () => {
  assert.deepEqual(layout(1920, 1200), { W: 1920, H: 1200, bar: 164, total: 1364, font: 42, small: 24, gap: 15 });
  const big = layout(2560, 1440);
  assert.equal(big.W, 1920);
  assert.equal(big.H, 1080);
  const small = layout(1366, 768);
  assert.equal(small.W, 1366);
  for (const v of [big, small, layout(1365, 767)]) for (const k of ['W', 'H', 'bar', 'total']) assert.equal(v[k] % 2, 0, k);
});

test('grabador: cada paso va desde un "Listo" hasta el siguiente; lo saltado no sale', () => {
  const steps = [{ en: 'a' }, { en: 'b' }, { en: 'c' }, { en: 'd' }];
  // Paso 2 saltado (mismo tiempo que el anterior) y el último sigue hasta el final.
  const segs = segments(steps, [5, 5, 12, 14], 15.2);
  assert.deepEqual(segs.map((s) => [s.n, s.start, s.end]), [[1, 0, 5], [3, 5, 12], [4, 12, 15.2]]);
  // Grabación cortada a la mitad: el paso actual va hasta el final y los siguientes no salen.
  assert.deepEqual(segments(steps, [3], 10).map((s) => [s.n, s.start, s.end]), [[1, 0, 3], [2, 3, 10]]);
});

test('grabador: el archivo de subtítulos tiene el paso, el permiso y el texto en inglés', () => {
  const info = { video: VIDEOS.facebook, marks: [4, 9, 15, 30, 41], duration: 50, width: 1920, height: 1200 };
  const ass = buildAss(info);
  assert.match(ass, /PlayResX: 1920\nPlayResY: 1364/);
  const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
  assert.equal(dialogues.length, 6 * 2);
  assert.match(dialogues[0], /0:00:00\.00,0:00:04\.00,Paso,.*CLIPVIRAL · FACEBOOK PAGES/);
  assert.match(ass, /STEP 4 OF 13 · pages_show_list, pages_read_engagement, pages_manage_posts, read_insights, instagram_basic/);
  assert.match(ass, /0:00:41\.00,0:00:50\.00,Texto,,0,0,0,,Back in ClipViral: the connected Page/);
  assert.ok(!dialogues.some((l) => /[{}\\]/.test(l.split(',,').slice(1).join(''))), 'sin llaves ni barras en el texto');
  const srt = buildSrt(info);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,000\nSTEP 1 OF 13/);
  assert.match(srt, /\n6\n00:00:41,000 --> 00:00:50,000\n/);
  assert.match(buildResumen(info), /0:41–0:50  Paso 6 \(pages_show_list, pages_read_engagement\)/);
});

test('grabador: órdenes de FFmpeg para grabar la pantalla principal y armar el video', () => {
  const rec = recordArgs({ x: 1280, y: 0, width: 1920, height: 1200, out: 'g.mkv' });
  const at = (a, k) => a[a.indexOf(k) + 1];
  assert.equal(at(rec, '-f'), 'gdigrab');
  assert.equal(at(rec, '-offset_x'), '1280');
  assert.equal(at(rec, '-video_size'), '1920x1200');
  assert.equal(at(rec, '-i'), 'desktop');
  assert.ok(!rec.includes('-an') && !rec.includes('dshow'), 'sin micrófono');
  const fin = finalArgs({ input: 'grabacion.mkv', width: 2560, height: 1440, out: 'C:/x/final.mp4' });
  assert.equal(at(fin, '-vf'), 'scale=1920:1080:flags=lanczos,pad=1920:1244:0:0:color=0x111118,drawbox=x=0:y=1080:w=1920:h=4:color=0x8b5cf6@1:t=fill,ass=subs.ass');
  assert.equal(fin.at(-1), 'C:/x/final.mp4');
  assert.ok(fin.includes('+faststart'));
});
