// Revisión del sistema: dice qué falta para que la app funcione bien y qué botón lo arregla.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prettyName } = require('./localai');

/** Busca dónde está instalado Ollama en Windows. */
function findOllama() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(local, 'Programs', 'Ollama', 'ollama app.exe'),
    path.join(local, 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama app.exe',
    'C:\\Program Files\\Ollama\\ollama.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** Espacio libre (en bytes) en el disco de una carpeta. */
function freeSpace(dir) {
  try {
    let d = dir;
    while (d && !fs.existsSync(d)) d = path.dirname(d);
    const st = fs.statfsSync(d || os.homedir());
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

const GB = 1024 ** 3;

/**
 * Devuelve la lista de requisitos con su estado.
 * estado: 'ok' | 'falta' (impide usar la app) | 'aviso' (funciona, pero mejor arreglarlo)
 * accion: lo que hace el botón en la app.
 */
function checkSystem({ comps, settings, gpu, ollama, ollamaPath, diskFree, totalMem, serverOk, mode }) {
  const items = [];
  const add = (id, nombre, estado, detalle, accion = null, grupo = 'Herramientas') => items.push({ id, nombre, estado, detalle, accion, grupo });

  add('server', 'Conexión con ClipViral', serverOk ? 'ok' : 'falta',
    serverOk ? 'Conectado' : 'No hay conexión con el servidor. Revisa tu internet.', serverOk ? null : 'reintentar', 'Sistema');

  add('ytdlp', 'yt-dlp (conexión con YouTube)', comps.ytdlp ? 'ok' : 'falta',
    comps.ytdlp ? 'Instalado' : 'Necesario para leer los directos', comps.ytdlp ? null : 'instalar:ytdlp');
  add('deno', 'Deno (ayuda a leer YouTube)', comps.deno ? 'ok' : 'falta',
    comps.deno ? 'Instalado' : `YouTube ahora lo pide para leer los videos. Se descargan ${comps.denoMb || 41} MB.`, comps.deno ? null : 'instalar:deno');
  add('ffmpeg', 'FFmpeg (cortes y subtítulos)', comps.ffmpeg ? 'ok' : 'falta',
    comps.ffmpeg ? 'Instalado' : 'Necesario para crear los clips', comps.ffmpeg ? null : 'instalar:ffmpeg');
  add('whisper', 'Whisper (voz a texto)', comps.whisper ? 'ok' : 'falta',
    comps.whisper ? `Instalado (${comps.whisperFlavor === 'gpu' ? 'NVIDIA' : 'procesador'})` : 'Necesario para los subtítulos', comps.whisper ? null : 'instalar:whisper-cpu');
  const model = settings.whisperModel || 'small';
  const modelOk = comps.models?.[model]?.installed;
  add('model', `Modelo de voz: ${comps.models?.[model]?.label || model}`, modelOk ? 'ok' : 'falta',
    modelOk ? 'Instalado' : `Se descargan ${comps.models?.[model]?.sizeMb || '?'} MB`, modelOk ? null : `instalar:model-${model}`);

  const usesOllama = mode !== 'ia' && !!settings.ollamaModel;
  if (usesOllama) {
    if (!ollamaPath && !ollama.running) {
      add('ollama', 'Ollama (IA local)', 'falta', 'Elegiste usar IA local pero Ollama no está instalado', 'descargar-ollama', 'IA local');
    } else if (!ollama.running) {
      add('ollama', 'Ollama (IA local)', 'falta', 'Está instalado pero cerrado', 'abrir-ollama', 'IA local');
    } else {
      add('ollama', 'Ollama (IA local)', 'ok', 'Abierto', null, 'IA local');
      const has = ollama.models.some((m) => m === settings.ollamaModel || m.startsWith(settings.ollamaModel));
      add('ollama-model', `Modelo de IA: ${prettyName(settings.ollamaModel)}`, has ? 'ok' : 'falta', has ? 'Descargado' : 'Hay que descargarlo en Ollama', has ? null : 'descargar-modelo', 'IA local');
    }
  } else if (ollamaPath && !ollama.running && mode !== 'ia') {
    add('ollama', 'Ollama (IA local)', 'aviso', 'Instalado pero cerrado. Ábrelo para que la IA local ponga mejores títulos.', 'abrir-ollama', 'IA local');
  }

  if (diskFree !== null && diskFree !== undefined) {
    const gb = diskFree / GB;
    add('disk', 'Espacio en disco', gb < 2 ? 'falta' : gb < 10 ? 'aviso' : 'ok',
      `${gb.toFixed(1)} GB libres${gb < 10 ? ' · se recomiendan 10 GB para directos largos' : ''}`, gb < 10 ? 'elegir-carpeta' : null, 'Sistema');
  }
  const ramGb = totalMem / GB;
  add('ram', 'Memoria RAM', ramGb < 6 ? 'aviso' : 'ok',
    `${ramGb.toFixed(0)} GB${ramGb < 6 ? ' · usa el modelo de voz "Rápido" para que no se trabe' : ''}`, null, 'Sistema');
  if (gpu?.hasNvidia) {
    add('gpu', 'Tarjeta de video', 'ok', `${gpu.name} · los clips se crean con la NVIDIA`, null, 'Sistema');
  } else {
    add('gpu', 'Tarjeta de video', 'aviso', 'Sin NVIDIA: funciona, pero los clips tardan más', null, 'Sistema');
  }

  const blocking = items.filter((i) => i.estado === 'falta');
  return { items, ok: blocking.length === 0, blocking: blocking.length, warnings: items.filter((i) => i.estado === 'aviso').length };
}

module.exports = { checkSystem, findOllama, freeSpace };
