const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildAss } = require('../engine/subtitles');
const { videoFilter } = require('../engine/clipper');
const { checkSystem } = require('../engine/requisitos');
const { buildCaption, UPLOADERS } = require('../engine/redes');
const { UploadQueue } = require('../engine/subidas');

const words = ['hola', 'qué', 'tal', 'amigos'].map((w, i) => ({ s: i * 0.5, e: i * 0.5 + 0.4, w }));

test('estilo: letra, tamaño, posición y minúsculas', () => {
  const ass = buildAss(words, { font: 'Impact', size: 'grande', position: 'arriba', uppercase: false, wordsPerLine: 2 }, 10);
  assert.match(ass, /Style: Viral,Impact,104,/);
  assert.match(ass, /,8,60,60,300,1/); // arriba
  assert.match(ass, /\}hola\{\\r\} qué/);
  assert.ok(!ass.includes('HOLA'));
});

test('estilo: título arriba y marca de agua', () => {
  const ass = buildAss(words, { titleBanner: { text: 'Mira esto', seconds: 3, color: 'morado' }, watermark: { text: '@micanal', position: 'arriba-izq' } }, 20);
  assert.match(ass, /Dialogue: 2,0:00:00\.00,0:00:03\.00,Titulo,,0,0,0,,\{\\fad\(250,250\)\}Mira esto/);
  assert.match(ass, /Marca,,0,0,0,,\{\\an7\}@micanal/);
  assert.match(ass, /0:00:20\.00,Marca/);
});

test('video: logo, 60 fps, 720p y zoom', () => {
  const f = videoFilter('recorte', true, { logo: { position: 'abajo-izq', size: 20, opacity: 50 }, fps: 60, quality: '720', zoom: 1.2 });
  assert.match(f, /\[1:v\]scale=216:-1,format=rgba,colorchannelmixer=aa=0\.50\[lg\]/);
  assert.match(f, /overlay=40:H-h-40\[b1\]/);
  assert.match(f, /\[b1\]ass=subs\.ass,fps=60,scale=720:1280\[v\]/);
  assert.match(f, /scale=1296:2304/);
});

const baseComps = { ytdlp: true, deno: true, ffmpeg: true, whisper: true, whisperFlavor: 'cpu', models: { small: { installed: true, label: 'Equilibrado', sizeMb: 181 } } };
const GB = 1024 ** 3;

test('requisitos: todo bien', () => {
  const r = checkSystem({ comps: baseComps, settings: { whisperModel: 'small' }, gpu: { hasNvidia: true, name: 'RTX' }, ollama: { running: false, models: [] }, ollamaPath: null, diskFree: 50 * GB, totalMem: 16 * GB, serverOk: true, mode: 'local' });
  assert.equal(r.ok, true);
  assert.equal(r.blocking, 0);
});

test('requisitos: pide instalar lo que falta y abrir Ollama', () => {
  const r = checkSystem({
    comps: { ...baseComps, ffmpeg: false, models: { small: { installed: false, label: 'Equilibrado', sizeMb: 181 } } },
    settings: { whisperModel: 'small', ollamaModel: 'qwen2.5:7b' },
    gpu: { hasNvidia: false }, ollama: { running: false, models: [] }, ollamaPath: 'C:/x/ollama app.exe',
    diskFree: 1 * GB, totalMem: 4 * GB, serverOk: false, mode: 'local',
  });
  assert.equal(r.ok, false);
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(by.ffmpeg.accion, 'instalar:ffmpeg');
  assert.equal(by.model.accion, 'instalar:model-small');
  assert.equal(by.ollama.accion, 'abrir-ollama');
  assert.equal(by.disk.estado, 'falta');
  assert.equal(by.ram.estado, 'aviso');
  assert.equal(by.server.estado, 'falta');
});

test('requisitos: sin Deno pide instalarlo (YouTube lo necesita)', () => {
  const r = checkSystem({ comps: { ...baseComps, deno: false, denoMb: 41 }, settings: { whisperModel: 'small' }, gpu: { hasNvidia: true, name: 'RTX' }, ollama: { running: false, models: [] }, ollamaPath: null, diskFree: 50 * GB, totalMem: 16 * GB, serverOk: true, mode: 'ia' });
  const deno = r.items.find((i) => i.id === 'deno');
  assert.equal(r.ok, false);
  assert.equal(deno.estado, 'falta');
  assert.equal(deno.accion, 'instalar:deno');
  assert.match(deno.detalle, /41 MB/);
});

test('requisitos: en modo IA Pro no exige Ollama', () => {
  const r = checkSystem({ comps: baseComps, settings: { whisperModel: 'small', ollamaModel: 'qwen2.5:7b' }, gpu: {}, ollama: { running: false, models: [] }, ollamaPath: null, diskFree: 50 * GB, totalMem: 16 * GB, serverOk: true, mode: 'ia' });
  assert.equal(r.items.some((i) => i.id === 'ollama'), false);
});

test('texto de la publicación con plantilla', () => {
  const clip = { title: 'Golazo', description: 'Increíble', hashtags: ['#futbol', '#viral'], stream: { channel: 'Ibai', url: 'https://yt/x' } };
  const t = buildCaption('{titulo}\n\n\n\n{hashtags}\nDe {canal} ({fuente}) {raro}', clip);
  assert.equal(t, 'Golazo\n\n#futbol #viral\nDe Ibai (https://yt/x) {raro}');
  // {gancho}: la primera frase que engancha; si el clip no tiene, va el título (los textos de antes no cambian)
  assert.equal(buildCaption('{gancho} | {titulo}', clip), 'Golazo | Golazo');
  assert.equal(buildCaption('{gancho} | {titulo}', { ...clip, gancho: '¡Mira esto! 😳' }), '¡Mira esto! 😳 | Golazo');
});

test('cola de subidas: lo que programó la versión anterior para publicarse solo se cancela', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cola-'));
  const file = path.join(dir, 'cola.json');
  const later = Date.now() + 3600000;
  fs.writeFileSync(file, JSON.stringify([
    { id: 'a', clipId: 'c1', platform: 'tiktok', status: 'pendiente', auto: true, scheduledAt: later, attempts: 0 },
    { id: 'b', clipId: 'c2', platform: 'tiktok', status: 'pendiente', scheduledAt: later, attempts: 0 },
    { id: 'c', clipId: 'c3', platform: 'youtube', status: 'publicado', auto: true, scheduledAt: 1, attempts: 1 },
  ]));
  let calls = 0;
  const q = new UploadQueue({ file, getToken: async () => ({}), uploaders: { tiktok: async () => { calls += 1; return {}; } } });
  try {
    assert.equal(q.cancelAuto(), 1, 'solo el automático que estaba pendiente');
    const [a, b, c] = q.list();
    assert.equal(a.status, 'cancelado');
    assert.match(a.note, /versión anterior/);
    assert.equal(b.status, 'pendiente', 'lo que programaste tú sigue en pie');
    assert.equal(c.status, 'publicado', 'lo ya publicado no se toca');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))[0].status, 'cancelado', 'queda guardado');
    assert.equal(q.cancelAuto(), 0);
    const job = q.add({ clip: { id: 'c9', file: 'x.mp4' }, platform: 'tiktok', title: 'T', caption: 'C', scheduledAt: later });
    assert.ok(!('auto' in job), 'las subidas nuevas no usan el ajuste viejo');
    assert.equal(job.origen, 'manual');
    assert.equal(calls, 0);
  } finally {
    q.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('subida a YouTube en pedazos (simulada)', async () => {
  const file = path.join(os.tmpdir(), `cv-yt-${Date.now()}.mp4`);
  fs.writeFileSync(file, Buffer.alloc(9 * 1024 * 1024, 1)); // 9 MB → 2 pedazos
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), method: opts.method, headers: opts.headers, body: opts.body });
    if (String(url).includes('uploadType=resumable')) return new Response(null, { status: 200, headers: { location: 'https://upload.test/session1' } });
    const range = opts.headers['Content-Range'];
    if (range.startsWith('bytes 0-')) return new Response(null, { status: 308, headers: { range: 'bytes=0-8388607' } });
    return Response.json({ id: 'VID123' });
  };
  const progress = [];
  try {
    const r = await UPLOADERS.youtube({ file, title: 'Hola <mundo>', description: 'desc', tags: ['#a', '#b'], token: 'tk', onProgress: (p) => progress.push(p) });
    assert.equal(r.url, 'https://www.youtube.com/shorts/VID123');
    const meta = JSON.parse(seen[0].body);
    assert.equal(meta.snippet.title, 'Hola mundo');
    assert.deepEqual(meta.snippet.tags, ['a', 'b']);
    assert.equal(meta.status.selfDeclaredMadeForKids, false);
    assert.equal(seen[1].headers['Content-Range'], `bytes 0-8388607/${9 * 1024 * 1024}`);
    assert.equal(seen[2].headers['Content-Range'], `bytes 8388608-${9 * 1024 * 1024 - 1}/${9 * 1024 * 1024}`);
    assert.equal(progress[progress.length - 1], 1);
  } finally {
    globalThis.fetch = real;
    fs.rmSync(file, { force: true });
  }
});

test('cola de subidas: publica, reintenta y no repite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-cola-'));
  const clipFile = path.join(dir, 'c.mp4');
  fs.writeFileSync(clipFile, 'x');
  let calls = 0;
  const q = new UploadQueue({
    file: path.join(dir, 'cola.json'),
    getToken: async () => ({ accessToken: 't', accountId: 'a' }),
    uploaders: {
      youtube: async ({ onProgress }) => { calls += 1; if (calls === 1) throw Object.assign(new Error('red caída'), { status: 503 }); onProgress(1); return { id: 'v', url: 'https://y/v' }; },
    },
  });
  try {
    const clip = { id: 'c1', file: clipFile, title: 'T' };
    const job = q.add({ clip, platform: 'youtube', title: 'T', caption: 'C' });
    assert.equal(q.add({ clip, platform: 'youtube', title: 'T', caption: 'C' }), null, 'no se repite');
    await q.tick();
    assert.equal(job.status, 'pendiente');
    assert.equal(job.attempts, 1);
    assert.match(job.error, /red caída/);
    job.scheduledAt = Date.now() - 1; // adelantamos el reintento
    await q.tick();
    assert.equal(job.status, 'publicado');
    assert.equal(job.url, 'https://y/v');
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cola.json'), 'utf8'));
    assert.equal(saved[0].status, 'publicado');
  } finally {
    q.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
