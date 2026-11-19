// Recorte para Instagram (39 s) y Facebook (88 s): Claude elige qué partes del clip se quedan y la app las une.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { trimTarget, phrases, volumeDigits, cleanPlan, cutFilter, smartTrim } = require('../engine/recorte');

test('cuándo se recorta: Instagram más de 40 s (si está encendido), Facebook más de 90 s', () => {
  assert.strictEqual(trimTarget({ platform: 'instagram', duration: 41 }), 39);
  assert.strictEqual(trimTarget({ platform: 'instagram', duration: 40 }), null);
  assert.strictEqual(trimTarget({ platform: 'instagram', duration: 80 }, { instagram: { recortar: false } }), null, 'apagado en Redes');
  assert.strictEqual(trimTarget({ platform: 'facebook', duration: 95 }), 88);
  assert.strictEqual(trimTarget({ platform: 'facebook', duration: 90 }), null);
  assert.strictEqual(trimTarget({ platform: 'facebook', duration: 120 }, { instagram: { recortar: false } }), 88, 'Facebook siempre: si no, lo rechaza');
  assert.strictEqual(trimTarget({ platform: 'youtube', duration: 300 }), null);
});

const w = (s, e, word) => ({ s, e, w: word });

test('las palabras se juntan en frases con su tiempo; el volumen va de 0 a 9', () => {
  const words = [w(0.2, 0.5, 'Hola'), w(0.55, 0.9, 'gente.'), w(1, 1.3, 'Miren'), w(1.35, 1.6, 'esto'), w(4, 4.4, 'wow')];
  assert.deepStrictEqual(phrases(words), [
    { s: 0.2, e: 0.9, texto: 'Hola gente.' },
    { s: 1, e: 1.6, texto: 'Miren esto' },
    { s: 4, e: 4.4, texto: 'wow' },
  ]);
  assert.strictEqual(volumeDigits([-120, -60, -30, -20, -25]), '00798', 'lo más fuerte es 9; 40 dB menos o más bajo, 0');
  assert.strictEqual(volumeDigits([]), '');
});

test('las partes de Claude se limpian: sin palabras cortadas, juntas si casi se tocan, nunca más del máximo', () => {
  const words = [w(9.8, 10.4, 'mira'), w(20, 20.6, 'golazo'), w(38.5, 39.4, 'increíble')];
  const plan = cleanPlan([
    { inicio: 30, fin: 45 }, // desordenada
    { inicio: 10, fin: 20.3 }, // empieza y termina a mitad de palabra
    { inicio: 20.5, fin: 25 }, // casi pegada a la anterior: se juntan
    { inicio: 50, fin: 50.5 }, // muy corta: se va
  ], { words, duration: 60, target: 30 });
  assert.ok(plan.total <= 30, `total ${plan.total}`);
  assert.strictEqual(plan.parts[0].s, 9.74, '"mira" entera (con un respiro)');
  assert.strictEqual(plan.parts.length, 2);
  assert.ok(plan.parts[0].e >= 25, 'la segunda se juntó con la primera');
  // El final se acortó para no pasarse, sin dejar "increíble" por la mitad.
  const last = plan.parts.at(-1);
  assert.ok(last.e < 38.5 || last.e >= 39.4, `termina en ${last.e}`);
  assert.strictEqual(cleanPlan([], { words, duration: 60, target: 30 }), null);
  assert.strictEqual(cleanPlan([{ inicio: 'x', fin: 2 }, { inicio: 5, fin: 6 }], { words, duration: 60, target: 30 }), null, 'menos de 3 s: no sirve');
});

test('FFmpeg une las partes con un fundido de sonido cortito en cada corte', () => {
  const f = cutFilter([{ s: 1, e: 3 }, { s: 10, e: 14 }]);
  assert.match(f, /\[0:v\]trim=start=1\.000:end=3\.000,setpts=PTS-STARTPTS\[v0\]/);
  assert.match(f, /\[0:a\]atrim=start=10\.000:end=14\.000/);
  assert.match(f, /\[v0\]\[a0\]\[v1\]\[a1\]concat=n=2:v=1:a=1\[v\]\[a\]$/);
  assert.doesNotMatch(cutFilter([{ s: 1, e: 3 }], { audio: false }), /atrim|\[a0\]/);
});

// Con FFmpeg de verdad (el que baja la app). Si esta PC no lo tiene, se salta.
const FFMPEG = path.join(process.env.APPDATA || '', 'ClipViral', 'bin', 'ffmpeg.exe');
const FFPROBE = FFMPEG.replace(/ffmpeg\.exe$/, 'ffprobe.exe');
const hasFfmpeg = fs.existsSync(FFMPEG) && fs.existsSync(FFPROBE);
const dur = (file) => Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }));

test('con FFmpeg: Claude elige partes y sale un video de ese largo; sin Claude, el principio', { skip: !hasFfmpeg && 'sin FFmpeg en esta PC' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorte-test-'));
  try {
    const clip = path.join(dir, 'clip.mp4');
    execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=360x640:r=30:d=60',
      '-f', 'lavfi', '-i', 'sine=f=440:d=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', clip]);
    const job = { id: 'j1', platform: 'instagram', file: clip, duration: 60, title: 'Prueba' };
    const pedidos = [];
    const notas = [];
    const deps = {
      ffmpeg: FFMPEG,
      tmpDir: dir,
      transcribe: async () => ({ words: [w(5, 5.5, 'hola'), w(30, 30.4, 'gol')], loudness: Array(60).fill(-20), duration: 60 }),
      ask: async (body) => { pedidos.push(body); return { partes: [{ inicio: 4, fin: 14 }, { inicio: 28, fin: 40 }, { inicio: 50, fin: 58 }], resumen: 'Quité la espera del medio' }; },
      onNote: (n) => notas.push(n),
      cache: new Map(),
    };
    const r = await smartTrim(job, 39, deps);
    assert.ok(Math.abs(dur(r.file) - r.duration) < 0.3, `video ${dur(r.file)} s, plan ${r.duration} s`);
    assert.ok(r.duration <= 39);
    assert.match(r.note, /Claude dejó lo mejor en \d+ s para Instagram: Quité la espera del medio/);
    assert.strictEqual(pedidos[0].maximo, 39);
    assert.ok(pedidos[0].fotos.length >= 10 && pedidos[0].fotos.every((f) => f.data.length > 100), 'le manda fotos del clip');
    assert.deepStrictEqual(pedidos[0].frases.map((f) => f.texto), ['hola', 'gol']);
    assert.ok(notas.some((n) => /Claude está viendo el clip/.test(n)));
    r.cleanup();
    assert.ok(!fs.existsSync(r.file));

    // Un reintento no le vuelve a preguntar a Claude (ni gasta otra vez).
    const r2 = await smartTrim(job, 39, deps);
    assert.strictEqual(pedidos.length, 1);
    r2.cleanup();

    // Sin Claude (modo Local, sin internet...): el principio del clip, como antes.
    const r3 = await smartTrim({ ...job, id: 'j2' }, 39, { ...deps, cache: new Map(), ask: async () => { throw new Error('Tu plan no incluye la IA Pro'); } });
    assert.strictEqual(r3.duration, 39);
    assert.ok(Math.abs(dur(r3.file) - 39) < 0.5);
    assert.match(r3.note, /primeros 39 s para Instagram \(Tu plan no incluye la IA Pro\)/);
    r3.cleanup();
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['clip.mp4'], 'no deja archivos de trabajo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
