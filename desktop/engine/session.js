// Une todo: graba el directo, lo transcribe, busca momentos virales y crea los clips.
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { run, slug, fmtClock, youtubeId } = require('./util');
const os = require('node:os');
const { Recorder } = require('./recorder');
const { VodSource } = require('./vod');
const { ChatWatcher } = require('./chat');
const { Timeline } = require('./detector');
const { transcribeSegment } = require('./transcribe');
const { makeClip } = require('./clipper');
const localAi = require('./localai');
const vista = require('./vista');
const camara = require('./camara');
const { merge: mergeSounds, describe: describeSound } = require('./sonido');
const { judge } = require('./juez');
const { SENSITIVITY } = require('./detector');

// El video ya no se puede ver (privado, borrado o bloqueado): actualizar yt-dlp no sirve.
const GONE = /private video|video unavailable|has been removed|not available in your country|members-only/i;

/** Por qué yt-dlp no pudo abrir el enlace, en palabras simples (con el motivo real al final). */
function ytdlpProblem(err) {
  const text = `${err?.err || ''}\n${err?.message || ''}`;
  const line = (text.match(/ERROR:[^\n]*/g) || []).pop()?.replace(/^ERROR:\s*(\[[^\]]*\]\s*)?([\w-]{11}:\s*)?/, '').trim().slice(0, 220) || '';
  if (GONE.test(text)) return 'Ese video no está disponible (puede ser privado o ya no existe).';
  if (/could not (copy|find).*cookie|failed to decrypt|DPAPI|cookies database|could not open.*cookie/i.test(text)) {
    return 'No pude leer las cookies del navegador (Chrome y Edge las bloquean mientras están abiertos). Cierra ese navegador del todo o, mejor, usa un archivo cookies.txt en Ajustes → Cookies de YouTube.';
  }
  if (/sign in to confirm|not a bot/i.test(text)) return `YouTube pidió confirmar que no eres un robot. Para arreglarlo ve a Ajustes → Cookies de YouTube y conecta tu sesión de YouTube (un archivo cookies.txt). (${line})`;
  if (/netscape format|invalid length|does not look like a Netscape/i.test(text)) return 'El archivo de cookies no sirve. Expórtalo otra vez desde youtube.com (Ajustes → Cookies de YouTube).';
  if (/age|inappropriate/i.test(text) && /sign in/i.test(text)) return 'Ese video tiene restricción de edad: YouTube no deja leerlo sin iniciar sesión.';
  if (/ENOENT|no se encontr|not recognized/i.test(text)) return 'Falta yt-dlp. Instálalo en Ajustes → Estado del sistema.';
  if (/getaddrinfo|timed out|Unable to download|network/i.test(text)) return 'No pude conectarme con YouTube. Revisa tu internet y prueba otra vez.';
  return `No pude abrir ese enlace de YouTube${line ? `: ${line}` : '.'}`;
}

const AI_WINDOW = 600;     // la IA Pro revisa tramos de 10 minutos
const AI_MIN_SCORE = 7;    // nota mínima de Haiku para pasar a Sonnet

class ClipSession extends EventEmitter {
  /**
   * opts: url, mode ('local'|'ia'), clipSeconds, style, subtitles, look (estilo), sensitivity, maxPerHour,
   *       outputDir, workRoot, paths (componentes), whisperModel, language, whisperGpu, gpuEncode,
   *       ollamaModel, api (llamadas al servidor), origin (piloto/manual), hints (lo que mejor funciona en tus redes)
   *       oido (detector de sonidos ya creado, o null), visionModel (modelo de Ollama que mira el video, o '')
   *       camModel (modelo de Ollama para encontrar la cámara del streamer, en los dos modos), camStore (cámaras marcadas a mano)
   */
  constructor(opts) {
    super();
    this.o = { clipSeconds: 45, style: 'blur', subtitles: true, subColor: 'amarillo', sensitivity: 'media', maxPerHour: 8, ...opts };
    this.mode = this.o.mode;
    this.timeline = new Timeline();
    this.clips = [];
    this.queue = Promise.resolve();
    this.state = 'starting';
    this.localFrom = 0;
    this.lastPeakT = -Infinity;
    this.aiWindowStart = 0;
    this.aiSecondsUsed = null;
    // Lo que va costando Claude en este directo (dólares que calcula el servidor con los tokens de cada consulta).
    this.aiCost = 0;
    this.aiCalls = 0;
    this.whisperGpu = this.o.whisperGpu;
    this.chatCount = 0;
    // "Saca ese clip": segundos de los pedidos ya atendidos y hasta dónde se buscaron.
    this.pedidosHechos = [];
    this.pedidosDesde = 0;
  }

  log(text, kind = 'info') { this.emit('log', { text, kind, at: Date.now() }); }

  stats() {
    const live = this.info?.isLive && this.recorder?.startedAt && this.state === 'recording'
      ? (Date.now() - this.recorder.startedAt) / 1000 : this.recorder?.offset || 0;
    return {
      state: this.state,
      mode: this.mode,
      info: this.info || null,
      recorded: Math.max(live, this.recorder?.offset || 0),
      analyzed: this.timeline.until,
      chatMessages: this.chatCount,
      clips: this.clips.length,
      aiSecondsUsed: this.aiSecondsUsed,
      aiCostUsd: this.aiCost,
      aiCalls: this.aiCalls,
    };
  }

  /** Suma lo que costó una consulta a Claude y lo avisa a la pantalla. */
  #addCost(usd) {
    const v = Number(usd);
    if (!Number.isFinite(v) || v < 0) return;
    this.aiCost += v;
    this.aiCalls += 1;
    this.emitStats();
  }

  emitStats() { this.emit('stats', this.stats()); }

  async start() {
    const { paths } = this.o;
    const ytdlpArgs = paths.ytdlpArgs?.() || [];
    this.log('Abriendo el enlace…');
    let meta;
    const read = async () => {
      const { out } = await run(paths.ytdlp, [...ytdlpArgs, '--dump-single-json', '--no-warnings', '--skip-download', '--no-playlist', this.o.url], { timeoutMs: 90000 });
      return JSON.parse(out);
    };
    try {
      meta = await read();
    } catch (first) {
      // YouTube cambia seguido y un yt-dlp viejo deja de leer los videos: se actualiza y se prueba otra vez.
      let err = first;
      if (this.o.updateYtdlp && !GONE.test(`${err.err || ''} ${err.message}`)) {
        this.log('No pude abrir el enlace. Actualizo yt-dlp y pruebo otra vez…');
        await this.o.updateYtdlp().catch(() => {});
        try { meta = await read(); } catch (again) { err = again; }
      }
      if (!meta) throw new Error(ytdlpProblem(err));
    }
    if (this.stopRequested) return;
    if (meta.is_upcoming || meta.live_status === 'is_upcoming') throw new Error('Ese directo todavía no ha empezado.');

    this.info = {
      id: meta.id || youtubeId(this.o.url) || 'video',
      title: meta.title || 'Directo',
      channel: meta.channel || meta.uploader || '',
      isLive: !!meta.is_live,
      duration: meta.duration || null,
      thumbnail: meta.thumbnail || null,
      url: this.o.url,
    };
    const stamp = new Date();
    const day = stamp.toISOString().slice(0, 10);
    this.outDir = path.join(this.o.outputDir, day, `${slug(this.info.channel || 'canal', 30)}_${slug(this.info.title, 40)}`);
    this.workDir = path.join(this.o.workRoot, `${this.info.id}-${stamp.getTime()}`);
    fs.mkdirSync(this.outDir, { recursive: true });
    fs.mkdirSync(this.workDir, { recursive: true });

    this.log(`${this.info.isLive ? 'Directo en vivo' : 'Video'}: ${this.info.title}`, 'ok');

    if (this.info.isLive) {
      this.chat = new ChatWatcher(this.info.id);
      this.chat.on('message', (m) => {
        this.chatCount += 1;
        if (!this.recorder?.startedAt) return;
        this.timeline.addChat((m.wall - this.recorder.startedAt) / 1000, m.text, m);
      });
      this.chat.on('warn', (w) => this.log(w, 'warn'));
      this.chat.start().then((ok) => ok && this.log('Leyendo el chat en vivo', 'ok'));
    }

    // "Cámara + juego" y "Vertical recortado" agrandan una parte del video: si el directo viene en 1440p, se baja en 1440p
    // (más nítido, pero usa más internet y disco). Los demás formatos se ven igual de bien con 1080p.
    const zoom = this.o.style === 'camara' || this.o.style === 'recorte';
    const src = { ytdlp: paths.ytdlp, ytdlpArgs, ffmpeg: paths.ffmpeg, ffprobe: paths.ffprobe, url: this.o.url, dir: path.join(this.workDir, 'video'), maxHeight: zoom ? 1440 : 1080 };
    // Video ya subido: se baja rápido (audio primero) en vez de leerlo en tiempo real como un directo.
    this.recorder = this.info.isLive ? new Recorder({ ...src, isLive: true }) : new VodSource(src);
    // Varios pedazos se pasan a texto a la vez; el análisis sigue el orden del video.
    this.parallel = this.info.isLive ? 1 : (this.whisperGpu ? 2 : os.cpus().length >= 12 ? 2 : 1);
    this.recorder.on('segment', (seg) => {
      // Video ya subido + "Detener": los pedazos que todavía no se empezaron se saltan (en un directo se analiza todo lo grabado).
      const text = this.#limit(() => (this.stopRequested && !this.info.isLive ? Promise.resolve(null) : this.#transcribe(seg)));
      text.catch(() => {});
      this.queue = this.queue.then(() => this.#handleSegment(seg, text)).catch((e) => this.log(e.message, 'error'));
    });
    this.recorder.on('warn', (w) => this.log(w, 'warn'));
    this.recorder.on('info', (w) => this.log(w));
    this.recorder.on('end', ({ reason }) => this.#finish(reason));
    this.recorder.start();
    // La IA que mira el video se carga mientras se graba el primer pedazo (si no, el primer momento se queda sin ella).
    if (this.o.visionModel) {
      vista.warmUp(this.o.visionModel).then((ok) => ok && this.log('La IA que mira el video ya está lista', 'ok'));
    }
    this.state = 'recording';
    this.log(this.info.isLive ? 'Grabando… el primer análisis sale en unos 2 minutos.' : 'Descargando y analizando el video…');
    this.emitStats();
    this.ticker = setInterval(() => this.emitStats(), 1000);
  }

  /** Deja correr como máximo `this.parallel` transcripciones a la vez. */
  #limit(fn) {
    this.running = this.running || 0;
    this.waiting = this.waiting || [];
    return new Promise((resolve, reject) => {
      const go = () => {
        this.running += 1;
        fn().then(resolve, reject).finally(() => { this.running -= 1; this.waiting.shift()?.(); });
      };
      if (this.running < (this.parallel || 1)) go(); else this.waiting.push(go);
    });
  }

  async #transcribe(seg) {
    const { paths } = this.o;
    this.log(`Pasando a texto ${fmtClock(seg.start)} – ${fmtClock(seg.start + seg.duration)}`);
    // Si corren varias a la vez, se reparten los núcleos del procesador.
    const threads = Math.max(2, Math.min(8, Math.floor((os.cpus().length - 1) / (this.parallel || 1))));
    const opts = { ffmpeg: paths.ffmpeg, whisper: paths.whisper, model: paths.model(this.o.whisperModel), language: this.o.language || 'auto', threads };
    try {
      return await transcribeSegment({ ...opts, useGpu: this.whisperGpu }, seg.file, this.workDir);
    } catch (err) {
      if (!this.whisperGpu) throw new Error(`Whisper falló: ${err.message.slice(0, 200)}`);
      if (!this.gpuWarned) { this.gpuWarned = true; this.log('La tarjeta de video no funcionó con Whisper. Sigo con el procesador.', 'warn'); }
      this.whisperGpu = false;
      return transcribeSegment({ ...opts, useGpu: false }, seg.file, this.workDir);
    }
  }

  async #handleSegment(seg, text) {
    const result = await text;
    if (!result) return; // se saltó porque el usuario tocó "Detener"
    this.timeline.addSegment(seg.start, seg.duration, result.words, result.loudness);
    await this.#listen(seg);

    const activity = this.timeline.scores(seg.start, seg.start + seg.duration);
    const points = [];
    for (let i = 0; i < activity.length; i += 5) points.push({ t: activity[i].t, score: +activity[i].score.toFixed(2) });
    this.emit('activity', points);
    this.emitStats();

    if (this.mode === 'ia') {
      if (this.timeline.until - this.aiWindowStart >= AI_WINDOW) await this.#analyzeAi(false);
    } else {
      await this.#analyzeLocal(false);
    }
    this.#cleanup();
  }

  /** El detector de sonidos escucha el pedazo (risas, gritos, aplausos…). Si falla, se sigue sin él. */
  async #listen(seg) {
    if (!this.o.oido || this.oidoOff || this.stopRequested) return;
    try {
      const windows = await this.o.oido.listenFile(this.o.paths.ffmpeg, seg.file, { shouldStop: () => this.stopRequested });
      this.timeline.addSound(seg.start, windows);
      const loud = windows.filter((w) => describeSound(w.cats));
      if (loud.length) this.log(`👂 Se oyen ${[...new Set(loud.map((w) => describeSound(w.cats)))].slice(0, 3).join('; ')} (${fmtClock(seg.start + loud[0].t)})`);
    } catch (err) {
      this.oidoOff = true;
      this.log(`El detector de sonidos no funcionó (${String(err.message).slice(0, 160)}). Sigo sin él.`, 'warn');
    }
  }

  #cleanup() {
    const keepFrom = this.mode === 'ia' ? this.aiWindowStart - 180 : this.localFrom - this.o.clipSeconds * 2;
    if (keepFrom > 0) {
      this.recorder.cleanup(keepFrom);
      this.timeline.trim(keepFrom - 120);
    }
  }

  #overlaps(start, end) {
    return this.clips.some((c) => {
      const inter = Math.min(end, c.end) - Math.max(start, c.start);
      return inter > 0.4 * Math.min(end - start, c.end - c.start);
    });
  }

  #clipsLastHour(at) {
    return this.clips.filter((c) => at - c.start < 3600).length;
  }

  // ---------- "Saca ese clip" ----------
  /** Pedidos de clip nuevos hasta `hasta` (el streamer lo dice, el dueño o un moderador escribe !clip, o el chat lo pide). */
  #nuevosPedidos(hasta) {
    const desde = this.pedidosDesde;
    this.pedidosDesde = Math.max(desde, hasta - 3);
    const nuevos = this.timeline.clipRequests(Math.max(0, desde - 15), hasta)
      .filter((p) => !this.pedidosHechos.some((t) => Math.abs(t - p.t) < 25));
    this.pedidosHechos.push(...nuevos.map((p) => p.t));
    if (this.pedidosHechos.length > 40) this.pedidosHechos.splice(0, this.pedidosHechos.length - 40);
    return nuevos;
  }

  /** Clip de lo que pasó justo ANTES del pedido. Sin Claude: título automático (o el de la IA local si está). */
  async #producePedido(p, ollama = null) {
    const L = Math.max(15, this.o.clipSeconds);
    const { start, end } = this.timeline.snap(Math.max(0, p.t - L + 2), Math.min(this.timeline.until, p.t + 2));
    if (this.#overlaps(start, end)) {
      this.log(`🎯 ${quienPide(p)} pidió clip en ${fmtClock(p.t)}: ese momento ya tiene su clip.`);
      return;
    }
    this.log(`🎯 ${quienPide(p)} pidió clip ("${p.frase}") en ${fmtClock(p.t)}. Lo saco.`, 'ok');
    const words = this.timeline.wordsBetween(start, end);
    let meta = { title: autoTitle(words.length ? words : [{ w: this.info.title || 'Momento' }]), hashtags: defaultTags(this.info), description: '', score: 9 };
    if (ollama) {
      try {
        const transcript = this.timeline.lines(start, end).map((l) => `[${l.t}] ${l.text}`).join('\n');
        const r = await localAi.review(ollama, { streamTitle: this.info.title, transcript, chatSummary: this.timeline.chatSummary(start, end) });
        meta = { ...meta, title: r.title || meta.title, hashtags: r.hashtags.length ? r.hashtags : meta.hashtags, description: r.description || '' };
      } catch { /* sigue con el título automático */ }
    }
    await this.#produce({ start, end, ...meta, reason: `${quienPide(p)} pidió este clip ("${p.frase}").`, pedido: pedidoDe(p) });
  }

  // ---------- Modo Local ----------
  async #analyzeLocal(final) {
    const L = this.o.clipSeconds;
    // Lo que pidió el streamer (o el chat) va primero y sin filtros: él sabe qué quiere.
    const pedidos = this.#nuevosPedidos(final ? this.timeline.until : this.timeline.until - 3);
    const horizon = final ? this.timeline.until : this.timeline.until - L;
    const peaks = horizon > this.localFrom
      ? this.timeline.findPeaks(Math.max(0, this.localFrom - L), horizon, { clipSeconds: L, sensitivity: this.o.sensitivity })
      : [];
    this.localFrom = Math.max(this.localFrom, horizon);
    let ollama = null;
    let eyes = null;
    if ((peaks.length || pedidos.length) && (this.o.ollamaModel || this.o.visionModel)) {
      const st = await localAi.status();
      const has = (id) => !!id && st.running && st.models.some((m) => m === id || m.startsWith(`${id}`));
      ollama = has(this.o.ollamaModel) ? this.o.ollamaModel : null;
      eyes = has(this.o.visionModel) ? this.o.visionModel : null;
      if (this.o.visionModel && !eyes && !this.eyesWarned) {
        this.eyesWarned = true;
        this.log(st.running ? `El modelo que mira el video (${this.o.visionModel}) no está descargado. Sigo sin él.` : 'Ollama está apagado: sigo sin mirar el video.', 'warn');
      }
    }
    for (const p of pedidos) await this.#producePedido(p, ollama);
    const threshold = SENSITIVITY[this.o.sensitivity] ?? SENSITIVITY.media;
    for (const peak of peaks) {
      if (peak.t - this.lastPeakT < L) continue;
      this.lastPeakT = peak.t;
      if (this.#clipsLastHour(peak.t) >= this.o.maxPerHour) continue;
      const { start, end } = this.timeline.snap(peak.t - 0.6 * L, peak.t + 0.4 * L);
      if (this.#overlaps(start, end)) continue;
      const words = this.timeline.wordsBetween(start, end);
      const heard = this.timeline.soundBetween(start, end);
      const sound = heard.length ? { cats: mergeSounds(heard.map((w) => w.cats)), score: Math.max(...heard.map((w) => w.score)) } : null;
      // Sin voz solo vale si se oye algo fuerte (risas, gritos, aplausos…).
      if (words.length < 4 && !(sound && describeSound(sound.cats))) continue;
      const transcript = this.timeline.lines(start, end).map((l) => `[${l.t}] ${l.text}`).join('\n');
      const chatSummary = this.timeline.chatSummary(start, end);

      let vision = null;
      if (eyes) {
        try {
          this.log(`👀 La IA está mirando el momento ${fmtClock(start)}…`);
          const segments = this.recorder.videoSegmentsFor ? await this.#waitVideo(start, end) : this.recorder.segmentsFor(start, end).filter((x) => !x.deleted);
          const frames = await vista.grabFrames({
            ffmpeg: this.o.paths.ffmpeg, segments, times: vista.frameTimes(start, end, peak.t), tempDir: path.join(this.workDir, 'fotos'),
          });
          if (frames.length) {
            vision = await vista.reviewMoment(eyes, {
              streamTitle: this.info.title, transcript, chatSummary, frames, start, sounds: sound ? describeSound(sound.cats) : '',
            });
          }
        } catch (err) {
          if (err.message === 'detenido') return;
          this.log(`La IA que mira el video no respondió (${String(err.message).slice(0, 160)}). Sigo sin ella en este momento.`, 'warn');
        }
      }

      const verdict = judge({ peak, sound, vision, threshold, sensitivity: this.o.sensitivity });
      if (!verdict.keep) {
        const what = vision ? ` La IA le dio ${vision.viral}/10${vision.que_pasa ? ` (${vision.que_pasa})` : ''}.` : '';
        this.log(`Momento ${fmtClock(start)} descartado: coinciden ${verdict.votes} de ${verdict.available} señales (hacen falta ${verdict.needed}).${what}`);
        continue;
      }

      let meta = { title: autoTitle(words.length ? words : [{ w: this.info.title || 'Momento' }]), hashtags: defaultTags(this.info), description: '', score: verdict.score };
      if (vision) {
        meta = { title: vision.title || meta.title, hashtags: vision.hashtags.length ? vision.hashtags : meta.hashtags, description: vision.description, score: verdict.score };
      } else if (ollama) {
        try {
          this.log(`IA local revisando el momento ${fmtClock(start)}…`);
          const soundNote = sound && describeSound(sound.cats) ? ` Se oyen ${describeSound(sound.cats)}.` : '';
          const r = await localAi.review(ollama, { streamTitle: this.info.title, transcript, chatSummary: `${chatSummary}${soundNote}` });
          if (r.viral < 5) { this.log(`Momento ${fmtClock(start)} descartado por la IA local (nota ${r.viral})`); continue; }
          meta = { title: r.title || meta.title, hashtags: r.hashtags.length ? r.hashtags : meta.hashtags, description: r.description, score: Math.round((r.viral + verdict.score) / 2) };
        } catch (err) {
          this.log(`IA local no respondió (${err.message}). Uso título automático.`, 'warn');
        }
      }
      await this.#produce({ start, end, ...meta, reason: verdict.reason });
    }
  }

  // ---------- Modo IA Pro (Claude) ----------
  async #analyzeAi(final) {
    const from = this.aiWindowStart;
    const to = this.timeline.until;
    if (to - from < (final ? 15 : AI_WINDOW)) return;
    const L = this.o.clipSeconds;
    const ctxStart = Math.max(0, from - 60);
    // Precisión que eligió el cliente: qué modelos de Claude se usan (normal, alta o maxima).
    const precision = this.o.precision || 'normal';
    this.log(`Claude está revisando ${fmtClock(from)} – ${fmtClock(to)}…`);
    let scan;
    try {
      scan = await this.o.api('/ai/scan', {
        title: this.info.title,
        precision,
        windowStart: ctxStart,
        windowSeconds: Math.round(to - from),
        clipSeconds: L,
        transcript: this.timeline.lines(ctxStart, to),
        chat: this.timeline.chatBins(ctxStart, to),
        peaks: this.timeline.findPeaks(ctxStart, to, { clipSeconds: L, sensitivity: 'alta' }).sort((a, b) => b.score - a.score).slice(0, 10),
      });
    } catch (err) {
      if (err.status === 402 || err.status === 503 || err.status === 401) {
        this.log(`${err.message} Sigo en modo Local.`, 'warn');
        this.mode = 'local';
        this.localFrom = from;
        this.emit('mode', 'local');
        return this.#analyzeLocal(final);
      }
      this.log(`${err.message}`, 'warn');
      if (to - from > 1500 || final) this.aiWindowStart = to; // no dejamos que el tramo crezca sin fin
      // Lo que pidió el streamer no se pierde aunque Claude falle: se saca igual, con título automático.
      for (const p of this.#nuevosPedidos(final ? to : to - 3)) await this.#producePedido(p);
      return;
    }
    this.aiWindowStart = to;
    if (typeof scan.secondsUsed === 'number') this.aiSecondsUsed = scan.secondsUsed;
    this.#addCost(scan.costUsd);

    const pedidos = this.#nuevosPedidos(final ? to : to - 3);
    const good = scan.candidates
      .filter((c) => c.score >= AI_MIN_SCORE && c.end > c.start && !this.#overlaps(c.start, c.end))
      .slice(0, 8);
    if (!good.length && !pedidos.length) { this.log(`Nada viral entre ${fmtClock(from)} y ${fmtClock(to)}`); return; }

    for (const p of pedidos) this.log(`🎯 ${quienPide(p)} pidió clip ("${p.frase}") en ${fmtClock(p.t)}. Claude lo va a preparar.`, 'ok');
    // Los pedidos van primero: lo que hay que sacar pasó justo antes, y Claude busca dónde empieza.
    const cands = [
      ...pedidos.map((p) => ({ start: Math.max(0, p.t - Math.max(L, 30) - 15), end: p.t + 3, score: 10, reason: `${quienPide(p)} pidió este clip`, pedido: p })),
      ...good,
    ];
    if (good.length) this.log(`Claude encontró ${good.length} posible${good.length > 1 ? 's' : ''}. Eligiendo los mejores…`);
    let picked;
    try {
      picked = await this.o.api('/ai/pick', {
        title: this.info.title,
        clipSeconds: L,
        precision,
        maxClips: Math.min(10, Math.max(1, Math.min(4, this.o.maxPerHour)) + pedidos.length),
        hints: this.o.hints || '',
        candidates: cands.map((c, i) => ({
          id: String(i + 1), start: c.start, end: c.end, score: c.score, reason: c.reason,
          pedido: c.pedido ? { quien: c.pedido.quien, frase: c.pedido.frase, t: Math.round(c.pedido.t) } : undefined,
          transcript: this.timeline.lines(c.start - (c.pedido ? 20 : 10), c.end + 10),
          chatSummary: this.timeline.chatSummary(c.start, c.end),
        })),
      }, 'POST', 5 * 60000); // Opus piensa más: se le da más tiempo
    } catch (err) {
      this.log(`${err.message}`, 'warn');
      for (const p of pedidos) await this.#producePedido(p);
      return;
    }
    this.#addCost(picked.costUsd);
    const clips = picked.clips.map((c) => ({ ...c, cand: cands[Number(c.id) - 1] }))
      .sort((x, y) => (y.cand?.pedido ? 1 : 0) - (x.cand?.pedido ? 1 : 0));
    for (const c of clips) {
      const pedido = c.cand?.pedido || null;
      let start = Math.max(ctxStart - (pedido ? 90 : 30), c.start);
      let end = Math.min(this.timeline.until, c.end);
      if (end - start < 12) end = Math.min(this.timeline.until, start + 12);
      if (end - start > 120) end = start + 120;
      ({ start, end } = this.timeline.snap(start, end));
      if (this.#overlaps(start, end)) continue;
      // Por qué funcionaría: lo que dice Claude al elegir (o, si no, lo que marcó al revisar). redes: el texto listo de cada red.
      const reason = c.reason || c.cand?.reason || 'Elegido por Claude';
      // Si Claude juntó el pedido con otro momento, el clip igual queda marcado como pedido.
      const pide = pedido || pedidos.find((p) => p.t >= start - 2 && p.t <= end + 8) || null;
      await this.#produce({ start, end, title: c.title, hashtags: c.hashtags, description: c.description, score: c.score, reason, redes: c.redes || null, pedido: pide && pedidoDe(pide) });
    }
    // Si Claude dejó afuera algún pedido, se saca igual (con título automático).
    for (const p of pedidos) {
      if (!this.clips.some((c) => c.pedido && Math.abs(c.pedido.t - p.t) < 1)) await this.#producePedido(p);
    }
  }

  async #produce({ start, end, title, hashtags, description, score, reason, redes = null, pedido = null }) {
    const n = this.clips.length + 1;
    const name = `${String(n).padStart(3, '0')}_${slug(title, 45)}`;
    const outFile = path.join(this.outDir, `${name}.mp4`);
    this.log(`✂️ Creando clip ${n}: "${title}"`);
    this.emit('producing', { title, start, end });
    try {
      const segments = this.recorder.videoSegmentsFor
        ? await this.#waitVideo(start, end)
        : this.recorder.segmentsFor(start, end).filter((s) => !s.deleted);
      // Cámara + juego: se busca la cámara del streamer en este momento (si no hay, el clip va con fondo).
      const split = this.o.style === 'camara' && segments.length ? await this.#camSplit(start, end, segments) : null;
      const result = await makeClip({
        ffmpeg: this.o.paths.ffmpeg,
        segments,
        split,
        clip: { start, end, title, words: this.timeline.wordsBetween(start, end) },
        outFile,
        style: this.o.style,
        subtitles: this.o.subtitles,
        look: this.o.look || { subs: { color: this.o.subColor } },
        gpuEncode: this.o.gpuEncode,
        tempDir: path.join(this.workDir, `clip-${n}`),
      });
      const tags = (hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, ''));
      fs.writeFileSync(path.join(this.outDir, `${name}.txt`),
        `${title}\n\n${description ? `${description}\n\n` : ''}${tags.join(' ')}\n\nFuente: ${this.info.channel} — ${this.info.url} (minuto ${fmtClock(start)})\n`);
      const entry = {
        id: `${this.info.id}-${Date.now()}-${n}`,
        file: result.file,
        thumb: result.thumb,
        title, description: description || '', hashtags: tags, score, reason,
        // Texto de cada red escrito por Claude (en modo Local no hay: Clips sugeridos usa la plantilla).
        redes,
        // "Saca ese clip": quién lo pidió ('streamer' o 'chat'), qué dijo y en qué segundo. null si lo eligió la app.
        pedido: pedido || null,
        start, end, duration: result.duration,
        stream: { id: this.info.id, title: this.info.title, channel: this.info.channel, url: this.info.url },
        mode: this.mode,
        // De dónde salió: a mano, o el piloto (y por qué canal o tema). Sirve para saber qué funciona.
        origin: this.o.origin ? { type: this.o.origin.type, source: this.o.origin.source || null, kind: this.o.origin.kind || null } : { type: 'manual' },
        createdAt: new Date().toISOString(),
      };
      this.clips.push(entry);
      this.emit('clip', entry);
      this.log(`✅ Clip listo: ${title}`, 'ok');
      this.emitStats();
    } catch (err) {
      this.log(err.message === 'detenido'
        ? `No se pudo crear el clip "${title}": se canceló la descarga del video.`
        : `No se pudo crear el clip: ${err.message.slice(0, 300)}`, 'error');
    }
  }

  // ---------- Cámara + juego ----------
  /** Dónde está la cámara del streamer en este tramo: la marcada a mano, la IA local o Claude (una vez por directo). */
  async #camSplit(start, end, segments) {
    const ffmpeg = this.o.paths.ffmpeg;
    const times = [0.25, 0.5, 0.75].map((k) => Math.round((start + (end - start) * k) * 10) / 10);
    const tempDir = path.join(this.workDir, 'camara');
    try {
      const video = await camara.measureVideo({ ffmpeg, segments, times, tempDir });
      if (!video) return null;
      if (video.h > video.w) { this.#camNote('vertical', '📷 Este video ya es vertical: va con el formato de siempre.'); return null; }
      const manual = this.o.camStore?.get(this.info.channel) || null;
      let box = manual;
      if (!box) {
        if (this.camLocal === undefined) this.camLocal = await camara.localCamModel(this.o.camModel);
        if (this.camLocal) {
          const found = await camara.findCamera({ ffmpeg, segments, times, tempDir, model: this.camLocal });
          box = found.box;
          if (found.b64) this.camShot = found.b64;
        } else if (this.mode === 'ia' && this.o.api) {
          // Con Claude se pregunta una sola vez por directo (cuesta centavos): los streamers no mueven la cámara.
          if (this.camClaude === undefined) {
            const found = await camara.findCamera({ ffmpeg, segments, times, tempDir,
              askClaude: async (images) => {
                const r = await this.o.api('/ai/camara', { images });
                this.#addCost(r.costUsd);
                return r.caja;
              } });
            this.camClaude = found.box;
            if (found.b64) this.camShot = found.b64;
          }
          box = this.camClaude;
        } else {
          this.#camNote('sin-ia', '📷 Para "Cámara + juego" hace falta la IA que mira el video (en Ajustes) o el plan Claude. '
            + 'También puedes marcar la cámara a mano con "Ajustar cámara". Mientras, los clips van con fondo.', 'warn');
          return null;
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (!box) { this.log('📷 No vi la cámara del streamer en este momento: este clip va con fondo.'); return null; }
      this.camBox = box;
      this.#camNote('ok', manual ? '📷 Uso la cámara que marcaste para este canal: va arriba y el juego abajo.'
        : '📷 Encontré la cámara del streamer: va arriba y el juego abajo. Si no quedó bien, toca "Ajustar cámara".', 'ok');
      return camara.planSplit(box, video);
    } catch (err) {
      this.log(`📷 No pude ubicar la cámara (${err.message}). Este clip va con fondo.`, 'warn');
      return null;
    }
  }

  /** Avisa una sola vez por directo. */
  #camNote(id, text, level) {
    this.camNotes ||= new Set();
    if (this.camNotes.has(id)) return;
    this.camNotes.add(id);
    this.log(text, level);
  }

  /** Para "Ajustar cámara": una foto del directo y la caja que se está usando. */
  async camSnapshot() {
    if (!this.info) throw new Error('El directo todavía no empezó. Espera unos segundos.');
    const manual = this.o.camStore?.get(this.info.channel) || null;
    let b64 = this.camShot || null;
    if (!b64) {
      let segs = [];
      if (this.recorder?.videoSegmentsFor) {
        if (!this.recorder.videoFile) throw new Error('Espera a que termine de bajar el video para marcar la cámara.');
        segs = await this.recorder.videoSegmentsFor();
      } else {
        // El último pedazo puede estar a medio escribir: se usa el anterior.
        const done = (this.recorder?.segments || []).filter((x) => !x.deleted && x.duration > 1);
        segs = done.length > 1 ? [done[done.length - 2]] : done.slice(-1);
      }
      const seg = segs[segs.length - 1];
      if (!seg) throw new Error('Todavía no hay video grabado. Espera unos segundos.');
      const t = seg.start + Math.min(seg.duration / 2, 30);
      const [f] = await vista.grabFrames({ ffmpeg: this.o.paths.ffmpeg, segments: [seg], times: [t], tempDir: path.join(this.workDir, 'camara'), width: 960 });
      b64 = f?.b64 || null;
    }
    if (!b64) throw new Error('No pude sacar una foto del video.');
    return { image: `data:image/jpeg;base64,${b64}`, box: manual || this.camBox || null, manual: !!manual, channel: this.info.channel };
  }

  async #waitVideo(start, end) {
    if (!this.recorder.videoFile) {
      const pct = Math.floor((this.recorder.progress?.video || 0) * 100);
      this.log(`Esperando que termine de bajar el video (va en ${pct}%) para cortar ${fmtClock(start)} – ${fmtClock(end)}…`);
    }
    return this.recorder.videoSegmentsFor(start, end);
  }

  async #finish(reason) {
    if (this.finishing) return;
    this.finishing = true;
    this.state = 'finishing';
    this.emitStats();
    this.chat?.stop();
    if (!this.stopRequested) this.log(this.info?.isLive ? `El directo terminó (${reason}).` : 'Audio completo listo para analizar.', 'ok');
    this.log('Terminando de analizar lo que falta…');
    await this.queue.catch(() => {});
    try {
      if (this.mode === 'ia') await this.#analyzeAi(true);
      if (this.mode === 'local') await this.#analyzeLocal(true);
    } catch (err) {
      this.log(err.message, 'error');
    }
    clearInterval(this.ticker);
    this.state = 'done';
    this.recorder?.abort?.(); // si el video seguía bajando y ningún clip lo necesita, se cancela
    if (this.workDir) { try { fs.rmSync(this.workDir, { recursive: true, force: true }); } catch {} }
    this.log(`Listo. ${this.clips.length} clip${this.clips.length === 1 ? '' : 's'} guardado${this.clips.length === 1 ? '' : 's'}.`, 'ok');
    this.emitStats();
    this.emit('done', { clips: this.clips.length, outDir: this.outDir });
  }

  /**
   * "Detener": no se analiza más y se crean los clips de lo ya revisado.
   * now: cancelar todo ya, sin esperar el video (al cerrar la app).
   */
  stop({ now = false } = {}) {
    if (now) this.recorder?.abort?.();
    if (this.stopRequested) return;
    this.stopRequested = true;
    this.log(this.info && !this.info.isLive && !now
      ? 'Deteniendo: ya no reviso más partes del video. Creo los clips de lo que ya revisé (si el video todavía se está bajando, espero a que termine).'
      : 'Deteniendo…');
    if (this.recorder) this.recorder.stop();
    else this.#finish('detenido');
  }
}

const quienPide = (p) => (p.quien === 'chat' ? 'El chat' : 'El streamer');
const pedidoDe = (p) => ({ quien: p.quien, frase: p.frase, t: Math.round(p.t) });

function autoTitle(words) {
  const text = words.map((w) => w.w).join(' ').replace(/\s+([.,!?])/g, '$1').trim();
  const firstSentence = text.split(/(?<=[.!?¡¿])\s/)[0] || text;
  const short = firstSentence.split(' ').slice(0, 9).join(' ');
  const title = short.length < firstSentence.length ? `${short}…` : short;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function defaultTags(info) {
  const channel = slug(info?.channel || '', 25).replace(/-/g, '');
  return ['#clips', '#viral', '#stream', ...(channel ? [`#${channel}`] : [])];
}

module.exports = { ClipSession, autoTitle, ytdlpProblem };
