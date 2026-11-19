// Recorte para una red: cuando un clip dura más de lo que acepta Instagram (~40 s por la API) o Facebook (90 s),
// Claude mira el clip (lo que se dice, el volumen de cada segundo y unas fotos) y deja solo lo más interesante,
// con cortes saltados. El clip original no se toca: se sube una copia recortada y las demás redes lo reciben entero.
// Sin Claude (modo Local, sin internet o si falla) se sube el principio del clip, como antes.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');
const { igTrimArgs } = require('./publicar');

const LIMITES = {
  instagram: { max: 40, objetivo: 39 },
  facebook: { max: 90, objetivo: 88 },
};
const NOMBRE = { instagram: 'Instagram', facebook: 'Facebook' };
const round1 = (x) => Math.round(x * 10) / 10;
const sum = (parts) => parts.reduce((a, p) => a + (p.e - p.s), 0);

/**
 * ¿A cuántos segundos hay que dejar el clip para esta red? null si no hace falta.
 * redes: los ajustes de Redes (en Instagram se puede apagar con "Recortar para Instagram"; Facebook siempre, porque lo rechaza).
 */
function trimTarget(job, redes = {}) {
  const lim = LIMITES[job?.platform];
  if (!lim || !(Number(job.duration) > lim.max)) return null;
  if (job.platform === 'instagram' && redes?.instagram?.recortar === false) return null;
  return lim.objetivo;
}

/** Palabras → frases con su segundo de inicio y fin (para que Claude corte en las pausas). */
function phrases(words, { gap = 0.7, maxWords = 14 } = {}) {
  const out = [];
  let cur = null;
  for (const w of words || []) {
    if (!cur || w.s - cur.e > gap || cur.n >= maxWords || /[.!?…]$/.test(cur.texto)) {
      cur = { s: w.s, e: w.e, texto: w.w, n: 1 };
      out.push(cur);
    } else {
      cur.e = w.e;
      cur.texto += ` ${w.w}`;
      cur.n += 1;
    }
  }
  return out.map((p) => ({ s: round1(p.s), e: round1(p.e), texto: p.texto }));
}

/** Volumen de cada segundo (en dB) → un dígito por segundo: 9 = lo más fuerte del clip, 0 = silencio. */
function volumeDigits(loudness) {
  const db = (loudness || []).filter(Number.isFinite);
  if (!db.length) return '';
  const top = Math.max(...db);
  return db.map((v) => Math.max(0, Math.min(9, Math.round(((v - (top - 40)) / 40) * 9)))).join('');
}

/**
 * Lo que dijo Claude → partes limpias { parts: [{s, e}], total } o null si no sirve.
 * No corta a mitad de palabra, junta las partes que casi se tocan, quita las muy cortas
 * y, si se pasa del tiempo, acorta desde el final.
 */
function cleanPlan(partes, { words = [], duration, target }) {
  let ps = (Array.isArray(partes) ? partes : [])
    .map((p) => ({ s: Number(p?.inicio ?? p?.s), e: Number(p?.fin ?? p?.e) }))
    .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e))
    .map((p) => ({ s: Math.max(0, p.s), e: Math.min(duration, p.e) }))
    .filter((p) => p.e - p.s > 0.2)
    .sort((a, b) => a.s - b.s);
  for (const p of ps) {
    const ws = words.find((w) => w.s < p.s && p.s < w.e);
    if (ws) p.s = ws.s;
    const we = words.find((w) => w.s < p.e && p.e < w.e);
    if (we) p.e = we.e;
    // Un respiro para no comerse el comienzo ni el final de la voz.
    p.s = Math.max(0, p.s - 0.06);
    p.e = Math.min(duration, p.e + 0.12);
  }
  const merged = [];
  for (const p of ps) {
    const last = merged.at(-1);
    if (last && p.s - last.e < 0.3) last.e = Math.max(last.e, p.e);
    else merged.push({ ...p });
  }
  ps = merged.filter((p) => p.e - p.s >= 1);
  // Más largo de lo que acepta la red: se acorta el final (sin dejar una palabra por la mitad).
  let total = sum(ps);
  while (ps.length && total > target + 1e-6) {
    const last = ps.at(-1);
    let end = last.e - (total - target);
    const inside = words.find((w) => w.s < end && end < w.e);
    if (inside) end = inside.s - 0.02;
    if (end - last.s < 1) ps.pop();
    else last.e = end;
    total = sum(ps);
  }
  if (!ps.length || total < 3) return null;
  return { parts: ps.map((p) => ({ s: Number(p.s.toFixed(3)), e: Number(p.e.toFixed(3)) })), total: Number(total.toFixed(2)) };
}

/** FFmpeg: une las partes elegidas (con un fundido cortito de sonido en cada corte para que no haga "clic"). */
function cutFilter(parts, { audio = true } = {}) {
  const f = [];
  parts.forEach((p, i) => {
    const s = p.s.toFixed(3);
    const e = p.e.toFixed(3);
    const len = p.e - p.s;
    f.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    if (audio) {
      const out = i === parts.length - 1 ? Math.min(0.6, len / 3) : 0.04;
      f.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st=${(len - out).toFixed(3)}:d=${out.toFixed(3)}[a${i}]`);
    }
  });
  const ins = parts.map((_, i) => (audio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  f.push(`${ins}concat=n=${parts.length}:v=1:a=${audio ? 1 : 0}${audio ? '[v][a]' : '[v]'}`);
  return f.join(';');
}

function cutArgs(input, output, parts, { gpu = false, audio = true } = {}) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-filter_complex', cutFilter(parts, { audio }), '-map', '[v]', ...(audio ? ['-map', '[a]'] : []),
    ...(gpu ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', '23', '-b:v', '0'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']),
    '-pix_fmt', 'yuv420p', ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []), '-movflags', '+faststart', output];
}

/** ¿El clip tiene sonido? (FFmpeg sin salida termina con error, pero antes cuenta qué trae el archivo). */
async function hasAudio(ffmpeg, file) {
  const info = await run(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 30000 }).then((r) => r.err, (err) => String(err.err || err.message));
  return /Stream #\d+:\d+.*Audio:/.test(info);
}

/** Unas 20 fotos chiquitas del clip, repartidas, para que Claude vea lo que pasa (sirve mucho en clips sin voz). */
async function frames(ffmpeg, file, duration, dir) {
  const step = Math.max(2, duration / 20);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', `fps=1/${step.toFixed(3)},scale=288:-2`, '-q:v', '7',
    '-frames:v', '24', path.join(dir, 'foto_%03d.jpg')], { timeoutMs: 3 * 60000 });
  return fs.readdirSync(dir).filter((f) => /^foto_\d+\.jpg$/.test(f)).sort()
    .map((f, i) => ({ t: round1(i * step), data: fs.readFileSync(path.join(dir, f)).toString('base64') }))
    .filter((f) => f.t < duration);
}

/** Qué partes dejar: pregunta a Claude (una vez por clip y largo; se guarda para los reintentos). */
async function planFor(job, target, deps, work) {
  const { ffmpeg, transcribe, ask, onNote = () => {}, cache } = deps;
  const st = fs.statSync(job.file);
  const key = `${job.file}|${st.mtimeMs}`;
  if (cache?.has(`${key}|${target}`)) return cache.get(`${key}|${target}`);
  onNote(`🧠 Claude está viendo el clip para dejar lo mejor en ${target} s para ${NOMBRE[job.platform]}…`);
  let tx = cache?.get(`${key}|texto`);
  if (!tx) {
    tx = await transcribe(job.file, work).catch(() => null);
    if (tx) cache?.set(`${key}|texto`, tx);
  }
  const duration = Number(job.duration) || tx?.duration || 0;
  const fotos = await frames(ffmpeg, job.file, duration, work).catch(() => []);
  const r = await ask({
    red: job.platform, titulo: job.title || '', duracion: duration, maximo: target,
    frases: phrases(tx?.words), volumen: volumeDigits(tx?.loudness), fotos,
  });
  const plan = cleanPlan(r?.partes, { words: tx?.words || [], duration, target });
  if (!plan) throw new Error('Claude no devolvió partes que sirvan');
  plan.resumen = String(r?.resumen || '').trim().slice(0, 140);
  cache?.set(`${key}|${target}`, plan);
  return plan;
}

/**
 * Hace la copia recortada para la red. deps: { ffmpeg, transcribe(file, dir), ask(body), gpu, tmpDir, onNote, cache }.
 * Devuelve { file, duration, note, cleanup } (lo que espera la cola de subidas).
 */
async function smartTrim(job, target, deps) {
  const { ffmpeg, gpu = false, tmpDir, onNote = () => {} } = deps;
  const red = NOMBRE[job.platform] || job.platform;
  const out = path.join(tmpDir, `clipviral-${job.platform}-${String(job.id).replace(/[^\w-]/g, '_')}.mp4`);
  const work = fs.mkdtempSync(path.join(tmpDir, 'clipviral-recorte-'));
  const cleanup = () => fs.rmSync(out, { force: true });
  try {
    let motivo = '';
    let plan = null;
    try {
      plan = await planFor(job, target, deps, work);
    } catch (err) {
      motivo = String(err.message || err).slice(0, 120);
    }
    if (plan) {
      onNote(`✂️ Armando el video de ${Math.round(plan.total)} s para ${red}…`);
      const audio = await hasAudio(ffmpeg, job.file);
      const encode = (useGpu) => run(ffmpeg, cutArgs(job.file, out, plan.parts, { gpu: useGpu, audio }), { timeoutMs: 15 * 60000 });
      try {
        // Si la tarjeta de video falla, se hace con el procesador.
        await encode(gpu).catch((err) => (gpu ? encode(false) : Promise.reject(err)));
        return {
          file: out,
          duration: plan.total,
          note: `✂️ Claude dejó lo mejor en ${Math.round(plan.total)} s para ${red}${plan.resumen ? `: ${plan.resumen}` : ''}`,
          cleanup,
          parts: plan.parts,
        };
      } catch {
        motivo = 'no se pudo armar el video con los cortes';
      }
    }
    // Sin Claude: el principio del clip, como antes.
    await run(ffmpeg, igTrimArgs(job.file, out, target), { timeoutMs: 5 * 60000 });
    return { file: out, duration: target, note: `Recortado a los primeros ${target} s para ${red}${motivo ? ` (${motivo})` : ''}`, cleanup };
  } catch (err) {
    cleanup();
    throw Object.assign(new Error(`No se pudo recortar el clip para ${red}: ${String(err.message).slice(0, 200)}`), { status: 400 });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { trimTarget, phrases, volumeDigits, cleanPlan, cutFilter, cutArgs, smartTrim, LIMITES };
