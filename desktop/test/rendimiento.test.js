const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { prettyName, describeModels, pickModel } = require('../engine/localai');
const { suggest, levels } = require('../engine/rendimiento');
const { download } = require('../engine/util');
const { createComponents } = require('../engine/components');

const MODELS = {
  base: { label: 'Rápido (base)', sizeMb: 142, installed: true },
  small: { label: 'Equilibrado (small)', sizeMb: 181, installed: true },
  medium: { label: 'Preciso (medium)', sizeMb: 514, installed: false },
};
const LOOK = { quality: '1080', fps: 30 };

// Lo que tiene instalado Ollama en la PC de prueba
const OLLAMA = {
  running: true,
  models: ['qwen3-vl:8b-instruct', 'qwen3:8b'],
  details: [
    { name: 'qwen3-vl:8b-instruct', sizeGb: 6.14, params: '8.8B', vision: true, embedding: false },
    { name: 'qwen3:8b', sizeGb: 5.23, params: '8.2B', vision: false, embedding: false },
  ],
};

test('nombres claros para los modelos de IA', () => {
  assert.equal(prettyName('qwen3-vl:8b-instruct'), 'Qwen 3 VL · 8B');
  assert.equal(prettyName('qwen3:8b'), 'Qwen 3 · 8B');
  assert.equal(prettyName('llama3.2:3b'), 'Llama 3.2 · 3B');
  assert.equal(prettyName('gemma3:4b-it-qat'), 'Gemma 3 · 4B');
  assert.equal(prettyName('mimodelo:latest', '7.6B'), 'Mimodelo · 7.6B');
});

test('lista de modelos: recomienda el que cabe en la tarjeta y explica el de visión', () => {
  const list = describeModels(OLLAMA, { vramGb: 7.96, ramGb: 15.6, gpuName: 'RTX 5050' }, '');
  const byId = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(byId['qwen3:8b'].recommended, true);
  assert.equal(byId['qwen3:8b'].installed, true);
  assert.equal(byId['qwen3:8b'].fit, 'rapido');
  assert.match(byId['qwen3-vl:8b-instruct'].note, /lee imágenes/);
  assert.equal(byId['qwen3-vl:8b-instruct'].recommended, false);
  assert.equal(byId['qwen3:4b'].installed, false);
  assert.equal(list.filter((m) => m.recommended).length, 1);
});

test('PC potente con NVIDIA: sugiere Whisper NVIDIA, la IA que ya tiene y video con la tarjeta', () => {
  const hw = { cpu: { model: 'i5-13450HX', threads: 16 }, ramGb: 15.6, freeRamGb: 4, gpu: { name: 'RTX 5050', vramGb: 7.96 }, nvenc: true, encodeFps: 230, diskFreeGb: 120 };
  assert.deepEqual(levels(hw), { cpu: 'alto', gpu: 'alto', ram: 'alto', score: 100, overall: 'potente' });
  const r = suggest(hw, {
    comps: { whisperFlavor: 'cpu', models: MODELS },
    ollama: OLLAMA, ollamaInstalled: true,
    settings: { mode: 'local', whisperModel: 'small', gpuEncode: true, ollamaModel: '', whisperGpu: true, look: LOOK },
  });
  assert.deepEqual(r.changes.map((c) => c.key), ['ollamaModel']);
  assert.equal(r.patch.ollamaModel, 'qwen3:8b');
  assert.equal(r.changes[0].to, 'Qwen 3 · 8B');
  assert.equal(r.extras[0].accion, 'instalar:whisper-gpu');
  // Con Whisper para NVIDIA ya instalado, pasa al modelo de voz más preciso (y avisa que se descarga)
  const r2 = suggest(hw, {
    comps: { whisperFlavor: 'gpu', models: MODELS }, ollama: OLLAMA, ollamaInstalled: true,
    settings: { mode: 'local', whisperModel: 'small', gpuEncode: true, ollamaModel: 'qwen3:8b', whisperGpu: true, look: LOOK },
  });
  assert.deepEqual(r2.patch, { whisperModel: 'medium' });
  assert.match(r2.changes[0].why, /514 MB/);
  assert.equal(r2.extras.length, 0);
});

test('PC sencilla sin NVIDIA: modelo rápido, 720p, 30 fps y sugiere bajar un modelo de IA liviano', () => {
  const hw = { cpu: { model: 'i3', threads: 4 }, ramGb: 8, freeRamGb: 2, gpu: null, nvenc: false, encodeFps: 40, diskFreeGb: 6 };
  assert.equal(levels(hw).overall, 'basica');
  const r = suggest(hw, {
    comps: { whisperFlavor: 'cpu', models: MODELS },
    ollama: { running: true, models: [], details: [] }, ollamaInstalled: true,
    settings: { mode: 'local', whisperModel: 'small', gpuEncode: true, ollamaModel: '', look: { quality: '1080', fps: 60 } },
  });
  assert.deepEqual(r.patch, { whisperModel: 'base', gpuEncode: false, look: { quality: '720', fps: 30 } });
  assert.deepEqual(r.extras.map((x) => x.accion), ['ollama:qwen3:4b', 'elegir-carpeta']);
  assert.ok(r.key);
});

test('el mismo análisis da la misma clave (para no volver a preguntar si dijo "Ahora no")', () => {
  const hw = { cpu: { model: 'x', threads: 8 }, ramGb: 16, freeRamGb: 8, gpu: null, nvenc: false, encodeFps: 90, diskFreeGb: 50 };
  const ctx = { comps: { whisperFlavor: 'cpu', models: MODELS }, settings: { mode: 'ia', whisperModel: 'base', gpuEncode: true, look: LOOK } };
  assert.equal(suggest(hw, ctx).key, suggest(hw, ctx).key);
  assert.equal(pickModel([], { vramGb: 0, ramGb: 4 }), null);
});

// Servidor de prueba: la primera vez manda un pedazo y se traba; después deja continuar con Range.
function flakyServer(data, { alwaysStall = false } = {}) {
  let calls = 0;
  const ranges = [];
  const server = http.createServer((req, res) => {
    calls += 1;
    const m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const start = m ? Number(m[1]) : 0;
    ranges.push(start);
    const body = data.subarray(start);
    res.writeHead(m ? 206 : 200, { 'Content-Length': body.length, ...(m ? { 'Content-Range': `bytes ${start}-${data.length - 1}/${data.length}` } : {}) });
    if (calls === 1 || alwaysStall) { res.write(body.subarray(0, 300000)); return; } // se queda trabado
    res.end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/f`, ranges })));
}

test('descarga trabada: sigue desde donde iba y el archivo queda completo', async () => {
  const data = crypto.randomBytes(1024 * 1024);
  const { server, url, ranges } = await flakyServer(data);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-dl-'));
  try {
    const dest = path.join(dir, 'archivo.bin');
    const r = await download(url, dest, null, null, { stallMs: 300, retries: 3 });
    assert.deepEqual(fs.readFileSync(dest), data);
    assert.equal(r.sha256, crypto.createHash('sha256').update(data).digest('hex'));
    assert.equal(ranges[0], 0);
    assert.ok(ranges[1] > 0, 'la segunda vez pide continuar, no empezar de cero');
    assert.equal(fs.existsSync(`${dest}.part`), false);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('descarga que nunca avanza: avisa claro y guarda lo bajado para continuar', async () => {
  const data = crypto.randomBytes(1024 * 1024);
  const { server, url } = await flakyServer(data, { alwaysStall: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-dl-'));
  try {
    const dest = path.join(dir, 'archivo.bin');
    await assert.rejects(download(url, dest, null, null, { stallMs: 250, retries: 1 }), /se quedó trabada/);
    assert.ok(fs.statSync(`${dest}.part`).size > 0);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('componentes: limpia descargas viejas y revisa de verdad lo instalado', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-bin-'));
  try {
    const comps = createComponents(bin);
    fs.writeFileSync(path.join(bin, 'descarga-model-medium-1793795269688.part'), 'viejo');
    fs.writeFileSync(path.join(bin, 'descarga-model-small.part'), 'reciente');
    fs.mkdirSync(path.join(bin, 'whisper-nuevo'));
    comps.cleanLeftovers();
    assert.deepEqual(fs.readdirSync(bin).sort(), ['descarga-model-small.part']);
    assert.equal(comps.isInstalled('model-small'), false);
    assert.equal(comps.isInstalled('whisper-gpu'), false);
    fs.mkdirSync(path.join(bin, 'whisper'));
    fs.writeFileSync(path.join(bin, 'whisper', 'whisper-cli.exe'), '');
    assert.equal(comps.isInstalled('whisper-cpu'), true);
    assert.equal(comps.isInstalled('whisper-gpu'), false, 'sin tipo.txt = versión de procesador');
    fs.writeFileSync(path.join(bin, 'whisper', 'tipo.txt'), 'gpu');
    assert.equal(comps.isInstalled('whisper-gpu'), true);
    // Una segunda descarga de un modelo que ya está instalado se borra (no sirve para nada)
    fs.mkdirSync(path.join(bin, 'models'));
    fs.writeFileSync(path.join(bin, 'models', 'ggml-small-q5_1.bin'), 'modelo');
    comps.cleanLeftovers();
    assert.equal(fs.existsSync(path.join(bin, 'descarga-model-small.part')), false);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Deno: se instala desde el zip, se reemplaza entero y yt-dlp lo recibe', async () => {
  const AdmZip = require('adm-zip');
  const zipOf = (content) => {
    const z = new AdmZip();
    z.addFile('deno.exe', Buffer.from(content)); // en el zip oficial viene suelto
    return z.toBuffer();
  };
  let body = zipOf('deno-version-1');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Length': body.length }); res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-deno-'));
  try {
    const comps = createComponents(bin, { sources: { deno: `http://127.0.0.1:${server.address().port}/deno.zip` } });
    // Sin Deno: yt-dlp se llama igual que antes
    assert.deepEqual(comps.paths.ytdlpArgs(), []);
    assert.equal(comps.status().deno, false);

    await comps.install('deno');
    const exe = path.join(bin, 'deno.exe');
    assert.equal(fs.readFileSync(exe, 'utf8'), 'deno-version-1');
    assert.equal(comps.isInstalled('deno'), true);
    assert.deepEqual(comps.paths.ytdlpArgs(), ['--js-runtimes', `deno:${exe}`]);
    // No quedan restos de la descarga
    assert.deepEqual(fs.readdirSync(bin), ['deno.exe']);

    // Reinstalar reemplaza el archivo completo
    body = zipOf('deno-version-2');
    await comps.install('deno');
    assert.equal(fs.readFileSync(exe, 'utf8'), 'deno-version-2');

    // Un zip sin deno.exe no rompe el que ya estaba
    const z = new AdmZip();
    z.addFile('LEEME.txt', Buffer.from('nada'));
    body = z.toBuffer();
    await assert.rejects(comps.install('deno'), /no tiene lo esperado/);
    assert.equal(fs.readFileSync(exe, 'utf8'), 'deno-version-2');
    assert.deepEqual(fs.readdirSync(bin), ['deno.exe']);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
