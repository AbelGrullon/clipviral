// Análisis de rendimiento de la PC y configuración sugerida.

const LEVEL = {
  potente: { label: 'Potente', emoji: '🚀', badge: 'ok', text: 'Tu PC puede con todo: clips rápidos y en alta calidad.' },
  buena: { label: 'Buena', emoji: '👍', badge: 'ok', text: 'Tu PC funciona bien con ClipViral. Ajustamos algunas cosas para que vaya fluido.' },
  basica: { label: 'Básica', emoji: '🐢', badge: 'warn', text: 'Tu PC es sencilla. Usamos una configuración liviana para que no se atrase.' },
};
const PART = { alto: ['ok', 'Muy bien'], medio: ['warn', 'Bien'], bajo: ['bad', 'Justo'], ninguna: ['', 'No tiene'] };
const PERF_STEPS = ['Revisando el procesador', 'Midiendo la memoria', 'Buscando la tarjeta de video', 'Probando cómo crea video', 'Armando tu configuración'];

function perfGauge(score) {
  const c = 2 * Math.PI * 42;
  return `<svg class="gauge" viewBox="0 0 100 100" aria-label="Nota ${score} de 100">
    <defs><linearGradient id="gaugeGrad" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#3a6cff"/><stop offset="1" stop-color="#9dbaff"/></linearGradient></defs>
    <circle cx="50" cy="50" r="42" class="gauge-bg"/>
    <circle cx="50" cy="50" r="42" class="gauge-fg" stroke="url(#gaugeGrad)" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}" style="--to:${(c * (1 - score / 100)).toFixed(1)}"/>
    <text x="50" y="57" text-anchor="middle">${score}</text></svg>`;
}

function perfSpecs(r) {
  const { hw, levels: lv } = r;
  const disk = hw.diskFreeGb;
  const rows = [
    ['🧠', 'Procesador', hw.cpu.model, `${hw.cpu.threads} hilos`, lv.cpu],
    ['💾', 'Memoria RAM', `${Math.round(hw.ramGb)} GB`, `${hw.freeRamGb.toFixed(1)} GB libres ahora`, lv.ram],
    ['🎮', 'Tarjeta de video', hw.gpu ? hw.gpu.name : 'Sin NVIDIA', hw.gpu ? `${Math.round(hw.gpu.vramGb)} GB de memoria de video` : 'Todo lo hace el procesador', lv.gpu],
    ['🎬', 'Crear los clips', hw.nvenc ? 'Con la NVIDIA' : hw.encodeFps ? 'Con el procesador' : 'Sin medir',
      hw.encodeFps ? `Prueba: ${hw.encodeFps} cuadros por segundo` : 'Se mide cuando FFmpeg esté instalado', hw.nvenc ? 'alto' : hw.encodeFps ? lv.cpu : null],
    ['💽', 'Espacio libre', disk == null ? '—' : `${Math.round(disk)} GB`, 'En el disco de los clips', disk == null ? null : disk >= 30 ? 'alto' : disk >= 10 ? 'medio' : 'bajo'],
  ];
  return `<div class="spec-grid">${rows.map(([icon, name, value, sub, level], i) => `
    <div class="spec" style="animation-delay:${i * 70}ms"><span class="spec-icon">${icon}</span>
      <div class="grow"><div class="muted tiny">${name}</div><b title="${esc(value)}">${esc(value)}</b><div class="muted tiny">${esc(sub)}</div></div>
      ${level ? `<span class="badge ${PART[level][0]}">${PART[level][1]}</span>` : ''}</div>`).join('')}</div>`;
}

function extraButtonLabel(accion) {
  if (accion.startsWith('instalar:') || accion.startsWith('ollama:')) return 'Instalar';
  if (accion === 'descargar-ollama') return 'Descargar';
  return 'Elegir';
}

function perfBody(r, { head = true } = {}) {
  const L = LEVEL[r.levels.overall];
  return `
    ${head ? `<div class="perf-head">${perfGauge(r.levels.score)}
      <div><div class="muted tiny">Tu PC es</div><div class="perf-level">${L.emoji} ${L.label}</div><p class="muted" style="margin:4px 0 0">${L.text}</p></div></div>` : ''}
    ${perfSpecs(r)}
    <h3 class="perf-sub">⚙️ Configuración sugerida</h3>
    ${r.changes.length
    ? `<div class="changes">${r.changes.map((c, i) => `
        <div class="change" style="animation-delay:${i * 80}ms"><div class="grow"><b>${esc(c.label)}</b><div class="muted tiny">${esc(c.why)}</div></div>
          <span class="from">${esc(c.from)}</span><span class="arrow">→</span><span class="to">${esc(c.to)}</span></div>`).join('')}</div>`
    : '<div class="ideal">✅ Tu configuración ya es la ideal para esta PC.</div>'}
    ${r.extras.length ? `<h3 class="perf-sub">✨ Mejoras opcionales</h3>
      ${r.extras.map((x) => {
    const comp = x.accion.startsWith('instalar:') ? x.accion.slice(9) : null;
    const busy = comp && isInstalling(comp);
    const pr = (comp && progressState[comp]) || {};
    return `<div class="req aviso" data-req="${esc(x.id)}" ${comp ? `data-req-install="${esc(comp)}"` : ''}><span class="req-icon">${busy ? '⏬' : '✨'}</span>
        <div class="grow"><b>${esc(x.label)}</b><div class="muted tiny">${esc(x.why)}</div>
          <div class="prog ${busy ? '' : 'hidden'}"><div class="progress"><span style="width:${Math.round((pr.frac || 0) * 100)}%"></span></div><div class="ptext tiny muted">${esc(pr.text || '')}</div></div></div>
        ${busy ? '<button class="btn small" disabled><span>Descargando…</span></button>' : `<button class="btn small" data-fix="${esc(x.accion)}"><span>${extraButtonLabel(x.accion)}</span></button>`}</div>`;
  }).join('')}` : ''}`;
}

function perfLoading() {
  return `<div class="perf-loading">${PERF_STEPS.map((t, i) => `
    <div class="pstep" style="animation-delay:${i * 0.55}s"><span class="spinner"></span><span>${t}…</span></div>`).join('')}</div>`;
}

/** Espera a que no haya otra ventana abierta encima (para no amontonarlas). */
function whenNoModal() {
  return new Promise((resolve) => {
    const t = setInterval(() => { if (!$('#modalRoot').children.length) { clearInterval(t); resolve(); } }, 300);
  });
}

async function applyPerf() {
  S.settings = await api.perfApply();
  if (S.perf) S.perf = { ...S.perf, changes: [], patch: {}, key: '' };
  toast('Configuración aplicada', 'ok', '⚡');
  S.comps = await api.componentsStatus().catch(() => S.comps);
  if (S.page === 'directo' || S.page === 'ajustes') renderPage(false);
  // Si el cambio necesita descargar algo (por ejemplo otro modelo de voz), lo pedimos enseguida.
  api.systemCheck(S.settings.mode).then((r) => { S.system = r; if (!r.ok) whenNoModal().then(() => showRequirements(r)); }).catch(() => {});
}

/** Ventana "Análisis de tu PC". Sin resultado, muestra el análisis en vivo. Se resuelve al cerrarla. */
function showPerfModal(initial) {
  return new Promise((resolve) => {
    let current = initial;
    let decided = false;
    const m = modal(`<div data-perfmodal>
      <div class="perf-icon">⚡</div>
      <h2>Análisis de tu PC</h2>
      <p class="muted">Medimos tu PC para que ClipViral vaya rápido y sin trabarse.</p>
      <div id="perfBody"></div>
      <div class="modal-actions" id="perfActions"></div></div>`, {
      onClose: () => { if (!decided && current) api.perfDismiss(current.key).catch(() => {}); resolve(); },
    });
    const body = $('#perfBody', m.el);
    const actions = $('#perfActions', m.el);
    const fill = (r) => {
      current = r;
      S.perf = r;
      body.innerHTML = perfBody(r);
      bindReqButtons(body, async () => fill(await api.perfAnalyze()));
      actions.innerHTML = r.changes.length
        ? '<button class="btn ghost" data-later>Ahora no</button><button class="btn primary" data-apply><span>Aplicar configuración</span></button>'
        : '<button class="btn primary" data-later><span>Listo</span></button>';
      $('[data-later]', m.el).onclick = () => { decided = true; api.perfDismiss(r.key).catch(() => {}); m.close(); };
      $('[data-apply]', m.el)?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
        decided = true;
        await applyPerf();
        m.close();
      }));
      if (S.page === 'ajustes') renderPerfCard($('#perfCard'));
    };
    if (initial) return fill(initial);
    body.innerHTML = perfLoading();
    actions.innerHTML = '<button class="btn ghost" data-later>Cerrar</button>';
    $('[data-later]', m.el).onclick = () => m.close();
    const started = Date.now();
    api.perfAnalyze()
      // Dejamos ver los pasos un momento aunque la PC sea muy rápida.
      .then(async (r) => { S.perf = r; await new Promise((ok) => setTimeout(ok, Math.max(0, 2600 - (Date.now() - started)))); if (m.el.isConnected) fill(r); })
      .catch((err) => { body.innerHTML = `<p class="muted">No se pudo analizar la PC: ${esc(err.message)}</p>`; });
  });
}

/** Al abrir la app: la primera vez enseña el análisis; después solo avisa si hay algo nuevo que mejorar. */
async function startupPerf(state) {
  if (!state.seen) return showPerfModal(null);
  const r = await api.perfAnalyze().catch(() => null);
  if (!r) return;
  S.perf = r;
  if (S.page === 'ajustes') renderPerfCard($('#perfCard'));
  if (r.changes.length && r.key !== r.dismissedKey) {
    await whenNoModal();
    await showPerfModal(r);
  }
}

/** Tarjeta "Rendimiento de tu PC" en Ajustes. */
function renderPerfCard(el) {
  if (!el?.isConnected) return;
  const r = S.perf;
  const L = r && LEVEL[r.levels.overall];
  el.innerHTML = `<h3>⚡ Rendimiento de tu PC ${r ? `<span class="badge ${L.badge}" style="margin-left:auto">${L.emoji} ${L.label} · ${r.levels.score}/100</span>` : ''}</h3>
    <div>${r ? perfBody(r, { head: false }) : perfLoading()}</div>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:12px">
      <button class="btn small" data-perf-again>Analizar de nuevo</button>
      ${r?.changes.length ? '<button class="btn small primary" data-perf-apply><span>Aplicar configuración sugerida</span></button>' : ''}</div>`;
  const again = async () => { S.perf = await api.perfAnalyze(); renderPerfCard(el); };
  if (!r) { again().catch(() => {}); return; }
  bindReqButtons(el, again);
  $('[data-perf-again]', el).onclick = (e) => withLoading(e.currentTarget, async () => { await again(); toast('Análisis listo', 'ok', '⚡'); });
  $('[data-perf-apply]', el)?.addEventListener('click', (e) => withLoading(e.currentTarget, applyPerf));
}
