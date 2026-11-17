'use strict';
// Pantalla "Publicar en TikTok": la que pide la auditoría de TikTok (Direct Post).
// - Lee la cuenta cada vez que se abre (apodo, foto, privacidad permitida, interacciones, duración máxima).
// - Privacidad sin valor por defecto; Comentarios, Duo y Stitch apagados; aviso de contenido comercial apagado.
// - Vista previa del video, texto editable, aviso de música / contenido de marca antes del botón.
// - Nada se envía a TikTok hasta que la persona aprueba; si eligió una hora, se envía a esa hora.

const TT_PRIVACY = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (se siguen mutuamente)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Solo yo',
};
const TT_LINKS = {
  music: 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en',
  branded: 'https://www.tiktok.com/legal/page/global/bc-policy/en',
};
const TT_INTERACTIONS = [
  ['allowComment', 'commentDisabled', 'Comentar'],
  ['allowDuet', 'duetDisabled', 'Hacer Duo'],
  ['allowStitch', 'stitchDisabled', 'Hacer Stitch'],
];

/**
 * clip: el clip a publicar.
 * opts: { caption, sugId, at (hora sugerida o elegida, en ms), atKind: 'sugerida' | 'fecha', prefer: 'ahora' | 'programar', onDone }
 */
async function openTiktokModal(clip, opts = {}) {
  const m = modal('<div class="tt-modal"><h2>Publicar en TikTok</h2><div class="tt-body"><div class="muted" style="padding:26px 0">⏳ Revisando tu cuenta de TikTok…</div></div></div>');
  const body = $('.tt-body', m.el);
  let info;
  try {
    info = await api.tiktokInfo();
  } catch (err) {
    // Si TikTok dice que la cuenta no puede publicar ahora (límite del día, etc.), no se sigue.
    body.innerHTML = `<div class="warn-box"><span>⚠️</span><div><b>No se puede publicar en TikTok ahora</b><br><span class="muted">${esc(err.message)}</span><br><span class="muted tiny">Inténtalo de nuevo más tarde.</span></div></div>
      <div class="modal-actions"><button class="btn" data-c>Cerrar</button></div>`;
    $('[data-c]', m.el).onclick = () => m.close();
    return;
  }
  if (!info.privacyOptions.length) info.privacyOptions = ['SELF_ONLY'];
  const st = { privacy: '', allowComment: false, allowDuet: false, allowStitch: false, disclose: false, brandOrganic: false, brandContent: false };
  const tooLong = info.maxDuration && clip.duration > info.maxDuration;
  const sched = opts.at ? { when: opts.atKind || 'sugerida', at: opts.at } : null;
  const nowFirst = opts.prefer === 'ahora' || !sched;
  const disabledNote = TT_INTERACTIONS.filter(([, off]) => info[off]).map(([, , label]) => label.toLowerCase());

  body.innerHTML = `
    <div class="tt-account">
      ${info.avatar ? `<img src="${esc(info.avatar)}" alt="">` : '<span class="net-logo" style="background:#000">♪</span>'}
      <div><small class="muted">Se publicará en tu cuenta</small><b>${esc(info.nickname || 'TikTok')}</b>${info.username ? `<span class="muted tiny">@${esc(info.username)}</span>` : ''}</div>
    </div>
    ${tooLong ? `<div class="warn-box"><span>⏱️</span><div>Tu cuenta de TikTok acepta videos de hasta <b>${fmtClock(info.maxDuration)}</b> y este dura <b>${fmtClock(clip.duration)}</b>. Haz un clip más corto para TikTok.</div></div>` : ''}
    <div class="tt-grid">
      <div class="tt-preview">
        <video src="${esc(fileUrl(clip.file))}" controls playsinline preload="metadata"></video>
        <small class="muted tiny">Vista previa · ${fmtClock(clip.duration)}</small>
      </div>
      <div class="tt-form">
        <label>Texto de la publicación <small class="muted tiny">Puedes cambiarlo</small>
          <textarea id="ttCaption" rows="5" maxlength="2200">${esc(opts.caption ?? clip.title ?? '')}</textarea>
          <small class="muted tiny" id="ttCount"></small></label>
        <label>¿Quién puede ver este video?
          <select id="ttPrivacy"><option value="" selected disabled>Elige una opción…</option>
            ${info.privacyOptions.map((p) => `<option value="${p}">${TT_PRIVACY[p] || p}</option>`).join('')}</select></label>
        <div class="tt-sub">Permitir que los demás puedan:</div>
        <div class="tt-checks">${TT_INTERACTIONS.map(([key, off, label]) => `
          <label class="check ${info[off] ? 'off' : ''}" ${info[off] ? 'title="Lo tienes apagado en los ajustes de tu cuenta de TikTok"' : ''}>
            <input type="checkbox" data-int="${key}" ${info[off] ? 'disabled' : ''}/><span>${label}</span></label>`).join('')}</div>
        ${disabledNote.length ? `<small class="muted tiny">No disponible: ${esc(disabledNote.join(', '))} (lo tienes apagado en tu cuenta de TikTok).</small>` : ''}
        <div class="setting tt-disclose"><div class="grow"><b>Revelar contenido comercial</b><small>Actívalo si este video promociona una marca, un producto o un servicio.</small></div>
          <label class="toggle"><input type="checkbox" id="ttDisclose"/><span></span></label></div>
        <div id="ttBrand" class="tt-brand hidden">
          <label class="check"><input type="checkbox" id="ttOrganic"/><span><b>Tu marca</b><small class="muted"> Promocionas tu propio negocio, producto o servicio.</small></span></label>
          <label class="check"><input type="checkbox" id="ttBranded"/><span><b>Contenido de marca</b><small class="muted"> Promocionas a otra marca o a un tercero.</small></span></label>
          <div id="ttLabelMsg" class="tt-note hidden"></div>
        </div>
        <div id="ttPrivNote" class="tt-note hidden"></div>
      </div>
    </div>
    <p class="tt-declare" id="ttDeclare"></p>
    <p class="muted tiny" style="margin:0">⏳ Después de publicar, TikTok puede tardar unos minutos en mostrar el video en tu perfil. Verás el avance en Clips sugeridos y en Redes.</p>
    <div class="modal-actions">
      <button class="btn ghost" data-c>Cancelar</button>
      ${nowFirst
    ? `${sched ? `<span class="tt-wrap"><button class="btn" data-pub="${sched.when}">🕒 Programar · ${esc(whenLabel(sched.at))}</button></span>` : ''}
         <span class="tt-wrap"><button class="btn primary" data-pub="ahora">🚀 Publicar ahora</button></span>`
    : `<span class="tt-wrap"><button class="btn" data-pub="ahora">Publicar ahora</button></span>
         <span class="tt-wrap"><button class="btn primary" data-pub="${sched.when}">✅ Aprobar y programar · ${esc(whenLabel(sched.at))}</button></span>`}
    </div>`;

  const cap = $('#ttCaption', m.el);
  const sel = $('#ttPrivacy', m.el);
  const selfOnly = $('option[value="SELF_ONLY"]', sel);

  const refresh = () => {
    $('#ttCount', m.el).textContent = `${cap.value.length} / 2200`;
    $('#ttBrand', m.el).classList.toggle('hidden', !st.disclose);
    // El contenido de marca no puede ser privado.
    const branded = st.disclose && st.brandContent;
    if (selfOnly) {
      selfOnly.disabled = branded;
      selfOnly.title = branded ? 'La visibilidad del contenido de marca no puede ser privada' : '';
      selfOnly.textContent = branded ? `${TT_PRIVACY.SELF_ONLY} (no disponible para contenido de marca)` : TT_PRIVACY.SELF_ONLY;
    }
    const label = !st.disclose ? '' : st.brandContent ? 'Tu video se etiquetará como «Colaboración pagada».' : st.brandOrganic ? 'Tu video se etiquetará como «Contenido promocional».' : '';
    $('#ttLabelMsg', m.el).textContent = label;
    $('#ttLabelMsg', m.el).classList.toggle('hidden', !label);
    $('#ttDeclare', m.el).innerHTML = branded
      ? `Al publicar, aceptas la <a href="#" data-link="branded">Política de contenido de marca</a> y la <a href="#" data-link="music">Confirmación de uso de música</a> de TikTok.`
      : 'Al publicar, aceptas la <a href="#" data-link="music">Confirmación de uso de música</a> de TikTok.';
    $$('[data-link]', m.el).forEach((a) => { a.onclick = (e) => { e.preventDefault(); api.openUrl(TT_LINKS[a.dataset.link]); }; });
    // Por qué no se puede publicar todavía (se ve al pasar el mouse por el botón).
    const why = tooLong ? 'El video es más largo de lo que acepta tu cuenta de TikTok'
      : !st.privacy ? 'Elige quién puede ver el video'
        : st.disclose && !st.brandOrganic && !st.brandContent ? 'Debes indicar si este contenido promociona tu marca, a un tercero o ambos'
          : '';
    $$('[data-pub]', m.el).forEach((b) => { b.disabled = !!why; b.closest('.tt-wrap').title = why; });
  };

  cap.addEventListener('input', refresh);
  sel.addEventListener('change', () => { st.privacy = sel.value; $('#ttPrivNote', m.el).classList.add('hidden'); refresh(); });
  $$('[data-int]', m.el).forEach((c) => c.addEventListener('change', () => { st[c.dataset.int] = c.checked; }));
  $('#ttDisclose', m.el).addEventListener('change', (e) => { st.disclose = e.target.checked; refresh(); });
  $('#ttOrganic', m.el).addEventListener('change', (e) => { st.brandOrganic = e.target.checked; refresh(); });
  $('#ttBranded', m.el).addEventListener('change', (e) => {
    st.brandContent = e.target.checked;
    if (st.brandContent && st.privacy === 'SELF_ONLY') {
      // Tenía "Solo yo": se borra la elección y se le explica por qué.
      st.privacy = '';
      sel.value = '';
      const note = $('#ttPrivNote', m.el);
      note.textContent = 'El contenido de marca no puede ser «Solo yo». Elige otra opción de privacidad.';
      note.classList.remove('hidden');
    }
    refresh();
  });
  $('[data-c]', m.el).onclick = () => m.close();
  $$('[data-pub]', m.el).forEach((b) => b.addEventListener('click', () => withLoading(b, async () => {
    const when = b.dataset.pub;
    try {
      await api.tiktokApprove({
        clipId: clip.id, sugId: opts.sugId || null, when, at: when === 'fecha' ? sched?.at : undefined,
        caption: cap.value, ...st, consent: true,
      });
      S.uploads = await api.uploadsList().catch(() => S.uploads);
      updateNavBadges();
      m.close();
      toast(when === 'ahora' ? 'Enviando a TikTok. Puede tardar unos minutos en aparecer en tu perfil.' : `Aprobado: se publica en TikTok ${whenLabel(sched.at).toLowerCase()}`, 'ok', '🎵');
      opts.onDone?.();
    } catch (err) { toast(err.message, 'bad'); }
  })));
  refresh();
}
