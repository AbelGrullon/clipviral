// ======================= Agente de contenido (solo admin) =======================
// Maneja solo una página de Facebook nueva. Esta pantalla muestra lo que hace, sus números y sus ajustes.

const AG_TIPO = { narrado: { icon: '🎙️', name: 'Narrado' }, serie: { icon: '🎬', name: 'Episodio' } };
const AG_LOG = { ok: '✅', publicado: '📤', idea: '💡', plan: '🧭', error: '⚠️', espera: '⏸️', pausa: '⏸️', info: 'ℹ️', logro: '🏆' };
const AG_PASO = { voces: '🎙️', plan: '🧭', idea: '💡', voz: '🎙️', subtitulos: '💬', fondo: '🖼️', video: '🎞️', serie: '🎬', publicar: '📤', numeros: '📊' };
const agWhen = (ms) => new Date(ms).toLocaleString('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const agUsd = (n) => `${Number(n || 0).toFixed(2)} USD`;
const agLocalInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

async function renderAgente(el) {
  el.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
  try { S.agent = await api.agentState(); } catch (err) { el.innerHTML = `<div class="warn-box">${esc(err.message)}</div>`; return; }
  if (S.page !== 'agente') return;
  el.innerHTML = '<div id="agDyn"></div><div id="agSettings"></div>';
  agRenderDynamic();
  agRenderSettings();
  // El estado del servidor (página, gasto) se pide aparte: si el servidor no responde, la pantalla igual se ve.
  api.agentRemote().then((st) => { S.agent = st; if (S.page === 'agente') { agRenderDynamic(); agRenderSettings(); } })
    .catch((err) => toast(`No pude hablar con el servidor: ${err.message}`, 'bad'));
}

function agSvgBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  const w = 100 / rows.length;
  return `<svg class="ag-chart" viewBox="0 0 100 46" preserveAspectRatio="none">${rows.map((r, i) => {
    const h = (r.views / max) * 38;
    return `<rect x="${i * w + w * 0.18}" y="${40 - h}" width="${w * 0.64}" height="${Math.max(0.6, h)}" rx="0.8"><title>${new Date(r.day).toLocaleDateString('es', { day: 'numeric', month: 'short' })}: ${fmtShort(r.views)} vistas</title></rect>`;
  }).join('')}</svg><div class="ag-axis"><span>${new Date(rows[0].day).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span><span>hoy</span></div>`;
}

function agSvgLine(points) {
  if (points.length < 2) return '<div class="muted tiny" style="padding:18px 0">Hacen falta al menos dos días de números para dibujar la línea.</div>';
  const xs = points.map((p) => p.at);
  const ys = points.map((p) => p.count);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (x) => (x1 === x0 ? 50 : ((x - x0) / (x1 - x0)) * 100);
  const py = (y) => (y1 === y0 ? 20 : 40 - ((y - y0) / (y1 - y0)) * 36);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.at).toFixed(2)},${py(p.count).toFixed(2)}`).join(' ');
  return `<svg class="ag-chart" viewBox="0 0 100 46" preserveAspectRatio="none"><path d="${d} L100,44 L0,44 Z" class="ag-area"/><path d="${d}" class="ag-line"/></svg>
    <div class="ag-axis"><span>${fmtShort(y0)}</span><span>${fmtShort(y1)} seguidores</span></div>`;
}

function agMeta(label, value, goal, pct, note) {
  return `<div class="ag-goal"><div class="ag-goal-head"><b>${label}</b><span>${fmtShort(value)} / ${fmtShort(goal)}</span></div>
    <div class="progress"><span style="width:${Math.max(2, pct)}%"></span></div><div class="muted tiny">${note}</div></div>`;
}

/** Lo que falta para que el agente pueda trabajar. */
function agChecklist(a) {
  const r = a.remoto;
  const h = a.herramientas;
  const items = [];
  if (r && !r.facebook) items.push(['📘', 'Conecta Facebook', 'En Redes, conecta Facebook con un token que incluya la página nueva del agente.', '<button class="btn small primary" data-go="redes">Ir a Redes</button>']);
  else if (r && !r.pagina) items.push(['📘', r.paginaPerdida ? 'La página del agente ya no aparece' : 'Elige la página del agente', r.paginaPerdida ? 'Vuelve a conectar Facebook en Redes marcando la página del agente.' : 'Más abajo, en Ajustes del agente, elige cuál de tus páginas maneja. Si es nueva y no sale, vuelve a conectar Facebook en Redes marcándola.', '<button class="btn small" data-go="redes">Redes</button>']);
  if (r && !r.ia) items.push(['🔑', 'Falta la clave de Claude', 'El cerebro del agente es Claude: pon la clave en Ajustes → Clave de Claude.', '<button class="btn small" data-go="ajustes">Ajustes</button>']);
  if (!h.voz.ok) items.push(['🎙️', 'Sintetizador de voz', h.voz.motivo, '<button class="btn small" data-agfolder="sintetizador">Elegir carpeta</button>']);
  if (a.config.tipos.narrado && !h.whisper.ok) items.push(['💬', 'Subtítulos', h.whisper.motivo, '<button class="btn small" data-go="directo">Ir a Directo</button>']);
  if (a.config.tipos.serie && !h.serie.ok) items.push(['🎬', 'SerieAI', h.serie.motivo, '<button class="btn small" data-agfolder="serieai">Elegir carpeta</button>']);
  return items.map(([icon, t, d, btn]) => `<div class="warn-box"><span style="font-size:22px">${icon}</span><div><b>${esc(t)}</b><div class="muted tiny">${esc(d)}</div></div>${btn}</div>`).join('');
}

function agStatus(a) {
  if (a.busy && a.tarea) {
    const mins = Math.max(0, Math.round((Date.now() - a.tarea.desde) / 60000));
    return `<div class="ag-status busy"><div class="spinner"></div><div class="grow"><b>${AG_PASO[a.tarea.paso] || '⚙️'} ${esc(a.tarea.detalle || 'Trabajando…')}</b>
      <div class="muted tiny">${mins ? `Hace ${mins} min` : 'Ahora mismo'}</div></div><button class="btn small danger" id="agStop">${I.stop}<span>Detener</span></button></div>`;
  }
  if (!a.activo) return '<div class="ag-status"><span class="ag-big">⏸️</span><div class="grow"><b>En pausa</b><div class="muted tiny">Enciéndelo arriba a la derecha y trabajará solo mientras ClipViral esté abierto.</div></div></div>';
  if (a.espera) return `<div class="ag-status warn"><span class="ag-big">⏳</span><div class="grow"><b>Esperando</b><div class="muted tiny">${esc(a.espera.texto)}</div></div></div>`;
  const next = [...a.cola].filter((v) => v.estado === 'listo').sort((x, y) => x.publicarEn - y.publicarEn)[0];
  return `<div class="ag-status ok"><span class="ag-big">🤖</span><div class="grow"><b>Trabajando solo</b><div class="muted tiny">${next ? `Próxima publicación: "${esc(next.titulo)}" el ${esc(agWhen(next.publicarEn))}.` : 'Revisa cada minuto si toca publicar, leer números o hacer el próximo video.'}</div></div></div>`;
}

function agQueueItem(v) {
  const t = AG_TIPO[v.tipo] || AG_TIPO.narrado;
  return `<div class="job ag-item">${v.thumb ? `<img src="${esc(fileUrl(v.thumb))}" alt="">` : '<div class="job-thumb"></div>'}
    <div class="grow" style="min-width:0"><b class="job-title">${esc(v.titulo)}</b>
      <div class="muted tiny">${t.icon} ${t.name} · ${Math.round(v.duracion || 0)} s${v.pilar ? ` · ${esc(v.pilar)}` : ''}</div>
      ${v.estado === 'error' ? `<div class="tiny" style="color:#fca5a5">⚠️ ${esc(v.error || 'No se pudo publicar')}</div>` : ''}
      <div class="ag-when"><span class="muted tiny">Se publica:</span><input type="datetime-local" data-agwhen="${esc(v.id)}" value="${agLocalInput(v.publicarEn)}"></div></div>
    <div class="ag-actions"><button class="btn small ghost" data-agview="${esc(v.archivo)}">${I.play}<span>Ver</span></button>
      <button class="btn small" data-agpub="${esc(v.id)}">${I.upload}<span>Publicar ya</span></button>
      <button class="btn small ghost" data-agdel="${esc(v.id)}" title="Descartar">${I.trash}</button></div></div>`;
}

function agPostItem(p) {
  const t = AG_TIPO[p.tipo] || AG_TIPO.narrado;
  const s = p.stats || {};
  const ret = s.avgWatch && p.duracion ? Math.min(100, Math.round((s.avgWatch / p.duracion) * 100)) : null;
  return `<div class="job ag-item">${p.thumb ? `<img src="${esc(fileUrl(p.thumb))}" alt="">` : '<div class="job-thumb"></div>'}
    <div class="grow" style="min-width:0"><b class="job-title">${esc(p.titulo)}</b>
      <div class="muted tiny">${t.icon} ${t.name} · ${esc(new Date(p.publicadoAt).toLocaleDateString('es', { day: 'numeric', month: 'short' }))}${p.pilar ? ` · ${esc(p.pilar)}` : ''}</div>
      <div class="ag-nums"><span>👁️ ${s.views !== undefined && s.views !== null ? fmtShort(s.views) : '—'}</span><span>❤️ ${s.likes !== undefined && s.likes !== null ? fmtShort(s.likes) : '—'}</span>
        <span>💬 ${s.comments ? fmtShort(s.comments) : '0'}</span><span>🔁 ${s.shares ? fmtShort(s.shares) : '0'}</span>
        ${ret !== null ? `<span title="Cuánto del video ven en promedio">⏱️ ${Math.round(s.avgWatch)} s (${ret}%)</span>` : ''}</div></div>
    ${p.url ? `<button class="btn small ghost" data-open="${esc(p.url)}">Ver ↗</button>` : ''}</div>`;
}

function agRenderDynamic() {
  const box = $('#agDyn');
  if (!box || !S.agent) return;
  const a = S.agent;
  const r = a.remoto || {};
  const pr = a.progreso;
  const plan = a.plan;
  const cola = [...a.cola].sort((x, y) => x.publicarEn - y.publicarEn);
  const pubs = [...a.publicaciones].sort((x, y) => y.publicadoAt - x.publicadoAt);
  const gastoPct = r.tope ? Math.min(100, Math.round((r.gastado / r.tope) * 100)) : 0;
  box.innerHTML = `
    <div class="page-head"><div><h1>🤖 Agente</h1><p class="muted">Maneja solo ${r.pagina ? `la página <b>${esc(r.pagina.name)}</b>` : 'una página de Facebook nueva'}: piensa qué publicar, hace los videos con tus apps, los publica y aprende de los números.</p></div>
      <label class="ag-power ${a.activo ? 'on' : ''}"><span>${a.activo ? 'Encendido' : 'En pausa'}</span><span class="toggle"><input type="checkbox" id="agOn" ${a.activo ? 'checked' : ''}/><span></span></span></label></div>
    ${agChecklist(a)}
    ${agStatus(a)}
    <div class="ag-buttons">
      <button class="btn small primary" id="agNow" ${a.busy ? 'disabled' : ''}>${I.sparkles}<span>Hacer un video ahora</span></button>
      <button class="btn small" id="agNums" ${a.busy ? 'disabled' : ''}>📊 <span>Leer números</span></button>
      <button class="btn small" id="agReplan" ${a.busy ? 'disabled' : ''}>🧭 <span>Rehacer el plan</span></button>
      <button class="btn small ghost" data-agfolder="videos">${I.folder}<span>Videos</span></button>
    </div>
    <div class="grid cols-4 stagger" style="margin:16px 0">
      <div class="card stat"><div class="label">👥 Seguidores</div><div class="value">${fmtShort(pr.seguidores)}</div><div class="muted tiny">${pr.seguidoresSemana !== null ? `${pr.seguidoresSemana >= 0 ? '+' : ''}${fmtShort(pr.seguidoresSemana)} esta semana` : 'de la página'}</div></div>
      <div class="card stat"><div class="label">${I.eye} Vistas</div><div class="value">${fmtShort(pr.vistas30)}</div><div class="muted tiny">últimos 30 días · ${pr.publicaciones30} publ.</div></div>
      <div class="card stat"><div class="label">⏱️ Minutos vistos</div><div class="value">${fmtShort(pr.minutos60)}</div><div class="muted tiny">últimos 60 días (aprox.)</div></div>
      <div class="card stat"><div class="label">💵 Gasto en Claude</div><div class="value">${r.tope !== undefined ? agUsd(r.gastado) : '—'}</div>
        <div class="progress" style="margin:6px 0 4px"><span style="width:${gastoPct}%"></span></div><div class="muted tiny">de ${r.tope !== undefined ? agUsd(r.tope) : '—'} este mes</div></div>
    </div>
    <div class="grid cols-2 stagger" style="margin-bottom:16px">
      <div class="card"><h3>💰 Camino a monetizar</h3>
        ${agMeta('Estrellas', pr.seguidores, pr.metas.estrellas.meta, pr.metas.estrellas.pct, 'Seguidores que pide Facebook para recibir Estrellas (regalos).')}
        ${agMeta('Seguidores', pr.seguidores, pr.metas.seguidores.meta, pr.metas.seguidores.pct, 'Lo más pedido para cobrar por Reels y videos.')}
        ${agMeta('Minutos vistos', pr.minutos60, pr.metas.minutos.meta, pr.metas.minutos.pct, 'En los últimos 60 días.')}
        <p class="muted tiny" style="margin:10px 0 0">Las metas cambian según el país y Facebook las decide. Mira las tuyas en Facebook → Panel profesional → Monetización. Cuando la página las cumpla, la solicitud la haces tú (Facebook pide tus datos y tu cuenta para pagarte).</p></div>
      <div class="card"><h3>📈 Cómo crece</h3>
        <div class="muted tiny" style="margin-bottom:4px">Vistas por día (14 días)</div>${agSvgBars(a.vistasPorDia)}
        <div class="muted tiny" style="margin:12px 0 4px">Seguidores</div>${agSvgLine(a.seguidores.slice(-60))}</div>
    </div>
    <div class="grid cols-2 stagger" style="margin-bottom:16px">
      <div class="card"><h3>🧭 El plan del agente</h3>
        ${plan ? `<p style="margin:0 0 10px">${esc(plan.resumen)}</p>
          <div class="ag-kv"><span>Nicho</span><b>${esc(plan.nicho)}</b></div>
          <div class="ag-kv"><span>Para quién</span><b>${esc(plan.publico)}</b></div>
          <div class="ag-kv"><span>Tono</span><b>${esc(plan.tono)}</b></div>
          <div class="ag-kv"><span>Publica</span><b>${a.porDia} al día · ${plan.horas.slice(0, a.porDia + 1).map((h) => `${h}:00`).join(', ')}</b></div>
          <div class="chips" style="margin-top:10px">${plan.pilares.map((p) => `<span class="chip" title="${esc(p.descripcion)}">${esc(p.nombre)}</span>`).join('')}</div>
          ${a.serie ? `<div class="ag-kv" style="margin-top:10px"><span>Serie</span><b>🎬 ${esc(a.serie.titulo)} · ${a.serie.episodios || 0} episodios</b></div>` : ''}
          <div class="muted tiny" style="margin-top:8px">Hecho el ${esc(agWhen(plan.at))}. Se revisa cada semana con los números.</div>`
    : '<div class="empty" style="padding:24px"><div class="big" style="font-size:38px">🧭</div><div class="muted">Cuando lo enciendas, lo primero que hace es elegir el nicho y armar el plan.</div></div>'}</div>
      <div class="card"><h3>🧠 Lo que aprendió</h3>
        ${a.lecciones.length ? `<ul class="findings">${a.lecciones.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<div class="muted tiny">Todavía nada: necesita publicar y ver los números de unos días.</div>'}</div>
    </div>
    <div class="grid cols-2 stagger" style="margin-bottom:16px">
      <div class="card"><h3>⏭️ Próximas publicaciones <span class="badge">${cola.length}</span></h3>
        <div class="job-list">${cola.map(agQueueItem).join('') || '<div class="muted tiny">No hay videos esperando. El agente los hace con tiempo antes de cada hora de publicar.</div>'}</div></div>
      <div class="card"><h3>📤 Publicado <span class="badge">${pubs.length}</span></h3>
        <div class="job-list">${pubs.slice(0, 40).map(agPostItem).join('') || '<div class="muted tiny">Todavía no publicó nada.</div>'}</div></div>
    </div>
    <div class="card" style="margin-bottom:16px"><h3>📓 Diario del agente</h3>
      <div class="ag-log">${[...a.diario].reverse().slice(0, 80).map((d) => `<div class="ag-log-row ag-t-${esc(d.tipo)}"><span>${AG_LOG[d.tipo] || '•'}</span>
        <div class="grow">${esc(d.texto)}${d.url ? ` <a href="#" data-open="${esc(d.url)}">ver ↗</a>` : ''}${d.costo ? ` <span class="muted tiny">(${agUsd(d.costo)})</span>` : ''}</div>
        <span class="muted tiny">${esc(agWhen(d.at))}</span></div>`).join('') || '<div class="muted tiny">Aquí verás todo lo que hace.</div>'}</div></div>`;
  agBindDynamic(box);
}

function agBindDynamic(box) {
  $('#agOn', box).onchange = async (e) => {
    try { S.agent = await api.agentActivate(e.target.checked); agRenderDynamic(); toast(e.target.checked ? 'Agente encendido' : 'Agente en pausa', 'ok', '🤖'); } catch (err) { toast(err.message, 'bad'); }
  };
  const bg = (fn, msg) => async (e) => {
    try { S.agent = await fn(); agRenderDynamic(); if (msg) toast(msg, 'ok', '🤖'); } catch (err) { toast(err.message, 'bad'); }
  };
  $('#agNow', box).onclick = bg(() => api.agentNow(), 'Haciendo un video… mira el avance arriba.');
  $('#agNums', box).onclick = bg(() => api.agentNumbers(), 'Leyendo los números de Facebook…');
  $('#agReplan', box).onclick = bg(() => api.agentReplan(), 'Rehaciendo el plan con Claude…');
  $('#agStop', box)?.addEventListener('click', bg(() => api.agentStop(), 'Detenido'));
  $$('[data-go]', box).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  $$('[data-open]', box).forEach((b) => { b.onclick = (e) => { e.preventDefault(); api.openUrl(b.dataset.open); }; });
  $$('[data-agfolder]', box).forEach((b) => { b.onclick = bg(() => api.agentFolder(b.dataset.agfolder)); });
  $$('[data-agview]', box).forEach((b) => { b.onclick = () => api.agentOpenVideo(b.dataset.agview).catch((err) => toast(err.message, 'bad')); });
  $$('[data-agpub]', box).forEach((b) => { b.onclick = bg(() => api.agentPublishNow(b.dataset.agpub), 'Publicando en Facebook…'); });
  $$('[data-agdel]', box).forEach((b) => { b.onclick = bg(() => api.agentDiscard(b.dataset.agdel), 'Video descartado'); });
  $$('[data-agwhen]', box).forEach((inp) => {
    inp.onchange = bg(() => api.agentReschedule(inp.dataset.agwhen, new Date(inp.value).getTime()), 'Hora cambiada');
  });
}

function agRenderSettings() {
  const box = $('#agSettings');
  if (!box || !S.agent) return;
  const a = S.agent;
  const c = a.config;
  const r = a.remoto || {};
  const f = a.fondos;
  box.innerHTML = `<div class="card" style="margin-bottom:16px"><h3>⚙️ Ajustes del agente</h3>
    <div class="setting"><div class="grow"><b>Página de Facebook</b><small>La página nueva que maneja el agente (no uses la de tus clips). Si no aparece, vuelve a conectar Facebook en Redes marcándola.</small></div>
      <select id="agPage"><option value="">— Elige la página —</option>${(r.paginas || []).map((p) => `<option value="${esc(p.id)}" ${r.pagina?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="setting"><div class="grow"><b>Tope de gasto en Claude (al mes)</b><small>Al llegar, deja de crear videos nuevos hasta el mes siguiente (lo ya hecho se publica igual). Un video cuesta unos centavos.</small></div>
      <div style="display:flex;gap:8px;align-items:center"><input type="number" id="agCap" min="0" max="500" step="1" value="${r.tope ?? 10}" style="width:90px"><span class="muted">USD</span></div></div>
    <div class="setting"><div class="grow"><b>Videos narrados</b><small>Guion de Claude + voz del Sintetizador + fondo + subtítulos. Rápidos de hacer.</small></div>
      <label class="toggle"><input type="checkbox" id="agNarr" ${c.tipos.narrado ? 'checked' : ''}/><span></span></label></div>
    <div class="setting"><div class="grow"><b>Episodios de SerieAI</b><small>Su propia serie animada (en la carpeta del agente; tu serie no se toca). Tardan horas: uno al día como mucho.</small></div>
      <label class="toggle"><input type="checkbox" id="agSerie" ${c.tipos.serie ? 'checked' : ''}/><span></span></label></div>
    <div class="setting"><div class="grow"><b>Animación de la serie</b><small>3D con Blender (más bonito, más lento) o 2D (dibujos planos, rápido).</small></div>
      <select id="agModo"><option value="3d" ${c.modoSerie === '3d' ? 'selected' : ''}>3D (Blender)</option><option value="2d" ${c.modoSerie === '2d' ? 'selected' : ''}>2D</option></select></div>
    <div class="setting"><div class="grow"><b>Máximo de videos al día</b><small>El agente decide cuántos publica, sin pasar de este número.</small></div>
      <select id="agMax">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${c.maxDia === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="setting"><div class="grow"><b>Avisar que es contenido con IA</b><small>Agrega "🤖 Voz creada con IA" al texto. Meta pide indicar el audio y video realista hecho con IA.</small></div>
      <label class="toggle"><input type="checkbox" id="agAviso" ${c.avisoIa ? 'checked' : ''}/><span></span></label></div>
    <div class="setting"><div class="grow"><b>Fondos de los videos narrados</b><small>${f.videos} videos, ${f.imagenes} fotos y ${f.musica} canciones. Pon ahí material TUYO o libre de derechos (por ejemplo, grabaciones de tus partidas). Si está vacía, usa colores animados.</small></div>
      <button class="btn small" data-agfolder="fondos">${I.folder}<span>Abrir carpeta</span></button></div>
    <div class="setting"><div class="grow"><b>Sintetizador de voz</b><small>${esc(c.sintetizador || 'No encontrado')} · ${a.herramientas.voz.ok ? `✅ ${a.herramientas.voz.voces.length} voces` : `⚠️ ${esc(a.herramientas.voz.motivo)}`}</small></div>
      <button class="btn small ghost" data-agfolder="sintetizador">Cambiar</button></div>
    <div class="setting"><div class="grow"><b>SerieAI</b><small>${esc(c.serieai || 'No encontrado')} · ${a.herramientas.serie.ok ? '✅ listo' : `⚠️ ${esc(a.herramientas.serie.motivo)}`}</small></div>
      <button class="btn small ghost" data-agfolder="serieai">Cambiar</button></div>
    <div class="setting"><div class="grow"><b>Metas de monetización</b><small>Para las barras de progreso. Cámbialas por las que te muestre Facebook.</small></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <label class="muted tiny" style="display:grid;gap:3px">Estrellas<input type="number" id="agGoalStars" min="1" value="${c.metas.estrellas}" style="width:90px"></label>
        <label class="muted tiny" style="display:grid;gap:3px">Seguidores<input type="number" id="agGoalFol" min="1" value="${c.metas.seguidores}" style="width:100px"></label>
        <label class="muted tiny" style="display:grid;gap:3px">Minutos (60 días)<input type="number" id="agGoalMin" min="1" value="${c.metas.minutos}" style="width:120px"></label></div></div>
  </div>`;
  const save = async (patch, msg = 'Guardado') => {
    try { S.agent = await api.agentConfig(patch); agRenderDynamic(); agRenderSettings(); toast(msg, 'ok', '🤖'); } catch (err) { toast(err.message, 'bad'); }
  };
  $('#agPage', box).onchange = async (e) => {
    try { S.agent = await api.agentPage(e.target.value); agRenderDynamic(); agRenderSettings(); toast(e.target.value ? 'Página elegida' : 'Sin página', 'ok', '📘'); } catch (err) { toast(err.message, 'bad'); }
  };
  $('#agCap', box).onchange = async (e) => {
    try { S.agent = await api.agentCap(Number(e.target.value)); agRenderDynamic(); toast('Tope guardado', 'ok', '💵'); } catch (err) { toast(err.message, 'bad'); }
  };
  $('#agNarr', box).onchange = (e) => save({ tipos: { narrado: e.target.checked } });
  $('#agSerie', box).onchange = (e) => save({ tipos: { serie: e.target.checked } });
  $('#agModo', box).onchange = (e) => save({ modoSerie: e.target.value });
  $('#agMax', box).onchange = (e) => save({ maxDia: Number(e.target.value) });
  $('#agAviso', box).onchange = (e) => save({ avisoIa: e.target.checked });
  const goals = () => save({ metas: { estrellas: Number($('#agGoalStars', box).value), seguidores: Number($('#agGoalFol', box).value), minutos: Number($('#agGoalMin', box).value) } }, 'Metas guardadas');
  ['#agGoalStars', '#agGoalFol', '#agGoalMin'].forEach((id) => { $(id, box).onchange = goals; });
  $$('[data-agfolder]', box).forEach((b) => {
    b.onclick = async () => { try { S.agent = await api.agentFolder(b.dataset.agfolder); agRenderDynamic(); agRenderSettings(); } catch (err) { toast(err.message, 'bad'); } };
  });
}

api.onAgentUpdate((st) => {
  S.agent = st;
  // Solo se redibuja la parte que cambia (los ajustes no, para no borrar lo que estés escribiendo).
  if (S.page === 'agente') agRenderDynamic();
});
