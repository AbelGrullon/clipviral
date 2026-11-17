// Piloto automático: vigila canales y temas de YouTube y elige qué clipear.
// Usa yt-dlp (no gasta cupo de la API de YouTube): cada revisión de un canal o tema tarda 2-5 segundos.
//
// Cada video encontrado pasa por estos estados:
//   en-cola     → se va a procesar solo (canal con permiso, o el usuario tocó "Clipear")
//   sugerencia  → se muestra, pero espera a que el usuario decida (no hay permiso del creador)
//   procesando  → la app lo está clipeando
//   listo / error / ignorado
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const HOUR = 3600000;
// Búsqueda de YouTube: subidos HOY, ordenados por vistas, solo videos.
const SEARCH_TODAY_BY_VIEWS = 'CAMSBAgCEAE%3D';

/** Convierte lo que escriba el usuario en la dirección base del canal. */
function channelUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^@[\w.-]+$/.test(s)) return `https://www.youtube.com/${s}`;
  if (/^[\w.-]{3,}$/.test(s)) return `https://www.youtube.com/@${s}`;
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); } catch { return null; }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const m = /^\/(@[\w.-]+|channel\/UC[\w-]{20,}|c\/[^/]+|user\/[^/]+)/.exec(u.pathname);
  return m ? `https://www.youtube.com/${m[1]}` : null;
}

const searchUrl = (topic) => `https://www.youtube.com/results?search_query=${encodeURIComponent(String(topic).trim())}&sp=${SEARCH_TODAY_BY_VIEWS}`;

/** Edad en horas y vistas por hora. Sin fecha (búsqueda de "hoy") se asume medio día. */
function velocity(entry, now = Date.now(), { assumeAgeHours = 12 } = {}) {
  const ageHours = entry.timestamp ? Math.max(1, (now - entry.timestamp * 1000) / HOUR) : assumeAgeHours;
  const views = Number(entry.view_count) || 0;
  return { ageHours, views, viewsPerHour: Math.round(views / ageHours) };
}

/**
 * Filtra lo que devuelve yt-dlp y deja solo videos nuevos que valga la pena revisar.
 * opts: seen (ids ya vistos), maxAgeHours, minDuration, maxDuration (segundos), minViewsPerHour, now
 */
function pickVideos(entries, { seen = {}, maxAgeHours = 48, minDuration = 90, maxDuration = 3 * 3600, minViewsPerHour = 0, now = Date.now(), assumeAgeHours } = {}) {
  const out = [];
  for (const e of entries || []) {
    if (!e?.id || seen[e.id]) continue;
    if (e.live_status === 'is_live' || e.live_status === 'is_upcoming') continue; // los directos se revisan aparte
    const dur = Number(e.duration) || 0;
    if (dur && (dur < minDuration || dur > maxDuration)) continue;
    const v = velocity(e, now, { assumeAgeHours });
    if (v.ageHours > maxAgeHours) continue;
    if (v.viewsPerHour < minViewsPerHour) continue;
    out.push({ id: e.id, title: e.title || 'Video', channel: e.channel || e.uploader || '', duration: dur, ...v });
  }
  return out.sort((a, b) => b.viewsPerHour - a.viewsPerHour);
}

/** Orden de la cola: primero los directos (se pierden si se espera), después los que suben más rápido. */
function nextInQueue(found) {
  return found
    .filter((c) => c.status === 'en-cola')
    .sort((a, b) => (b.kind === 'live') - (a.kind === 'live') || (b.manual === true) - (a.manual === true) || b.viewsPerHour - a.viewsPerHour)[0] || null;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

class Vigilante extends EventEmitter {
  /**
   * file: dónde se guarda el estado (JSON)
   * ytdlp(args): corre yt-dlp y devuelve el JSON (se cambia en las pruebas)
   * getConfig(): ajustes del piloto
   * isBusy(): true si ya hay un video clipeándose
   * rank(videos, temas): opcional, la IA da una nota de 1 a 10 a cada video encontrado por tema
   */
  constructor({ file, ytdlp, getConfig, isBusy, rank, now = () => Date.now() }) {
    super();
    Object.assign(this, { file, ytdlp, getConfig, isBusy, rank, now });
    this.state = { seen: {}, found: [], history: [], lastCheck: null, daily: {} };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
    // Si la app se cerró mientras clipeaba, ese video vuelve a la cola.
    for (const c of this.state.found) if (c.status === 'procesando') c.status = 'en-cola';
    this.checking = false;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const cutoff = this.now() - 30 * 86400000;
    for (const [id, at] of Object.entries(this.state.seen)) if (at < cutoff) delete this.state.seen[id];
    this.state.found = this.state.found.filter((c) => c.foundAt > cutoff || ['en-cola', 'procesando'].includes(c.status)).slice(-300);
    this.state.history = this.state.history.slice(-200);
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1));
  }

  log(text, kind = 'info') {
    const item = { at: this.now(), text, kind };
    this.state.history.push(item);
    this.emit('log', item);
  }

  snapshot() {
    const cfg = this.getConfig();
    return {
      ...this.state,
      checking: this.checking,
      todayCount: this.state.daily[today(this.now())] || 0,
      nextCheck: this.state.lastCheck ? this.state.lastCheck + (cfg.revisarCadaMin || 20) * 60000 : null,
    };
  }

  #add(cand, { auto }) {
    this.state.seen[cand.id] = this.now();
    const item = { ...cand, url: `https://www.youtube.com/watch?v=${cand.id}`, foundAt: this.now(), status: auto ? 'en-cola' : 'sugerencia', clips: 0 };
    this.state.found.push(item);
    return item;
  }

  /** ¿Este canal tiene permiso del creador? (los temas traen videos de cualquier canal) */
  #allowed(channelName, cfg) {
    if (!cfg.soloConPermiso) return true;
    const n = String(channelName || '').toLowerCase();
    return (cfg.canales || []).some((c) => c.permiso && (c.nombre || '').toLowerCase() === n);
  }

  /** Revisa todos los canales y temas. Devuelve cuántos videos nuevos encontró. */
  async check({ manual = false } = {}) {
    const cfg = this.getConfig();
    if ((!cfg.activo && !manual) || this.checking) return 0;
    this.checking = true;
    this.emit('update');
    let added = 0;
    try {
      for (const ch of cfg.canales || []) {
        const auto = !cfg.soloConPermiso || !!ch.permiso;
        if (ch.directos !== false) {
          try {
            const live = await this.ytdlp(['-J', '--no-warnings', '--skip-download', '--no-playlist', `${ch.url}/live`]);
            if (live?.is_live && live.id && !this.state.seen[live.id]) {
              this.#add({ id: live.id, title: live.title || 'Directo', channel: ch.nombre || live.channel, kind: 'live', views: Number(live.concurrent_view_count) || 0, viewsPerHour: 0, source: { type: 'canal', name: ch.nombre } }, { auto });
              this.log(`🔴 ${ch.nombre} está en directo: ${live.title}`, 'ok');
              added += 1;
            }
          } catch (err) {
            if (!/not currently live|does not have a live|no live/i.test(err.message)) this.log(`No pude revisar el directo de ${ch.nombre}: ${short(err)}`, 'warn');
          }
        }
        if (ch.videos !== false) {
          for (const tab of ['videos', 'streams']) {
            try {
              const list = await this.ytdlp(['-J', '--flat-playlist', '--playlist-end', '6', '--extractor-args', 'youtubetab:approximate_date', `${ch.url}/${tab}`]);
              const vids = pickVideos(list?.entries, { seen: this.state.seen, maxAgeHours: cfg.edadMaxHoras || 48, maxDuration: (cfg.duracionMaxMin || 180) * 60, now: this.now() });
              for (const v of vids) {
                this.#add({ ...v, channel: ch.nombre || v.channel, kind: 'video', source: { type: 'canal', name: ch.nombre } }, { auto });
                this.log(`🆕 ${ch.nombre}: ${v.title}`, 'ok');
                added += 1;
              }
            } catch (err) {
              if (!/does not have a (streams|videos) tab/i.test(err.message)) this.log(`No pude revisar ${ch.nombre}: ${short(err)}`, 'warn');
            }
          }
        }
      }

      const temas = (cfg.temas || []).map((t) => t.texto).filter(Boolean);
      let fromTopics = [];
      for (const tema of temas) {
        try {
          const list = await this.ytdlp(['-J', '--flat-playlist', '--playlist-end', '10', searchUrl(tema)]);
          const vids = pickVideos(list?.entries, {
            seen: this.state.seen, maxAgeHours: 48, maxDuration: (cfg.duracionMaxMin || 180) * 60,
            minViewsPerHour: Math.round((cfg.minVistasTema || 20000) / 12), now: this.now(), assumeAgeHours: 12,
          });
          fromTopics.push(...vids.slice(0, 4).map((v) => ({ ...v, kind: 'video', source: { type: 'tema', name: tema } })));
        } catch (err) {
          this.log(`No pude buscar "${tema}": ${short(err)}`, 'warn');
        }
      }
      fromTopics = fromTopics.filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
      // La IA descarta los que no tienen que ver con tus temas o no tienen momentos para clips.
      if (fromTopics.length && this.rank && cfg.usarIa !== false) {
        try {
          const notes = await this.rank(fromTopics, temas);
          fromTopics = fromTopics.map((v) => ({ ...v, ai: notes[v.id] || null }))
            .filter((v) => {
              if (!v.ai || v.ai.score >= 6) return true;
              this.state.seen[v.id] = this.now(); // no volver a preguntar por él
              return false;
            });
        } catch (err) {
          this.log(`La IA no pudo revisar los temas (${short(err)}). Los muestro igual.`, 'warn');
        }
      }
      for (const v of fromTopics) {
        const auto = this.#allowed(v.channel, cfg);
        this.#add(v, { auto });
        this.log(`${auto ? '🔥' : '💡'} "${v.source.name}": ${v.title} (${v.channel}, ${fmtViews(v.views)} vistas hoy)`, auto ? 'ok' : 'info');
        added += 1;
      }
      this.state.lastCheck = this.now();
      if (!added && manual) this.log('Revisé todo: no hay nada nuevo por ahora.');
    } finally {
      this.checking = false;
      this.save();
      this.emit('update');
    }
    this.next();
    return added;
  }

  /** Si no hay nada clipeándose, manda el siguiente video de la cola. */
  next() {
    const cfg = this.getConfig();
    if (this.isBusy()) return null;
    if (this.pausedUntil && this.now() < this.pausedUntil) return null;
    const cand = nextInQueue(this.state.found);
    if (!cand) return null;
    const day = today(this.now());
    const used = this.state.daily[day] || 0;
    if (cand.kind === 'video' && !cand.manual && used >= (cfg.maxVideosDia || 6)) {
      if (!this.warnedDay || this.warnedDay !== day) {
        this.warnedDay = day;
        this.log(`Ya se clipearon ${used} videos hoy (tu límite). Los demás esperan a mañana.`, 'warn');
        this.save();
      }
      return null;
    }
    if ((!cfg.activo && !cand.manual)) return null;
    cand.status = 'procesando';
    cand.startedAt = this.now();
    if (cand.kind === 'video') this.state.daily = { [day]: used + 1 };
    this.log(`▶️ Clipeando: ${cand.title}`);
    this.save();
    this.emit('update');
    this.emit('process', cand);
    return cand;
  }

  /** La sesión de ese video terminó (o falló al empezar). */
  finished(id, { clips = 0, error = null } = {}) {
    const c = this.state.found.find((x) => x.id === id);
    if (!c) return;
    c.status = error ? 'error' : 'listo';
    c.clips = clips;
    c.error = error;
    c.endedAt = this.now();
    this.log(error ? `No se pudo clipear "${c.title}": ${error}` : `✅ "${c.title}": ${clips} clip${clips === 1 ? '' : 's'}`, error ? 'warn' : 'ok');
    this.save();
    this.emit('update');
    setTimeout(() => this.next(), 1500);
  }

  /**
   * No se pudo empezar por algo que no es culpa del video (falta una herramienta, venció el plan):
   * el video vuelve a la cola y el piloto espera un rato antes de intentar otra vez.
   */
  pause(id, reason, minutes = 30) {
    const c = this.state.found.find((x) => x.id === id);
    if (c) { c.status = 'en-cola'; if (c.kind === 'video' && !c.manual) { const day = today(this.now()); this.state.daily[day] = Math.max(0, (this.state.daily[day] || 1) - 1); } }
    this.pausedUntil = this.now() + minutes * 60000;
    this.log(`⏸️ Piloto en pausa ${minutes} min: ${reason}`, 'warn');
    this.save();
    this.emit('update');
  }

  /** El usuario decide sobre un video: 'clipear' (va primero en la cola) o 'ignorar'. */
  decide(id, action) {
    const c = this.state.found.find((x) => x.id === id);
    if (!c) return null;
    if (action === 'clipear' && ['sugerencia', 'error', 'ignorado'].includes(c.status)) Object.assign(c, { status: 'en-cola', manual: true, error: null });
    if (action === 'ignorar' && ['sugerencia', 'en-cola', 'error'].includes(c.status)) c.status = 'ignorado';
    this.save();
    this.emit('update');
    if (action === 'clipear') setTimeout(() => this.next(), 200);
    return c;
  }

  /** Agrega un video a mano (por enlace) a la cola del piloto. */
  addManual({ id, title, channel }) {
    if (this.state.found.some((c) => c.id === id && ['en-cola', 'procesando'].includes(c.status))) return null;
    const item = this.#add({ id, title: title || 'Video', channel: channel || '', kind: 'video', views: 0, viewsPerHour: 0, source: { type: 'manual', name: 'A mano' } }, { auto: true });
    item.manual = true;
    this.save();
    this.emit('update');
    setTimeout(() => this.next(), 200);
    return item;
  }

  clearDone() {
    this.state.found = this.state.found.filter((c) => !['listo', 'ignorado', 'error'].includes(c.status));
    this.save();
    this.emit('update');
  }
}

const short = (err) => String(err?.message || err).split('\n').filter(Boolean).pop().replace(/^.*ERROR:\s*/, '').slice(0, 160);
const fmtViews = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(n));

module.exports = { Vigilante, channelUrl, searchUrl, pickVideos, velocity, nextInQueue };
