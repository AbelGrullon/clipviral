// Análisis de rendimiento: mide la PC al abrir la app y sugiere la mejor configuración.
const fs = require('node:fs');
const os = require('node:os');
const { run } = require('./util');
const { freeSpace } = require('./requisitos');
const { pickModel, prettyName, sameModel } = require('./localai');

const GB = 1024 ** 3;
const TEST_FRAMES = 150;

/** Mide la PC. Tarda unos segundos (prueba corta de video con FFmpeg si está instalado). */
async function measure({ ffmpeg, outputDir }) {
  const cpus = os.cpus();
  const free = freeSpace(outputDir);
  const hw = {
    cpu: { model: (cpus[0]?.model || 'Procesador').replace(/\(R\)|\(TM\)/gi, '').replace(/^\d+(st|nd|rd|th) Gen\s+/i, '').replace(/\s+/g, ' ').trim(), threads: cpus.length },
    ramGb: os.totalmem() / GB,
    freeRamGb: os.freemem() / GB,
    gpu: null,
    nvenc: null,
    encodeFps: null,
    diskFreeGb: free == null ? null : free / GB,
  };
  const tasks = [
    run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeoutMs: 8000 })
      .then(({ out }) => {
        const [name, mem, driver] = out.trim().split('\n')[0].split(',').map((x) => x.trim());
        if (name) hw.gpu = { name: name.replace(/^NVIDIA\s+/i, ''), vramGb: (Number(mem) || 0) / 1024, driver };
      })
      .catch(() => {}),
  ];
  if (ffmpeg && fs.existsSync(ffmpeg)) {
    // ¿La NVIDIA puede crear video?
    tasks.push(run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '5', '-c:v', 'h264_nvenc', '-f', 'null', '-'], { timeoutMs: 20000 })
      .then(() => { hw.nvenc = true; }, () => { hw.nvenc = false; }));
    // ¿Qué tan rápido crea video vertical el procesador?
    tasks.push((async () => {
      const t0 = performance.now();
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30', '-frames:v', String(TEST_FRAMES), '-c:v', 'libx264', '-preset', 'veryfast', '-f', 'null', '-'], { timeoutMs: 90000 });
      hw.encodeFps = Math.round(TEST_FRAMES / ((performance.now() - t0) / 1000));
    })().catch(() => {}));
  }
  await Promise.all(tasks);
  return hw;
}

/** Nivel de cada parte y una nota general de 0 a 100. */
function levels(hw) {
  const cpu = hw.encodeFps != null
    ? (hw.encodeFps >= 150 ? 'alto' : hw.encodeFps >= 60 ? 'medio' : 'bajo')
    : (hw.cpu.threads >= 12 ? 'alto' : hw.cpu.threads >= 6 ? 'medio' : 'bajo');
  const vram = hw.gpu?.vramGb || 0;
  const gpu = vram >= 6 ? 'alto' : vram >= 3.5 ? 'medio' : hw.gpu ? 'bajo' : 'ninguna';
  const ram = hw.ramGb >= 14.5 ? 'alto' : hw.ramGb >= 7.5 ? 'medio' : 'bajo';
  const pts = { alto: 3, medio: 2, bajo: 1, ninguna: 0 };
  const score = Math.round((pts[cpu] / 3) * 45 + (pts[gpu] / 3) * 30 + (pts[ram] / 3) * 25);
  const overall = score >= 75 ? 'potente' : score >= 45 ? 'buena' : 'basica';
  return { cpu, gpu, ram, score, overall };
}

const LABELS = {
  whisperModel: 'Modelo de voz',
  gpuEncode: 'Crear los clips con la NVIDIA',
  quality: 'Calidad del video',
  fps: 'Cuadros por segundo',
  ollamaModel: 'IA local para títulos',
};

/**
 * Sugiere la configuración para esta PC.
 * Devuelve los cambios frente a lo que el usuario tiene, el "patch" para aplicarlos y mejoras opcionales con botón.
 */
function suggest(hw, { comps, ollama = { running: false, details: [] }, ollamaInstalled = false, settings }) {
  const lv = levels(hw);
  const vram = hw.gpu?.vramGb || 0;
  const look = settings.look || {};
  const whisperOnGpu = comps.whisperFlavor === 'gpu' && settings.whisperGpu !== false && vram >= 3.5;
  const suggested = {};
  const why = {};
  const extras = [];

  // Modelo de voz: tiene que transcribir más rápido de lo que habla el directo.
  if (whisperOnGpu) {
    suggested.whisperModel = 'medium';
    why.whisperModel = 'Tu NVIDIA pasa la voz a texto rápido: puedes usar el más preciso.';
  } else if (lv.cpu !== 'bajo' && hw.ramGb >= 7.5) {
    suggested.whisperModel = 'small';
    why.whisperModel = 'Tu procesador sigue el directo en vivo con el modelo equilibrado.';
  } else {
    suggested.whisperModel = 'base';
    why.whisperModel = 'Así los subtítulos no se atrasan en tu PC.';
  }
  const model = comps.models?.[suggested.whisperModel];
  if (model && !model.installed) why.whisperModel += ` Se descargan ${model.sizeMb} MB.`;

  // Crear video con la NVIDIA (solo si la prueba funcionó)
  if (hw.nvenc !== null) {
    suggested.gpuEncode = hw.nvenc;
    why.gpuEncode = hw.nvenc ? 'Tu NVIDIA crea los clips mucho más rápido.'
      : hw.gpu ? 'Tu NVIDIA no pudo crear video. Actualiza su driver; mientras tanto se usa el procesador.' : 'No tienes NVIDIA: se usa el procesador.';
  }

  // Calidad y fps: solo bajamos si la PC no da para más.
  const weakVideo = hw.nvenc !== true && lv.cpu === 'bajo';
  suggested.quality = weakVideo ? '720' : '1080';
  why.quality = weakVideo ? 'Tu PC crea video lento: en 720p los clips salen el doble de rápido.' : 'Tu PC puede crear los clips en alta calidad.';
  suggested.fps = Number(look.fps) === 60 && hw.nvenc !== true && lv.cpu !== 'alto' ? 30 : Number(look.fps) || 30;
  why.fps = 'A 60 cuadros tu PC tardaría el doble en cada clip.';

  // IA local (plan Local)
  if (settings.mode !== 'ia') {
    const best = pickModel(ollama.details || [], { vramGb: vram, ramGb: hw.ramGb, gpuName: hw.gpu?.name });
    if (!ollama.running) {
      suggested.ollamaModel = settings.ollamaModel;
      if (!ollamaInstalled && best) {
        extras.push({ id: 'ollama', label: 'Instalar Ollama (IA local gratis)', why: 'Pone títulos, descripciones y hashtags a cada clip sin costo.', accion: 'descargar-ollama' });
      }
    } else if (best?.installed) {
      suggested.ollamaModel = best.id;
      why.ollamaModel = `Ya lo tienes instalado y ${best.fit === 'rapido' ? 'corre rápido en tu tarjeta de video' : 'tu PC lo puede mover'}.`;
    } else if (best) {
      suggested.ollamaModel = settings.ollamaModel;
      extras.push({ id: 'ollama-model', label: `Descargar ${prettyName(best.id)} (${best.sizeGb} GB)`, why: 'El mejor modelo de IA local para tu PC: títulos y hashtags gratis.', accion: `ollama:${best.id}` });
    } else {
      suggested.ollamaModel = '';
      why.ollamaModel = 'Tu PC no tiene memoria suficiente para la IA local. Los momentos se eligen igual con el chat y el volumen.';
    }
  }

  // Mejoras que se instalan aparte
  if (hw.gpu && vram >= 3.5 && comps.whisperFlavor !== 'gpu') {
    extras.unshift({ id: 'whisper-gpu', label: 'Instalar Whisper para NVIDIA (650 MB)', why: 'Subtítulos mucho más rápidos y podrás usar el modelo de voz más preciso.', accion: 'instalar:whisper-gpu' });
  }
  if (hw.diskFreeGb != null && hw.diskFreeGb < 10) {
    extras.push({ id: 'disco', label: 'Libera espacio o cambia la carpeta de clips', why: `Solo quedan ${hw.diskFreeGb.toFixed(1)} GB libres; un directo largo usa varios GB.`, accion: 'elegir-carpeta' });
  }

  // Cambios frente a lo que tiene ahora
  const current = {
    whisperModel: settings.whisperModel, gpuEncode: settings.gpuEncode !== false,
    quality: String(look.quality || '1080'), fps: Number(look.fps) || 30, ollamaModel: settings.ollamaModel || '',
  };
  const show = {
    whisperModel: (v) => comps.models?.[v]?.label || v,
    gpuEncode: (v) => (v ? 'Sí' : 'No'),
    quality: (v) => `${v}p`,
    fps: (v) => `${v} fps`,
    ollamaModel: (v) => (v ? prettyName(v) : 'No usar'),
  };
  const changes = [];
  const patch = {};
  for (const key of Object.keys(LABELS)) {
    if (!(key in suggested)) continue;
    const to = suggested[key];
    const same = key === 'ollamaModel' ? (to || '') === current[key] || (to && current[key] && sameModel(to, current[key])) : String(to) === String(current[key]);
    if (same) continue;
    changes.push({ key, label: LABELS[key], from: show[key](current[key]), to: show[key](to), why: why[key] || '' });
    if (key === 'quality' || key === 'fps') patch.look = { ...(patch.look || {}), [key]: to };
    else patch[key] = to;
  }
  const key = changes.length ? JSON.stringify(changes.map((c) => [c.key, c.to])) : '';
  return { hw, levels: lv, suggested, changes, patch, extras, key };
}

module.exports = { measure, levels, suggest };
