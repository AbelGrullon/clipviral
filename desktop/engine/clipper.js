// Corta el clip, lo pone vertical, le quema subtítulos, título y logo, y saca una miniatura.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');
const { buildAss } = require('./subtitles');
const efectos = require('./efectos');

const LOGO_POS = {
  'arriba-izq': '40:40',
  'arriba-der': 'W-w-40:40',
  'abajo-izq': '40:H-h-40',
  'abajo-der': 'W-w-40:H-h-40',
};

/**
 * Arma el filtro de FFmpeg.
 * style: 'blur' | 'recorte' | 'horizontal' | 'camara' · opts: { subs, logo, fps, quality, zoom, split }
 * 'camara' (cámara + juego): split = { camCrop, camH, gameCrop, gameH } (de camara.planSplit), en píxeles del video.
 * Efectos: mirror (espejo), bgInput (n.º de entrada de la imagen de fondo), cut (partes que se quedan), speed.
 */
function videoFilter(style, withSubs, opts = {}) {
  const fps = Number(opts.fps) === 60 ? 60 : 30;
  const W = style === 'horizontal' ? 1920 : 1080;
  const H = style === 'horizontal' ? 1080 : 1920;
  const zoom = Math.max(1, Math.min(1.5, Number(opts.zoom) || 1));
  const parts = [];
  // Primero se bajan los cuadros por segundo: así un video de 60 fps no se procesa el doble.
  // El espejo va antes de todo: así los subtítulos, el título y el logo NO salen al revés.
  const src = `[0:v]fps=${fps},${opts.mirror ? 'hflip,' : ''}`;
  // Fondo propio: una imagen que cubre todo el cuadro, en lugar del fondo borroso o las franjas negras.
  const bg = Number.isInteger(opts.bgInput) && style !== 'recorte' && style !== 'camara'
    ? `[${opts.bgInput}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps}[bg]` : '';
  if (style === 'camara' && opts.split) {
    // Cámara arriba y juego abajo: se recorta cada parte del video original y se apilan.
    // El espejo va después del recorte (las medidas son del video sin voltear).
    const { camCrop: c, camH, gameCrop: g, gameH } = opts.split;
    const flip = opts.mirror ? 'hflip,' : '';
    parts.push(`[0:v]fps=${fps},split=2[cm][gm]`,
      `[cm]crop=${c.w}:${c.h}:${c.x}:${c.y},${flip}scale=${W}:${camH}:force_original_aspect_ratio=increase,crop=${W}:${camH},setsar=1[top]`,
      `[gm]crop=${g.w}:${g.h}:${g.x}:${g.y},${flip}scale=${W}:${gameH},setsar=1[bot]`,
      '[top][bot]vstack=inputs=2,setsar=1[b0]');
  } else if (bg) {
    const fit = style === 'horizontal' ? `scale=${W}:${H}:force_original_aspect_ratio=decrease` : `scale=${Math.round(W * zoom / 2) * 2}:-2`;
    parts.push(bg, `${src}${fit}[fg]`, `[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,crop=${W}:${H},setsar=1[b0]`);
  } else if (style === 'horizontal') {
    parts.push(`${src}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[b0]`);
  } else if (style === 'recorte') {
    parts.push(`${src}scale=${Math.round(W * zoom)}:${Math.round(H * zoom)}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[b0]`);
  } else {
    // Fondo desenfocado: el video completo en el centro y el mismo video borroso detrás.
    // El borroso se hace en chico (1/4) y se agranda: se ve igual y cuesta mucho menos.
    const fgW = Math.round(W * zoom / 2) * 2;
    parts.push(`${src}split=2[a][b];[a]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${H / 4},boxblur=7:2,eq=brightness=-0.08,scale=${W}:${H}[bg];[b]scale=${fgW}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,crop=${W}:${H},setsar=1[b0]`);
  }
  let last = 'b0';
  if (opts.logo) {
    const width = Math.round(W * Math.max(0.05, Math.min(0.5, (Number(opts.logo.size) || 18) / 100)));
    const alpha = Math.max(0.1, Math.min(1, (Number(opts.logo.opacity) || 85) / 100));
    parts.push(`[1:v]scale=${width}:-1,format=rgba,colorchannelmixer=aa=${alpha.toFixed(2)}[lg]`);
    parts.push(`[${last}][lg]overlay=${LOGO_POS[opts.logo.position] || LOGO_POS['arriba-der']}[b1]`);
    last = 'b1';
  }
  const tail = [];
  if (withSubs) tail.push('ass=subs.ass');
  // Los cortes y la velocidad van DESPUÉS de los subtítulos: el texto queda pegado a su imagen.
  const speed = Number(opts.speed) || 1;
  if (opts.cut) tail.push(`select='${efectos.selectExpr(opts.cut)}'`, `setpts=N/(${fps}*${speed})/TB`);
  else if (speed !== 1) tail.push(`setpts=PTS/${speed}`);
  tail.push(`fps=${fps}`);
  if (String(opts.quality) === '720') tail.push(style === 'horizontal' ? 'scale=1280:720' : 'scale=720:1280');
  parts.push(`[${last}]${tail.join(',')}[v]`);
  return parts.join(';');
}

/**
 * clip: { start, end, words:[{s,e,w}] en segundos absolutos, title }
 * segments: pedazos que cubren el clip [{ file, start, duration }]
 * look: opciones de estilo (subtítulos, título arriba, marca de agua, logo, calidad, fps, zoom)
 */
/**
 * Cámara + juego: los subtítulos van más chicos y abajo, dentro del recuadro de la cámara (así no tapan el juego).
 * Se ajusta el estilo "Viral" que arma subtitles.js: tamaño, borde, alineación (2 = abajo al centro) y margen de abajo.
 */
const CAM_SUB_SCALE = 0.68;
function subsInCam(ass, camH, H = 1920) {
  return ass.replace(/^Style: Viral,.*$/m, (line) => {
    const f = line.split(',');
    const size = Math.round(Number(f[2]) * CAM_SUB_SCALE);
    f[2] = String(size);
    f[16] = String(Math.max(2, Math.round(size / 12)));
    f[18] = '2';
    f[21] = String(H - camH + Math.round(camH * 0.06));
    return f.join(',');
  });
}

async function makeClip({ ffmpeg, segments, clip, outFile, style = 'blur', subtitles = true, look = {}, gpuEncode = false, tempDir, split = null }) {
  if (!segments.length) throw new Error('No hay video grabado para ese momento');
  // Cámara + juego sin cámara encontrada: va con fondo, como siempre.
  if (style === 'camara' && !split) style = 'blur';
  fs.mkdirSync(tempDir, { recursive: true });
  const listFile = path.join(tempDir, 'lista.txt');
  fs.writeFileSync(listFile, segments.map((s) => `file '${s.file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));

  const duration = clip.end - clip.start;
  const offset = Math.max(0, clip.start - segments[0].start);
  const rel = (subtitles ? clip.words : [])
    .filter((w) => w.e > clip.start && w.s < clip.end)
    .map((w) => ({ s: Math.max(0, w.s - clip.start), e: Math.min(duration, w.e - clip.start), w: w.w }));
  const banner = look.titleBanner?.enabled && clip.title ? { text: clip.title, seconds: look.titleBanner.seconds, color: look.titleBanner.color } : null;
  const watermark = look.watermark?.text ? look.watermark : null;
  const withAss = rel.length > 0 || !!banner || !!watermark;
  if (withAss) {
    const ass = buildAss(rel, {
      ...look.subs,
      layout: style === 'horizontal' ? 'horizontal' : 'vertical',
      titleBanner: banner,
      watermark,
    }, duration);
    fs.writeFileSync(path.join(tempDir, 'subs.ass'), style === 'camara' ? subsInCam(ass, split.camH) : ass);
  }
  const logo = look.logo?.file && fs.existsSync(look.logo.file) ? look.logo : null;
  // -ss antes de -i: salta directo al momento (mucho más rápido que decodificar desde el inicio).
  // Con un solo archivo (video ya subido) se lee directo: "concat" lo recorre desde el inicio y es más lento.
  const input = segments.length === 1
    ? ['-ss', offset.toFixed(2), '-i', segments[0].file]
    : ['-ss', offset.toFixed(2), '-f', 'concat', '-safe', '0', '-i', listFile];

  // Efectos: si hace falta tocar el audio, primero se escucha el pedazo (dice si hay sonido y dónde hay silencios).
  const fx = efectos.normalize(look.efectos);
  let cut = null;
  let audio = '';
  if (fx.silencios || fx.voz !== 'normal' || fx.velocidad !== 1) {
    const heard = await efectos.analyzeAudio(ffmpeg, input, duration);
    if (heard.hasAudio) {
      if (fx.silencios) {
        const ranges = efectos.keepRanges(heard.silences, duration);
        if (!efectos.isWhole(ranges, duration)) cut = ranges;
      }
      audio = efectos.audioFilter(fx, cut);
    }
  }
  const finalDuration = (cut ? efectos.keptSeconds(cut) : duration) / fx.velocidad;
  const bgInput = fx.fondo && style !== 'camara' ? (logo ? 2 : 1) : null;
  const video = videoFilter(style, withAss, { logo, fps: look.fps, quality: look.quality, zoom: look.zoom, mirror: fx.espejo, bgInput, cut, speed: fx.velocidad, split });
  const filter = audio ? `${video};${audio}` : video;

  const encode = async (gpu) => {
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...input.slice(0, -2), '-t', duration.toFixed(2), ...input.slice(-2),
      ...(logo ? ['-i', logo.file] : []),
      ...(bgInput !== null ? ['-loop', '1', '-i', fx.fondo] : []),
      '-t', finalDuration.toFixed(2),
      '-filter_complex', filter,
      '-map', '[v]', '-map', audio ? '[a]' : '0:a:0?',
      ...(gpu ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21']),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outFile,
    ];
    await run(ffmpeg, args, { cwd: tempDir, timeoutMs: 15 * 60 * 1000 });
  };

  try {
    await encode(gpuEncode);
  } catch (err) {
    if (!gpuEncode) throw err;
    await encode(false); // Si la tarjeta de video falla, lo hacemos con el procesador.
  }

  const thumb = outFile.replace(/\.mp4$/i, '.jpg');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (finalDuration * 0.35).toFixed(2), '-i', outFile, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', thumb])
    .catch(() => null);
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { file: outFile, thumb: fs.existsSync(thumb) ? thumb : null, duration: finalDuration };
}

module.exports = { makeClip, videoFilter, subsInCam, CAM_SUB_SCALE };
