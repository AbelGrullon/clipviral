'use strict';
// Clips sugeridos: cada clip nuevo con la hora sugerida y el texto listo para cada red.
// El usuario publica a mano, con un botón (programar a la hora sugerida o publicar ahora), o enciende "Publicar sola" por red.
// TikTok: cada clip se aprueba en su pantalla (tiktok.js) y después se publica solo a su hora.

const SUG_FILTERS = [['nueva', 'Por subir'], ['subida', 'Ya subidos'], ['descartada', 'Descartados']];
const SUG_ORDER = ['tiktok', 'instagram', 'youtube', 'facebook'];
const SUG_FIELDS = [
  ['titulo', 'Título', 'En YouTube, el título del Short'],
  ['gancho', 'Gancho', 'La primera frase'],
  ['descripcion', 'Descripción', ''],
  ['hashtags', 'Hashtags', ''],
];
S.sugFilter = 'nueva';
S.sugTab = {};

/** "Hoy 19:00", "Mañana 12:00" o "jueves 21:00". */
function whenLabel(ms) {
  if (!ms) return 'Cuando quieras';
  const d = dayLabel(ms);
  return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${hhmm(ms)}`;
}

function sugOriginLabel(clip) {
  const o = clip.origin || {};
  if (o.type === 'piloto') return o.source?.type === 'tema' ? `🛰️ Piloto · tema "${esc(o.source.name)}"` : '🛰️ Piloto';
  return '✂️ Directo';
}

const AUTO_NETS = ['instagram', 'tiktok', 'facebook'];

/** La subida de este clip en esa red que todavía importa (programada, subiendo o con error). */
function jobFor(clipId, red, statuses = ['pendiente', 'subiendo', 'error']) {
  return (S.uploads || []).filter((j) => j.clipId === clipId && j.platform === red && statuses.includes(j.status))
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

const ORIGEN_LABEL = { sola: 'Se publica sola', aprobado: 'Aprobado: se publica', manual: 'Programado' };

/** Botones de la red elegida en la tarjeta: programar, publicar ahora, aprobar (TikTok) o marcar a mano. */
function netActions(it, red) {
  const name = NET[red].short;
  const p = (S.social || []).find((x) => x.id === red);
  const done = it.hechas[red];
  const manual = `<button class="btn small ${done ? 'ghost' : ''}" data-sa="red">${done ? `↩️ No lo subí a ${name}` : `✓ Ya lo subí a ${name}`}</button>`;
  // Clientes: copian el texto y lo suben ellos; aquí solo marcan que ya lo subieron.
  if (!canPublish()) return manual;
  if (done) {
    const pub = jobFor(it.clip.id, red, ['publicado']);
    return `${pub?.url ? `<button class="btn small" data-sa="view">Ver en ${name}</button>` : ''}${pub ? '' : manual}`;
  }
  const job = jobFor(it.clip.id, red);
  if (job?.status === 'pendiente') {
    return `<div class="sched-box"><span>🕒 <b>${ORIGEN_LABEL[job.origen] || 'Programado'}</b> ${esc(whenLabel(job.scheduledAt).toLowerCase())}${job.note ? `<small class="muted">${esc(job.note)}</small>` : ''}</span>
      <span class="grow"></span><button class="btn small" data-sa="job-now">Publicar ahora</button><button class="btn small ghost" data-sa="job-cancel">Cancelar</button></div>`;
  }
  if (job?.status === 'subiendo') {
    return `<div class="sched-box"><span>⏫ <b>Publicando en ${name}…</b> ${Math.round((job.progress || 0) * 100)}%${job.note ? `<small class="muted">${esc(job.note)}</small>` : ''}</span>
      <div class="progress grow"><span style="width:${Math.round((job.progress || 0) * 100)}%"></span></div></div>`;
  }
  const failed = job?.status === 'error'
    ? `<div class="sched-box bad"><span>⚠️ <b>No se publicó en ${name}</b><small>${esc(job.error || '')}</small></span><span class="grow"></span>
        ${job.reconnect ? '<button class="btn small" data-go="redes">Reconectar</button>' : '<button class="btn small" data-sa="job-retry">Reintentar</button>'}</div>`
    : '';
  if (!p?.connected) {
    return `${failed}${manual}${red !== 'youtube' && p?.configured ? `<span class="muted tiny">Conecta ${name} en <a href="#" data-go="redes">Redes</a> para publicar desde aquí.</span>` : ''}`;
  }
  // YouTube queda como antes: se sube a mano, abriendo la ventana de subida con este texto.
  if (red === 'youtube') {
    return `${failed}${manual}<button class="btn small ghost" data-sa="upload" title="Abre la ventana de subida con este texto. Sube solo cuando tú confirmes.">${I.upload}<span>Subir con ClipViral</span></button>`;
  }
  const at = it.horas[red];
  if (red === 'tiktok') {
    return `${failed}${at ? `<button class="btn small primary" data-sa="tt-sched" title="Revisas el video, eliges la privacidad y se publica solo a esa hora">✅ Aprobar y programar · ${esc(whenLabel(at))}</button>` : ''}
      <button class="btn small ${at ? '' : 'primary'}" data-sa="tt-now">🚀 Aprobar y publicar ahora</button>${manual}`;
  }
  return `${failed}${at ? `<button class="btn small primary" data-sa="sched" title="Se publica solo a esa hora con el texto de ${name}">🕒 Programar a la hora sugerida · ${esc(whenLabel(at))}</button>` : ''}
    <button class="btn small ${at ? '' : 'primary'}" data-sa="pub-now">🚀 Publicar ahora</button>${manual}`;
}

/** Interruptores "Publicar sola" de Instagram, TikTok y Facebook. */
function autoBar() {
  if (!canPublish()) return '';
  const R = S.settings.redes || {};
  const anyOn = AUTO_NETS.some((r) => R[r]?.publicarSola);
  return `<div class="card auto-bar pop-in">
    <div class="auto-head"><b>🤖 Publicación automática</b>
      <span class="muted tiny">${anyOn ? 'Usa la hora sugerida y el texto de cada red (como mucho 4 por día en cada una). Puedes cancelar cualquier publicación antes de que salga.'
    : 'Apagada: tú decides cada publicación. Enciéndela en las redes que quieras: usa la hora sugerida y el texto de cada red.'}</span></div>
    <div class="auto-nets">${AUTO_NETS.map((r) => {
    const p = (S.social || []).find((x) => x.id === r);
    const on = !!R[r]?.publicarSola;
    const desc = r === 'tiktok'
      ? (on ? 'Apruebas cada clip y se publica solo a su hora' : 'TikTok pide que apruebes cada video')
      : (on ? 'Publica sola a la hora sugerida' : 'Apagada');
    const right = !p?.configured ? '<span class="muted tiny">Aún no disponible</span>'
      : !p.connected ? '<button class="btn small" data-go="redes">Conectar</button>'
        : `<label class="toggle" title="Publicar sola en ${NET[r].short}"><input type="checkbox" data-auto="${r}" ${on ? 'checked' : ''}/><span></span></label>`;
    return `<div class="auto-net ${on && p?.connected ? 'on' : ''}"><span class="net-dot" style="background:${NET[r].color}">${NET[r].icon}</span>
      <div class="grow"><b>${NET[r].short}</b><small>${desc}</small></div>${right}</div>`;
  }).join('')}</div>
  </div>`;
}

function sugCard(it, first) {
  const c = it.clip;
  const redes = S.sug.redes;
  const pending = it.status === 'nueva';
  const tab = redes.includes(S.sugTab[it.id]) ? S.sugTab[it.id] : redes.find((r) => !it.hechas[r]) || redes[0];
  S.sugTab[it.id] = tab;
  const t = it.textos[tab];
  const when = redes.map((r) => {
    const done = it.hechas[r];
    const prog = it.programadas?.[r];
    const label = done ? `✓ Subido ${hhmm(done)}` : prog ? (prog.status === 'subiendo' ? '⏫ Publicando…' : `🕒 ${whenLabel(prog.at)}`) : pending ? whenLabel(it.horas[r]) : '—';
    return `<button class="when-chip ${r === tab ? 'active' : ''} ${done ? 'done' : ''} ${prog && !done ? 'sched' : ''}" data-tab="${r}" title="${prog && !done ? `${ORIGEN_LABEL[prog.origen] || 'Programado'} en ${NET[r].short}` : `Ver el texto para ${NET[r].short}`}">
      <span class="net-dot" style="background:${NET[r].color}">${NET[r].icon}</span><span><b>${NET[r].short}</b><small>${label}</small></span></button>`;
  }).join('');
  const field = ([k, label, help]) => {
    const value = k === 'hashtags' ? t.hashtags.join(' ') : t[k];
    return `<div class="field-row"><div class="field-label">${label}${help ? `<small>${help}</small>` : ''}</div>
      <div class="copy-box field-value">${esc(value)}</div><button class="btn small" data-copy="${k}">${I.copy}<span>Copiar</span></button></div>`;
  };
  return `<div class="card sug ${pending ? '' : 'done'}" data-sug="${esc(it.id)}">
    <div class="sug-media clip-media" data-sa="play" title="Ver el clip">
      ${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" loading="lazy">` : ''}
      <div class="play"><span>▶</span></div>
      <span class="badge score">🔥 ${c.score}/10</span><span class="dur">${fmtClock(c.duration)}</span>
    </div>
    <div class="sug-body">
      <div class="sug-top">
        <div class="grow"><div class="sug-title">${first && pending ? '<span class="badge grad">⭐ Súbelo primero</span> ' : ''}${esc(c.title)}</div>
          <div class="muted tiny">${esc(c.stream?.channel || '')} · ${sugOriginLabel(c)} · ${ago(it.addedAt)}</div></div>
        <span class="badge ${it.textosDe === 'ia' ? 'grad' : ''}" title="${it.textosDe === 'ia' ? 'Claude escribió un texto distinto para cada red' : 'Texto armado con tu plantilla (sección Redes). Con IA Pro, Claude lo escribe para cada red.'}">${it.textosDe === 'ia' ? '✨ Texto de Claude' : '📝 Texto con plantilla'}</span>
      </div>
      <div class="sug-why">💡 <b>Por qué funcionaría:</b> ${esc(it.porQue)}</div>
      <div class="sug-when"><span class="muted tiny">${pending ? '🕒 Cuándo subirlo' : 'Redes'}</span><div class="when-row">${when}</div></div>
      ${pending ? `<div class="sug-panel">
        ${SUG_FIELDS.map(field).join('')}
        <div class="field-row full"><div class="field-label">Texto para pegar<small>Todo junto, para ${NET[tab].short}</small></div>
          <div class="copy-box field-value tall">${esc(t.texto)}</div><button class="btn small primary" data-copy="texto">${I.copy}<span>Copiar todo</span></button></div>
        <div class="sug-net-actions">${netActions(it, tab)}</div>
      </div>` : ''}
      <div class="sug-actions">
        <button class="btn small" data-sa="open">${I.play}<span>Abrir video</span></button>
        <button class="btn small" data-sa="folder">${I.folder}<span>Abrir carpeta</span></button>
        <span class="grow"></span>
        ${pending ? `<button class="btn small ghost" data-sa="descartar">Descartar</button>
          <button class="btn small primary" data-sa="subida"><span>✓ Ya la subí</span></button>`
    : `<span class="muted tiny">${it.status === 'subida' ? `Subida ${ago(it.doneAt || Math.max(0, ...Object.values(it.hechas)))}` : 'Descartada'}</span>
          <button class="btn small ghost" data-sa="volver">Volver a "Por subir"</button>`}
      </div>
    </div>
  </div>`;
}

async function renderSugeridos(el) {
  const [snap, social, uploads] = await Promise.all([
    api.sugList().catch(() => S.sug || { items: [], counts: {}, redes: SUG_ORDER }),
    api.socialList().catch(() => S.social || []),
    api.uploadsList().catch(() => S.uploads || []),
  ]);
  S.sug = snap;
  S.social = social;
  S.uploads = uploads;
  if (S.page !== 'sugeridos') return;
  el.innerHTML = `
    <div class="page-head"><div><h1>Clips sugeridos</h1><p class="muted">${canPublish() ? 'Cada clip nuevo llega aquí listo para publicar: cuándo subirlo y el texto de cada red. Publícalo tú, prográmalo con un botón o enciende la publicación automática.' : 'Cada clip nuevo llega aquí listo para publicar: la mejor hora para subirlo, el texto y los hashtags de cada red. Cópialos y súbelo tú.'}</p></div>
      <div class="head-actions"><button class="btn small" data-go="piloto">🛰️ Piloto</button><button class="btn small ghost" id="sugClear">Limpiar terminados</button></div></div>
    ${autoBar()}
    <div class="card sug-bar pop-in">
      <div class="chips" id="sugFilters"></div>
      <div class="chips" style="align-items:center"><span class="muted tiny">Dónde publicas:</span>${SUG_ORDER.map((r) => `<button class="chip net-toggle ${snap.redes.includes(r) ? 'active' : ''}" data-net="${r}"><span class="net-dot" style="background:${NET[r].color}">${NET[r].icon}</span>${NET[r].short}</button>`).join('')}</div>
    </div>
    <p class="muted tiny" id="sugHint" style="margin:0 0 12px"></p>
    <div id="sugList" class="sug-list"></div>`;
  $$('[data-go]', el).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  $('#sugClear').onclick = async () => { S.sug = await api.sugClear(); drawSugeridos(); updateNavBadges(); };
  $$('[data-auto]', el).forEach((inp) => inp.addEventListener('change', () => toggleAuto(inp)));
  $$('.net-toggle', el).forEach((b) => b.addEventListener('click', async () => {
    const r = b.dataset.net;
    const now = S.sug.redes.includes(r) ? S.sug.redes.filter((x) => x !== r) : [...S.sug.redes, r];
    if (!now.length) return toast('Deja al menos una red', 'bad');
    const ordered = SUG_ORDER.filter((x) => now.includes(x));
    S.settings = await api.setSettings({ sugerencias: { redes: ordered } });
    b.classList.toggle('active', ordered.includes(r));
    S.sug = await api.sugList();
    drawSugeridos();
  }));
  drawSugeridos();
}

/** Enciende o apaga "Publicar sola" en una red (con confirmación si va a programar o quitar publicaciones). */
async function toggleAuto(inp) {
  const red = inp.dataset.auto;
  const on = inp.checked;
  const name = NET[red].short;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (red !== 'tiktok') {
    if (on) {
      const n = S.sug.items.filter((i) => i.status === 'nueva' && !i.hechas[red] && !i.programadas?.[red] && !i.sinAuto?.[red]).length;
      const text = `${n ? `${plural(n, 'clip por subir se programará', 'clips por subir se programarán')} a su hora sugerida. ` : ''}Cada clip nuevo se publicará solo en ${name} a su hora sugerida, con el texto para ${name} (como mucho 4 por día). Puedes cancelar cualquiera antes de que salga.`;
      if (!(await confirmBox(`¿Publicar sola en ${name}?`, text, 'Encender'))) { inp.checked = false; return; }
    } else {
      const n = S.sug.items.filter((i) => i.programadas?.[red]?.origen === 'sola').length;
      if (n && !(await confirmBox(`¿Apagar en ${name}?`, `Se quitarán ${plural(n, 'publicación automática que todavía no salió', 'publicaciones automáticas que todavía no salieron')}. Lo que programaste tú sigue en pie.`, 'Apagar', true))) { inp.checked = true; return; }
    }
  } else if (on && !(await confirmBox('Publicar en TikTok a la hora sugerida', 'TikTok pide que apruebes cada video antes de publicarlo. En cada clip toca "Aprobar y programar": revisas el video, eliges quién lo ve y se publica solo a su hora. Te avisaremos cuando haya clips nuevos para aprobar.', 'Entendido'))) {
    inp.checked = false;
    return;
  }
  try {
    const r = await api.autoSet({ red, on });
    S.settings = r.settings;
    S.sug = r.snap;
    S.uploads = await api.uploadsList().catch(() => S.uploads);
    if (on && red !== 'tiktok') toast(r.scheduled ? `Listo: ${plural(r.scheduled, 'clip programado', 'clips programados')} en ${name}` : `Listo: los clips nuevos se publicarán solos en ${name}`, 'ok', '🤖');
    else if (on) toast('Listo: aprueba cada clip y se publica solo a su hora', 'ok', '🎵');
    else toast(r.removed ? `Apagado. Se quitaron ${plural(r.removed, 'publicación automática', 'publicaciones automáticas')}.` : `Apagado en ${name}`, 'info', '⏸️');
    updateNavBadges();
    renderPage(false);
  } catch (err) {
    inp.checked = !on;
    toast(err.message, 'bad');
  }
}

/** Dibuja la lista (sin tocar la barra de arriba). */
function drawSugeridos() {
  const box = $('#sugList');
  if (S.page !== 'sugeridos' || !box) return;
  const snap = S.sug;
  $('#sugFilters').innerHTML = SUG_FILTERS.map(([v, l]) => `<button class="chip ${S.sugFilter === v ? 'active' : ''}" data-filter="${v}">${l} <b>${snap.counts?.[v] || 0}</b></button>`).join('');
  $$('[data-filter]', $('#sugFilters')).forEach((b) => { b.onclick = () => { S.sugFilter = b.dataset.filter; drawSugeridos(); }; });
  $('#sugHint').textContent = S.sugFilter !== 'nueva' ? '' : snap.horasDe === 'aprendidas'
    ? '🧠 Las horas salen de tus estadísticas: son las que más vistas te dan. Nunca te propongo dos clips a la misma hora en la misma red.'
    : '🕒 Horas recomendadas para Latinoamérica y España. Cuando tengas estadísticas, uso las que más vistas te dan. Nunca te propongo dos clips a la misma hora en la misma red.';
  const list = snap.items.filter((i) => i.status === S.sugFilter);
  if (!list.length) {
    box.innerHTML = S.sugFilter === 'nueva'
      ? `<div class="card"><div class="empty" style="padding:36px"><div class="big" style="font-size:44px">✨</div><h3 style="margin:0">No hay clips por subir</h3>
          <p class="muted" style="margin:0">Enciende el Piloto con los canales que te interesan, o saca clips en Directo: aparecerán aquí con la hora y el texto listos.<br>También puedes traer un clip viejo desde Mis clips con el botón ✨.</p>
          <div style="display:flex;gap:10px"><button class="btn primary" data-go="piloto"><span>Ir al Piloto</span></button><button class="btn" data-go="directo"><span>Sacar clips de un video</span></button></div></div></div>`
      : `<div class="muted" style="padding:30px;text-align:center">${S.sugFilter === 'subida' ? 'Todavía no marcaste ningún clip como subido.' : 'No hay clips descartados.'}</div>`;
    $$('[data-go]', box).forEach((b) => { b.onclick = () => go(b.dataset.go); });
    return;
  }
  box.innerHTML = list.slice(0, 60).map((it, i) => sugCard(it, i === 0)).join('');
  $$('.sug', box).forEach((card) => bindSugCard(card, snap.items.find((x) => x.id === card.dataset.sug)));
}

function bindSugCard(card, it) {
  const media = $('.sug-media', card);
  let video;
  media.addEventListener('mouseenter', () => {
    if (!video) { video = document.createElement('video'); video.src = fileUrl(it.clip.file); video.muted = true; video.loop = true; media.prepend(video); }
    video.currentTime = 0;
    video.play().then(() => media.classList.add('playing')).catch(() => {});
  });
  media.addEventListener('mouseleave', () => { media.classList.remove('playing'); video?.pause(); });
  $$('[data-tab]', card).forEach((b) => b.addEventListener('click', () => { S.sugTab[it.id] = b.dataset.tab; redrawCard(it.id); }));
  $$('[data-copy]', card).forEach((b) => b.addEventListener('click', async () => {
    const t = it.textos[S.sugTab[it.id]];
    const k = b.dataset.copy;
    await api.copy(k === 'hashtags' ? t.hashtags.join(' ') : t[k]);
    const label = $('span', b);
    const old = label.textContent;
    label.textContent = '¡Copiado!';
    b.classList.add('copied');
    setTimeout(() => { label.textContent = old; b.classList.remove('copied'); }, 1400);
  }));
  $$('[data-go]', card).forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.go); }));
  $$('[data-sa]', card).forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const act = b.dataset.sa;
    const red = S.sugTab[it.id];
    const job = jobFor(it.clip.id, red);
    const refresh = async () => {
      [S.uploads, S.sug] = await Promise.all([api.uploadsList().catch(() => S.uploads), api.sugList().catch(() => S.sug)]);
      updateNavBadges();
      redrawCard(it.id);
    };
    try {
      if (act === 'play') return openPlayer(it.clip);
      if (act === 'open') return await api.openClipFile(it.clip.id);
      if (act === 'folder') return api.revealClip(it.clip.file);
      if (act === 'upload') {
        const t = it.textos[red];
        return openUploadModal(it.clip, { platforms: [red], title: t.titulo, caption: t.texto });
      }
      if (act === 'view') return api.openUrl(jobFor(it.clip.id, red, ['publicado'])?.url);
      // Instagram y Facebook: con el texto de esa red, a la hora sugerida o ya.
      if (act === 'sched' || act === 'pub-now') {
        if (act === 'pub-now' && !(await confirmBox(`¿Publicar ahora en ${NET[red].short}?`, `Se publicará ahora en tu cuenta con el texto de ${NET[red].short} que ves en esta tarjeta.`, 'Publicar ahora'))) return;
        await withLoading(b, () => api.sugPublish({ id: it.id, red, when: act === 'sched' ? 'sugerida' : 'ahora' }));
        toast(act === 'sched' ? `Programado en ${NET[red].short}: ${whenLabel(it.horas[red]).toLowerCase()}` : `Publicando en ${NET[red].short}…`, 'ok', act === 'sched' ? '🕒' : '🚀');
        return refresh();
      }
      // TikTok: su pantalla de aprobación (privacidad, interacciones, contenido comercial y vista previa).
      if (act === 'tt-sched' || act === 'tt-now') {
        return openTiktokModal(it.clip, {
          caption: it.textos.tiktok.texto, sugId: it.id, at: it.horas.tiktok, atKind: 'sugerida',
          prefer: act === 'tt-now' ? 'ahora' : 'programar', onDone: refresh,
        });
      }
      if (act === 'job-now' && job) { await api.uploadsNow(job.id); toast(`Publicando en ${NET[red].short}…`, 'ok', '🚀'); return refresh(); }
      if (act === 'job-cancel' && job) {
        if (!(await confirmBox('¿Cancelar esta publicación?', job.origen === 'sola' ? 'Este clip no se publicará solo en esta red. Puedes programarlo de nuevo con los botones.' : 'No se publicará. Puedes programarlo de nuevo cuando quieras.', 'Cancelar publicación', true))) return;
        await api.uploadsCancel(job.id);
        return refresh();
      }
      if (act === 'job-retry' && job) { await api.uploadsRetry(job.id); return refresh(); }
      if (act === 'red' || act === 'subida' || act === 'descartar' || act === 'volver') {
        if (act !== 'red') { card.style.transition = 'all .3s'; card.style.opacity = '0'; card.style.transform = 'scale(.97)'; await new Promise((r) => setTimeout(r, 250)); }
        S.sug = await api.sugMark({ id: it.id, action: act, red });
        const now = S.sug.items.find((x) => x.id === it.id);
        if (act === 'subida' || (now?.status === 'subida' && it.status === 'nueva')) { confetti(); toast('¡Bien! Clip marcado como subido', 'ok', '🚀'); }
        if (act === 'descartar') toast('Descartado. Lo encuentras en "Descartados".', 'info', '🗑️');
        updateNavBadges();
        if (act === 'red' && now?.status === 'nueva') redrawCard(it.id); else drawSugeridos();
      }
    } catch (err) { toast(err.message, 'bad'); }
  }));
}

function redrawCard(id) {
  const card = $(`.sug[data-sug="${CSS.escape(id)}"]`);
  const it = S.sug.items.find((x) => x.id === id);
  if (!card || !it) return drawSugeridos();
  const first = S.sug.items.filter((i) => i.status === S.sugFilter)[0]?.id === id;
  card.outerHTML = sugCard(it, first);
  const fresh = $(`.sug[data-sug="${CSS.escape(id)}"]`);
  fresh.style.animation = 'none';
  bindSugCard(fresh, it);
}

/** Desde Mis clips: trae un clip viejo a Clips sugeridos. */
async function suggestClip(clip) {
  try {
    S.sug = await api.sugAdd(clip.id);
    updateNavBadges();
    toast('Listo: está en Clips sugeridos con la hora y el texto', 'ok', '✨');
  } catch (err) { toast(err.message, 'bad'); }
}

api.onSugUpdate((snap) => {
  S.sug = snap;
  updateNavBadges();
  // Llega un clip nuevo o cambió algo (por ejemplo, terminó una subida): se redibuja la lista.
  if (S.page === 'sugeridos') drawSugeridos();
});

// Avance de una subida (programada, subiendo, publicada o con error): se redibuja solo esa tarjeta.
const sugJobTimers = {};
api.onUploadUpdate((job) => {
  if (!job || S.page !== 'sugeridos' || !S.sug) return;
  const i = (S.uploads || []).findIndex((u) => u.id === job.id);
  if (i >= 0) S.uploads[i] = job; else (S.uploads = S.uploads || []).push(job);
  const it = S.sug.items.find((x) => x.clipId === job.clipId);
  if (!it) return;
  clearTimeout(sugJobTimers[it.id]);
  sugJobTimers[it.id] = setTimeout(() => { if ($(`.sug[data-sug="${CSS.escape(it.id)}"]`)) redrawCard(it.id); }, 250);
});
