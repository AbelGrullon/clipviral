// El agente de contenido (solo administradores): maneja solo una página de Facebook nueva.
// Cada vuelta hace UNA cosa: publicar lo que ya tocó, leer los números, armar el plan o hacer el próximo video.
// Usa las apps del dueño: el Sintetizador de voz (voces), SerieAI (episodios animados) y ClipViral (subtítulos, video).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Voz, sinteInfo } = require('./voz');
const { findPython, serieInfo, runSerie } = require('./serie');
const { makeNarrated, listFondos, mediaDuration } = require('./narrados');
const cerebro = require('./cerebro');
const { nextSlot, progress, viewsByDay, dayKey, DAY, HOUR } = require('./horario');
const { run } = require('../util');
const { FB_VERSION } = require('../redes');

const DEFAULT_CONFIG = {
  tipos: { narrado: true, serie: true },
  maxDia: 2,              // videos al día como máximo (el agente puede elegir menos)
  modoSerie: '3d',        // '3d' (Blender) o '2d' (dibujos planos, más rápido)
  avisoIa: true,          // agrega "Voz creada con IA" al texto (Meta pide avisar del contenido hecho con IA)
  metas: { estrellas: 500, seguidores: 5000, minutos: 60000 },
  sintetizador: '',       // carpeta del Sintetizador de voz (se busca sola)
  serieai: '',            // carpeta de SerieAI (se busca sola)
};

const fmtWhen = (ms) => new Date(ms).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

/** Busca la carpeta de otra app del dueño al lado de ClipViral (programacion/<nombre>) o en el Escritorio. */
function detectFolder(appDir, name) {
  const cands = [
    path.resolve(appDir, '..', '..', name),
    path.join(os.homedir(), 'OneDrive', 'Desktop', 'programacion', name),
    path.join(os.homedir(), 'Desktop', 'programacion', name),
  ];
  return cands.find((c) => fs.existsSync(c)) || '';
}

class Agente extends EventEmitter {
  /**
   * dir: carpeta del agente (estado, videos, serie, fondos) · appDir: carpeta de la app (para buscar las otras apps)
   * api(path, body, method, timeoutMs): servidor de ClipViral · server(): { url, token } (para SerieAI)
   * paths: componentes (ffmpeg, whisper) · whisper(): { model, gpu, ok } · gpuEncode(): bool
   * uploader: redes.facebook · fetchers: estadisticas.FETCHERS · ocupado(): ClipViral está grabando un directo
   */
  constructor({ dir, appDir, api, server, paths, whisper, gpuEncode = () => false, uploader, fetchers, ocupado = () => false, fetchImpl = fetch, now = () => Date.now() }) {
    super();
    Object.assign(this, { dir, appDir, api, server, paths, whisper, gpuEncode, uploader, fetchers, ocupado, fetchImpl, now });
    this.file = path.join(dir, 'estado.json');
    this.fondosDir = path.join(dir, 'fondos');
    this.serieDir = path.join(dir, 'serie');
    for (const d of [dir, this.fondosDir, path.join(dir, 'videos'), path.join(dir, 'trabajo')]) fs.mkdirSync(d, { recursive: true });
    const leeme = path.join(this.fondosDir, 'LEEME.txt');
    if (!fs.existsSync(leeme)) {
      fs.writeFileSync(leeme, 'Pon aquí videos (mp4) o fotos (jpg, png) TUYOS o libres de derechos para el fondo de los videos narrados.\r\n'
        + 'Por ejemplo: grabaciones de tus partidas, paisajes que grabaste, fotos tuyas.\r\n'
        + 'En la carpeta "musica" puedes poner canciones libres de derechos: suenan bajito detrás de la voz.\r\n'
        + 'Si la carpeta está vacía, el agente usa fondos de colores animados.\r\n');
      fs.mkdirSync(path.join(this.fondosDir, 'musica'), { recursive: true });
    }
    this.state = {
      activo: false, config: structuredClone(DEFAULT_CONFIG), plan: null, lecciones: [], cola: [], publicaciones: [],
      seguidores: [], diario: [], serie: null, voces: null, vocesAt: 0, fondosRecientes: [], fallos: {}, statsAt: 0,
      remoto: null, espera: null,
    };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = { ...this.state, ...saved, config: { ...this.state.config, ...(saved.config || {}), tipos: { ...DEFAULT_CONFIG.tipos, ...(saved.config?.tipos || {}) }, metas: { ...DEFAULT_CONFIG.metas, ...(saved.config?.metas || {}) } } };
    } catch {}
    if (!this.state.config.sintetizador) this.state.config.sintetizador = detectFolder(appDir, 'Sintetizadorai');
    if (!this.state.config.serieai) this.state.config.serieai = detectFolder(appDir, 'SerieAI');
    // Lo que quedó a medias si la app se cerró trabajando.
    for (const v of this.state.cola) if (v.estado === 'publicando') v.estado = 'listo';
    this.voz = new Voz({ dir: this.state.config.sintetizador });
    this.busy = false;
    this.tarea = null;
    this.abort = null;
    this.python = null;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  changed() { this.save(); this.emit('update'); }

  log(tipo, texto, extra = {}) {
    this.state.diario.push({ at: this.now(), tipo, texto: String(texto).slice(0, 600), ...extra });
    this.state.diario = this.state.diario.slice(-250);
    this.changed();
  }

  setTarea(paso, detalle) {
    this.tarea = paso ? { paso, detalle: String(detalle || '').slice(0, 300), desde: this.tarea?.paso === paso ? this.tarea.desde : this.now() } : null;
    this.emit('update');
  }

  /** El agente no puede seguir hasta que pase algo (falta la página, llegó al tope…). Se anota una sola vez. */
  esperar(motivo, texto) {
    if (this.state.espera?.texto !== texto) this.log('espera', texto);
    this.state.espera = { motivo, texto, at: this.now() };
  }

  herramientas() {
    const c = this.state.config;
    const w = this.whisper();
    return {
      voz: sinteInfo(c.sintetizador),
      serie: serieInfo(c.serieai),
      whisper: w.ok ? { ok: true } : { ok: false, motivo: 'Falta Whisper (subtítulos). Instálalo desde la pantalla Directo.' },
    };
  }

  /** Lo que ve la pantalla. */
  snapshot() {
    const s = this.state;
    const now = this.now();
    return {
      ...s,
      diario: s.diario.slice(-120),
      busy: this.busy,
      tarea: this.tarea,
      herramientas: this.herramientas(),
      fondos: (() => { const f = listFondos(this.fondosDir); return { videos: f.videos.length, imagenes: f.imagenes.length, musica: f.musica.length, carpeta: this.fondosDir }; })(),
      progreso: progress({ seguidores: s.seguidores, publicaciones: s.publicaciones, metas: s.config.metas, now }),
      vistasPorDia: viewsByDay(s.publicaciones, 14, now),
      porDia: this.porDia(),
    };
  }

  porDia() {
    return Math.max(1, Math.min(this.state.config.maxDia, this.state.plan?.publicacionesPorDia || 1));
  }

  setConfig(patch = {}) {
    const c = this.state.config;
    if (patch.tipos) c.tipos = { narrado: !!(patch.tipos.narrado ?? c.tipos.narrado), serie: !!(patch.tipos.serie ?? c.tipos.serie) };
    if (patch.maxDia !== undefined) c.maxDia = Math.max(1, Math.min(6, Math.round(Number(patch.maxDia)) || 1));
    if (patch.modoSerie) c.modoSerie = patch.modoSerie === '2d' ? '2d' : '3d';
    if (patch.avisoIa !== undefined) c.avisoIa = !!patch.avisoIa;
    if (patch.metas) for (const k of ['estrellas', 'seguidores', 'minutos']) if (Number(patch.metas[k]) > 0) c.metas[k] = Math.round(Number(patch.metas[k]));
    if (patch.sintetizador !== undefined) { c.sintetizador = String(patch.sintetizador); this.voz.stop(); this.voz = new Voz({ dir: c.sintetizador }); this.state.voces = null; }
    if (patch.serieai !== undefined) { c.serieai = String(patch.serieai); this.python = null; }
    // Si cambian los tipos o el máximo por día, el plan se rehace en la próxima vuelta.
    if ((patch.tipos || patch.maxDia !== undefined) && this.state.plan) this.state.plan.rehacer = true;
    this.changed();
    return this.snapshot();
  }

  setActivo(on) {
    this.state.activo = !!on;
    if (on) this.state.espera = null;
    this.log(on ? 'info' : 'pausa', on ? 'Agente encendido: trabaja solo mientras ClipViral esté abierto.' : 'Agente en pausa.');
    if (on) setTimeout(() => this.tick(), 1500);
    return this.snapshot();
  }

  start() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 60000);
    setTimeout(() => this.tick(), 8000);
  }

  stop() {
    clearInterval(this.timer);
    this.detener();
  }

  /** Corta lo que esté haciendo (voz, SerieAI). */
  detener() {
    this.abort?.abort();
    this.voz.stop();
  }

  /** Corre un trabajo del agente (uno a la vez). */
  async trabajar(fn) {
    if (this.busy) throw new Error('El agente ya está trabajando en algo. Espera a que termine.');
    this.busy = true;
    this.abort = new AbortController();
    this.emit('update');
    try {
      return await fn();
    } finally {
      this.voz.stop(); // libera la tarjeta gráfica y deja abrir el programa del Sintetizador
      this.busy = false;
      this.abort = null;
      this.setTarea(null);
      this.changed();
    }
  }

  async tick() {
    if (!this.state.activo || this.busy) return;
    if (this.ocupado()) return this.esperar('ocupado', 'ClipViral está haciendo clips de un directo: el agente espera a que termine.');
    try {
      await this.trabajar(() => this.vuelta());
    } catch (err) {
      if (err.status === 402) this.esperar('tope', err.message);
      else if (err.status === 403) { this.state.activo = false; this.log('error', 'Solo un administrador puede usar el agente. Quedó en pausa.'); }
      else this.log('error', err.message);
    }
  }

  /** Una vuelta: hace lo más urgente y termina. */
  async vuelta() {
    const now = this.now();
    const remoto = await this.api('/agente/estado');
    this.state.remoto = remoto;
    if (!remoto.pagina) {
      return this.esperar('pagina', remoto.paginaPerdida
        ? 'La página del agente ya no aparece en tu conexión de Facebook. Vuelve a conectar Facebook en Redes marcando esa página.'
        : 'Elige la página de Facebook que va a manejar el agente.');
    }
    if (!remoto.ia) return this.esperar('ia', 'Falta la clave de Claude del servidor (Ajustes → Clave de Claude).');

    // 1) Publicar lo que ya llegó a su hora.
    const due = this.state.cola.find((v) => v.estado === 'listo' && v.publicarEn <= now && (!v.reintentoEn || v.reintentoEn <= now));
    if (due) { this.state.espera = null; return this.publicar(due); }

    // 2) Leer los números cada 3 horas.
    if (now - (this.state.statsAt || 0) > 3 * HOUR) return this.actualizarStats();

    // 3) Tope de gasto: publica lo hecho, pero no piensa ni hace videos nuevos.
    if (remoto.gastado >= remoto.tope) {
      return this.esperar('tope', `Llegó al tope de gasto de este mes (${remoto.tope} USD). Publica lo que ya tiene hecho; para seguir creando, sube el tope en Ajustes del agente.`);
    }

    // 4) Plan: la primera vez, cada semana, o antes si ya hay números y el plan se hizo sin ellos.
    const plan = this.state.plan;
    const conNumeros = this.state.publicaciones.filter((p) => p.stats?.views !== undefined && now - p.publicadoAt > DAY).length;
    if (!plan || plan.rehacer || now - plan.at > 7 * DAY || (plan.sinDatos && conNumeros >= 5 && now - plan.at > 2 * DAY)) {
      this.state.espera = null;
      return this.planear();
    }

    // 5) Hacer el próximo video si hace falta.
    const falta = this.faltaProducir(now);
    if (falta === true) { this.state.espera = null; return this.producir(); }
    if (typeof falta === 'string') return this.esperar('herramientas', falta);
    this.state.espera = null;
  }

  /** true si toca hacer un video; texto si no se puede por algo que debe arreglar el dueño; false si no hace falta. */
  faltaProducir(now) {
    const porDia = this.porDia();
    const listos = this.state.cola.filter((v) => v.estado === 'listo').length;
    if (listos >= porDia) return false;
    const hechosHoy = [...this.state.cola, ...this.state.publicaciones].filter((v) => dayKey(v.creadoAt) === dayKey(now)).length;
    if (hechosHoy >= porDia * 2 + 1) return false; // nunca más de esto al día (cuida el gasto)
    const f = this.state.fallos.produccion;
    if (f && now - f.at < Math.min(6 * HOUR, 30 * 60000 * 2 ** Math.max(0, f.n - 1))) return false;
    const tipos = this.tiposDisponibles(now);
    if (!tipos.ok.length) return tipos.motivo;
    return true;
  }

  /** Qué tipos de video se pueden hacer ahora (y si ninguno, por qué). */
  tiposDisponibles(now) {
    const c = this.state.config;
    const h = this.herramientas();
    const ok = [];
    const motivos = [];
    if (!h.voz.ok) motivos.push(h.voz.motivo);
    if (c.tipos.narrado) {
      if (!h.whisper.ok) motivos.push(h.whisper.motivo);
      else if (h.voz.ok) ok.push('narrado');
    }
    if (c.tipos.serie && h.voz.ok) {
      const ultima = [...this.state.cola, ...this.state.publicaciones].filter((v) => v.tipo === 'serie').map((v) => v.creadoAt).sort().pop() || 0;
      const fallo = this.state.fallos.serie;
      if (!h.serie.ok) motivos.push(h.serie.motivo);
      else if (now - ultima > 20 * HOUR && !(fallo && fallo.n >= 2 && now - fallo.at < 12 * HOUR)) ok.push('serie');
    }
    if (!c.tipos.narrado && !c.tipos.serie) motivos.push('No hay ningún tipo de video encendido en los ajustes del agente.');
    return { ok, motivo: motivos[0] || 'Por ahora no puede hacer ningún video.' };
  }

  async pensar(tarea, prompt, schema, effort = 'medium') {
    const r = await this.api('/agente/pensar', { tarea, system: cerebro.systemPrompt(this.state.config.tipos), prompt, schema, effort }, 'POST', 6 * 60000);
    if (this.state.remoto) { this.state.remoto.gastado = r.gastado; this.state.remoto.tope = r.tope; }
    return r;
  }

  async vocesDisponibles() {
    if (this.state.voces && this.now() - (this.state.vocesAt || 0) < DAY) return this.state.voces;
    this.setTarea('voces', 'Abriendo el Sintetizador de voz…');
    this.state.voces = await this.voz.voces();
    this.state.vocesAt = this.now();
    return this.state.voces;
  }

  statsText() {
    return cerebro.statsText({ pagina: this.state.remoto?.pagina?.name, seguidores: this.state.seguidores, publicaciones: this.state.publicaciones, now: this.now() });
  }

  async planear() {
    this.setTarea('plan', 'Revisando los números y armando el plan de la página…');
    const voces = this.herramientas().voz.ok ? await this.vocesDisponibles().catch(() => this.state.voces || {}) : {};
    this.setTarea('plan', 'Claude está armando el plan de la página…');
    const prompt = cerebro.planPrompt({ stats: this.statsText(), plan: this.state.plan, lecciones: this.state.lecciones, config: this.state.config, voces });
    const r = await this.pensar('plan', prompt, cerebro.PLAN_SCHEMA, 'high');
    const plan = cerebro.normalizePlan(r.json, this.state.config, this.now());
    plan.sinDatos = !this.state.publicaciones.some((p) => p.stats?.views !== undefined);
    const antes = this.state.plan;
    this.state.plan = plan;
    if (plan.lecciones.length) this.state.lecciones = plan.lecciones;
    this.log('plan', `Plan ${antes ? 'actualizado' : 'nuevo'}: ${plan.nicho}. ${plan.resumen}`, { costo: r.costo });
  }

  /** Hace el próximo video (idea → video) y lo deja en la cola con su hora. */
  async producir() {
    const now = this.now();
    const tipos = this.tiposDisponibles(now);
    if (!tipos.ok.length) throw new Error(tipos.motivo);
    const voces = await this.vocesDisponibles();
    if (!Object.keys(voces).length) throw new Error('El Sintetizador no tiene voces listas.');
    this.setTarea('idea', 'Claude está pensando el próximo video…');
    const hoy = { narrado: 0, serie: 0 };
    for (const v of [...this.state.cola, ...this.state.publicaciones]) if (dayKey(v.creadoAt) === dayKey(now)) hoy[v.tipo] = (hoy[v.tipo] || 0) + 1;
    const recientes = [...this.state.publicaciones, ...this.state.cola].sort((a, b) => b.creadoAt - a.creadoAt).slice(0, 25).map((p) => p.tema || p.titulo);
    const prompt = cerebro.ideaPrompt({
      stats: this.statsText(), plan: this.state.plan, lecciones: this.state.lecciones, recientes, config: this.state.config, voces,
      serie: this.state.serie, hoy: { ...hoy, serieBloqueada: !tipos.ok.includes('serie') },
    });
    const r = await this.pensar('idea', prompt, cerebro.IDEA_SCHEMA, 'medium');
    const idea = cerebro.normalizeIdea(r.json, { tiposOk: tipos.ok, voces });
    if (idea.tipo === 'narrado' && words(idea.guion) < 40) throw new Error('Claude escribió un guion demasiado corto. Se intenta de nuevo más tarde.');
    this.log('idea', `Idea (${idea.tipo === 'serie' ? 'episodio' : 'narrado'}): "${idea.titulo}". ${idea.porque}`, { costo: r.costo });

    const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    let hecho;
    try {
      hecho = idea.tipo === 'serie' ? await this.hacerEpisodio(idea, id) : await this.hacerNarrado(idea, id);
    } catch (err) {
      const k = idea.tipo === 'serie' ? 'serie' : 'produccion';
      const prev = this.state.fallos[k];
      this.state.fallos[k] = { n: (prev?.n || 0) + 1, at: this.now(), error: err.message };
      if (k === 'serie') this.state.fallos.produccion = { n: 1, at: this.now() - 25 * 60000 }; // reintenta pronto con otro video
      throw new Error(`No se pudo hacer "${idea.titulo}": ${err.message}`);
    } finally {
      fs.rmSync(path.join(this.dir, 'trabajo', id), { recursive: true, force: true });
    }
    delete this.state.fallos.produccion;
    if (idea.tipo === 'serie') delete this.state.fallos.serie;
    const item = {
      id, ...idea, ...hecho, creadoAt: this.now(), estado: 'listo',
      publicarEn: nextSlot({
        now: this.now(), horas: this.state.plan.horas, porDia: this.porDia(),
        ocupados: [...this.state.cola.map((v) => v.publicarEn), ...this.state.publicaciones.map((p) => p.publicadoAt).filter(Boolean)],
      }),
    };
    this.state.cola.push(item);
    this.log('ok', `Video listo: "${item.titulo}" (${Math.round(item.duracion)} s). Se publica el ${fmtWhen(item.publicarEn)}.`, { id });
    this.emit('aviso', { titulo: '🤖 El agente hizo un video', texto: `${item.titulo}\nSe publica el ${fmtWhen(item.publicarEn)}.` });
  }

  async hacerNarrado(idea, id) {
    const workDir = path.join(this.dir, 'trabajo', id);
    const out = path.join(this.dir, 'videos', `${id}.mp4`);
    const r = await makeNarrated({
      idea, voz: this.voz, paths: this.paths, whisper: this.whisper(), workDir, outFile: out, fondosDir: this.fondosDir,
      recientes: this.state.fondosRecientes, gpuEncode: this.gpuEncode(), onStep: (paso, detalle) => this.setTarea(paso, detalle),
    });
    if (r.fondo) this.state.fondosRecientes = [r.fondo, ...this.state.fondosRecientes.filter((f) => f !== r.fondo)].slice(0, 3);
    return { archivo: r.file, thumb: r.thumb, duracion: r.duration, voz: r.voz, emocion: r.emocion };
  }

  async pythonSerie() {
    if (this.python && fs.existsSync(this.python)) return this.python;
    this.python = await findPython(this.state.config.serieai);
    if (!this.python) throw new Error('No encontré el Python de SerieAI. Abre SerieAI una vez (instala lo que le falta) y vuelve a intentar.');
    return this.python;
  }

  async hacerEpisodio(idea, id) {
    const c = this.state.config;
    const python = await this.pythonSerie();
    await this.voz.start();
    const voces = Object.keys(this.state.voces || {});
    const ajustes = { modo: c.modoSerie, formato: 'vertical', duracion_objetivo_segundos: 55, subtitulos: true, blender_en_vivo: false, ...(voces.length ? { voces_disponibles: voces } : {}) };
    const srv = this.server();
    const env = { CLIPVIRAL_URL: srv.url, CLIPVIRAL_TOKEN: srv.token || '', ...this.voz.env() };
    const onLine = (l) => this.setTarea('serie', l);
    const signal = this.abort?.signal;
    if (!fs.existsSync(path.join(this.serieDir, 'serie.json'))) {
      this.setTarea('serie', 'Creando la serie animada del agente…');
      const s = await runSerie({ python, serieDir: c.serieai, workDir: this.serieDir, orden: 'nueva', idea: this.state.plan?.ideaSerie || idea.tema, ajustes, env, onLine, signal });
      this.state.serie = { titulo: s.titulo, personajes: s.personajes || [], imagen: s.imagen, episodios: 0, creadaAt: this.now() };
      this.log('ok', `Serie creada: "${s.titulo}" con ${(s.personajes || []).join(', ')}.`);
    }
    this.setTarea('serie', 'Haciendo el episodio (guion, voces y animación). Puede tardar horas…');
    const r = await runSerie({ python, serieDir: c.serieai, workDir: this.serieDir, orden: 'episodio', tema: idea.tema, ajustes, env, onLine, signal });
    const ffmpeg = this.paths.ffmpeg;
    const out = path.join(this.dir, 'videos', `${id}.mp4`);
    let dur = await mediaDuration(ffmpeg, r.video);
    if (dur > 89) {
      // Facebook acepta Reels de hasta 90 s: si se pasó un poco, se acelera (hasta 1,3×).
      const f = dur / 88;
      if (f > 1.3) throw new Error(`El episodio salió de ${Math.round(dur)} s y Facebook acepta hasta 90 s.`);
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', r.video, '-filter_complex', `[0:v]setpts=PTS/${f.toFixed(4)}[v];[0:a]atempo=${f.toFixed(4)}[a]`,
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { timeoutMs: 30 * 60000 });
      dur /= f;
    } else {
      fs.copyFileSync(r.video, out);
    }
    const thumb = out.replace(/\.mp4$/, '.jpg');
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (dur * 0.3).toFixed(2), '-i', out, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', thumb]).catch(() => {});
    if (this.state.serie) this.state.serie.episodios = r.numero;
    return {
      archivo: out, thumb: fs.existsSync(thumb) ? thumb : null, duracion: dur,
      titulo: `${r.serie ? `${r.serie} · ` : ''}Ep. ${r.numero}: ${r.titulo || idea.titulo}`.slice(0, 95),
      descripcion: r.descripcion || idea.descripcion,
      hashtags: r.hashtags?.length ? r.hashtags.slice(0, 8) : idea.hashtags,
    };
  }

  async publicar(item) {
    this.setTarea('publicar', `Publicando "${item.titulo}" en Facebook…`);
    if (!fs.existsSync(item.archivo)) {
      item.estado = 'error';
      item.error = 'El video ya no está en la PC.';
      return this.log('error', `No se pudo publicar "${item.titulo}": el archivo ya no existe.`);
    }
    item.estado = 'publicando';
    try {
      const auth = await this.api('/agente/token', {});
      const r = await this.uploader({
        file: item.archivo, caption: cerebro.buildCaption(item, { avisoIa: this.state.config.avisoIa }), title: item.titulo,
        token: auth.accessToken, accountId: auth.accountId, duration: item.duracion,
        onProgress: (p) => this.setTarea('publicar', `Publicando "${item.titulo}"… ${Math.round(p * 100)}%`),
      });
      this.state.cola = this.state.cola.filter((v) => v.id !== item.id);
      const pub = { ...item, estado: 'publicado', publicadoAt: this.now(), remoteId: r.id, url: r.url, stats: {}, historial: [] };
      delete pub.reintentoEn;
      delete pub.error;
      this.state.publicaciones.push(pub);
      this.log('publicado', `Publicado en Facebook: "${item.titulo}".`, { url: r.url, id: item.id });
      this.emit('aviso', { titulo: '🤖 El agente publicó', texto: item.titulo });
    } catch (err) {
      item.intentos = (item.intentos || 0) + 1;
      item.error = err.message;
      const final = item.intentos >= 3 || err.status === 400;
      item.estado = final ? 'error' : 'listo';
      if (!final) item.reintentoEn = this.now() + 30 * 60000 * item.intentos;
      this.log('error', `No se pudo publicar "${item.titulo}": ${err.message}${final ? '' : ' Se reintenta más tarde.'}`);
    }
  }

  /** Tiempo visto de un Reel (si Facebook lo da): promedio en segundos y total en minutos. */
  async watchTime(videoId, token) {
    const res = await this.fetchImpl(`https://graph.facebook.com/${FB_VERSION}/${videoId}/video_insights?metric=post_video_avg_time_watched,post_video_view_time&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const d = await res.json();
    const out = {};
    for (const m of d.data || []) {
      const v = Number(m.values?.[0]?.value);
      if (!Number.isFinite(v)) continue;
      if (m.name === 'post_video_avg_time_watched') out.avgWatch = v / 1000;
      if (m.name === 'post_video_view_time') out.viewTimeMin = v / 60000;
    }
    return out;
  }

  async actualizarStats() {
    this.setTarea('numeros', 'Leyendo los números de Facebook…');
    const now = this.now();
    this.state.statsAt = now;
    const auth = await this.api('/agente/token', {});
    const recent = this.state.publicaciones.filter((p) => p.remoteId && now - p.publicadoAt < 60 * DAY);
    if (recent.length) {
      const got = await this.fetchers.facebook(recent.map((p) => p.remoteId), auth).catch((err) => { this.log('error', `No pude leer las vistas: ${err.message}`); return {}; });
      for (const p of recent) {
        const s = got[p.remoteId];
        if (!s) continue;
        const w = await this.watchTime(p.remoteId, auth.accessToken).catch(() => null);
        p.stats = { ...p.stats, views: s.views, likes: s.likes, comments: s.comments, shares: s.shares, ...(w || {}), at: now };
        const last = p.historial[p.historial.length - 1];
        if (!last || now - last.at > 20 * HOUR) p.historial.push({ at: now, views: s.views || 0, likes: s.likes || 0 });
        else Object.assign(last, { at: now, views: s.views || 0, likes: s.likes || 0 });
        p.historial = p.historial.slice(-60);
      }
    }
    const f = await this.fetchers.facebookFollowers(auth).catch(() => null);
    if (f !== null && f !== undefined) {
      const last = this.state.seguidores[this.state.seguidores.length - 1];
      if (last && now - last.at < 20 * HOUR) Object.assign(last, { count: f }); else this.state.seguidores.push({ at: now, count: f });
      this.state.seguidores = this.state.seguidores.slice(-180);
      const meta = this.state.config.metas;
      for (const [k, label] of [['estrellas', 'Estrellas (500 seguidores)'], ['seguidores', `${meta.seguidores} seguidores`]]) {
        if (f >= meta[k] && !(this.state.logros || {})[k]) {
          this.state.logros = { ...(this.state.logros || {}), [k]: now };
          this.log('logro', `🎉 La página llegó a ${f} seguidores: ya cumple la meta de ${label}. Revisa en Facebook → Panel profesional → Monetización y solicítala tú (Facebook pide tus datos).`);
          this.emit('aviso', { titulo: '🎉 Meta de monetización', texto: `La página del agente llegó a ${f} seguidores.` });
        }
      }
    }
    this.limpiar(now);
  }

  /** Borra videos ya publicados hace más de 30 días (quedan los números y la miniatura). */
  limpiar(now) {
    for (const p of this.state.publicaciones) {
      if (p.archivo && now - p.publicadoAt > 30 * DAY && fs.existsSync(p.archivo)) { fs.rmSync(p.archivo, { force: true }); p.archivo = null; }
    }
  }

  // ---------- Acciones de la pantalla ----------

  hacerAhora() {
    return this.trabajar(async () => {
      const remoto = await this.api('/agente/estado');
      this.state.remoto = remoto;
      if (!remoto.pagina) throw new Error('Primero elige la página de Facebook del agente.');
      if (!remoto.ia) throw new Error('Falta la clave de Claude del servidor.');
      if (!this.state.plan) await this.planear();
      await this.producir();
    });
  }

  replanear() { return this.trabajar(() => this.planear()); }

  numeros() { return this.trabajar(() => this.actualizarStats()); }

  publicarYa(id) {
    const v = this.state.cola.find((x) => x.id === id);
    if (!v) throw new Error('Ese video ya no está en la cola.');
    return this.trabajar(() => this.publicar(v));
  }

  descartar(id) {
    const v = this.state.cola.find((x) => x.id === id);
    if (!v) return this.snapshot();
    this.state.cola = this.state.cola.filter((x) => x.id !== id);
    for (const f of [v.archivo, v.thumb]) if (f) fs.rmSync(f, { force: true });
    this.log('info', `Descartaste "${v.titulo}".`);
    return this.snapshot();
  }

  /** Cambia la hora de un video de la cola. */
  reprogramar(id, at) {
    const v = this.state.cola.find((x) => x.id === id);
    if (!v || !Number.isFinite(Number(at))) throw new Error('No encontré ese video.');
    v.publicarEn = Number(at);
    v.estado = 'listo';
    delete v.reintentoEn;
    this.changed();
    return this.snapshot();
  }
}

module.exports = { Agente, DEFAULT_CONFIG, detectFolder };
