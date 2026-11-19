// Videos ya subidos (no en vivo): mucho más rápido que grabarlos como un directo.
// 1) Baja SOLO el audio con varias conexiones (pesa poco) y lo corta en pedazos para pasarlo a texto enseguida.
// 2) Al mismo tiempo baja el video completo, también con varias conexiones.
// 3) Los clips esperan a que el video esté listo y se cortan del archivo completo.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');
const { SEGMENT_SECONDS } = require('./recorder');

// Primero VP9 normal (no HDR): en YouTube se ve mejor que el H.264 a la misma altura, y pasa de 1080p
// (el H.264 llega hasta 1080p). Si no hay, H.264 como antes. Los clips se recodifican igual, así que da lo mismo cuál llegue.
const VP9_SDR = "[vcodec~='^(vp9|vp09\\.00)']";
const VIDEO_FORMAT = (h) => [
  `bv*[height<=${h}]${VP9_SDR}+ba[ext=m4a]`,
  `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]`,
  `bv*[height<=${h}][vcodec^=avc1]+ba`,
  `b[height<=${h}]`,
  `bv*[height<=${h}]+ba`,
  'b',
].join('/');

/**
 * Lee la lista que escribe FFmpeg al cortar el audio en pedazos (-segment_list_type csv):
 * "aud_00000.ts,0.000000,120.021333" → { 'aud_00000.ts': { start: 0, end: 120.021333 } }.
 * Son los tiempos exactos de cada pedazo dentro del video completo.
 */
function parseSegmentList(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(.*),(-?[\d.]+),(-?[\d.]+)\s*$/.exec(line.trim());
    if (!m) continue;
    const start = Number(m[2]);
    const end = Number(m[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out[m[1].replace(/^"|"$/g, '').replace(/""/g, '"')] = { start, end };
  }
  return out;
}

class VodSource extends EventEmitter {
  constructor({ ytdlp, ytdlpArgs = [], ffmpeg, ffprobe, url, dir, maxHeight = 1080, connections = 8 }) {
    super();
    Object.assign(this, { ytdlp, ytdlpArgs, ffmpeg, ffprobe, url, dir, maxHeight, connections });
    this.segments = [];
    this.offset = 0;
    this.startedAt = null;
    this.stopped = false;
    this.procs = new Set();
    this.videoFile = null;
    this.progress = { audio: 0, video: 0 };
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.startedAt = Date.now();
    this.videoReady = this.#downloadVideo();
    this.videoReady.catch(() => {}); // el error se muestra cuando un clip lo necesita
    this.#audioFlow().catch((err) => {
      if (!this.stopped) this.emit('warn', `No se pudo bajar el audio: ${err.message.slice(0, 200)}`);
    }).finally(() => this.emit('end', { reason: this.stopped ? 'stopped' : 'fin del video' }));
  }

  /** Corre yt-dlp mostrando el avance (en %). */
  #ytdlp(args, kind) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ytdlp, [...this.ytdlpArgs, '--newline', '--no-warnings', '--no-playlist', '-N', String(this.connections),
        '--ffmpeg-location', path.dirname(this.ffmpeg), ...args, this.url], { cwd: this.dir, windowsHide: true });
      p.kind = kind;
      this.procs.add(p);
      let err = '';
      let last = -10;
      const onData = (d) => {
        for (const line of String(d).split('\n')) {
          const m = /\[download\]\s+([\d.]+)%/.exec(line);
          if (m) {
            const pct = Number(m[1]);
            this.progress[kind] = pct / 100;
            this.emit('progress', { ...this.progress });
            if (pct - last >= 25 || pct >= 100) { last = pct; this.emit('info', `${kind === 'audio' ? 'Audio' : 'Video'} descargado: ${Math.floor(pct)}%`); }
          } else if (/ERROR/.test(line)) err += `${line}\n`;
        }
      };
      p.stdout.on('data', onData);
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', reject);
      p.on('close', (code) => {
        this.procs.delete(p);
        // El video solo se cancela del todo (abort): con "Detener" sigue bajando para cortar los clips que falten.
        if (kind === 'video' ? this.aborted : this.stopped) return reject(new Error('detenido'));
        if (code === 0) resolve();
        else reject(new Error(err.trim().split('\n').pop() || `yt-dlp terminó con código ${code}`));
      });
    });
  }

  async #audioFlow() {
    await this.#ytdlp(['-f', 'ba[ext=m4a]/ba', '-o', 'audio.%(ext)s'], 'audio');
    const audio = fs.readdirSync(this.dir).find((f) => /^audio\.\w+$/.test(f));
    if (!audio) throw new Error('No llegó el audio');
    // Cortar en pedazos es casi instantáneo: no se convierte nada.
    // FFmpeg anota dónde empieza cada pedazo (piezas.csv). Antes se sumaba lo que "medía" cada pedazo,
    // pero esa medida sale un poco corta y en videos largos los subtítulos se iban adelantando segundos.
    await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', audio, '-map', '0:a:0', '-c', 'copy',
      '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1', '-segment_format', 'mpegts',
      '-segment_list', 'piezas.csv', '-segment_list_type', 'csv', 'aud_%05d.ts'],
    { cwd: this.dir });
    let times = {};
    try { times = parseSegmentList(fs.readFileSync(path.join(this.dir, 'piezas.csv'), 'utf8')); } catch {}
    const pieces = fs.readdirSync(this.dir).filter((f) => /^aud_\d+\.ts$/.test(f)).sort();
    for (const name of pieces) {
      if (this.stopped) return;
      const file = path.join(this.dir, name);
      const exact = times[name];
      const start = exact ? exact.start : this.offset;
      const duration = exact ? exact.end - exact.start : await this.#duration(file);
      if (duration < 0.5) continue;
      const seg = { index: this.segments.length, file, start, duration };
      this.offset = start + duration;
      this.segments.push(seg);
      this.emit('segment', seg);
    }
  }

  async #downloadVideo() {
    await this.#ytdlp(['-f', VIDEO_FORMAT(this.maxHeight), '--merge-output-format', 'mp4', '-o', 'video.%(ext)s'], 'video');
    const name = fs.readdirSync(this.dir).find((f) => /^video\.(mp4|mkv|webm)$/.test(f));
    if (!name) throw new Error('No llegó el video');
    this.videoFile = path.join(this.dir, name);
    this.videoDuration = await this.#duration(this.videoFile);
    this.emit('info', 'Video completo descargado');
    return this.videoFile;
  }

  async #duration(file) {
    try {
      const { out } = await run(this.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
      return parseFloat(out) || 0;
    } catch {
      return 0;
    }
  }

  segmentsFor(start, end) {
    return this.segments.filter((s) => s.start + s.duration > start && s.start < end);
  }

  /** Para crear clips: espera el video completo y lo entrega como un solo "pedazo". */
  async videoSegmentsFor() {
    await this.videoReady;
    return [{ file: this.videoFile, start: 0, duration: this.videoDuration || this.offset }];
  }

  cleanup(before) {
    for (const s of this.segments) {
      if (s.start + s.duration < before && !s.deleted) { fs.rmSync(s.file, { force: true }); s.deleted = true; }
    }
  }

  /** "Detener": deja de bajar el audio (no se analiza más), pero el video sigue bajando para cortar los clips que falten. */
  stop() {
    this.stopped = true;
    for (const p of this.procs) if (p.kind !== 'video') { try { p.kill(); } catch {} }
  }

  /** Cancela todo, también el video (cuando termina la sesión o se cierra la app). */
  abort() {
    this.stopped = true;
    this.aborted = true;
    for (const p of this.procs) { try { p.kill(); } catch {} }
  }
}

module.exports = { VodSource, VIDEO_FORMAT, parseSegmentList };
