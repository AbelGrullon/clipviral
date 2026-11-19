// Cola de subidas a redes: sube lo que toca (ahora o a su hora), de a uno, y reintenta si falla.
// Quién pidió cada subida queda en `origen`:
//   'manual'   → el usuario tocó Subir / Publicar ahora / Programar
//   'sola'     → publicación automática (Instagram y Facebook con "Publicar sola" encendido)
//   'aprobado' → TikTok: el usuario aprobó el clip en la pantalla de TikTok
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { LATE_MS } = require('./publicar');

const MAX_ATTEMPTS = 3;
const SERVER_NOTE = 'Se publica a su hora aunque apagues la PC';
const SENDING_NOTE = 'Enviando al servidor…';

/** Lo que cambia en la subida de la app según cómo va la publicación en el servidor. */
function fromServer(p) {
  switch (p.status) {
    case 'pendiente': return { status: 'pendiente', scheduledAt: p.scheduledAt, progress: 0, error: p.error || null, note: p.note || SERVER_NOTE };
    case 'subiendo': return { status: 'subiendo', progress: p.progress || 0, error: null, note: p.note || 'El servidor lo está publicando' };
    case 'publicado': return { status: 'publicado', progress: 1, url: p.url, remoteId: p.remoteId, publishedAt: p.publishedAt, error: null, reconnect: false, note: p.note || null };
    case 'error': return { status: 'error', progress: 0, error: p.error || 'El servidor no pudo publicarlo', reconnect: !!p.reconnect, note: null };
    case 'cancelado': return { status: 'cancelado', progress: 0 };
    default: return null;
  }
}

class UploadQueue extends EventEmitter {
  /**
   * file: dónde se guarda la cola (JSON)
   * getToken(platform): pide al servidor un token vigente
   * uploaders: { youtube, tiktok, instagram, facebook }
   * onResult(platform, ok): para estadísticas
   * relay: { put(file), remove(id) } para que Instagram descargue el video desde el servidor si hace falta
   * onLate(job): si la PC estaba apagada a la hora elegida, devuelve la nueva hora (o null para publicar ya)
   * prepare(job, onNote): antes de subir, puede dar otro archivo { file, duration, note, cleanup } (por ejemplo, la copia recortada
   *   para Instagram) o null para subir el clip tal cual. cleanup() se llama al terminar, salga bien o mal.
   * remote: publicar desde el servidor de ClipViral (en esta PC o en un VPS). La subida se manda al servidor apenas se
   *   programa y el servidor la publica a su hora, aunque la PC esté apagada. La app solo sigue su estado (sync).
   *   { enabled(job), base(), send(job, { file, duration, note }, onProgress), list(ids), cancel(id), now(id),
   *     reschedule(id, at, note) }. Las subidas que están en el servidor llevan `servidor: { id, base }`.
   */
  constructor({ file, getToken, uploaders, onResult, relay = null, onLate = null, prepare = null, remote = null }) {
    super();
    Object.assign(this, { file, getToken, uploaders, onResult, relay, onLate, prepare, remote });
    this.jobs = [];
    try { this.jobs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    // Si la app se cerró a mitad de una subida, la volvemos a intentar (las del servidor siguen ahí: sync las pone al día).
    for (const j of this.jobs) if (j.status === 'subiendo') { j.status = 'pendiente'; j.progress = 0; if (!j.servidor && j.note === SENDING_NOTE) j.note = null; }
    this.busy = false;
    this.syncing = false;
    this.timer = setInterval(() => this.tick(), 15000);
    setTimeout(() => this.tick(), 3000);
    if (remote) {
      this.syncTimer = setInterval(() => this.sync(), 30000);
      setTimeout(() => this.sync(), 4000);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.jobs.slice(-1000), null, 1));
  }

  /** Sin las que se están quitando (esperan que el servidor confirme que las canceló). */
  list() { return this.jobs.filter((j) => !j.quitar); }

  /** ¿Esta subida la publica el servidor? */
  remoteFor(job) {
    try { return !!this.remote?.enabled(job); } catch { return false; }
  }

  /**
   * Una versión anterior publicaba sola con otros ajustes (`auto: true`). Lo que quedó programado así se cancela:
   * la publicación automática de ahora se enciende de nuevo, red por red, en Clips sugeridos.
   * Devuelve cuántas se cancelaron.
   */
  cancelAuto() {
    const old = this.jobs.filter((j) => j.auto && j.status === 'pendiente');
    for (const j of old) {
      Object.assign(j, { status: 'cancelado', note: 'Cancelado: lo programó una versión anterior. Enciende "Publicar sola" en Clips sugeridos si lo quieres.' });
      delete j.auto; // si el usuario toca "Reintentar", ya es una subida que pidió él
    }
    if (old.length) { this.save(); this.emit('update', null); }
    return old.length;
  }

  add({ clip, platform, title, caption, tags, privacy, scheduledAt, shareToFeed = true, origen = 'manual', tiktok = null, sugId = null, reprogramar = false }) {
    if (this.jobs.some((j) => j.clipId === clip.id && j.platform === platform && j.status !== 'error' && j.status !== 'cancelado')) {
      return null; // ya está en la cola
    }
    const job = {
      id: crypto.randomUUID(),
      clipId: clip.id,
      file: clip.file,
      thumb: clip.thumb,
      duration: clip.duration || 0,
      platform,
      title,
      caption,
      tags: tags || [],
      privacy,
      shareToFeed,
      origen,
      sugId,
      // TikTok: lo que el usuario aprobó (privacidad, interacciones, contenido comercial y cuándo dio su OK).
      tiktok,
      // A la hora sugerida: si la PC estaba apagada, se pasa a la próxima hora buena.
      reprogramar: !!reprogramar,
      status: 'pendiente',
      progress: 0,
      attempts: 0,
      error: null,
      url: null,
      scheduledAt: scheduledAt || Date.now(),
      createdAt: Date.now(),
    };
    this.jobs.push(job);
    this.save();
    this.emit('update', job);
    setTimeout(() => this.tick(), 200);
    return job;
  }

  update(job, patch) {
    Object.assign(job, patch);
    this.save();
    this.emit('update', job);
  }

  async tick() {
    if (this.busy) return;
    const now = Date.now();
    // Las que publica el servidor se le mandan apenas se programan (sendAfter: esperar tras un corte de internet);
    // las demás, cuando llega su hora.
    const job = this.jobs
      .filter((j) => j.status === 'pendiente' && !j.servidor && !j.quitar
        && (j.scheduledAt <= now || (this.remoteFor(j) && !(j.sendAfter > now))))
      .sort((a, b) => a.scheduledAt - b.scheduledAt)[0];
    if (!job) return;
    this.busy = true;
    let prepared = null;
    let remote = false;
    try {
      if (!fs.existsSync(job.file)) {
        this.update(job, { status: 'error', error: 'El archivo del clip ya no existe' });
        return;
      }
      // La PC estaba apagada a la hora sugerida: mejor la próxima hora buena que publicar a deshora.
      if (job.reprogramar && !job.attempts && Date.now() - job.scheduledAt > LATE_MS && this.onLate) {
        const next = this.onLate(job);
        if (next && next > Date.now()) {
          const hora = new Date(next).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
          this.update(job, { scheduledAt: next, note: `La PC estaba apagada a la hora elegida: pasó a ${hora}` });
          return;
        }
      }
      remote = this.remoteFor(job) && !(job.sendAfter > Date.now());
      this.update(job, { status: 'subiendo', progress: 0, attempts: job.attempts + 1, error: null, ...(remote ? { note: SENDING_NOTE } : {}) });
      // Por ejemplo, la copia recortada para Instagram.
      prepared = this.prepare ? await this.prepare(job, (note) => this.update(job, { note })) : null;
      if (remote) {
        // Al servidor: el video y los textos. Desde ahí, el servidor la publica a su hora (la PC ya se puede apagar).
        let sent = 0;
        const post = await this.remote.send(job, { file: prepared?.file || job.file, duration: prepared?.duration ?? job.duration, note: prepared?.note || null }, (p) => {
          if (p - sent >= 0.02 || p === 1) { sent = p; job.progress = p; this.emit('update', job); }
        });
        this.update(job, { servidor: { id: post.id, base: this.remote.base() }, attempts: 0, sendAfter: null, ...(fromServer(post) || { status: 'pendiente', progress: 0, note: SERVER_NOTE }) });
        setTimeout(() => this.sync(), 3000);
        return;
      }
      if (prepared?.note) this.update(job, { note: prepared.note });
      const auth = await this.getToken(job.platform);
      const upload = this.uploaders[job.platform];
      let last = 0;
      const result = await upload({
        file: prepared?.file || job.file,
        title: job.title,
        description: job.caption,
        caption: job.caption,
        tags: job.tags,
        privacy: job.privacy,
        shareToFeed: job.shareToFeed,
        duration: prepared?.duration ?? job.duration,
        tiktok: job.tiktok,
        relay: this.relay,
        token: auth.accessToken,
        accountId: auth.accountId,
        extra: auth.extra || null,
        onProgress: (p, note) => {
          if (note && note !== job.note) { job.note = note; last = p; job.progress = p; this.emit('update', job); return; }
          if (p - last >= 0.02 || p === 1) { last = p; job.progress = p; this.emit('update', job); }
        },
      });
      const note = result.pending ? 'TikTok sigue procesando el video: aparecerá en tu perfil en unos minutos'
        : result.privacy === 'SELF_ONLY' ? 'Publicado como "Solo yo"' : prepared?.note || null;
      this.update(job, { status: 'publicado', progress: 1, url: result.url, remoteId: result.id, accountId: auth.accountId || null, publishedAt: Date.now(), note });
      this.onResult?.(job.platform, true);
      this.emit('done', job);
    } catch (err) {
      // Mandarla al servidor: además, si la cuenta no tiene esa red conectada (404) o el plan venció (402).
      const giveUp = err.reconnect || job.attempts >= MAX_ATTEMPTS || err.status === 400 || err.status === 403
        || (remote && [402, 404, 413].includes(err.status));
      const retryAt = Date.now() + 2 ** job.attempts * 60000;
      this.update(job, {
        status: giveUp ? 'error' : 'pendiente',
        error: String(err.message || err).slice(0, 300),
        reconnect: !!err.reconnect,
        progress: 0,
        note: job.note === SENDING_NOTE ? null : job.note,
        // Si falló al mandarla al servidor, la hora de publicar no cambia: solo se espera para volver a mandarla.
        ...(remote ? { sendAfter: giveUp ? null : retryAt } : { scheduledAt: giveUp ? job.scheduledAt : retryAt }),
      });
      if (giveUp) { this.onResult?.(job.platform, false); this.emit('failed', job); }
    } finally {
      try { prepared?.cleanup?.(); } catch {}
      this.busy = false;
      setTimeout(() => this.tick(), 500);
    }
  }

  /** Vuelve a intentar una que falló o se canceló. Si estaba en el servidor, se le manda de nuevo (el video no se repite si sigue ahí). */
  retry(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (job && ['error', 'cancelado'].includes(job.status)) {
      this.update(job, { status: 'pendiente', attempts: 0, error: null, reconnect: false, scheduledAt: Date.now(), servidor: null, sendAfter: null, note: null });
    }
    setTimeout(() => this.tick(), 200);
  }

  /** Cancela una programada. Si está en el servidor, primero se cancela allá (si no hay conexión, avisa y no se cancela). */
  async cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'pendiente') return job || null;
    if (job.servidor) {
      this.apply(job, await this.remote.cancel(job.servidor.id));
      return job;
    }
    this.update(job, { status: 'cancelado' });
    return job;
  }

  /** Cancela las subidas pendientes que cumplen la condición (por ejemplo, las de un clip descartado). Devuelve cuántas. */
  cancelWhere(pred) {
    const list = this.jobs.filter((j) => j.status === 'pendiente' && !j.quitar && pred(j));
    // Las del servidor se cancelan allá en la próxima vuelta de sync (se reintenta hasta que conteste).
    for (const j of list) Object.assign(j, { status: 'cancelado' }, j.servidor ? { servidorCancelar: true } : {});
    if (list.length) { this.save(); this.emit('update', null); }
    if (list.some((j) => j.servidor)) setTimeout(() => this.sync(), 200);
    return list.length;
  }

  /** Quita de la cola las pendientes que cumplen la condición (al apagar "Publicar sola"). Devuelve cuántas. */
  removeWhere(pred) {
    const list = this.jobs.filter((j) => j.status === 'pendiente' && !j.quitar && pred(j));
    // Las del servidor se esconden y se quitan cuando el servidor confirma que las canceló.
    for (const j of list) if (j.servidor) Object.assign(j, { servidorCancelar: true, quitar: true });
    this.jobs = this.jobs.filter((j) => !(list.includes(j) && !j.servidor));
    if (list.length) { this.save(); this.emit('update', null); }
    if (list.some((j) => j.servidor)) setTimeout(() => this.sync(), 200);
    return list.length;
  }

  /** Una programada se publica ya. */
  async publishNow(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status !== 'pendiente') return null;
    if (job.servidor) {
      this.apply(job, await this.remote.now(job.servidor.id));
      setTimeout(() => this.sync(), 3000);
      return job;
    }
    this.update(job, { scheduledAt: Date.now(), reprogramar: false });
    setTimeout(() => this.tick(), 200);
    return job;
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.servidorCancelar || !['publicado', 'cancelado', 'error'].includes(j.status));
    this.save();
    this.emit('update', null);
  }

  /**
   * Al cambiar de servidor (Ajustes): lo que estaba programado en el de ahora se cancela allá y queda para mandarse al
   * nuevo. Lo que ya se está publicando sigue donde está. Devuelve { moved, kept }.
   */
  async detachFromServer() {
    const base = this.remote?.base();
    let moved = 0;
    let kept = 0;
    for (const j of this.jobs.filter((x) => x.servidor && x.servidor.base === base && x.status === 'pendiente' && !x.quitar)) {
      try {
        const post = await this.remote.cancel(j.servidor.id);
        if (post.status !== 'cancelado') { this.apply(j, post); kept++; continue; }
      } catch (err) {
        if (err.status !== 404) { kept++; continue; } // sin conexión o ya se está publicando
      }
      this.update(j, { servidor: null, servidorCancelar: null, sendAfter: null, attempts: 0, progress: 0, note: null, error: null, otroServidor: null });
      moved++;
    }
    return { moved, kept };
  }

  /** Pone al día una subida con lo que dice el servidor. Avisa (done / failed) cuando termina. */
  apply(job, post) {
    const patch = post && fromServer(post);
    if (!patch) return;
    const changed = Object.entries(patch).some(([k, v]) => (job[k] ?? null) !== (v ?? null));
    if (!changed) return;
    const before = job.status;
    this.update(job, patch);
    if (before !== 'publicado' && job.status === 'publicado') this.emit('done', job);
    if (before !== 'error' && job.status === 'error') this.emit('failed', job);
  }

  /** Automática cuya hora pasó con el servidor apagado: la próxima hora buena (como en la PC), o ya. */
  async late(job) {
    const next = this.onLate?.(job);
    if (next && next > Date.now()) {
      const hora = new Date(next).toLocaleString('es', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
      this.apply(job, await this.remote.reschedule(job.servidor.id, next, `El servidor estaba apagado a la hora elegida: pasó a ${hora}`));
    } else {
      this.apply(job, await this.remote.now(job.servidor.id));
    }
  }

  /**
   * Pregunta al servidor cómo van las que tiene (cada 30 s; cada 5 s si alguna está por salir).
   * También termina de cancelar las que se cancelaron sin conexión.
   */
  async sync() {
    if (!this.remote || this.syncing) return;
    const base = this.remote.base();
    const ours = this.jobs.filter((j) => j.servidor);
    if (!ours.length) return;
    this.syncing = true;
    let soon = false;
    try {
      // Programadas en otro servidor (se cambió en Ajustes): no se pueden seguir desde aquí.
      for (const j of ours) {
        if (j.servidor.base !== base && j.status === 'pendiente' && !j.otroServidor) this.update(j, { otroServidor: true, note: `Está programada en otro servidor (${j.servidor.base})` });
      }
      for (const j of ours.filter((x) => x.servidorCancelar && x.servidor.base === base)) {
        try {
          const post = await this.remote.cancel(j.servidor.id);
          delete j.servidorCancelar;
          if (j.quitar && post.status === 'cancelado') { this.jobs = this.jobs.filter((x) => x !== j); this.save(); this.emit('update', null); continue; }
          delete j.quitar;
          this.apply(j, post);
          this.save();
        } catch (err) {
          if (err.status === 404) { // el servidor ya no la tiene: queda cancelada
            delete j.servidorCancelar;
            if (j.quitar) this.jobs = this.jobs.filter((x) => x !== j);
            this.save(); this.emit('update', null);
          } else if (err.status === 409) { // ya se estaba publicando: se sigue su estado real
            delete j.servidorCancelar; delete j.quitar;
            this.update(j, { status: 'subiendo', note: 'Ya se estaba publicando: no se pudo cancelar' });
          }
          // Sin conexión: se intenta en la próxima vuelta.
        }
      }
      const open = this.jobs.filter((j) => j.servidor && j.servidor.base === base && !j.servidorCancelar && ['pendiente', 'subiendo'].includes(j.status));
      if (open.length) {
        const { posts = [] } = await this.remote.list(open.map((j) => j.servidor.id));
        const byId = new Map(posts.map((p) => [p.id, p]));
        for (const j of open) {
          const post = byId.get(j.servidor.id);
          if (!post) {
            this.update(j, { status: 'error', progress: 0, error: 'El servidor ya no tiene esta publicación. Toca Reintentar para mandarla otra vez.' });
            this.emit('failed', j);
            continue;
          }
          if (post.status === 'tarde') { await this.late(j).catch(() => {}); continue; }
          this.apply(j, post);
        }
        soon = open.some((j) => j.status === 'subiendo' || (j.status === 'pendiente' && j.scheduledAt <= Date.now() + 60000));
      }
    } catch {
      // Sin conexión con el servidor: se pregunta en la próxima vuelta.
    } finally {
      this.syncing = false;
    }
    if (soon && !this.fastSync) this.fastSync = setTimeout(() => { this.fastSync = null; this.sync(); }, 5000);
  }

  stop() { clearInterval(this.timer); clearInterval(this.syncTimer); clearTimeout(this.fastSync); }
}

module.exports = { UploadQueue, SERVER_NOTE };
