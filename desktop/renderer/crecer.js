'use strict';
// Pantallas para crecer: Piloto automático, Estadísticas y Competencia.

const fmtShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.0', '')} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1).replace('.0', '')} mil`;
  return String(Math.round(v));
};
const hhmm = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ms) => {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
};
const ago = (ms) => {
  if (!ms) return L('nunca', 'never');
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return L('recién', 'just now');
  if (m < 60) return L(`hace ${m} min`, `${m} min ago`);
  const h = Math.round(m / 60);
  return h < 24 ? L(`hace ${h} h`, `${h} h ago`) : L(`hace ${Math.round(h / 24)} d`, `${Math.round(h / 24)} d ago`);
};
const ytThumb = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
const opt = (list, cur) => list.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`).join('');

function savePilot(patch) {
  S.settings.piloto = { ...S.settings.piloto, ...patch };
  return api.setSettings({ piloto: patch }).then((s) => { S.settings = s; return s; });
}

// ======================= Piloto automático =======================
const FOUND_STATUS = {
  'en-cola': ['En cola', 'warn'], procesando: ['Clipeando…', 'grad'], sugerencia: ['Sugerencia', ''],
  listo: ['Listo', 'ok'], error: ['Error', 'bad'], ignorado: ['Ignorado', ''],
};
const FOUND_ORDER = { procesando: 0, 'en-cola': 1, sugerencia: 2, error: 3, listo: 4, ignorado: 5 };

async function renderPiloto(el) {
  S.pilot = await api.pilotState().catch(() => S.pilot || { found: [], history: [] });
  if (S.page !== 'piloto') return;
  const P = S.settings.piloto;
  el.innerHTML = `
    <div class="page-head"><div><h1>Piloto automático</h1><p class="muted">Dile qué canales y temas te interesan: ClipViral los vigila, saca los mejores clips y te los deja en <b style="color:var(--text)">Clips sugeridos</b> con la hora, el texto y los hashtags. Tú decides qué publicar.</p></div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn small" id="pilotCheck">${I.sparkles}<span>Revisar ahora</span></button>
        <div class="pilot-switch ${P.activo ? 'on' : ''}"><label class="toggle"><input type="checkbox" id="pilotOn" ${P.activo ? 'checked' : ''}/><span></span></label><b>${P.activo ? 'Encendido' : 'Apagado'}</b></div>
      </div></div>
    <div id="pilotWarn"></div>
    <div class="grid cols-4 stagger" id="pilotStatus" style="margin-bottom:16px"></div>
    <div class="grid cols-2 stagger">
      <div class="card">
        <h3>📺 Canales que vigila</h3>
        <p class="muted tiny" style="margin-top:-4px">Si empiezan un directo lo graba; si suben un video nuevo lo analiza.</p>
        <div class="url-box small-box"><input id="chInput" placeholder="youtube.com/@canal  o  @canal" spellcheck="false"/><button class="btn small primary" id="chAdd"><span>Agregar</span></button></div>
        <div id="chList" class="row-list"></div>
      </div>
      <div class="card">
        <h3>🔎 Temas</h3>
        <p class="muted tiny" style="margin-top:-4px">Busca en YouTube lo más visto de hoy sobre cada tema.</p>
        <div class="url-box small-box"><input id="topicInput" placeholder="Ej.: reacciones fútbol, Fortnite, chismes…" spellcheck="false"/><button class="btn small primary" id="topicAdd"><span>Agregar</span></button></div>
        <div class="chips" id="topicList" style="margin:10px 0"></div>
        <div class="setting"><div class="grow"><b>Vistas mínimas en el día</b><small>Solo cuenta lo que ya está pegando.</small></div>
          <select data-p="minVistasTema">${opt([[5000, '5 mil'], [20000, '20 mil'], [50000, '50 mil'], [100000, '100 mil'], [500000, '500 mil']], P.minVistasTema)}</select></div>
        <div class="setting"><div class="grow"><b>Claude filtra los resultados</b><small>Descarta lo que no tiene que ver con tus temas. Plan Pro IA.</small></div>
          <label class="toggle"><input type="checkbox" data-p="usarIa" ${P.usarIa !== false ? 'checked' : ''}/><span></span></label></div>
      </div>
    </div>

    <div class="card pop-in" style="margin-top:16px">
      <h3>🎯 Lo que encontró <span class="muted tiny" style="font-weight:400" id="foundCount"></span>
        <button class="btn small ghost" id="foundClear" style="margin-left:auto">Limpiar terminados</button></h3>
      <div class="url-box small-box" style="margin-bottom:10px"><input id="vidInput" placeholder="¿Tienes un video en mente? Pega el enlace y va a la cola" spellcheck="false"/><button class="btn small" id="vidAdd"><span>A la cola</span></button></div>
      <div id="foundList" class="job-list"></div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card pop-in">
        <h3>⚙️ Reglas</h3>
        <div class="setting"><div class="grow"><b>Solo clipear solo con permiso</b><small>Recomendado. Los canales sin "Tengo permiso" y lo que salga de los temas quedan como sugerencia: decides tú.</small></div>
          <label class="toggle"><input type="checkbox" data-p="soloConPermiso" ${P.soloConPermiso !== false ? 'checked' : ''}/><span></span></label></div>
        <div class="setting"><div class="grow"><b>Revisar cada</b></div><select data-p="revisarCadaMin">${opt([[10, '10 min'], [20, '20 min'], [30, '30 min'], [60, '1 hora'], [180, '3 horas']], P.revisarCadaMin)}</select></div>
        <div class="setting"><div class="grow"><b>Máximo de videos por día</b><small>Los directos no cuentan.</small></div><select data-p="maxVideosDia">${opt([[2, '2'], [4, '4'], [6, '6'], [10, '10'], [20, '20']], P.maxVideosDia)}</select></div>
        <div class="setting"><div class="grow"><b>Videos de hasta</b><small>Más viejos que esto se ignoran.</small></div><select data-p="edadMaxHoras">${opt([[24, '1 día'], [48, '2 días'], [72, '3 días'], [168, '1 semana']], P.edadMaxHoras)}</select></div>
        <div class="setting"><div class="grow"><b>Duración máxima del video</b></div><select data-p="duracionMaxMin">${opt([[30, '30 min'], [60, '1 hora'], [180, '3 horas'], [360, '6 horas']], P.duracionMaxMin)}</select></div>
        <div class="setting"><div class="grow"><b>Usar lo aprendido</b><small>Duración de clip que mejor te funciona (sale de Estadísticas).</small></div>
          <label class="toggle"><input type="checkbox" data-p="usarAprendido" ${P.usarAprendido !== false ? 'checked' : ''}/><span></span></label></div>
        <p class="muted tiny">Cada clip del piloto queda en Clips sugeridos${canPublish() ? '. Solo sale sin que lo toques en las redes donde encendiste la publicación automática' : ', con la hora, el texto y los hashtags listos para que lo subas'}. Con el piloto encendido la PC no se duerme; deja la app abierta.</p>
      </div>
      <div class="card pop-in"><h3>📜 Actividad</h3><div id="pilotLog" class="feed" style="max-height:420px"></div></div>
    </div>`;

  renderPilotDynamic();
  renderChannels();
  renderTopics();

  $('#pilotOn').onchange = async (e) => {
    const on = e.target.checked;
    await savePilot({ activo: on });
    if (on) {
      toast('Piloto encendido. Reviso ahora tus canales y temas.', 'ok', '🛰️');
      api.pilotCheck().catch((err) => toast(err.message, 'bad'));
    } else toast('Piloto apagado', 'info', '⏸️');
    updateNavBadges();
    renderPage(false);
  };
  $('#pilotCheck').onclick = (e) => withLoading(e.currentTarget, async () => {
    const n = await api.pilotCheck().catch((err) => { toast(err.message, 'bad'); return null; });
    if (n !== null) toast(n ? `Encontré ${n} video${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'}` : 'Nada nuevo por ahora', 'ok', '🔎');
  });
  const addChannel = () => withLoading($('#chAdd'), async () => {
    const v = $('#chInput').value.trim();
    if (!v) return $('#chInput').focus();
    try { S.settings = await api.pilotAddChannel(v); $('#chInput').value = ''; renderChannels(); renderPilotDynamic(); toast('Canal agregado. Marca "Tengo permiso" si el creador te dio permiso.', 'ok', '📺'); } catch (err) { toast(err.message, 'bad'); }
  });
  $('#chAdd').onclick = addChannel;
  $('#chInput').onkeydown = (e) => { if (e.key === 'Enter') addChannel(); };
  const addTopic = async () => {
    const v = $('#topicInput').value.trim();
    if (!v) return $('#topicInput').focus();
    const temas = S.settings.piloto.temas || [];
    if (temas.some((t) => t.texto.toLowerCase() === v.toLowerCase())) return toast('Ese tema ya está', 'info');
    await savePilot({ temas: [...temas, { texto: v.slice(0, 60) }] });
    $('#topicInput').value = '';
    renderTopics();
  };
  $('#topicAdd').onclick = addTopic;
  $('#topicInput').onkeydown = (e) => { if (e.key === 'Enter') addTopic(); };
  $$('[data-p]', el).forEach((inp) => inp.addEventListener('change', async () => {
    const k = inp.dataset.p;
    await savePilot({ [k]: inp.type === 'checkbox' ? inp.checked : Number(inp.value) });
    if (k === 'soloConPermiso') renderPilotDynamic();
  }));
  const addVideo = () => withLoading($('#vidAdd'), async () => {
    const v = $('#vidInput').value.trim();
    if (!v) return $('#vidInput').focus();
    try { S.pilot = await api.pilotAddVideo(v); $('#vidInput').value = ''; renderPilotDynamic(); toast('Agregado a la cola', 'ok', '🎬'); } catch (err) { toast(err.message, 'bad'); }
  });
  $('#vidAdd').onclick = addVideo;
  $('#vidInput').onkeydown = (e) => { if (e.key === 'Enter') addVideo(); };
  $('#foundClear').onclick = async () => { await api.pilotClear(); };
}

function renderChannels() {
  const box = $('#chList');
  if (!box) return;
  const list = S.settings.piloto.canales || [];
  box.innerHTML = list.length ? list.map((c, i) => `
    <div class="row-item" data-ch="${i}">
      <div class="grow"><b>${esc(c.nombre)}</b><div class="muted tiny">${esc(c.url.replace('https://www.', ''))}</div></div>
      <div class="chips">
        <button class="chip ${c.directos !== false ? 'active' : ''}" data-chf="directos" title="Grabar sus directos">🔴 Directos</button>
        <button class="chip ${c.videos !== false ? 'active' : ''}" data-chf="videos" title="Analizar sus videos nuevos">🎬 Videos</button>
        <button class="chip ${c.permiso ? 'active ok-chip' : ''}" data-chf="permiso" title="El creador te dio permiso de usar su contenido">${c.permiso ? '✅' : '⬜'} Tengo permiso</button>
      </div>
      <button class="icon-btn" data-chdel title="Quitar">${I.trash}</button>
    </div>`).join('') : '<div class="muted tiny" style="padding:14px 0">Todavía no hay canales. Agrega los de los creadores con los que trabajas.</div>';
  $$('[data-ch]', box).forEach((row) => {
    const i = Number(row.dataset.ch);
    $$('[data-chf]', row).forEach((b) => b.addEventListener('click', async () => {
      const canales = [...S.settings.piloto.canales];
      const f = b.dataset.chf;
      if (f === 'permiso' && !canales[i].permiso && !(await confirmBox('¿Tienes permiso de este creador?', `Al marcarlo, el piloto sacará clips de ${canales[i].nombre} sin preguntarte (publicarlos lo decides tú). Hazlo solo si el creador te autorizó.`, 'Sí, tengo permiso'))) return;
      canales[i] = { ...canales[i], [f]: f === 'permiso' ? !canales[i].permiso : canales[i][f] === false };
      await savePilot({ canales });
      renderChannels();
      renderPilotDynamic();
    }));
    $('[data-chdel]', row).onclick = async () => {
      const canales = S.settings.piloto.canales.filter((_, k) => k !== i);
      await savePilot({ canales });
      renderChannels();
    };
  });
}

function renderTopics() {
  const box = $('#topicList');
  if (!box) return;
  const temas = S.settings.piloto.temas || [];
  box.innerHTML = temas.length ? temas.map((t, i) => `<span class="chip active tag-x">${esc(t.texto)}<button data-tdel="${i}" title="Quitar">×</button></span>`).join('')
    : '<span class="muted tiny">Sin temas. Ej.: "reacciones fútbol", "minecraft", "podcast chismes".</span>';
  $$('[data-tdel]', box).forEach((b) => b.addEventListener('click', async () => {
    await savePilot({ temas: S.settings.piloto.temas.filter((_, k) => k !== Number(b.dataset.tdel)) });
    renderTopics();
  }));
}

function foundRow(c) {
  const [label, cls] = FOUND_STATUS[c.status] || [c.status, ''];
  const src = c.source?.type === 'tema' ? `🔎 ${esc(c.source.name)}` : c.source?.type === 'manual' ? '✋ A mano' : `📺 ${esc(c.source?.name || c.channel)}`;
  return `<div class="job wide" data-found="${esc(c.id)}">
    <img src="${esc(ytThumb(c.id))}" alt="" loading="lazy">
    <div class="grow">
      <div style="display:flex;gap:8px;align-items:center">${c.kind === 'live' ? '<span class="badge live">EN VIVO</span>' : ''}<b class="job-title">${esc(c.title)}</b></div>
      <div class="muted tiny">${esc(c.channel || '')} · ${src}${c.views ? ` · ${fmtShort(c.views)} vistas` : ''}${c.viewsPerHour ? ` · ${fmtShort(c.viewsPerHour)}/h` : ''} · ${ago(c.foundAt)}</div>
      ${c.ai?.reason ? `<div class="tiny" style="color:#c4b5fd;margin-top:3px">✨ ${esc(c.ai.reason)} (${c.ai.score}/10)</div>` : ''}
      ${c.status === 'listo' ? `<div class="tiny" style="color:#86efac;margin-top:3px">${c.clips} clip${c.clips === 1 ? '' : 's'} creado${c.clips === 1 ? '' : 's'}</div>` : ''}
      ${c.error ? `<div class="tiny" style="color:#fca5a5;margin-top:3px">${esc(c.error)}</div>` : ''}
    </div>
    <span class="badge ${cls}">${label}</span>
    <div class="job-actions">
      <button class="btn small ghost" data-fact="ver">Ver</button>
      ${['sugerencia', 'error', 'ignorado'].includes(c.status) ? '<button class="btn small primary" data-fact="clipear">Clipear</button>' : ''}
      ${['sugerencia', 'en-cola', 'error'].includes(c.status) ? '<button class="btn small ghost" data-fact="ignorar">Ignorar</button>' : ''}
      ${c.status === 'listo' && c.clips ? '<button class="btn small primary" data-fact="sugeridos">Ver clips</button>' : ''}
    </div></div>`;
}

/** Partes que cambian solas (estado, encontrados y actividad), sin borrar lo que el usuario está escribiendo. */
function renderPilotDynamic() {
  if (S.page !== 'piloto' || !$('#pilotStatus')) return;
  const P = S.settings.piloto;
  const st = S.pilot || { found: [], history: [] };
  const queued = st.found.filter((c) => c.status === 'en-cola').length;
  const suggested = st.found.filter((c) => c.status === 'sugerencia').length;
  const working = st.found.find((c) => c.status === 'procesando');
  const tile = (label, value, sub = '') => `<div class="card stat"><div class="label">${label}</div><div class="value" style="font-size:22px">${value}</div>${sub ? `<div class="muted tiny">${sub}</div>` : ''}</div>`;
  $('#pilotStatus').innerHTML = [
    tile('Estado', st.checking ? 'Revisando…' : working ? 'Clipeando' : P.activo ? 'Vigilando' : 'Apagado', working ? esc(working.title.slice(0, 40)) : P.activo ? `Última revisión ${ago(st.lastCheck)}` : 'Enciéndelo arriba a la derecha'),
    tile('Próxima revisión', P.activo && st.nextCheck ? hhmm(Math.max(Date.now(), st.nextCheck)) : '—', `Cada ${P.revisarCadaMin} min`),
    tile('Videos hoy', `${st.todayCount || 0} / ${P.maxVideosDia}`, 'Los directos no cuentan'),
    tile('Esperando', String(queued), suggested ? `${suggested} sugerencia${suggested === 1 ? '' : 's'} para revisar` : 'En la cola'),
  ].join('');
  const noPerm = P.soloConPermiso !== false && !(P.canales || []).some((c) => c.permiso);
  const nothing = !(P.canales || []).length && !(P.temas || []).length;
  $('#pilotWarn').innerHTML = nothing ? '<div class="warn-box"><span style="font-size:22px">👇</span><div><b>Empieza agregando canales o temas</b><div class="muted tiny">El piloto revisa cada tanto y te avisa cuando encuentra algo.</div></div></div>'
    : noPerm ? '<div class="warn-box"><span style="font-size:22px">✋</span><div><b>Ningún canal tiene "Tengo permiso"</b><div class="muted tiny">Así el piloto solo te sugiere videos y no clipea nada solo. Marca los canales de creadores que te autorizaron.</div></div></div>' : '';
  const found = [...st.found].sort((a, b) => (FOUND_ORDER[a.status] ?? 9) - (FOUND_ORDER[b.status] ?? 9) || b.foundAt - a.foundAt).slice(0, 80);
  $('#foundCount').textContent = found.length ? `— ${found.length}` : '';
  $('#foundList').innerHTML = found.map(foundRow).join('') || '<div class="empty" style="padding:24px"><div class="big" style="font-size:38px">🛰️</div><div class="muted">Aún no encontró nada. Agrega canales o temas y toca "Revisar ahora".</div></div>';
  $$('[data-fact]', $('#foundList')).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-found]').dataset.found;
    const c = st.found.find((x) => x.id === id);
    if (b.dataset.fact === 'ver') return api.openUrl(c.url);
    if (b.dataset.fact === 'sugeridos') return go('sugeridos');
    if (b.dataset.fact === 'clipear' && c.source?.type === 'tema' && !(await confirmBox('¿Clipear este video?', `Es de "${c.channel}". Asegúrate de tener permiso del creador antes de publicar sus clips.`, 'Clipear'))) return;
    await api.pilotDecide(id, b.dataset.fact);
    if (b.dataset.fact === 'clipear') toast(isRunning() ? 'En cola: empieza cuando termine lo que se está clipeando' : 'Empezando…', 'ok', '✂️');
  }));
  const log = [...(st.history || [])].reverse().slice(0, 60);
  $('#pilotLog').innerHTML = log.map((l) => `<div class="feed-item ${l.kind}"><time>${hhmm(l.at)}</time><span>${esc(l.text)}</span></div>`).join('') || '<div class="muted tiny">Sin actividad todavía.</div>';
}

api.onPilotUpdate((st) => { S.pilot = st; renderPilotDynamic(); updateNavBadges(); });
api.onEngineStarted(({ origin }) => {
  S.logs = []; S.activity = []; S.done = null; S.producing = null;
  if (origin?.type === 'piloto') toast(origin.kind === 'live' ? 'Piloto: grabando un directo' : 'Piloto: clipeando un video nuevo', 'info', '🛰️');
});

// ======================= Estadísticas =======================
function bars(rows, { label = (r) => r.label, value = (r) => r.median, sub = (r) => `${r.posts} publ.` } = {}) {
  const max = Math.max(1, ...rows.map(value));
  return `<div class="bars">${rows.map((r) => `<div class="bar-row"><span class="bar-label" title="${esc(label(r))}">${esc(label(r))}</span>
    <div class="bar"><span style="width:${Math.max(3, (value(r) / max) * 100)}%"></span></div><b>${fmtShort(value(r))}</b><span class="muted tiny">${esc(sub(r))}</span></div>`).join('')}</div>`;
}

async function renderStats(el) {
  const [st, social] = await Promise.all([api.statsState().catch(() => ({})), api.socialList().catch(() => S.social || [])]);
  S.stats = st;
  S.social = social;
  if (S.page !== 'stats') return;
  const t = st.totals || { views: 0, likes: 0, posts: 0, byPlatform: {} };
  const fol = st.followers || {};
  const folTotal = Object.values(fol).reduce((a, f) => a + (f.count || 0), 0);
  const folWeek = Object.values(fol).reduce((a, f) => a + (f.week || 0), 0);
  const connected = social.filter((p) => p.connected);
  const reconnect = social.filter((p) => p.needsReconnect);
  const errors = Object.entries(st.errors || {});
  el.innerHTML = `
    <div class="page-head"><div><h1>${L('Estadísticas', 'Statistics')}</h1><p class="muted">${L('Cómo le va a lo que publicas y qué aprendió ClipViral de tus números.', 'How your posts perform: views, likes and comments read from your connected accounts.')}</p></div>
      <div style="display:flex;gap:10px;align-items:center"><span class="muted tiny">${L('Actualizado', 'Updated')} ${ago(st.lastRefresh)}</span><button class="btn small" id="statsRefresh">${I.sparkles}<span>${L('Actualizar', 'Refresh')}</span></button></div></div>
    ${!connected.length ? `<div class="warn-box"><span style="font-size:22px">🔗</span><div><b>${L('Conecta tus redes', 'Connect your networks')}</b><div class="muted tiny">${L('Las estadísticas salen de lo que subes con ClipViral a tus cuentas.', 'Statistics come from what you post with ClipViral.')}</div></div><button class="btn small primary" data-go="redes"><span>${L('Ir a Redes', 'Go to Networks')}</span></button></div>` : ''}
    ${reconnect.length ? `<div class="warn-box"><span style="font-size:22px">🔄</span><div><b>${L(`Vuelve a conectar ${reconnect.map((p) => NET[p.id].short).join(' y ')}`, `Reconnect ${reconnect.map((p) => NET[p.id].short).join(' and ')}`)}</b><div class="muted tiny">${L('Se conectó antes de que ClipViral pidiera permiso para leer las vistas. Sigue subiendo normal, pero sin estadísticas.', 'It was connected before ClipViral asked for permission to read views.')}</div></div><button class="btn small primary" data-go="redes"><span>${L('Reconectar', 'Reconnect')}</span></button></div>` : ''}
    ${errors.map(([p, msg]) => `<div class="warn-box"><span style="font-size:22px">⚠️</span><div><b>${esc(NET[p]?.short || p)}</b><div class="muted tiny">${esc(msg)}</div></div></div>`).join('')}
    <div class="grid cols-4 stagger" style="margin-bottom:16px">
      <div class="card stat"><div class="label">${I.eye} ${L('Vistas', 'Views')}</div><div class="value">${fmtShort(t.views)}</div><div class="muted tiny">${L('últimos 30 días', 'last 30 days')}</div></div>
      <div class="card stat"><div class="label">❤️ ${L('Me gusta', 'Likes')}</div><div class="value">${fmtShort(t.likes)}</div><div class="muted tiny">${fmtShort(t.comments)} ${L('comentarios', 'comments')}</div></div>
      <div class="card stat"><div class="label">${I.upload} ${L('Publicaciones', 'Posts')}</div><div class="value">${fmtNum(t.posts)}</div><div class="muted tiny">${L('con números', 'with numbers')}</div></div>
      <div class="card stat"><div class="label">👥 ${L('Seguidores', 'Followers')}</div><div class="value">${fmtShort(folTotal)}</div><div class="muted tiny">${folWeek ? `${folWeek > 0 ? '+' : ''}${fmtShort(folWeek)} ${L('esta semana', 'this week')}` : L('en todas tus redes', 'across your networks')}</div></div>
    </div>
    <div class="nets stagger" style="margin-bottom:16px">${connected.map((p) => {
    const bp = t.byPlatform?.[p.id] || { posts: 0, views: 0 };
    const f = fol[p.id] || {};
    return `<div class="card net on"><div class="net-head"><span class="net-logo" style="background:${NET[p.id].color}">${NET[p.id].icon}</span>
        <div class="grow"><b>${NET[p.id].short}</b><div class="muted tiny">${esc(p.account?.name || '')}</div></div></div>
        <div class="mini-stats"><div><b>${fmtShort(bp.views)}</b><span>${L('vistas', 'views')}</span></div><div><b>${bp.posts}</b><span>${L('publ.', 'posts')}</span></div>
        <div><b>${f.count !== null && f.count !== undefined ? fmtShort(f.count) : '—'}</b><span>${L('seguidores', 'followers')}${f.week ? ` (${f.week > 0 ? '+' : ''}${fmtShort(f.week)})` : ''}</span></div></div></div>`;
  }).join('')}</div>
    <div class="grid cols-2 stagger">
      <div class="card"><h3>🏆 ${L('Tus mejores clips', 'Your best clips')}</h3>
        <div class="job-list">${(st.top || []).map((c) => `<div class="job">${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="">` : '<div class="job-thumb"></div>'}
          <div class="grow"><b class="job-title">${esc(c.title)}</b><div class="muted tiny"><span style="color:${NET[c.platform].color}">${NET[c.platform].icon}</span> ${NET[c.platform].short} · ${new Date(c.publishedAt).toLocaleDateString(L('es', 'en'), { day: 'numeric', month: 'short' })}${c.likes !== undefined ? ` · ❤️ ${fmtShort(c.likes)}` : ''}${c.comments !== undefined ? ` · 💬 ${fmtShort(c.comments)}` : ''}</div></div>
          <span class="badge ok">${fmtShort(c.views)} ${L('vistas', 'views')}</span>${c.url ? `<button class="btn small ghost" data-open="${esc(c.url)}">${L('Ver', 'View')} ↗</button>` : ''}</div>`).join('')
    || `<div class="empty" style="padding:24px"><div class="big" style="font-size:38px">📊</div><div class="muted">${L('Cuando subas clips con ClipViral, aquí verás cuáles funcionan mejor.', 'When you post clips with ClipViral, you will see here which ones perform best.')}</div></div>`}</div></div>
      <div class="card"><h3>🧠 ${L('Lo que funciona', 'What works')}</h3>
        ${st.ready ? `<ul class="findings">${(st.findings || []).map((f) => `<li>${esc(f)}</li>`).join('') || '<li>Por ahora todo rinde parecido. Sigue publicando y vuelvo a mirar.</li>'}</ul>
          ${Object.keys(st.bestHours || {}).length ? `<div class="setting"><div class="grow"><b>Mejores horas</b><small>Clips sugeridos las usa para proponerte cuándo subir.</small></div></div>
          ${Object.entries(st.bestHours).map(([p, hs]) => `<div class="chips" style="margin-bottom:6px"><span class="net-dot" style="background:${NET[p].color}">${NET[p].icon}</span>${hs.map((h) => `<span class="chip">${h}:00</span>`).join('')}</div>`).join('')}` : ''}
          ${st.bestClipSeconds ? `<p class="muted tiny">⏱️ El piloto ya usa clips de unos ${st.bestClipSeconds} segundos.</p>` : ''}
          <p class="muted tiny">✨ Claude usa esto para elegir y titular los clips nuevos.</p>`
    : `<div class="empty" style="padding:24px"><div class="big" style="font-size:38px">🌱</div><div><b>${L('Aprendiendo…', 'Learning…')}</b></div><div class="muted tiny">${L(`Necesito al menos ${st.minPosts || 5} publicaciones con más de un día para sacar conclusiones. Llevas ${st.maturePosts || 0}.`, `ClipViral needs at least ${st.minPosts || 5} posts older than one day to find patterns. You have ${st.maturePosts || 0}.`)}</div></div>`}
      </div>
      ${(st.byLength || []).length ? `<div class="card"><h3>📏 Vistas según el largo del clip</h3><p class="muted tiny">Vistas típicas (mediana) por publicación.</p>${bars(st.byLength)}</div>` : ''}
      ${(st.bySource || []).length ? `<div class="card"><h3>📺 Vistas según el canal o tema</h3><p class="muted tiny">De dónde salen los clips que mejor te van.</p>${bars(st.bySource.slice(0, 8), { label: (r) => r.name })}</div>` : ''}
    </div>`;
  $('#statsRefresh').onclick = (e) => withLoading(e.currentTarget, async () => {
    try { await api.statsRefresh(); toast(L('Números actualizados', 'Numbers updated'), 'ok', '📊'); renderPage(false); } catch (err) { toast(err.message, 'bad'); }
  });
  $$('[data-go]', el).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  $$('[data-open]', el).forEach((b) => { b.onclick = () => api.openUrl(b.dataset.open); });
}
api.onStatsUpdate((st) => { S.stats = st; });

// ======================= Competencia =======================
const COMP_NET = { youtube: { name: 'YouTube', color: '#ff0033', icon: '▶' }, instagram: { name: 'Instagram', color: '#e1306c', icon: '◎' } };

async function renderCompetencia(el) {
  const [c, social] = await Promise.all([api.compState().catch(() => ({ results: [], cuentas: [] })), api.socialList().catch(() => S.social || [])]);
  S.comp = c;
  S.social = social;
  if (S.page !== 'competencia') return;
  const plan = S.user.plan;
  const fb = (S.social || []).find((p) => p.id === 'facebook');
  const igReady = !!fb?.account?.igBusinessId;
  const rep = c.report;
  el.innerHTML = `
    <div class="page-head"><div><h1>Competencia</h1><p class="muted">Mira qué publican otras cuentas, qué les funciona y qué podrías hacer tú esta semana.</p></div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn small" id="compNums" ${c.busy ? 'disabled' : ''}>${I.eye}<span>Actualizar números</span></button>
        <button class="btn small primary" id="compReport" ${c.busy ? 'disabled' : ''}>${I.sparkles}<span>${c.busy ? 'Analizando…' : 'Informe con IA'}</span></button></div></div>
    <div class="card pop-in" style="margin-bottom:16px">
      <h3>➕ Agregar una cuenta</h3>
      <div class="url-box small-box"><select id="compNet" style="max-width:150px"><option value="youtube">YouTube</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select>
        <input id="compUser" placeholder="youtube.com/@canal  o  @canal" spellcheck="false"/><button class="btn small primary" id="compAdd"><span>Agregar</span></button></div>
      <p class="muted tiny" id="compHelp">YouTube: se leen sus videos y Shorts recientes con las vistas. No hace falta permiso.</p>
      <div class="setting"><div class="grow"><b>Informe automático cada semana</b><small>${plan.usesAi ? 'Claude lo escribe solo y te llega una notificación.' : 'El informe con IA es parte del plan Pro IA.'}</small></div>
        <label class="toggle"><input type="checkbox" id="compAuto" ${S.settings.competencia?.informeAuto !== false ? 'checked' : ''}/><span></span></label></div>
    </div>
    ${c.reportError ? `<div class="warn-box"><span style="font-size:22px">⚠️</span><div><b>No salió el informe</b><div class="muted tiny">${esc(c.reportError)}</div></div></div>` : ''}
    ${rep ? `<div class="card pop-in report" style="margin-bottom:16px">
      <h3>✨ Informe de la semana <span class="muted tiny" style="font-weight:400">${new Date(c.reportAt).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}</span></h3>
      <p>${esc(rep.resumen)}</p>
      <div class="grid cols-2">
        <div><h4>💡 Ideas para esta semana</h4><ul class="findings">${(rep.ideas || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>
        <div>${(rep.competidores || []).map((x) => `<h4>${esc(x.nombre)}</h4><ul class="findings">${(x.queLeFunciona || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</div>
      </div>
      ${(rep.alertas || []).length ? `<h4>🚨 Atención</h4><ul class="findings">${rep.alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      ${(rep.temasSugeridos || []).length ? `<h4>🛰️ Para vigilar con el piloto</h4><div class="chips">${rep.temasSugeridos.map((t) => `<button class="chip" data-watch="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
    </div>` : ''}
    <div class="grid cols-2 stagger">${(c.cuentas || []).map((cu, i) => {
    const r = (c.results || []).find((x) => x.key === cu.usuario);
    const N = COMP_NET[cu.plataforma];
    const sm = r?.summary;
    const metric = sm?.metric === 'likes' ? 'me gusta' : 'vistas';
    return `<div class="card comp-card">
        <div class="net-head"><span class="net-logo" style="background:${N.color}">${N.icon}</span>
          <div class="grow"><b>${esc(r?.name || cu.usuario)}</b><div class="muted tiny">${N.name}${r?.followers ? ` · ${fmtShort(r.followers)} seguidores` : ''}</div></div>
          <button class="icon-btn" data-cdel="${i}" title="Quitar">${I.trash}</button></div>
        ${!r ? '<p class="muted tiny">Toca "Actualizar números" para ver sus datos.</p>'
    : r.error ? `<p class="tiny" style="color:#fca5a5">${esc(r.error)}</p>`
      : `<div class="mini-stats"><div><b>${sm.postsWeek}</b><span>publ. esta semana</span></div><div><b>${fmtShort(sm.median)}</b><span>${metric} típicas</span></div>
          <div><b>${sm.avgDuration ? `${sm.avgDuration} s` : '—'}</b><span>duración típica</span></div></div>
          <div class="job-list">${sm.best.map((p) => `<div class="job compact"><div class="grow"><b class="job-title">${esc(p.title || '(sin texto)')}</b>
            <div class="muted tiny">${p.kind === 'short' || p.kind === 'reel' ? '📱 ' : ''}${p.date || ''}</div></div><span class="badge">${fmtShort(sm.metric === 'likes' ? p.likes : p.views)} ${metric}</span>
            ${p.url ? `<button class="btn small ghost" data-open="${esc(p.url)}">Ver</button>` : ''}</div>`).join('')}</div>`}
      </div>`;
  }).join('') || '<div class="card"><div class="empty" style="padding:24px"><div class="big" style="font-size:38px">🕵️</div><div class="muted">Agrega cuentas que publiquen clips parecidos a los tuyos.</div></div></div>'}</div>
    ${c.checkedAt ? `<p class="muted tiny" style="margin-top:10px">Números de ${ago(c.checkedAt)}.</p>` : ''}`;

  const help = {
    youtube: ['youtube.com/@canal  o  @canal', 'YouTube: se leen sus videos y Shorts recientes con las vistas. No hace falta permiso.'],
    instagram: ['@cuenta', igReady ? 'Instagram: se leen sus publicaciones con "me gusta" y comentarios (Instagram no muestra las vistas de otras cuentas). Debe ser una cuenta profesional.'
      : canPublish() ? '⚠️ Para Instagram conecta Facebook (sección Redes) con una página que tenga tu Instagram profesional unido.'
        : '⚠️ Instagram todavía no está disponible en tu plan. Usa YouTube para ver a la competencia.'],
    tiktok: ['', 'TikTok no deja que las apps vean los números de otras cuentas. Si esa persona también sube a YouTube o Instagram, agrégala ahí.'],
  };
  $('#compNet').onchange = (e) => { const [ph, tx] = help[e.target.value]; $('#compUser').placeholder = ph; $('#compUser').disabled = e.target.value === 'tiktok'; $('#compHelp').textContent = tx; };
  const add = () => withLoading($('#compAdd'), async () => {
    try {
      await api.compAdd({ plataforma: $('#compNet').value, usuario: $('#compUser').value });
      S.settings = await api.getSettings();
      toast('Cuenta agregada. Leyendo sus números…', 'ok', '🕵️');
      renderPage(false);
      api.compAnalyze({}).catch(() => {});
    } catch (err) { toast(err.message, 'bad'); }
  });
  $('#compAdd').onclick = add;
  $('#compUser').onkeydown = (e) => { if (e.key === 'Enter') add(); };
  $('#compAuto').onchange = async (e) => { S.settings = await api.setSettings({ competencia: { informeAuto: e.target.checked } }); };
  $('#compNums').onclick = () => api.compAnalyze({}).catch((err) => toast(err.message, 'bad'));
  $('#compReport').onclick = () => {
    if (!plan.usesAi) { toast('El informe con IA es parte del plan Pro IA', 'info', '✨'); return setTimeout(() => go('plan'), 600); }
    api.compAnalyze({ withReport: true }).then((r) => { if (r.report && !r.reportError) { confetti(); toast('Informe listo', 'ok', '✨'); } }).catch((err) => toast(err.message, 'bad'));
  };
  $$('[data-cdel]', el).forEach((b) => b.addEventListener('click', async () => { await api.compRemove(Number(b.dataset.cdel)); S.settings = await api.getSettings(); renderPage(false); }));
  $$('[data-open]', el).forEach((b) => { b.onclick = () => api.openUrl(b.dataset.open); });
  $$('[data-watch]', el).forEach((b) => b.addEventListener('click', async () => {
    const temas = S.settings.piloto.temas || [];
    if (!temas.some((t) => t.texto.toLowerCase() === b.dataset.watch.toLowerCase())) await savePilot({ temas: [...temas, { texto: b.dataset.watch.slice(0, 60) }] });
    b.disabled = true;
    toast(`"${b.dataset.watch}" agregado a los temas del piloto`, 'ok', '🛰️');
  }));
}
api.onCompUpdate((c) => {
  const was = S.comp?.busy;
  S.comp = c;
  if (S.page === 'competencia') renderPage(false);
  if (was && !c.busy && c.reportAt && Date.now() - c.reportAt < 60000 && !document.hasFocus()) toast('Informe de competencia listo', 'ok', '✨');
});
