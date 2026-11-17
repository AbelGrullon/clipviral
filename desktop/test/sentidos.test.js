// IA local que ve y escucha: detector de sonidos, modelo de visión y el juez que decide si coinciden.
const test = require('node:test');
const assert = require('node:assert');
const { categorize, soundScore, describe, merge } = require('../engine/sonido');
const { judge } = require('../engine/juez');
const { frameTimes, parseReview, pickVisionModel } = require('../engine/vista');
const { Timeline } = require('../engine/detector');

const labels = { 0: 'Speech', 1: 'Laughter', 2: 'Screaming', 3: 'Applause', 4: 'Giggle' };

test('sonido: junta etiquetas de AudioSet en risas, gritos, euforia…', () => {
  const cats = categorize([0.9, 0.2, 0.05, 0.4, 0.35], labels);
  assert.strictEqual(cats.risas, 0.35); // la más fuerte entre Laughter y Giggle
  assert.strictEqual(cats.gritos, 0.05);
  assert.strictEqual(cats.euforia, 0.4);
  assert.match(describe(cats), /risas/);
  assert.match(describe(cats), /aplausos/);
  assert.doesNotMatch(describe(cats), /gritos/);
});

test('sonido: solo voz no cuenta como momento fuerte', () => {
  const speech = categorize([0.95, 0.02, 0.01, 0.01, 0.01], labels);
  assert.strictEqual(describe(speech), '');
  assert.ok(soundScore(speech) < 0.5);
  const laugh = categorize([0.5, 0.6, 0.3, 0, 0], labels);
  assert.ok(soundScore(laugh) > 2, `risas + gritos suman fuerte (${soundScore(laugh)})`);
  assert.deepStrictEqual(merge([{ risas: 0.1, gritos: 0.5 }, { risas: 0.4 }]), { risas: 0.4, gritos: 0.5 });
});

test('detector: el sonido sube el puntaje y marca el pico como "sonido"', () => {
  const tl = new Timeline();
  const quiet = Array(120).fill(-30);
  tl.addSegment(0, 120, [{ s: 50, e: 51, w: 'hola' }], quiet);
  const windows = Array.from({ length: 12 }, (_, i) => ({ t: i * 10, cats: {}, score: 0 }));
  windows[6] = { t: 60, cats: { risas: 0.6 }, score: 3 };
  tl.addSound(0, windows);
  const peaks = tl.findPeaks(0, 120, { clipSeconds: 30, sensitivity: 'media' });
  assert.strictEqual(peaks.length, 1);
  assert.ok(peaks[0].t >= 58 && peaks[0].t <= 72, `pico en ${peaks[0].t}`);
  assert.strictEqual(peaks[0].kind, 'sonido');
  assert.strictEqual(tl.soundBetween(55, 65).length, 2);
  tl.trim(100);
  assert.ok(tl.sound.every((w) => w.t + 10 >= 100));
});

test('juez: hacen falta 2 señales de acuerdo (sensibilidad media)', () => {
  const peak = { score: 2.4, chat: 0, loud: 1 };
  // Solo la voz: con una sola señal disponible, alcanza.
  assert.strictEqual(judge({ peak }).keep, true);
  // Voz floja, pero se oyen risas y se ve algo fuerte → sale.
  const strong = judge({ peak: { score: 1.8 }, sound: { cats: { risas: 0.5 }, score: 2 }, vision: { imagen: 8, viral: 7, que_pasa: 'se cae de la silla' } });
  assert.strictEqual(strong.keep, true);
  assert.match(strong.reason, /risas/);
  assert.match(strong.reason, /se cae de la silla/);
  // Solo una de tres → no sale.
  const weak = judge({ peak: { score: 1.8 }, sound: { cats: {}, score: 0 }, vision: { imagen: 3, viral: 6 } });
  assert.strictEqual(weak.keep, false);
  assert.strictEqual(weak.votes, 0);
  // Coinciden, pero la IA le da poca nota → no sale.
  assert.strictEqual(judge({ peak, sound: { cats: { gritos: 0.5 }, score: 2 }, vision: { imagen: 7, viral: 3 } }).keep, false);
});

test('juez: si la IA lo ve clarísimo, cuenta como un voto más', () => {
  const r = judge({ peak: { score: 1.8 }, sound: { cats: {}, score: 0 }, vision: { imagen: 9, viral: 9, que_pasa: 'celebran' } });
  assert.strictEqual(r.keep, true);
  assert.strictEqual(r.available, 3);
  assert.strictEqual(r.reason, 'Se ve: celebran');
});

test('juez: con sensibilidad baja tienen que coincidir las tres', () => {
  const two = { peak: { score: 3.6, chat: 3 }, sound: { cats: { risas: 0.6 }, score: 2 }, vision: { imagen: 4, viral: 7 }, threshold: 3, sensitivity: 'baja' };
  assert.strictEqual(judge(two).keep, false);
  assert.strictEqual(judge({ ...two, vision: { imagen: 8, viral: 8 } }).keep, true);
});

test('visión: fotos repartidas y alrededor del pico', () => {
  const times = frameTimes(100, 140, 125);
  assert.strictEqual(times.length, 6);
  assert.ok(times.every((t) => t >= 100 && t <= 140));
  assert.ok(times.includes(123.5) && times.includes(126.5));
  assert.deepStrictEqual(times, [...times].sort((a, b) => a - b));
});

test('visión: lee la respuesta del modelo aunque venga rara', () => {
  const r = parseReview('{"imagen": 12, "viral": "8", "title": "Se cae", "hashtags": ["#a","#b"], "que_pasa": "x"}');
  assert.strictEqual(r.imagen, 10);
  assert.strictEqual(r.viral, 8);
  assert.deepStrictEqual(r.hashtags, ['#a', '#b']);
  assert.deepStrictEqual(parseReview('no es json'), { que_pasa: '', imagen: 4, viral: 5, title: '', hashtags: [], description: '' });
});

test('visión: elige el modelo según la tarjeta de video', () => {
  // 8 GB: el de 8b no cabe junto con Whisper durante un directo.
  assert.strictEqual(pickVisionModel([], { vramGb: 8, ramGb: 16 }).id, 'qwen3-vl:4b-instruct');
  assert.strictEqual(pickVisionModel(['qwen3-vl:8b-instruct'], { vramGb: 8, ramGb: 16 }).id, 'qwen3-vl:4b-instruct');
  assert.strictEqual(pickVisionModel([], { vramGb: 12, ramGb: 32 }).id, 'qwen3-vl:8b-instruct');
  assert.strictEqual(pickVisionModel([], { vramGb: 4, ramGb: 16 }).id, 'qwen3-vl:2b-instruct');
  assert.strictEqual(pickVisionModel(['qwen3-vl:4b-instruct'], { vramGb: 6, ramGb: 16 }).installed, true);
  assert.strictEqual(pickVisionModel([], { vramGb: 0, ramGb: 6 }), null);
});
