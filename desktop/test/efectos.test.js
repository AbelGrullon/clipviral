const test = require('node:test');
const assert = require('node:assert/strict');
const efectos = require('../engine/efectos');
const { videoFilter } = require('../engine/clipper');

test('normalize deja valores válidos', () => {
  assert.deepEqual(efectos.normalize({}), { espejo: false, velocidad: 1, fondo: '', silencios: false, voz: 'normal' });
  const n = efectos.normalize({ espejo: 1, velocidad: '1.4', fondo: 'C:/no/existe.png', silencios: true, voz: 'marciano' });
  assert.equal(n.velocidad, 1.5);
  assert.equal(n.fondo, '');
  assert.equal(n.voz, 'normal');
  assert.equal(n.espejo, true);
});

test('lee los silencios de FFmpeg', () => {
  const txt = '[silencedetect @ 0] silence_start: 2.5\n[silencedetect @ 0] silence_end: 4.1 | silence_duration: 1.6\n[silencedetect @ 0] silence_start: 28.2\n';
  assert.deepEqual(efectos.parseSilences(txt, 30), [{ start: 2.5, end: 4.1 }, { start: 28.2, end: 30 }]);
});

test('corta los silencios dejando un respiro', () => {
  const keep = efectos.keepRanges([{ start: 0, end: 1 }, { start: 10, end: 12 }, { start: 20, end: 20.5 }, { start: 28, end: 30 }], 30);
  // Cada corte deja 0,15 s antes de la voz (también al inicio); el silencio del final se corta entero; el de 0,5 s no se corta.
  assert.deepEqual(keep, [{ start: 0.85, end: 10.15 }, { start: 11.85, end: 28.15 }]);
  assert.ok(Math.abs(efectos.keptSeconds(keep) - 25.6) < 0.001);
  // Si casi todo es silencio, no se corta nada.
  assert.ok(efectos.isWhole(efectos.keepRanges([{ start: 0, end: 29 }], 30), 30));
});

test('cadena de audio: cortes, voz y velocidad', () => {
  assert.equal(efectos.audioFilter(efectos.normalize({}), null), '');
  const a = efectos.audioFilter(efectos.normalize({ voz: 'aguda', velocidad: 1.25 }), [{ start: 1, end: 5 }]);
  assert.match(a, /^\[0:a:0\]aselect='between\(t,1,5\)',asetpts=N\/SR\/TB,aresample=48000,asetrate=64800.*atempo=1\.25\[a\]$/);
});

test('el filtro de video aplica espejo, fondo, cortes y velocidad en orden', () => {
  const f = videoFilter('blur', true, { mirror: true, bgInput: 1, cut: [{ start: 0, end: 4 }, { start: 6, end: 9 }], speed: 1.5 });
  assert.match(f, /\[0:v\]fps=30,hflip,/);
  assert.match(f, /\[1:v\]scale=1080:1920.*\[bg\]/);
  assert.doesNotMatch(f, /boxblur/);
  // Los subtítulos se queman antes de cortar y acelerar.
  assert.match(f, /ass=subs\.ass,select='between\(t,0,4\)\+between\(t,6,9\)',setpts=N\/\(30\*1\.5\)\/TB,fps=30/);
  assert.match(videoFilter('blur', false, { speed: 2 }), /setpts=PTS\/2,fps=30/);
  // Con "recorte" el video llena la pantalla: el fondo no se usa.
  assert.doesNotMatch(videoFilter('recorte', false, { bgInput: 1 }), /\[1:v\]/);
});
