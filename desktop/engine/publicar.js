// Publicación automática (opcional, por red) y reglas de TikTok.
//  - Instagram y Facebook: con "Publicar sola" encendido, cada clip sugerido se programa a su hora sugerida con el texto de esa red.
//  - TikTok: su auditoría exige que la persona apruebe cada video (privacidad elegida a mano, interacciones, aviso de
//    contenido comercial y consentimiento). La persona aprueba el clip una vez y ClipViral lo publica a la hora sugerida.
//  - YouTube: se sube a mano.

const AUTO_REDES = ['instagram', 'facebook'];   // se programan solas
const SOLA_REDES = ['instagram', 'tiktok', 'facebook']; // tienen el interruptor "Publicar sola"
const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];
// Si la PC estaba apagada a la hora elegida y pasaron más de 2 horas, se busca la próxima hora buena en vez de publicar a deshora.
const LATE_MS = 2 * 3600 * 1000;

/**
 * Qué clips programar solos ahora.
 * items: los de Clips sugeridos (buildSnapshot); redesOn: redes con "Publicar sola" encendido; connected: redes conectadas;
 * jobs: la cola de subidas. Nunca repite un clip en una red (aunque la subida se haya cancelado o haya fallado).
 */
function autoPlan({ items = [], redesOn = [], connected = [], jobs = [] }) {
  const queued = new Set(jobs.map((j) => `${j.clipId}|${j.platform}`));
  const out = [];
  for (const it of items) {
    if (it.status !== 'nueva') continue;
    for (const red of AUTO_REDES) {
      if (!redesOn.includes(red) || !connected.includes(red)) continue;
      if (it.hechas?.[red] || it.programadas?.[red] || it.sinAuto?.[red] || queued.has(`${it.clipId}|${red}`)) continue;
      const at = it.horas?.[red];
      const t = it.textos?.[red];
      if (!at || !t) continue;
      out.push({ sugId: it.id, clipId: it.clipId, red, at, title: t.titulo, caption: t.texto });
    }
  }
  return out;
}

const fmtDur = (s) => {
  const t = Math.round(Number(s) || 0);
  return t >= 60 ? `${Math.floor(t / 60)} min${t % 60 ? ` ${t % 60} s` : ''}` : `${t} s`;
};

/**
 * Revisa lo que eligió la persona en la pantalla de TikTok contra lo que permite su cuenta (creator_info).
 * Devuelve el problema en palabras sencillas, o null si está todo bien.
 */
function checkTiktokApproval(a = {}, info = {}, { duration = 0 } = {}) {
  const options = Array.isArray(info.privacyOptions) ? info.privacyOptions : [];
  if (info.canPost === false) return 'TikTok no deja publicar más videos en esta cuenta por ahora. Inténtalo más tarde.';
  if (!a.privacy) return 'Elige quién puede ver el video.';
  if (!TIKTOK_PRIVACY.includes(a.privacy) || !options.includes(a.privacy)) return 'Esa opción de privacidad no está disponible en tu cuenta de TikTok. Elige otra.';
  if (a.disclose && !a.brandOrganic && !a.brandContent) return 'Indica si el video promociona tu marca, a un tercero o ambos.';
  if (a.disclose && a.brandContent && a.privacy === 'SELF_ONLY') return 'El contenido de marca no puede ser privado ("Solo yo"). Elige otra opción.';
  if (String(a.caption ?? '').length > 2200) return 'El texto es muy largo: TikTok acepta hasta 2200 caracteres.';
  if (info.maxDuration && Number(duration) > info.maxDuration) return `Tu cuenta de TikTok acepta videos de hasta ${fmtDur(info.maxDuration)} y este dura ${fmtDur(duration)}.`;
  if (!a.consent) return 'Falta tu confirmación para publicar.';
  return null;
}

/** Lo que se guarda en la subida (y se manda a TikTok): solo lo que la persona eligió y su cuenta permite. */
function tiktokPostOptions(a = {}, info = {}, now = Date.now()) {
  const disclose = !!a.disclose;
  return {
    privacy: a.privacy,
    allowComment: !!a.allowComment && !info.commentDisabled,
    allowDuet: !!a.allowDuet && !info.duetDisabled,
    allowStitch: !!a.allowStitch && !info.stitchDisabled,
    brandOrganic: disclose && !!a.brandOrganic,
    brandContent: disclose && !!a.brandContent,
    consentAt: a.consent ? now : null,
    account: info.username || info.nickname || null,
  };
}

/** Normaliza la respuesta de creator_info de TikTok. */
function creatorInfo(d = {}) {
  return {
    nickname: d.creator_nickname || '',
    username: d.creator_username || '',
    avatar: d.creator_avatar_url || null,
    privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.filter((p) => TIKTOK_PRIVACY.includes(p)) : [],
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxDuration: Number(d.max_video_post_duration_sec) || 0,
  };
}

// ---------- Instagram: copia recortada ----------
// Por la API, Instagram rechaza a algunas cuentas (sobre todo nuevas) los Reels de más de ~40 s con un error genérico.
// Si el clip es más largo, se sube una copia de los primeros 39 s (el clip original no se toca; las demás redes lo reciben entero).
const IG_SAFE_SECONDS = 40;
const IG_TRIM_SECONDS = 39;

/** ¿Hay que subir a Instagram una copia recortada? `enabled`: ajuste redes.instagram.recortar (encendido si no está). */
function igTrimNeeded(job, enabled = true) {
  return enabled !== false && job?.platform === 'instagram' && Number(job.duration) > IG_SAFE_SECONDS;
}

/** FFmpeg: los primeros segundos, sin volver a codificar el video (rápido y sin perder calidad); el sonido se apaga al final. */
function igTrimArgs(input, output, seconds = IG_TRIM_SECONDS) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-t', String(seconds),
    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy',
    '-af', `afade=t=out:st=${Math.max(0, seconds - 0.8).toFixed(1)}:d=0.8`, '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart', output];
}

module.exports = {
  autoPlan, checkTiktokApproval, tiktokPostOptions, creatorInfo, igTrimNeeded, igTrimArgs,
  AUTO_REDES, SOLA_REDES, TIKTOK_PRIVACY, LATE_MS, IG_SAFE_SECONDS, IG_TRIM_SECONDS,
};
