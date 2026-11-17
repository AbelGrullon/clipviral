const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAss, chunkWords, assTime } = require('../engine/subtitles');
const { Timeline } = require('../engine/detector');
const { parseWhisperJson, loudnessPerSecond } = require('../engine/transcribe');
const { youtubeId, slug, fmtClock } = require('../engine/util');
const { autoTitle } = require('../engine/session');
const { videoFilter } = require('../engine/clipper');

test('saca el ID de cualquier enlace de YouTube', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/live/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('hola'), null);
});

test('nombres de archivo limpios', () => {
  assert.equal(slug('¡Qué Jugada Increíble! 😂'), 'que-jugada-increible');
  assert.equal(fmtClock(3725), '1:02:05');
  assert.equal(fmtClock(65), '1:05');
});

test('tiempo de subtítulos', () => {
  assert.equal(assTime(61.237), '0:01:01.23');
});

test('subtítulos: bloques de máximo 3 palabras y palabra resaltada', () => {
  const words = ['esto', 'fue', 'una', 'locura', 'total'].map((w, i) => ({ s: i * 0.4, e: i * 0.4 + 0.35, w }));
  const chunks = chunkWords(words);
  assert.ok(chunks.every((c) => c.length <= 3));
  const ass = buildAss(words, { color: 'amarillo' });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /\{\\c&H0000FFFF&.*\}ESTO\{\\r\} FUE UNA/);
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, 5);
});

test('subtítulos: quita llaves para no romper el formato', () => {
  const ass = buildAss([{ s: 0, e: 1, w: 'hola{\\b1}' }]);
  assert.ok(!ass.includes('{\\b1}'));
});

test('lee la salida de Whisper y une pedazos de palabra', () => {
  const words = parseWhisperJson({
    transcription: [
      { text: ' Hola', offsets: { from: 0, to: 400 } },
      { text: ' increí', offsets: { from: 500, to: 700 } },
      { text: 'ble', offsets: { from: 700, to: 900 } },
      { text: '!', offsets: { from: 900, to: 920 } },
      { text: ' Subtítulos realizados por la comunidad de Amara.org', offsets: { from: 1000, to: 3000 } },
    ],
  });
  assert.deepEqual(words.map((w) => w.w), ['Hola', 'increíble!']);
  assert.equal(words[1].s, 0.5);
});

test('mide el volumen de un WAV', () => {
  const rate = 16000;
  const samples = rate * 2;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = rate; i < samples; i++) buf.writeInt16LE(i % 2 ? 16000 : -16000, 44 + i * 2); // segundo 2 fuerte
  const file = path.join(os.tmpdir(), `cv-test-${Date.now()}.wav`);
  fs.writeFileSync(file, buf);
  const db = loudnessPerSecond(file);
  fs.rmSync(file);
  assert.equal(db.length, 2);
  assert.ok(db[0] < -80);
  assert.ok(db[1] > -10);
});

function fakeTimeline() {
  const tl = new Timeline();
  const words = [];
  for (let t = 0; t < 600; t += 0.5) words.push({ s: t, e: t + 0.4, w: t > 300 && t < 304 ? 'jajaja' : 'palabra' });
  const loud = Array.from({ length: 600 }, (_, i) => (i >= 298 && i <= 306 ? -8 : -30 + (i % 3)));
  tl.addSegment(0, 600, words, loud);
  for (let t = 0; t < 600; t += 6) tl.addChat(t, 'hola');
  for (let i = 0; i < 40; i++) tl.addChat(308 + i * 0.2, i % 2 ? 'JAJAJAJA 😂' : 'clip clip');
  return tl;
}

test('detector: encuentra el momento con grito + risas + chat', () => {
  const tl = fakeTimeline();
  const peaks = tl.findPeaks(0, 600, { clipSeconds: 45, sensitivity: 'media' });
  assert.equal(peaks.length, 1);
  assert.ok(Math.abs(peaks[0].t - 302) <= 6, `pico en ${peaks[0].t}`);
});

test('detector: nada viral en un tramo tranquilo', () => {
  const tl = fakeTimeline();
  assert.equal(tl.findPeaks(0, 250, { clipSeconds: 45, sensitivity: 'media' }).length, 0);
});

test('detector: resúmenes para la IA', () => {
  const tl = fakeTimeline();
  const bins = tl.chatBins(300, 320);
  assert.ok(bins.some((b) => b.laughs > 0));
  const lines = tl.lines(300, 310);
  assert.ok(lines.length > 0 && lines[0].text.includes('jajaja'));
  const { start, end } = tl.snap(280, 325);
  assert.ok(start >= 275 && end <= 330 && end > start);
});

test('título automático corto', () => {
  const t = autoTitle('no puedo creer lo que acaba de pasar en este directo de verdad'.split(' ').map((w, i) => ({ s: i, e: i + 0.5, w })));
  assert.match(t, /^No puedo creer/);
  assert.ok(t.endsWith('…'));
});

test('filtros de video para cada formato', () => {
  assert.match(videoFilter('blur', true), /boxblur.*ass=subs\.ass/);
  assert.match(videoFilter('recorte', false), /crop=1080:1920/);
  assert.doesNotMatch(videoFilter('recorte', false), /ass=/);
  assert.match(videoFilter('horizontal', true), /1920:1080/);
});

// ---------- "Detener" en un video ya subido ----------
const { VodSource } = require('../engine/vod');

/** yt-dlp de mentira: el audio se queda bajando; el video termina a los FAKE_VIDEO_MS. */
function fakeVod() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-vod-'));
  const script = path.join(dir, 'yt-dlp-falso.js');
  fs.writeFileSync(script, `
const fs = require('fs');
const out = process.argv[process.argv.indexOf('-o') + 1];
console.log('[download]  10.0% of 5MiB');
if (out.startsWith('audio')) setInterval(() => {}, 1000);
else setTimeout(() => { fs.writeFileSync('video.mp4', 'x'); process.exit(0); }, Number(process.env.FAKE_VIDEO_MS));
`);
  const work = path.join(dir, 'video');
  const v = new VodSource({ ytdlp: process.execPath, ytdlpArgs: [script], ffmpeg: path.join(dir, 'no', 'ffmpeg.exe'), ffprobe: path.join(dir, 'no', 'ffprobe.exe'), url: 'https://youtu.be/x', dir: work });
  return { v, dir };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Detener en un video: deja de bajar el audio pero termina de bajar el video para cortar los clips', async () => {
  process.env.FAKE_VIDEO_MS = '700';
  const { v, dir } = fakeVod();
  try {
    const ended = new Promise((r) => v.once('end', r));
    v.start();
    await wait(300);
    v.stop();
    assert.equal((await ended).reason, 'stopped', 'el audio se cortó');
    const [seg] = await v.videoSegmentsFor(0, 10);
    assert.match(seg.file, /video\.mp4$/, 'el video siguió bajando y sirve para cortar los clips');
  } finally {
    v.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cancelar todo (al terminar o cerrar la app) sí corta la descarga del video', async () => {
  process.env.FAKE_VIDEO_MS = '60000';
  const { v, dir } = fakeVod();
  try {
    const ended = new Promise((r) => v.once('end', r));
    v.start();
    await wait(300);
    v.abort();
    await assert.rejects(v.videoSegmentsFor(0, 10), /detenido/);
    await ended; // el audio también se cerró
    assert.equal(v.procs.size, 0, 'no queda nada bajando');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subtítulos en videos largos: cada pedazo de audio usa su tiempo exacto (no se van corriendo)', () => {
  const { parseSegmentList } = require('../engine/vod');
  // Lo que escribe FFmpeg al cortar el audio: nombre, inicio y fin dentro del video completo.
  const t = parseSegmentList('aud_00000.ts,0.000000,120.021333\r\naud_00070.ts,8401.493333,8521.514667\n"raro,nombre.ts",9000,9010.5\nbasura\nmal.ts,5,3\n');
  assert.deepEqual(t['aud_00000.ts'], { start: 0, end: 120.021333 });
  assert.equal(t['aud_00070.ts'].start, 8401.493333, 'el pedazo 70 empieza donde de verdad empieza, sin sumar errores');
  assert.deepEqual(t['raro,nombre.ts'], { start: 9000, end: 9010.5 });
  assert.equal(Object.keys(t).length, 3, 'las líneas rotas se ignoran');
  assert.deepEqual(parseSegmentList(''), {});
});
