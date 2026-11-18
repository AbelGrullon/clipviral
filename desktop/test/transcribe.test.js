// Tiempos precisos de Whisper (DTW): de los pedazos de palabra (tokens) a palabras con su tiempo real.
const test = require('node:test');
const assert = require('node:assert');
const { parseWhisperDtw, dtwPreset, whisperArgs } = require('../engine/transcribe');

const tk = (text, cs) => ({ text, t_dtw: cs });
const seg = (text, tokens) => ({ text, offsets: { from: 0, to: 0 }, tokens: [tk('[_BEG_]', 0), ...tokens, tk('[_TT_150]', 0)] });

test('DTW: arma palabras con su tiempo, pega los signos y quita guiones y (risas)', () => {
  const w = parseWhisperDtw({ transcription: [
    seg(' - ¿Quieres irme aquí? (risas)', [tk(' -', 1298), tk(' ¿', 1914), tk('Qu', 1914), tk('ieres', 1920), tk(' ir', 1936), tk('me', 1940), tk(' aquí', 1972), tk('?', 2000), tk(' (', 2102), tk('ris', 2102), tk('as', 2110), tk(')', 2112)]),
  ] });
  assert.deepStrictEqual(w.map((x) => x.w), ['¿Quieres', 'irme', 'aquí?']);
  assert.deepStrictEqual(w.map((x) => x.s), [19.14, 19.36, 19.72]);
  assert.ok(w.every((x) => x.e > x.s), 'cada palabra termina después de empezar');
  assert.strictEqual(w[0].e, 19.36, 'termina cuando empieza la siguiente');
});

test('DTW: el "¿" suelto va con la palabra que sigue', () => {
  const w = parseWhisperDtw({ transcription: [seg(' ¿ Qué?', [tk(' ¿', 100), tk(' Qué', 120), tk('?', 140)])] });
  assert.deepStrictEqual(w.map((x) => x.w), ['¿Qué?']);
});

test('DTW: la frase que Whisper repite al final se quita', () => {
  const frase = (cs) => [tk(' O', cs), tk(' sea', cs + 10), tk(',', cs + 12), tk(' qué', cs + 30), tk(' loco', cs + 50)];
  const w = parseWhisperDtw({ transcription: [seg(' O sea, qué loco', frase(4242)), seg(' - O sea, qué loco', frase(4474))] }, 45);
  assert.deepStrictEqual(w.map((x) => x.w), ['O', 'sea,', 'qué', 'loco']);
  assert.strictEqual(w[0].s, 42.42);
});

test('DTW: la primera palabra que quedó segundos antes se pone junto a la frase; una pausa corta se respeta', () => {
  const lejos = parseWhisperDtw({ transcription: [seg(' O sea si', [tk(' O', 3764), tk(' sea', 4242), tk(' si', 4260)])] });
  assert.ok(lejos[0].s > 42 && lejos[0].s < 42.42, `O en ${lejos[0].s}`);
  const pausa = parseWhisperDtw({ transcription: [seg(' ¿Tú? ¿Tú eres', [tk(' ¿', 142), tk('Tú', 142), tk('?', 150), tk(' ¿', 258), tk('Tú', 258), tk(' eres', 272)])] });
  assert.strictEqual(pausa[0].s, 1.42, 'una pausa de poco más de 1 s es real');
});

test('DTW: palabras amontonadas en el mismo instante se reparten y no pasan del final del audio', () => {
  const words = ['si', 'no', 'hubiese', 'cambiado', 'eso'];
  const w = parseWhisperDtw({ transcription: [seg(' si no hubiese cambiado eso', words.map((x) => tk(` ${x}`, 4478)))] }, 45);
  assert.strictEqual(w.length, 5);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].s > w[i - 1].s, 'cada una después de la anterior');
  assert.ok(w.at(-1).e <= 45, `termina en ${w.at(-1).e}`);
});

test('sin DTW en la salida, se usa el modo normal (null)', () => {
  assert.strictEqual(parseWhisperDtw({ transcription: [seg(' Hola', [{ text: ' Hola' }])] }), null);
  assert.strictEqual(parseWhisperDtw({ transcription: [seg(' Hola', [tk(' Hola', -1)])] }), null);
  assert.deepStrictEqual(parseWhisperDtw({ transcription: [] }), [], 'sin voz: sin palabras (no es un error)');
});

test('modelo → preset de DTW, y argumentos con respaldo', () => {
  assert.strictEqual(dtwPreset('C:/x/models/ggml-small-q5_1.bin'), 'small');
  assert.strictEqual(dtwPreset('ggml-base.bin'), 'base');
  assert.strictEqual(dtwPreset('ggml-medium-q5_0.bin'), 'medium');
  assert.strictEqual(dtwPreset('ggml-large-v3-turbo-q5_0.bin'), 'large.v3.turbo');
  assert.strictEqual(dtwPreset('otro.bin'), null);
  const base = { model: 'ggml-small-q5_1.bin', wav: 'a.wav', language: 'es', base: 'a', threads: 4 };
  const a = whisperArgs({ ...base, useGpu: true, feats: { dtw: true, nfa: true } });
  assert.deepStrictEqual(a.precise.slice(-4), ['-ojf', '--dtw', 'small', '-nfa']);
  assert.ok(a.precise.includes('--dtw') && a.precise.includes('-nfa') && a.precise.includes('-ojf') && !a.precise.includes('-ml'));
  assert.ok(a.plain.includes('-ml') && a.plain.includes('-sow') && a.plain.includes('-oj'), 'el de siempre, de respaldo');
  assert.strictEqual(whisperArgs({ ...base, useGpu: true, feats: { dtw: false } }).precise, null, 'whisper viejo sin --dtw');
  assert.strictEqual(whisperArgs({ ...base, model: 'raro.bin', useGpu: true, feats: { dtw: true } }).precise, null);
  const cpu = whisperArgs({ ...base, useGpu: false, feats: { dtw: true, nfa: false } });
  assert.ok(cpu.precise.includes('-ng') && cpu.plain.includes('-ng') && !cpu.precise.includes('-nfa'));
});
