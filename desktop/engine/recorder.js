// Graba el directo en pedazos de 2 minutos: yt-dlp baja el video y FFmpeg lo corta.
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');

const SEGMENT_SECONDS = 120;

// Mensajes de FFmpeg que no son un problema: YouTube cierra cada tanto la conexión que FFmpeg tenía abierta y FFmpeg
// abre otra al instante, sin perder video (comprobado en una grabación real: los pedazos duran lo mismo que el reloj).
// Antes salían en rojo en "Lo que está pasando" y asustaban.
const RUIDO_RED = /Error in the pull function|IO error: End of file|Error reading HTTP response: End of file|keepalive request failed|Will reconnect at/i;

/** Lo que FFmpeg escribió, sin el ruido de red de arriba. '' si no queda nada que avisar. */
function ffmpegWarnings(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !RUIDO_RED.test(l)).join('\n');
}

class Recorder extends EventEmitter {
  constructor({ ytdlp, ytdlpArgs = [], ffmpeg, ffprobe, url, dir, maxHeight = 1080, isLive = true }) {
    super();
    Object.assign(this, { ytdlp, ytdlpArgs, ffmpeg, ffprobe, url, dir, maxHeight, isLive });
    this.segments = [];      // { index, file, start, duration }
    this.nextIndex = 0;
    this.offset = 0;
    this.stopped = false;
    this.startedAt = null;   // hora real en que llegó el primer pedazo
    this.restarts = 0;
  }

  start() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.#launch();
    this.poll = setInterval(() => this.#scan(false).catch((e) => this.emit('warn', e.message)), 2000);
  }

  /**
   * Pide a yt-dlp las direcciones del video y del audio.
   * Muchos videos de YouTube ya no traen video y audio juntos: vienen separados y FFmpeg los une.
   * Se prefiere H.264 + AAC porque se pueden copiar tal cual (sin recodificar) a los pedazos .ts.
   */
  async #urls() {
    const h = this.maxHeight;
    const format = [
      `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]`,
      `bv*[height<=${h}][vcodec^=avc1]+ba`,
      `b[height<=${h}][vcodec^=avc1]`,
      `bv*[height<=${h}]+ba`,
      'b',
    ].join('/');
    const { out } = await run(this.ytdlp, [...this.ytdlpArgs, '-g', '-f', format, '--no-warnings', this.url], { timeoutMs: 90000 });
    const urls = out.split('\n').map((l) => l.trim()).filter((l) => /^https?:\/\//.test(l));
    if (!urls.length) throw new Error('YouTube no dio el enlace del video');
    return urls.slice(0, 2);
  }

  async #launch() {
    const runId = Date.now();
    this.pattern = `seg_${runId}_%05d.ts`;
    this.prefix = `seg_${runId}_`;
    let urls;
    try {
      urls = await this.#urls();
    } catch (err) {
      return this.#onClose(String(err.err || err.message || err).trim().split('\n').pop());
    }
    if (this.stopped) return; // ya avisó stop()
    const input = (u) => ['-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', u];
    const maps = urls.length === 2 ? ['-map', '0:v:0', '-map', '1:a:0'] : ['-map', '0:v:0?', '-map', '0:a:0?'];
    this.ff = spawn(this.ffmpeg, [
      '-hide_banner', '-loglevel', 'error', ...urls.flatMap(input),
      ...maps, '-c', 'copy',
      '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1',
      '-segment_format', 'mpegts', this.pattern,
    ], { cwd: this.dir, windowsHide: true });
    this.ff.stdin.on('error', () => {});
    let ffErr = '';
    let partial = ''; // un mensaje puede llegar partido en dos: se espera a tener la línea entera
    const warn = (text) => {
      const msg = ffmpegWarnings(text);
      if (msg) this.emit('warn', `FFmpeg: ${msg.slice(0, 300)}`);
    };
    this.ff.stderr.on('data', (d) => {
      ffErr = (ffErr + d).slice(-2000);
      const lines = (partial + d).split(/\r?\n/);
      partial = lines.pop();
      warn(lines.join('\n'));
    });
    this.ff.on('close', () => {
      warn(partial);
      this.#onClose(ffErr.trim() ? '' : 'fin del video');
    });
  }

  async #onClose(reason) {
    await this.#scan(true).catch(() => {});
    if (this.stopped) return this.#end('stopped');
    // El directo se cortó o terminó. Probamos reconectar unas veces.
    if (this.isLive && this.restarts < 5) {
      this.restarts += 1;
      this.emit('warn', `Se cortó la conexión. Reintentando (${this.restarts}/5)…`);
      setTimeout(() => !this.stopped && this.#launch(), 4000);
    } else {
      this.#end(reason || 'fin del video');
    }
  }

  /**
   * Se acabó la grabación: deja de revisar la carpeta cada 2 segundos.
   * Si no, al terminar la sesión (que borra la carpeta de trabajo) salía "ENOENT … scandir" una y otra vez.
   */
  #end(reason) {
    clearInterval(this.poll);
    this.emit('end', { reason });
  }

  /** Revisa la carpeta: un pedazo está completo cuando ya existe el siguiente. */
  async #scan(final) {
    if (this.scanning) return;
    this.scanning = true;
    try {
      let names;
      try {
        names = fs.readdirSync(this.dir);
      } catch (err) {
        if (err.code === 'ENOENT') return; // la carpeta ya no está (la sesión terminó y la borró)
        throw err;
      }
      const files = names.filter((f) => f.startsWith(this.prefix) && f.endsWith('.ts')).sort();
      const ready = final ? files : files.slice(0, -1);
      for (const name of ready) {
        const file = path.join(this.dir, name);
        if (this.segments.some((s) => s.file === file)) continue;
        if (!this.startedAt) this.startedAt = Date.now() - SEGMENT_SECONDS * 1000;
        const duration = await this.#duration(file);
        if (duration < 0.5) { fs.rmSync(file, { force: true }); continue; }
        const seg = { index: this.nextIndex++, file, start: this.offset, duration };
        this.offset += duration;
        this.segments.push(seg);
        this.emit('segment', seg);
      }
      if (!this.startedAt && files.length) this.startedAt = Date.now();
    } finally {
      this.scanning = false;
    }
  }

  async #duration(file) {
    try {
      const { out } = await run(this.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
      return parseFloat(out) || 0;
    } catch {
      return 0;
    }
  }

  /** Pedazos que cubren un rango de tiempo. */
  segmentsFor(start, end) {
    return this.segments.filter((s) => s.start + s.duration > start && s.start < end);
  }

  /** Borra pedazos que ya no se necesitan (para no llenar el disco). */
  cleanup(before) {
    for (const s of this.segments) {
      if (s.start + s.duration < before && !s.deleted) {
        fs.rmSync(s.file, { force: true });
        s.deleted = true;
      }
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.poll);
    // "q" le pide a FFmpeg que cierre bien el último pedazo; si no responde, se cierra a la fuerza.
    try { this.ff?.stdin.write('q'); } catch {}
    setTimeout(() => { try { this.ff?.kill(); } catch {} }, 8000);
    if (!this.ff) this.#end('stopped');
  }
}

module.exports = { Recorder, SEGMENT_SECONDS, ffmpegWarnings };
