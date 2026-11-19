// "Cámara + juego": si la IA no ve la cámara en el primer clip (una intro, una pantalla de pausa),
// la busca otra vez en los siguientes en vez de mandar todo el video con fondo.
// Sin video real: la búsqueda de la cámara está simulada y el corte falla (no hay FFmpeg), y está bien.
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const camara = require('../engine/camara');
const { ClipSession } = require('../engine/session');

const real = { measureVideo: camara.measureVideo, findCamera: camara.findCamera, localCamModel: camara.localCamModel };
afterEach(() => Object.assign(camara, real));

const CAJA = [700, 50, 980, 330]; // arriba a la derecha (0 a 1000)
const palabras = (texto, desde) => texto.split(' ').map((w, i) => ({ s: desde + i * 0.5, e: desde + i * 0.5 + 0.4, w }));

/** Un video horizontal de 2 minutos con `n` clips elegidos por Claude. */
function fakeSession(opts, n) {
  const s = new ClipSession({ url: 'x', clipSeconds: 20, maxPerHour: 8, style: 'camara', paths: {}, ...opts });
  s.info = { id: 'v', title: 'Video de prueba', channel: 'Canal', isLive: false, url: 'x' };
  s.outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-clips-'));
  s.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cam-trabajo-'));
  // El video "bajado": se pone justo después de "Detener" (sin grabador, Detener termina enseguida).
  const recorder = { segmentsFor: () => [{ file: 'falso.mp4', start: 0, duration: 120 }], cleanup() {} };
  const relleno = palabras(Array.from({ length: 180 }, (_, i) => `palabra${i}`).join(' '), 1);
  s.timeline.addSegment(0, 120, [...relleno, ...(opts.frase ? palabras(opts.frase, 100) : [])], []);
  const logs = [];
  s.on('log', (l) => logs.push(l.text));
  const momentos = Array.from({ length: n }, (_, i) => ({ start: 5 + i * 28, end: 25 + i * 28 }));
  const calls = [];
  const claudeCam = opts.claudeCam || (() => null);
  s.o.api = async (url, body) => {
    calls.push({ url, body });
    if (url === '/ai/scan') return { candidates: momentos.map((m) => ({ ...m, score: 9, reason: 'r' })), costUsd: 0 };
    if (url === '/ai/pick') return { clips: momentos.map((m, i) => ({ id: String(i + 1), ...m, title: `Clip ${i + 1}`, hashtags: [], description: '', score: 9, reason: 'r' })), costUsd: 0 };
    if (url === '/ai/camara') return { caja: claudeCam(calls.filter((c) => c.url === '/ai/camara').length), costUsd: 0.001 };
    throw new Error(`no esperado: ${url}`);
  };
  camara.measureVideo = async () => ({ w: 1920, h: 1080, game: { x: 0, y: 0, w: 1920, h: 1080 } });
  camara.findCamera = async ({ model, askClaude }) => {
    if (model) return { box: opts.localSees ? camara.boxFrom(CAJA) : null, b64: 'foto', by: 'local' };
    return { box: camara.boxFrom(await askClaude(['foto'])), b64: 'foto', by: 'claude' };
  };
  const done = new Promise((r) => s.once('done', r));
  return { s, logs, calls, run: async () => { s.stop(); s.recorder = recorder; await done; } };
}

test('Claude no ve la cámara en el primer clip: la busca otra vez y, cuando la encuentra, la usa para el resto', async () => {
  camara.localCamModel = async () => null; // Ollama apagado y sin forma de abrirlo
  const { logs, calls, run } = fakeSession({ mode: 'ia', precision: 'alta', claudeCam: (k) => (k === 1 ? null : CAJA) }, 3);
  await run();
  const cam = calls.filter((c) => c.url === '/ai/camara');
  assert.equal(cam.length, 2, 'pregunta en el 1.º (no la ve) y en el 2.º (la ve); el 3.º usa la que ya encontró');
  assert.equal(cam[0].body.precision, 'alta');
  assert.equal(logs.filter((t) => t.includes('No vi la cámara')).length, 1);
  assert.ok(logs.some((t) => t.includes('Encontré la cámara')));
  assert.ok(logs.some((t) => t.includes('Ajustar cámara')));
});

test('Claude nunca la ve: deja de preguntar después de 3 intentos y avisa', async () => {
  camara.localCamModel = async () => null;
  const { logs, calls, run } = fakeSession({ mode: 'ia' }, 4);
  await run();
  assert.equal(calls.filter((c) => c.url === '/ai/camara').length, 3);
  assert.ok(logs.some((t) => t.includes('Claude no vio la cámara en 3 momentos')));
});

test('Ollama instalado pero cerrado: lo abre una vez y busca la cámara gratis, sin Claude', async () => {
  let abierto = false;
  let aperturas = 0;
  camara.localCamModel = async () => (abierto ? 'qwen3-vl:4b-instruct' : null);
  const startOllama = async () => { aperturas++; abierto = true; };
  const { logs, calls, run } = fakeSession({ mode: 'ia', startOllama, localSees: true }, 2);
  await run();
  assert.equal(aperturas, 1);
  assert.equal(calls.filter((c) => c.url === '/ai/camara').length, 0);
  assert.ok(logs.some((t) => t.includes('Abriendo Ollama')));
  assert.ok(logs.some((t) => t.includes('Encontré la cámara')));
});

test('la IA local no la ve en este momento: en el plan Claude, pregunta a Claude', async () => {
  camara.localCamModel = async () => 'qwen3-vl:4b-instruct';
  const { calls, logs, run } = fakeSession({ mode: 'ia', localSees: false, claudeCam: () => CAJA }, 2);
  await run();
  assert.equal(calls.filter((c) => c.url === '/ai/camara').length, 1, 'la segunda vez usa la que ya encontró Claude');
  assert.ok(logs.some((t) => t.includes('Encontré la cámara')));
});

test('modo Local sin IA que mira el video: avisa y no llama a Claude', async () => {
  camara.localCamModel = async () => null;
  // En modo Local (sin video de verdad) el clip sale de "saca ese clip".
  const { logs, calls, run } = fakeSession({ mode: 'local', frase: 'se cayó del puente jajaja saca ese clip' }, 0);
  await run();
  assert.equal(calls.filter((c) => c.url === '/ai/camara').length, 0);
  assert.equal(logs.filter((t) => t.includes('hace falta la IA que mira el video')).length, 1);
});

test('si no puede medir el video, lo dice en vez de quedarse callado', async () => {
  camara.localCamModel = async () => null;
  const { logs, calls, run } = fakeSession({ mode: 'ia', claudeCam: () => CAJA }, 1);
  camara.measureVideo = async () => null;
  await run();
  assert.equal(calls.filter((c) => c.url === '/ai/camara').length, 0);
  assert.ok(logs.some((t) => t.includes('No pude medir el video')));
});
