// "Saca ese clip": el streamer (o el chat) pide un clip y la app lo saca de lo que acaba de pasar.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timeline, pideClip } = require('../engine/detector');
const { ClipSession } = require('../engine/session');

test('reconoce las formas de pedir un clip', () => {
  const si = [
    '¡Saca ese clip!', 'sácame un clip de eso', 'Clipéalo, clipéalo', 'que alguien lo clipee', 'eso es clip',
    'eso va pa clip', 'Esto merece un clip', 'qué clipazo', 'clip that', 'CLIP IT', '!clip', 'cliiiip', 'clip clip clip',
    'saquen clip', 'hazle un clip a eso', 'no puede ser, saca ese clip', 'hay que sacar clip de eso',
  ];
  for (const t of si) assert.ok(pideClip(t), `debería pedir clip: ${t}`);
});

test('no confunde frases que hablan de otro clip o dicen que no', () => {
  const no = [
    'no saquen clip de esto', 'no lo clipeen', 'el clip de ayer estuvo bueno', 'saca el clip de ayer',
    'esto es un clip que vi en tiktok', 'vamos a ver clips', 'me gusta el clip', 'eso no es clip', 'saquen clips',
    "don't clip that", 'clips del stream',
  ];
  for (const t of no) assert.ok(!pideClip(t), `no debería pedir clip: ${t}`);
});

const palabras = (texto, desde, paso = 0.5) => texto.split(' ').map((w, i) => ({ s: desde + i * paso, e: desde + i * paso + 0.4, w }));

test('el streamer pide clip: segundo exacto y la frase como la dijo', () => {
  const tl = new Timeline();
  tl.addSegment(100, 60, palabras('jajaja no puede ser se cayó del puente ¡Saca ese clip! sigue la partida', 0), []);
  // Un moderador también escribe !clip unos segundos después: es el mismo pedido.
  tl.addChat(120, '!clip', { author: 'Moni', rol: 'mod' });
  assert.deepEqual(tl.clipRequests(100, 160), [{ t: 104, quien: 'streamer', frase: 'Saca ese clip' }]);
});

test('el chat: el dueño o un moderador basta; si no, hacen falta 3 personas', () => {
  const mod = new Timeline();
  mod.addSegment(0, 60, [], []);
  mod.addChat(40, '!clip', { author: 'Moni', rol: 'mod' });
  assert.deepEqual(mod.clipRequests(0, 60), [{ t: 38, quien: 'chat', frase: '!clip' }]);

  const dos = new Timeline();
  dos.addSegment(0, 60, [], []);
  dos.addChat(30, 'clip!!', { author: 'a' });
  dos.addChat(33, 'CLIP IT', { author: 'b' });
  dos.addChat(35, 'clip!!', { author: 'a' }); // la misma persona otra vez no cuenta
  assert.deepEqual(dos.clipRequests(0, 60), []);

  dos.addChat(38, 'clipeen eso', { author: 'c' });
  assert.deepEqual(dos.clipRequests(0, 60), [{ t: 26, quien: 'chat', frase: 'clip!!' }]);
});

/** Sesión sin video: sirve para ver qué clip intenta sacar (el corte real falla porque no hay video, y está bien). */
function fakeSession(opts) {
  const s = new ClipSession({ url: 'x', clipSeconds: 30, maxPerHour: 8, paths: {}, ...opts });
  s.info = { id: 'v', title: 'Directo de prueba', channel: 'Canal', isLive: true, url: 'x' };
  s.outDir = require('node:os').tmpdir();
  const producing = [];
  s.on('producing', (p) => producing.push(p));
  return { s, producing };
}

test('modo Local: saca el clip pedido con lo que pasó ANTES del pedido', async () => {
  const { s, producing } = fakeSession({ mode: 'local' });
  const relleno = Array.from({ length: 100 }, (_, i) => `palabra${i}`).join(' ');
  s.timeline.addSegment(0, 120, [...palabras(relleno, 10), ...palabras('se cayó del puente jajaja saca ese clip', 70)], []);
  s.stop();
  await new Promise((r) => s.once('done', r));
  assert.equal(producing.length, 1);
  const { start, end } = producing[0];
  // El pedido fue en el segundo 72,5: el clip termina ahí y empieza unos 30 s antes.
  assert.ok(end >= 72 && end <= 76, `fin ${end}`);
  assert.ok(start >= 40 && start <= 50, `inicio ${start}`);
});

test('modo IA Pro: el pedido va a Claude marcado y con la precisión elegida', async () => {
  const calls = [];
  const api = async (url, body) => {
    calls.push({ url, body });
    if (url === '/ai/scan') return { candidates: [], costUsd: 0.001 };
    if (url === '/ai/pick') return { clips: [{ id: '1', start: 50, end: 74, title: 'Se cayó del puente', hashtags: ['#fail'], description: '', score: 9, reason: 'Caída épica' }], costUsd: 0.05 };
    throw new Error(`no esperado: ${url}`);
  };
  const { s, producing } = fakeSession({ mode: 'ia', api, precision: 'alta' });
  s.timeline.addSegment(0, 120, palabras('se cayó del puente jajaja saca ese clip', 70), []);
  s.stop();
  await new Promise((r) => s.once('done', r));
  const scan = calls.find((c) => c.url === '/ai/scan');
  const pick = calls.find((c) => c.url === '/ai/pick');
  assert.equal(scan.body.precision, 'alta');
  assert.equal(pick.body.precision, 'alta');
  assert.deepEqual(pick.body.candidates[0].pedido, { quien: 'streamer', frase: 'saca ese clip', t: 73 });
  assert.ok(pick.body.candidates[0].start < 40, 'le da a Claude contexto de antes del pedido');
  assert.equal(producing[0].title, 'Se cayó del puente');
});
