'use strict';
// Pantallas nuevas: estilo del clip con vista previa, revisión del sistema, redes sociales y cola de subidas.

const NET = {
  youtube: { name: 'YouTube Shorts', short: 'YouTube', color: '#ff0033', icon: '▶' },
  tiktok: { name: 'TikTok', short: 'TikTok', color: '#25f4ee', icon: '♪' },
  instagram: { name: 'Instagram Reels', short: 'Instagram', color: '#e1306c', icon: '◎' },
  facebook: { name: 'Facebook Reels', short: 'Facebook', color: '#1877f2', icon: 'f' },
};
const HL = { amarillo: '#ffd600', verde: '#00ff7f', rosa: '#ec4899', celeste: '#4ad2ff', rojo: '#ff3c3c', naranja: '#ff8c0a' };
const BOXC = { rosa: '#ec4899', morado: '#7c3aed', rojo: '#ff3c3c', negro: '#111', blanco: '#fff' };
const FONT_LIST = ['Arial Black', 'Impact', 'Segoe UI Black', 'Verdana', 'Comic Sans MS', 'Georgia'];

// ---------- Estilo del clip ----------
function look() { return S.settings.look; }

function saveLook(patch) {
  const deep = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v)) { a[k] = a[k] || {}; deep(a[k], v); } else a[k] = v; } };
  deep(S.settings.look, patch);
  clearTimeout(saveLook.t);
  saveLook.t = setTimeout(() => api.setSettings({ look: S.settings.look }).catch(() => {}), 250);
  renderStylePreview();
}

function renderStyleCard(el) {
  if (!el) return;
  const L = look();
  const sub = L.subs;
  L.efectos = { espejo: false, velocidad: 1, fondo: '', silencios: false, voz: 'normal', ...(L.efectos || {}) };
  const FX = L.efectos;
  const chipRow = (group, key, opts, cur) => opts.map(([v, label]) => `<button class="chip ${String(cur) === String(v) ? 'active' : ''}" data-look="${group}" data-k="${key}" data-v="${v}">${label}</button>`).join('');
  el.innerHTML = `
    <h3>🎨 Estilo del clip <span class="muted tiny" style="font-weight:400">Así se verán tus clips</span></h3>
    <div class="style-grid">
      <div class="style-opts">
        <details open><summary>💬 Subtítulos</summary>
          <div class="opt-row"><span>Letra</span><select id="lkFont">${FONT_LIST.map((f) => `<option ${sub.font === f ? 'selected' : ''} style="font-family:'${f}'">${f}</option>`).join('')}</select></div>
          <div class="opt-row"><span>Tamaño</span><div class="chips">${chipRow('subs', 'size', [['pequeño', 'S'], ['normal', 'M'], ['grande', 'L'], ['enorme', 'XL']], sub.size)}</div></div>
          <div class="opt-row"><span>Posición</span><div class="chips">${chipRow('subs', 'position', [['arriba', 'Arriba'], ['centro', 'Centro'], ['abajo', 'Abajo']], sub.position)}</div></div>
          <div class="opt-row"><span>Palabras a la vez</span><div class="chips">${chipRow('subs', 'wordsPerLine', [[1, '1'], [2, '2'], [3, '3'], [4, '4']], sub.wordsPerLine)}</div></div>
          <div class="opt-row"><span>Resaltado</span><div class="chips">${Object.entries(HL).map(([k, c]) => `<span class="color-dot ${sub.color === k ? 'active' : ''}" data-hl="${k}" title="${k}" style="background:${c}"></span>`).join('')}</div></div>
          <div class="opt-row"><span>Color del texto</span><div class="chips">${chipRow('subs', 'textColor', [['blanco', 'Blanco'], ['amarillo', 'Amarillo']], sub.textColor)}</div></div>
          <div class="opt-row"><span>Animación</span><div class="chips">${chipRow('subs', 'animation', [['pop', 'Salto'], ['ninguna', 'Sin animación']], sub.animation)}
            <label class="check" style="margin:0 0 0 8px"><input type="checkbox" id="lkUpper" ${sub.uppercase ? 'checked' : ''}/> MAYÚSCULAS</label></div></div>
        </details>
        <details><summary>🏷️ Título arriba</summary>
          <div class="opt-row"><span>Mostrar título</span><div class="chips" style="align-items:center"><label class="toggle"><input type="checkbox" id="lkBanner" ${L.titleBanner.enabled ? 'checked' : ''}/><span></span></label>
            <span class="muted tiny">Pone el título del clip arriba, como gancho.</span></div></div>
          <div class="opt-row"><span>Cuánto dura</span><div class="chips">${chipRow('titleBanner', 'seconds', [[3, '3 s'], [5, '5 s'], [0, 'Todo el clip']], L.titleBanner.seconds)}</div></div>
          <div class="opt-row"><span>Color</span><div class="chips">${Object.entries(BOXC).map(([k, c]) => `<span class="color-dot ${L.titleBanner.color === k ? 'active' : ''}" data-box="${k}" style="background:${c}"></span>`).join('')}</div></div>
        </details>
        <details><summary>©️ Marca y logo</summary>
          <div class="opt-row"><span>Texto de marca</span><input id="lkMark" placeholder="@tucanal" value="${esc(L.watermark.text)}" maxlength="40"/></div>
          <div class="opt-row"><span>Posición</span><div class="chips">${chipRow('watermark', 'position', [['arriba-izq', '↖'], ['arriba-der', '↗'], ['abajo-izq', '↙'], ['abajo-der', '↘']], L.watermark.position)}</div></div>
          <div class="opt-row"><span>Logo (PNG)</span><div class="chips" style="align-items:center">
            <button class="btn small" id="lkLogo">${L.logo.file ? 'Cambiar logo' : 'Elegir imagen'}</button>
            ${L.logo.file ? '<button class="btn small ghost" id="lkLogoOff">Quitar</button>' : ''}</div></div>
          ${L.logo.file ? `
          <div class="opt-row"><span>Posición del logo</span><div class="chips">${chipRow('logo', 'position', [['arriba-izq', '↖'], ['arriba-der', '↗'], ['abajo-izq', '↙'], ['abajo-der', '↘']], L.logo.position)}</div></div>
          <div class="opt-row"><span>Tamaño</span><div class="range-wrap"><input type="range" min="6" max="40" id="lkLogoSize" value="${L.logo.size}"/><b>${L.logo.size}%</b></div></div>
          <div class="opt-row"><span>Transparencia</span><div class="range-wrap"><input type="range" min="20" max="100" id="lkLogoOp" value="${L.logo.opacity}"/><b>${L.logo.opacity}%</b></div></div>` : ''}
        </details>
        <details><summary>✨ Efectos</summary>
          <div class="opt-row"><span>Espejo</span><div class="chips" style="align-items:center"><label class="toggle"><input type="checkbox" id="fxMirror" ${FX.espejo ? 'checked' : ''}/><span></span></label>
            <span class="muted tiny">Voltea la imagen de lado (los subtítulos se leen normal).</span></div></div>
          <div class="opt-row"><span>Velocidad</span><div class="chips">${chipRow('efectos', 'velocidad', [[1, 'Normal'], [1.1, '1.1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']], FX.velocidad)}</div></div>
          <div class="opt-row"><span>Fondo propio</span><div class="chips" style="align-items:center">
            <button class="btn small" id="fxBg">${FX.fondo ? 'Cambiar imagen' : 'Elegir imagen'}</button>
            ${FX.fondo ? '<button class="btn small ghost" id="fxBgOff">Quitar</button>' : ''}
            <span class="muted tiny">${S.settings.style === 'recorte' ? 'Con el formato "Recorte" el video llena la pantalla y no se ve el fondo.' : 'Va detrás del video, en lugar del fondo borroso.'}</span></div></div>
          <div class="opt-row"><span>Quitar silencios</span><div class="chips" style="align-items:center"><label class="toggle"><input type="checkbox" id="fxCuts" ${FX.silencios ? 'checked' : ''}/><span></span></label>
            <span class="muted tiny">Corta las pausas donde no se oye nada: el clip queda más dinámico.</span></div></div>
          <div class="opt-row"><span>Voz</span><div class="chips">${chipRow('efectos', 'voz', [['normal', 'Normal'], ['aguda', '🐿️ Aguda'], ['grave', '👹 Grave'], ['robot', '🤖 Robot'], ['eco', '🔊 Eco'], ['radio', '📻 Radio']], FX.voz)}</div></div>
          <p class="muted tiny" style="margin:6px 0 0">La voz y la velocidad cambian todo el sonido del clip. Se aplican a los clips nuevos.</p>
        </details>
        <details><summary>🎬 Video</summary>
          <div class="opt-row"><span>Calidad</span><div class="chips">${chipRow('', 'quality', [['1080', '1080p (mejor)'], ['720', '720p (pesa menos)']], L.quality)}</div></div>
          <div class="opt-row"><span>Fluidez</span><div class="chips">${chipRow('', 'fps', [[30, '30 fps'], [60, '60 fps (juegos)']], L.fps)}</div></div>
          <div class="opt-row"><span>Zoom</span><div class="range-wrap"><input type="range" min="100" max="140" step="5" id="lkZoom" value="${Math.round(L.zoom * 100)}"/><b>${Math.round(L.zoom * 100)}%</b></div></div>
        </details>
      </div>
      <div class="preview-wrap"><div class="preview-phone" id="stylePreview"></div><div class="muted tiny center">Vista previa</div></div>
    </div>`;

  $$('[data-look]', el).forEach((c) => c.addEventListener('click', () => {
    const { look: group, k, v } = c.dataset;
    const val = ['wordsPerLine', 'seconds', 'fps', 'velocidad'].includes(k) ? Number(v) : v;
    saveLook(group ? { [group]: { [k]: val } } : { [k]: val });
    $$(`[data-look="${group}"][data-k="${k}"]`, el).forEach((x) => x.classList.toggle('active', x === c));
  }));
  $$('[data-hl]', el).forEach((d) => d.addEventListener('click', () => {
    saveLook({ subs: { color: d.dataset.hl } });
    $$('[data-hl]', el).forEach((x) => x.classList.toggle('active', x === d));
  }));
  $$('[data-box]', el).forEach((d) => d.addEventListener('click', () => {
    saveLook({ titleBanner: { color: d.dataset.box } });
    $$('[data-box]', el).forEach((x) => x.classList.toggle('active', x === d));
  }));
  $('#lkFont', el).onchange = (e) => saveLook({ subs: { font: e.target.value } });
  $('#lkUpper', el).onchange = (e) => saveLook({ subs: { uppercase: e.target.checked } });
  $('#lkBanner', el).onchange = (e) => saveLook({ titleBanner: { enabled: e.target.checked } });
  $('#lkMark', el).oninput = (e) => saveLook({ watermark: { text: e.target.value } });
  $('#lkZoom', el).oninput = (e) => { e.target.nextElementSibling.textContent = `${e.target.value}%`; saveLook({ zoom: Number(e.target.value) / 100 }); };
  $('#lkLogo', el).onclick = async () => { const f = await api.pickImage('logo'); if (f) { saveLook({ logo: { file: f } }); renderStyleCard(el); } };
  $('#fxMirror', el).onchange = (e) => saveLook({ efectos: { espejo: e.target.checked } });
  $('#fxCuts', el).onchange = (e) => saveLook({ efectos: { silencios: e.target.checked } });
  $('#fxBg', el).onclick = async () => { const f = await api.pickImage('fondo'); if (f) { saveLook({ efectos: { fondo: f } }); renderStyleCard(el); $('#fxBg', el).closest('details').open = true; } };
  $('#fxBgOff', el)?.addEventListener('click', () => { saveLook({ efectos: { fondo: '' } }); renderStyleCard(el); $('#fxBg', el).closest('details').open = true; });
  $('#lkLogoOff', el)?.addEventListener('click', () => { saveLook({ logo: { file: '' } }); renderStyleCard(el); });
  $('#lkLogoSize', el)?.addEventListener('input', (e) => { e.target.nextElementSibling.textContent = `${e.target.value}%`; saveLook({ logo: { size: Number(e.target.value) } }); });
  $('#lkLogoOp', el)?.addEventListener('input', (e) => { e.target.nextElementSibling.textContent = `${e.target.value}%`; saveLook({ logo: { opacity: Number(e.target.value) } }); });
  renderStylePreview();
}

function renderStylePreview() {
  const box = $('#stylePreview');
  if (!box) return;
  const L = look();
  const sub = L.subs;
  const style = S.settings.style;
  const wide = style === 'horizontal';
  box.classList.toggle('wide', wide);
  const sizes = { 'pequeño': 11, normal: 14, grande: 17, enorme: 20 };
  const words = ['NO', 'PUEDO', 'CREER', 'LO', 'QUE', 'PASÓ'].slice(0, Math.max(1, sub.wordsPerLine));
  const text = words.map((w, i) => `<span class="pw" style="animation-delay:${i * 0.45}s;--hl:${HL[sub.color]}">${sub.uppercase ? w : w.toLowerCase()}</span>`).join(' ');
  const pos = { arriba: 'top:24%', centro: 'top:50%;transform:translateY(-50%)', abajo: 'bottom:22%' }[sub.position];
  const corner = (p) => ({ 'arriba-izq': 'top:6%;left:6%', 'arriba-der': 'top:6%;right:6%', 'abajo-izq': 'bottom:5%;left:6%', 'abajo-der': 'bottom:5%;right:6%' }[p]);
  const z = L.zoom || 1;
  const fx = L.efectos || {};
  const flip = fx.espejo ? 'scaleX(-1)' : '';
  const bgImg = fx.fondo && style !== 'recorte' ? `background:url('${esc(fileUrl(fx.fondo))}?v=${Date.now() % 1e5}') center/cover;filter:none;opacity:1;inset:0` : '';
  box.innerHTML = `
    ${style === 'blur' || (bgImg && wide) ? `<div class="pv-bg" style="${bgImg}${!bgImg && flip ? `;transform:${flip}` : ''}"></div><div class="pv-video" style="width:${wide ? 100 : 100 * z}%;${flip ? `transform:translate(-50%,-50%) ${flip}` : ''}"></div>` : `<div class="pv-video full" style="transform:scale(${z}) ${flip}"></div>`}
    ${fx.velocidad > 1 || fx.voz !== 'normal' || fx.silencios ? `<div class="pv-fx">${[fx.velocidad > 1 ? `⏩ ${fx.velocidad}×` : '', fx.silencios ? '✂️ sin silencios' : '', fx.voz && fx.voz !== 'normal' ? `🎙️ ${fx.voz}` : ''].filter(Boolean).join(' · ')}</div>` : ''}
    ${L.titleBanner.enabled ? `<div class="pv-banner" style="background:${BOXC[L.titleBanner.color]};color:${L.titleBanner.color === 'blanco' ? '#111' : '#fff'};font-family:'${sub.font}'">¡El momento más épico!</div>` : ''}
    ${S.settings.subtitles ? `<div class="pv-subs ${sub.animation === 'pop' ? 'pop' : ''}" style="${pos};font-family:'${sub.font}';font-size:${(sizes[sub.size] || 14) * (wide ? 0.8 : 1)}px;color:${sub.textColor === 'amarillo' ? '#ffd600' : '#fff'}">${text}</div>` : ''}
    ${L.watermark.text ? `<div class="pv-mark" style="${corner(L.watermark.position)}">${esc(L.watermark.text)}</div>` : ''}
    ${L.logo.file ? `<img class="pv-logo" src="${esc(fileUrl(L.logo.file))}?v=${Date.now() % 1e5}" style="${corner(L.logo.position)};width:${L.logo.size}%;opacity:${L.logo.opacity / 100}">` : ''}`;
}

// ---------- Revisión del sistema ----------
const REQ_ICON = { ok: '✅', falta: '❌', aviso: '⚠️' };

function reqButton(item) {
  if (!item.accion) return '';
  const labels = {
    reintentar: 'Reintentar', 'abrir-ollama': 'Abrir Ollama', 'descargar-ollama': 'Descargar Ollama',
    'descargar-modelo': 'Descargar modelo', 'elegir-carpeta': 'Cambiar carpeta',
  };
  const comp = item.accion.startsWith('instalar:') ? item.accion.slice(9) : null;
  if (comp && isInstalling(comp)) return '<button class="btn small" disabled><span>Descargando…</span></button>';
  const label = comp ? 'Instalar' : labels[item.accion] || 'Arreglar';
  return `<button class="btn small ${item.estado === 'falta' ? 'primary' : ''}" data-fix="${esc(item.accion)}"><span>${label}</span></button>`;
}

/** ¿Queda algo que "Arreglar todo" pueda hacer? (lo que ya se está descargando no cuenta) */
function canFixAll(r) {
  return r.items.some((i) => i.estado === 'falta' && i.accion && i.accion !== 'reintentar' && i.accion !== 'descargar-ollama'
    && !(i.accion.startsWith('instalar:') && isInstalling(i.accion.slice(9))));
}

function reqList(r) {
  const groups = [...new Set(r.items.map((i) => i.grupo))];
  return groups.map((g) => `<div class="req-group"><div class="req-title">${esc(g)}</div>
    ${r.items.filter((i) => i.grupo === g).map((i) => {
    // Si ya se está descargando (desde aquí o desde Ajustes), se ve la barra en vez de pedirlo otra vez.
    const comp = i.accion?.startsWith('instalar:') ? i.accion.slice(9) : null;
    const busy = comp && isInstalling(comp);
    const pr = (comp && progressState[comp]) || {};
    return `
      <div class="req ${i.estado}" data-req="${esc(i.id)}" ${comp ? `data-req-install="${esc(comp)}"` : ''}>
        <span class="req-icon">${busy ? '⏬' : REQ_ICON[i.estado]}</span>
        <div class="grow"><b>${esc(i.nombre)}</b><div class="muted tiny">${busy ? 'Descargando… se marca solo cuando termine.' : esc(i.detalle)}</div>
          <div class="prog ${busy ? '' : 'hidden'}"><div class="progress"><span style="width:${Math.round((pr.frac || 0) * 100)}%"></span></div><div class="ptext tiny muted">${esc(pr.text || '')}</div></div></div>
        ${reqButton(i)}
      </div>`;
  }).join('')}</div>`).join('');
}

async function fixRequirement(action, btn) {
  const row = btn?.closest('.req');
  btn?.classList.add('loading');
  try {
    if (action.startsWith('instalar:')) {
      // La barra se mueve sola (la actualiza el aviso de progreso general). Si ya estaba instalado no se baja otra vez.
      const id = action.slice(9);
      row?.querySelector('.prog')?.classList.remove('hidden');
      activeInstalls.add(id);
      let r;
      try { r = await api.installComponent(id); } finally { activeInstalls.delete(id); }
      S.comps = await api.componentsStatus().catch(() => S.comps);
      toast(r?.alreadyInstalled ? 'Ya estaba instalado ✓' : 'Instalado correctamente', 'ok', '🧩');
    } else if (action.startsWith('ollama:')) {
      const model = action.slice(7);
      row?.querySelector('.prog')?.classList.remove('hidden');
      const off = api.onOllamaProgress((p) => { if (row) { $('.progress span', row).style.width = `${Math.round(p.frac * 100)}%`; $('.ptext', row).textContent = p.text; } });
      try { await api.pullOllama(model); } finally { off(); }
      saveSetting({ ollamaModel: model });
      S.comps = await api.componentsStatus();
      toast('Modelo de IA listo y activado', 'ok', '🤖');
    } else if (action === 'abrir-ollama') {
      await api.openOllama();
      toast('Ollama abierto', 'ok', '🤖');
    } else if (action === 'descargar-ollama') {
      api.openUrl('https://ollama.com/download/windows');
      toast('Instala Ollama y luego toca "Revisar de nuevo"', 'info', '🤖');
    } else if (action === 'descargar-modelo') {
      row?.querySelector('.prog')?.classList.remove('hidden');
      const off = api.onOllamaProgress((p) => { if (row) { $('.progress span', row).style.width = `${Math.round(p.frac * 100)}%`; $('.ptext', row).textContent = p.text; } });
      try { await api.pullOllama(S.settings.ollamaModel); } finally { off(); }
    } else if (action === 'elegir-carpeta') {
      const dir = await api.pickFolder();
      if (dir) saveSetting({ outputDir: dir });
    }
    return true;
  } catch (err) {
    toast(err.message, 'bad');
    return false;
  } finally {
    btn?.classList.remove('loading');
  }
}

function bindReqButtons(container, after) {
  $$('[data-fix]', container).forEach((b) => { b.onclick = async () => { await fixRequirement(b.dataset.fix, b); after(); }; });
}

async function fixAll(r, container, after) {
  for (const item of r.items.filter((i) => i.estado === 'falta' && i.accion && i.accion !== 'reintentar' && i.accion !== 'descargar-ollama')) {
    const btn = $(`[data-req="${item.id}"] [data-fix]`, container);
    if (!(await fixRequirement(item.accion, btn))) break;
  }
  after();
}

function showRequirements(r) {
  $('.modal [data-reqmodal]')?.closest('.modal')?.remove();
  const m = modal(`<div data-reqmodal>
    <div style="font-size:38px">🧰</div>
    <h2>Antes de empezar</h2>
    <p class="muted">Para que ClipViral funcione rápido y sin errores, tu PC necesita esto. ${r.blocking ? `Falta${r.blocking > 1 ? 'n' : ''} <b style="color:var(--text)">${r.blocking}</b>.` : ''}</p>
    <div id="reqBody">${reqList(r)}</div>
    <div class="modal-actions"><button class="btn ghost" data-close>Después</button><button class="btn ghost" data-recheck>Revisar de nuevo</button>
      <button class="btn primary ${canFixAll(r) ? '' : 'hidden'}" data-fixall><span>Arreglar todo</span></button></div></div>`,
  { onClose: () => { if (reqModalRefresh === refresh) reqModalRefresh = null; } });
  const refresh = async () => {
    if (!m.el.isConnected) return;
    const r2 = await api.systemCheck(S.settings.mode);
    S.system = r2;
    if (r2.ok) {
      m.close();
      confetti();
      toast('¡Todo listo! Tu PC tiene lo necesario.', 'ok', '🎉');
      if (S.page === 'directo' || S.page === 'ajustes') renderPage(false);
      return;
    }
    $('#reqBody', m.el).innerHTML = reqList(r2);
    bindReqButtons($('#reqBody', m.el), refresh);
    $('[data-fixall]', m.el).classList.toggle('hidden', !canFixAll(r2));
    r = r2;
  };
  // Mientras está abierta, se actualiza sola cuando termina una descarga.
  reqModalRefresh = refresh;
  bindReqButtons($('#reqBody', m.el), refresh);
  $('[data-close]', m.el).onclick = () => m.close();
  $('[data-recheck]', m.el).onclick = (e) => withLoading(e.currentTarget, refresh);
  $('[data-fixall]', m.el)?.addEventListener('click', (e) => withLoading(e.currentTarget, () => fixAll(r, m.el, refresh)));
}

async function renderSystemCard(el) {
  if (!el) return;
  // Solo vale la revisión más reciente: una vieja que llegue tarde no puede volver a mostrar "Falta".
  const turn = (renderSystemCard.turn = (renderSystemCard.turn || 0) + 1);
  if (!el.innerHTML.trim()) el.innerHTML = '<h3>🩺 Estado del sistema</h3><div class="muted">Revisando…</div>';
  const r = await api.systemCheck(S.settings.mode).catch(() => null);
  if (!r || !el.isConnected || turn !== renderSystemCard.turn) return;
  S.system = r;
  el.innerHTML = `<h3>🩺 Estado del sistema
      <span class="badge ${r.ok ? (r.warnings ? 'warn' : 'ok') : 'bad'}" style="margin-left:auto">${r.ok ? (r.warnings ? `${r.warnings} aviso${r.warnings > 1 ? 's' : ''}` : 'Todo listo') : `Faltan ${r.blocking}`}</span></h3>
    <div class="req-grid">${reqList(r)}</div>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:10px">
      <button class="btn small" id="sysRe">Revisar de nuevo</button>
      <button class="btn small" id="ytUp">Actualizar yt-dlp</button>
      ${canFixAll(r) ? '<button class="btn small primary" id="sysFix"><span>Arreglar todo</span></button>' : ''}</div>`;
  // Siempre la tarjeta que se ve ahora (si la página se volvió a dibujar, la vieja ya no está).
  const again = () => renderSystemCard($('#sysCard'));
  bindReqButtons(el, again);
  $('#sysRe', el).onclick = again;
  $('#sysFix', el)?.addEventListener('click', (e) => withLoading(e.currentTarget, () => fixAll(r, el, again)));
  $('#ytUp', el).onclick = (e) => withLoading(e.currentTarget, async () => {
    const res = await api.updateYtdlp();
    toast(res.updated ? 'yt-dlp actualizado' : (res.output || res.reason || 'yt-dlp ya estaba al día'), 'ok', '📥');
  });
}

// ---------- Redes sociales ----------
function uploadedIcons(clipId) {
  const done = (S.uploads || []).filter((u) => u.clipId === clipId && u.status === 'publicado');
  if (!done.length) return '';
  return [...new Set(done.map((u) => u.platform))].map((p) => `<b style="color:${NET[p].color}">${NET[p].icon}</b>`).join('');
}

// Fechas y horas en el idioma de las pantallas.
const LOCALE = () => L('es', 'en');
/** "21:00" si es hoy; si no, "9 nov 21:00". */
function fmtWhen(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(LOCALE(), { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })} ${time}`;
}

const STATUS = {
  pendiente: (j) => (j.scheduledAt > Date.now() + 5000 ? `${L('Programado', 'Scheduled')} ${fmtWhen(j.scheduledAt)}` : L('En espera', 'Waiting')),
  subiendo: (j) => `${L('Subiendo', 'Uploading')} ${Math.round((j.progress || 0) * 100)}%`,
  publicado: () => L('Publicado', 'Published'),
  error: () => 'Error',
  cancelado: () => L('Cancelado', 'Cancelled'),
};
const STATUS_CLASS = { pendiente: '', subiendo: 'warn', publicado: 'ok', error: 'bad', cancelado: '' };
// Avisos que manda la subida (vienen en español) para las pantallas en inglés.
const NOTE_EN = {
  'Instagram está procesando el video': 'Instagram is processing the video',
  'TikTok está procesando el video (puede tardar unos minutos)': 'TikTok is processing the video (it can take a few minutes)',
  'TikTok sigue procesando el video: aparecerá en tu perfil en unos minutos': 'TikTok is still processing the video: it will show on your profile in a few minutes',
  'Publicado como "Solo yo"': 'Published as "Only me"',
  'Se publica a su hora aunque apagues la PC': 'It is posted on time even if your PC is off',
  'Enviando al servidor…': 'Sending to the server…',
  'El servidor lo está publicando': 'The server is posting it',
};
const noteText = (n) => (EN() && NOTE_EN[n]) || n;

function jobRow(j) {
  const net = NET[j.platform];
  const origin = (j.origen === 'sola' ? L(' · 🤖 automática', ' · 🤖 automatic') : j.origen === 'aprobado' ? L(' · ✅ aprobada por ti', ' · ✅ approved by you') : '')
    + (!j.servidor ? '' : ['pendiente', 'subiendo'].includes(j.status) ? L(' · 📡 en el servidor', ' · 📡 on the server') : L(' · 📡 desde el servidor', ' · 📡 from the server'));
  const scheduled = j.status === 'pendiente' && j.scheduledAt > Date.now() + 5000;
  return `<div class="job" data-job="${esc(j.id)}">
    ${j.thumb ? `<img src="${esc(fileUrl(j.thumb))}" alt="">` : '<div class="job-thumb"></div>'}
    <div class="grow">
      <div style="display:flex;gap:8px;align-items:center"><span class="net-dot" style="background:${net.color}">${net.icon}</span>
        <b class="job-title">${esc(j.title)}</b></div>
      <div class="muted tiny">${esc(net.short)} · ${new Date(j.createdAt).toLocaleString(LOCALE(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}${origin}${j.note ? ` · ${esc(noteText(j.note))}` : ''}</div>
      ${j.status === 'subiendo' ? `<div class="progress" style="margin-top:6px"><span style="width:${Math.round((j.progress || 0) * 100)}%"></span></div>` : ''}
      ${j.error ? `<div class="tiny" style="color:#fca5a5;margin-top:4px">${esc(j.error)}</div>` : ''}
    </div>
    <span class="badge ${STATUS_CLASS[j.status]}">${STATUS[j.status]?.(j) || j.status}</span>
    <div class="job-actions">
      ${j.url ? `<button class="btn small" data-jact="open" title="${esc(j.url)}">${L(`Ver en ${net.short}`, `View on ${net.short}`)} ↗</button>` : ''}
      ${['error', 'cancelado'].includes(j.status) ? `<button class="btn small" data-jact="retry">${L('Reintentar', 'Retry')}</button>` : ''}
      ${scheduled ? `<button class="btn small" data-jact="now">${L('Publicar ahora', 'Publish now')}</button>` : ''}
      ${j.status === 'pendiente' ? `<button class="btn small ghost" data-jact="cancel">${L('Cancelar', 'Cancel')}</button>` : ''}
    </div>
  </div>`;
}

function bindJobs(container) {
  $$('[data-jact]', container).forEach((b) => b.addEventListener('click', async () => {
    const id = b.closest('[data-job]').dataset.job;
    const job = S.uploads.find((u) => u.id === id);
    try {
      if (b.dataset.jact === 'open') api.openUrl(job.url);
      if (b.dataset.jact === 'retry') await api.uploadsRetry(id);
      if (b.dataset.jact === 'now') { await api.uploadsNow(id); toast(L(`Publicando en ${NET[job.platform].short}…`, `Publishing on ${NET[job.platform].short}…`), 'ok', '🚀'); }
      if (b.dataset.jact === 'cancel') await api.uploadsCancel(id);
    } catch (err) {
      // Por ejemplo, sin conexión con el servidor que la tiene programada.
      toast(err.message, 'bad');
    }
  }));
}

api.onUploadUpdate(async (job) => {
  if (!job) S.uploads = await api.uploadsList();
  else {
    const i = (S.uploads || []).findIndex((u) => u.id === job.id);
    if (i >= 0) S.uploads[i] = job; else (S.uploads = S.uploads || []).push(job);
    if (job.status === 'publicado' && job.progress === 1 && !job._toasted) toast(L(`Publicado en ${NET[job.platform].short}: ${job.title}`, `Published on ${NET[job.platform].short}: ${job.title}`), 'ok', '🚀');
  }
  updateNavBadges();
  const box = $('#jobList');
  if (box && job) {
    const row = $(`[data-job="${job.id}"]`, box);
    if (row) { row.outerHTML = jobRow(job); bindJobs(box); } else if (S.page === 'redes') renderPage(false);
  } else if (S.page === 'redes') renderPage(false);
});

// Instagram: tipo de cuenta profesional.
const IG_TYPE = { BUSINESS: ['Cuenta de empresa', 'Business account'], MEDIA_CREATOR: ['Cuenta de creador', 'Creator account'] };

/** Facebook: en qué página se publica (se puede cambiar) y qué Instagram tiene unido. */
function fbPageBlock(p) {
  const pages = p.account.pages || [];
  const current = pages.find((pg) => pg.id === p.account.pageId);
  const ig = p.account.instagram || current?.instagram;
  const select = pages.length
    ? `<select data-page>${pages.map((pg) => `<option value="${esc(pg.id)}" ${pg.id === p.account.pageId ? 'selected' : ''}>${esc(pg.name)}</option>`).join('')}</select>`
    : `<b>${esc(p.account.name)}</b>`;
  return `<div class="setting stack"><div class="grow"><b>📘 ${L('Página donde publicar', 'Page to publish to')}</b>
      <small>${pages.length > 1 ? L(`Administras ${pages.length} páginas: elige en cuál publicar`, `You manage ${pages.length} Pages: choose where to publish`) : L('La página que elegiste al conectar', 'The Page you chose when connecting')}</small></div>${select}</div>
    <div class="setting"><div class="grow"><b>◎ ${L('Instagram unido a esta página', 'Instagram linked to this Page')}</b>
      <small>${ig ? `<b style="color:var(--text);display:inline">${esc(ig)}</b>` : p.account.igBusinessId ? L('Sí, una cuenta profesional', 'Yes, a professional account') : L('Ninguno. Únelo desde Facebook para ver la competencia en Instagram.', 'None. Link one from Facebook to see Instagram competitors.')}</small></div></div>`;
}

/** Enlace para abrir la cuenta conectada en la red (para mostrar que es la misma). */
function accountLink(p) {
  if (p.id === 'facebook' && p.account.pageId) return [`https://www.facebook.com/${encodeURIComponent(p.account.pageId)}`, L('Ver página en Facebook', 'Open Page on Facebook')];
  const user = p.account.username || (/^@[\w.]+$/.test(p.account.name || '') ? p.account.name.slice(1) : '');
  if (p.id === 'instagram' && user) return [`https://www.instagram.com/${encodeURIComponent(user)}/`, L('Ver perfil en Instagram', 'Open profile on Instagram')];
  return null;
}

async function renderRedes(el) {
  el.innerHTML = `<div class="page-head"><div><h1>${L('Redes', 'Networks')}</h1><p class="muted">${L('Cargando…', 'Loading…')}</p></div></div>`;
  let platforms = [];
  try { platforms = await api.socialList(); } catch (err) { toast(err.message, 'bad'); }
  S.social = platforms;
  S.uploads = await api.uploadsList().catch(() => S.uploads || []);
  S.serverInfo = await api.serverInfo().catch(() => null);
  if (S.page !== 'redes') return;
  const R = S.settings.redes;
  const srv = S.serverInfo;
  const srvHost = srv ? srv.url.replace(/^https?:\/\//, '') : '';
  const srvText = !srv ? '' : !srv.ok ? L('Ahora no hay conexión con tu servidor de ClipViral.', 'There is no connection with your ClipViral server right now.')
    : !srv.publica ? L('Tu servidor es de una versión anterior y no publica solo: lo sube la PC. Cierra y abre ClipViral para ponerlo al día.', 'Your server is an older version and cannot post on its own: the PC uploads instead. Restart ClipViral to update it.')
      : srv.local ? L('Tu servidor está en esta PC: lo programado se publica mientras la PC esté encendida. Para publicar con la PC apagada, pon tu VPS en Ajustes → Servidor de ClipViral.', 'Your server runs on this PC: scheduled posts go out while the PC is on. To post with the PC off, set up your VPS in Settings → ClipViral server.')
        : L(`Tu servidor está en tu VPS (${srvHost}): lo programado se publica aunque apagues la PC. Apágala cuando la publicación diga «📡 en el servidor».`, `Your server runs on your VPS (${srvHost}): scheduled posts go out even with your PC off. Turn it off once the post says "📡 on the server".`);
  const srvRow = srv ? `<div class="setting"><div class="grow"><b>📡 ${L('Publicar desde el servidor', 'Post from the server')}</b><small>${esc(srvText)}</small></div>
      <label class="toggle"><input type="checkbox" id="srvPublica" ${R.servidorPublica !== false ? 'checked' : ''} ${srv.publica ? '' : 'disabled'}/><span></span></label></div>` : '';
  // TikTok no tiene privacidad por defecto: su auditoría pide elegirla en cada video (pantalla de TikTok).
  const privacy = {
    youtube: [['public', L('Público', 'Public')], ['unlisted', L('No listado', 'Unlisted')], ['private', L('Privado', 'Private')]],
  };
  const autoLine = (id) => {
    if (!['instagram', 'tiktok', 'facebook'].includes(id)) return '';
    const on = !!R[id]?.publicarSola;
    const detail = !on ? L('Tú decides cada publicación.', 'You decide every post.')
      : id === 'tiktok' ? L('Apruebas cada clip y se publica solo a su hora', 'You approve each clip and it is posted at its time')
        : L('Publica sola a la hora sugerida', 'Posts at the suggested time');
    return `<div class="setting stack"><div class="grow"><b>🤖 ${L('Publicación automática', 'Automatic posting')}: ${on ? L('encendida', 'on') : L('apagada', 'off')}</b><small>${detail}</small></div><button class="btn small ghost" data-go="sugeridos">${L('Cambiar en Clips sugeridos', 'Change in Suggested clips')}</button></div>`;
  };
  const jobs = [...S.uploads].sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
  const anyConnected = platforms.some((p) => p.connected);
  el.innerHTML = `
    <div class="page-head"><div><h1>${L('Redes', 'Networks')}</h1><p class="muted">${L('Conecta tus cuentas y publica tus clips con un clic, ahora o a la hora que elijas. También puedes dejar que ClipViral publique solo a la hora sugerida (se enciende en Clips sugeridos).', 'Connect your accounts and publish your clips with one click, right away or at the time you choose.')}</p></div>
      <div class="head-actions">
        <button class="chip ${EN() ? 'active' : ''}" id="langEn" title="${L('Pantallas en inglés, para grabar el video de la revisión de Meta', 'Screens in English (for the Meta review video)')}">🌐 English</button>
        ${anyConnected ? `<button class="btn primary" data-create="">➕ <span>${L('Crear publicación', 'Create post')}</span></button>` : ''}
      </div></div>
    <div class="nets stagger">
      ${platforms.map((p) => {
    const cfg = R[p.id] || {};
    const igType = p.id === 'instagram' && p.connected ? IG_TYPE[p.account.accountType] : null;
    const link = p.connected ? accountLink(p) : null;
    return `<div class="card net ${p.connected ? 'on' : ''}" data-net="${p.id}">
          <div class="net-head"><span class="net-logo" style="background:${NET[p.id].color}">${NET[p.id].icon}</span>
            <div class="grow"><b>${NET[p.id].name}</b><div class="muted tiny">${p.connected ? `${L('Conectado como', 'Connected as')} <b style="color:var(--text)">${esc(p.account.name)}</b>${igType ? ` · ${L(...igType)}` : ''}${p.account.viaFacebook ? ` · ${L('a través de tu página', 'through your Page')} ${esc(p.account.pageName || '')}` : ''}` : p.configured ? L('Sin conectar', 'Not connected') : L('Aún no disponible', 'Not available yet')}</div></div>
            ${p.connected && p.account.avatar ? `<img class="net-avatar" src="${esc(p.account.avatar)}" alt="">` : ''}</div>
          ${!p.configured ? (S.user?.role === 'admin'
    ? `<p class="muted tiny">${L('Falta pegar las claves de esta red en el panel de admin (Ajustes → Conexión con redes).', 'Paste this network\'s keys in the admin panel first (Settings → Network connection).')}</p><button class="btn small" data-admin>${L('Abrir el panel de admin', 'Open admin panel')} ↗</button>`
    : `<p class="muted tiny">${L('El administrador todavía no activó esta red. Escribe a soporte.', 'The administrator has not set up this network yet.')}</p>`)
    : p.connected ? `
            ${p.needsReconnect ? `<div class="tiny" style="color:#fcd34d;margin:6px 0">🔄 ${L('Vuelve a conectar para que ClipViral pueda leer las vistas (sube igual).', 'Reconnect so ClipViral can read your views (posting still works).')} <button class="btn small" data-connect style="margin-left:6px">${L('Reconectar', 'Reconnect')}</button></div>` : ''}
            ${p.id === 'facebook' ? fbPageBlock(p) : ''}
            ${privacy[p.id] ? `<div class="setting"><div class="grow"><b>${L('Quién lo ve', 'Who can see it')}</b></div><select data-cfg="privacy">${privacy[p.id].map(([v, l]) => `<option value="${v}" ${cfg.privacy === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
            ${p.id === 'tiktok' ? `<div class="setting"><div class="grow"><b>${L('Quién lo ve', 'Who can see it')}</b><small>${L('Lo eliges en cada video, en la pantalla de TikTok (TikTok lo pide así).', 'You choose it for every video, on the TikTok screen.')}</small></div></div>` : ''}
            ${autoLine(p.id)}
            ${p.id === 'youtube' ? `<div class="setting"><div class="grow"><b>${L('Agregar #Shorts', 'Add #Shorts')}</b><small>${L('Ayuda a que YouTube lo trate como Short.', 'Helps YouTube treat it as a Short.')}</small></div><label class="toggle"><input type="checkbox" data-cfg="shortsTag" ${cfg.shortsTag ? 'checked' : ''}/><span></span></label></div>` : ''}
            ${p.id === 'instagram' ? `<div class="setting"><div class="grow"><b>${L('Mostrar también en el feed', 'Also show in the feed')}</b></div><label class="toggle"><input type="checkbox" data-cfg="shareToFeed" ${cfg.shareToFeed !== false ? 'checked' : ''}/><span></span></label></div>
            <div class="setting"><div class="grow"><b>✂️ ${L('Recortar a 39 s para Instagram', 'Trim to 39 s for Instagram')}</b><small>${L('Instagram rechaza por la API los Reels de más de ~40 s en cuentas nuevas. Se sube una copia con los primeros 39 s; las demás redes reciben el clip completo.', 'Instagram rejects Reels longer than ~40 s from new accounts through the API. A copy with the first 39 s is uploaded; other networks get the full clip.')}</small></div><label class="toggle"><input type="checkbox" data-cfg="recortar" ${cfg.recortar !== false ? 'checked' : ''}/><span></span></label></div>` : ''}
            <div class="net-actions">
              <button class="btn small primary" data-create="${p.id}">➕ <span>${L('Crear publicación', 'Create post')}</span></button>
              ${link ? `<button class="btn small ghost" data-link="${esc(link[0])}">${esc(link[1])} ↗</button>` : ''}
              <span class="grow"></span>
              ${p.account.viaFacebook
    ? `<span class="muted tiny" title="${L('Publica con la conexión de Facebook', 'Uses the Facebook connection')}">${L('Se quita al desconectar Facebook', 'Disconnect Facebook to remove it')}</span>`
    : `<button class="btn small ghost danger" data-disconnect>${L('Desconectar', 'Disconnect')}</button>`}
            </div>`
      : `<button class="btn primary wide" data-connect><span>${L(`Conectar ${NET[p.id].short}`, `Connect ${NET[p.id].short}`)}</span></button>
            ${MANUAL_NETS.includes(p.id) ? `<button class="btn small ghost wide" data-manual style="margin-top:8px" title="Para usar ClipViral solo con tus cuentas, sin la verificación del negocio">🔑 ${L('Conectar con un token (uso personal)', 'Connect with a token (personal use)')}</button>` : ''}`}
        </div>`;
  }).join('')}
    </div>

    <div class="card pop-in" style="margin-top:16px" id="jobsCard">
      <h3>📤 ${L('Publicaciones', 'Posts')} <span class="muted tiny" style="font-weight:400">${jobs.length ? '' : L('— aún no hay', '— none yet')}</span>
        ${jobs.some((j) => ['publicado', 'cancelado', 'error'].includes(j.status)) ? `<button class="btn small ghost" id="clearJobs" style="margin-left:auto">${L('Limpiar terminadas', 'Clear finished')}</button>` : ''}</h3>
      ${srvRow}
      <div id="jobList" class="job-list">${jobs.map(jobRow).join('') || `<div class="empty" style="padding:24px"><div class="big" style="font-size:38px">📭</div><div class="muted">${L('Aquí verás lo que publiques o programes con ClipViral.', 'Here you will see what you publish or schedule with ClipViral.')}</div></div>`}</div>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card pop-in">
        <h3>✍️ ${L('Texto de cada publicación', 'Text of each post')}</h3>
        <p class="muted tiny">${L('Se usa en Clips sugeridos y al subir desde Mis clips. Toca una etiqueta para agregarla: se reemplaza por los datos de cada clip ({gancho} es la primera frase que engancha).', 'Used as the starting caption. Tap a tag to add it: it is replaced with each clip\'s data.')}</p>
        <div class="chips" style="margin-bottom:10px">${['gancho', 'titulo', 'descripcion', 'hashtags', 'canal', 'fuente', 'minuto'].map((v) => `<button class="chip" data-var="${v}">{${v}}</button>`).join('')}</div>
        <textarea id="capTpl" rows="6">${esc(R.plantilla)}</textarea>
      </div>
      <div class="card pop-in"><h3>👀 ${L('Así se verá', 'Preview')}</h3><div class="copy-box" id="capPreview" style="min-height:150px"></div></div>
    </div>`;

  $('#langEn').addEventListener('click', () => setEnglish(!EN()).catch((err) => toast(err.message, 'bad')));
  $$('[data-create]', el).forEach((b) => b.addEventListener('click', () => openCreatePost(b.dataset.create || null)));
  $$('[data-net]', el).forEach((card) => {
    const id = card.dataset.net;
    $('[data-connect]', card)?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
      toast(id === 'facebook' ? L('Se abrió tu navegador. Acepta los permisos, elige tu página y vuelve aquí.', 'Your browser opened. Accept the permissions, choose your Page and come back here.')
        : L('Se abrió tu navegador. Acepta el permiso y vuelve aquí.', 'Your browser opened. Accept the permissions and come back here.'), 'info', '🔗');
      try { await api.socialConnect(id); confetti(); toast(L(`${NET[id].short} conectado`, `${NET[id].short} connected`), 'ok', '🎉'); renderPage(false); } catch (err) { toast(err.message, 'bad'); }
    }));
    $('[data-disconnect]', card)?.addEventListener('click', async () => {
      if (!(await confirmBox(L(`¿Desconectar ${NET[id].short}?`, `Disconnect ${NET[id].short}?`),
        L('Dejará de subir clips a esa cuenta y se cancela lo que estaba programado para ella. ClipViral borra el permiso de su servidor.', 'ClipViral will stop posting to this account, cancel what was scheduled for it and delete its access from the server.'),
        L('Desconectar', 'Disconnect'), true))) return;
      await api.socialDisconnect(id);
      renderPage(false);
    });
    $('[data-link]', card)?.addEventListener('click', (e) => api.openUrl(e.currentTarget.dataset.link));
    $('[data-manual]', card)?.addEventListener('click', () => openManualConnect(id));
    $('[data-admin]', card)?.addEventListener('click', () => api.openUrl(`${(S.appInfo.serverUrl || 'http://localhost:4600').replace(/\/+$/, '')}/admin/`));
    $('[data-page]', card)?.addEventListener('change', async (e) => {
      try {
        S.social = await api.socialSetPage(e.target.value);
        toast(L(`Ahora se publica en ${e.target.selectedOptions[0].textContent}`, `Now publishing to ${e.target.selectedOptions[0].textContent}`), 'ok', '📘');
        renderPage(false);
      } catch (err) { toast(err.message, 'bad'); }
    });
    $$('[data-go]', card).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $$('[data-cfg]', card).forEach((inp) => inp.addEventListener('change', () => {
      const k = inp.dataset.cfg;
      const v = inp.type === 'checkbox' ? inp.checked : inp.value;
      S.settings.redes[id] = { ...S.settings.redes[id], [k]: v };
      api.setSettings({ redes: { [id]: { [k]: v } } });
    }));
  });

  const tpl = $('#capTpl');
  const updatePreview = async () => {
    $('#capPreview').textContent = await api.captionPreview({ clipId: S.clips[0]?.id, template: tpl.value });
  };
  tpl.addEventListener('input', () => {
    S.settings.redes.plantilla = tpl.value;
    clearTimeout(tpl.t);
    tpl.t = setTimeout(() => { api.setSettings({ redes: { plantilla: tpl.value } }); updatePreview(); }, 300);
  });
  $$('[data-var]', el).forEach((b) => b.addEventListener('click', () => {
    const pos = tpl.selectionStart ?? tpl.value.length;
    tpl.value = `${tpl.value.slice(0, pos)}{${b.dataset.var}}${tpl.value.slice(pos)}`;
    tpl.dispatchEvent(new Event('input'));
    tpl.focus();
  }));
  $('#clearJobs')?.addEventListener('click', async () => { await api.uploadsClear(); S.uploads = await api.uploadsList(); renderPage(false); });
  $('#srvPublica')?.addEventListener('change', async (e) => {
    S.settings = await api.setSettings({ redes: { servidorPublica: e.target.checked } });
    toast(e.target.checked ? L('Lo que programes se manda al servidor y él lo publica a su hora.', 'What you schedule is sent to the server, which posts it on time.')
      : L('Lo que programes lo sube esta PC a su hora (tiene que estar encendida).', 'This PC uploads what you schedule at its time (it must be on).'), 'info', '📡');
  });
  bindJobs($('#jobList'));
  updatePreview();
}

/** Lleva la vista a la lista de publicaciones de Redes (para ver el avance y el botón "Ver en …"). */
function showJobs() {
  if (S.page !== 'redes') go('redes');
  setTimeout(() => {
    const card = $('#jobsCard');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }, S.page === 'redes' ? 50 : 600);
}

// Duración que acepta cada red (en segundos). Facebook Reels: de 3 a 90 s.
const NET_LIMITS = { facebook: [3, 90], instagram: [3, 900] };

/**
 * "Crear publicación": eliges el clip y sigue la ventana de subida con esa red marcada
 * (texto, publicar ahora o programar). `platform` vacío: se marcan las redes conectadas.
 */
async function openCreatePost(platform = null) {
  S.clips = await api.listClips().catch(() => S.clips || []);
  const clips = [...S.clips].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 60);
  const limit = platform ? NET_LIMITS[platform] : null;
  const fits = (c) => !limit || !c.duration || (c.duration >= limit[0] && c.duration <= limit[1]);
  const where = platform ? NET[platform].short : L('tus redes', 'your networks');
  const m = modal(`
    <h2>➕ ${L('Crear publicación', 'Create post')}</h2>
    <p class="muted tiny">${L(`Paso 1 de 2: elige el clip que quieres publicar en ${where}.`, `Step 1 of 2: choose the clip you want to publish on ${where}.`)}${limit ? ` ${L(`(${NET[platform].short} acepta clips de ${limit[0]} a ${limit[1]} segundos.)`, `(${NET[platform].short} accepts clips from ${limit[0]} to ${limit[1]} seconds.)`)}` : ''}</p>
    ${clips.length ? `<div class="clip-pick-grid">${clips.map((c) => `
      <button class="clip-pick" data-clip="${esc(c.id)}" ${fits(c) ? '' : 'disabled'} title="${esc(c.title)}">
        <span class="clip-pick-media">${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" loading="lazy">` : ''}<span class="dur">${fmtClock(c.duration)}</span></span>
        <b>${esc(c.title)}</b>
        <small>${fits(c) ? `🔥 ${c.score ?? '–'}/10${c.createdAt ? ` · ${new Date(c.createdAt).toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short' })}` : ''}` : L(`Muy largo para ${NET[platform].short}`, `Too long for ${NET[platform].short}`)}</small>
      </button>`).join('')}</div>`
    : `<div class="empty" style="padding:28px"><div class="big" style="font-size:40px">🎬</div><div class="muted">${L('Todavía no tienes clips. Saca clips de un video en Directo y vuelve aquí.', 'You have no clips yet. Make clips from a video in Live and come back here.')}</div></div>`}
    <div class="modal-actions"><button class="btn ghost" data-c>${L('Cancelar', 'Cancel')}</button></div>`, { wide: true });
  $('[data-c]', m.el).onclick = () => m.close();
  $$('[data-clip]', m.el).forEach((b) => b.addEventListener('click', () => {
    const clip = clips.find((c) => c.id === b.dataset.clip);
    m.close();
    openUploadModal(clip, { platforms: platform ? [platform] : null, heading: L('Crear publicación', 'Create post'), step: true, onDone: showJobs });
  }));
}

// ---------- Uso personal: conectar pegando un token ----------
// El botón de inicio de sesión de Meta pide verificar el negocio en apps nuevas. Para usar ClipViral solo con tus cuentas
// alcanza con un token sacado de las herramientas de Meta (como administrador de tu propia app).
const MANUAL_NETS = ['facebook', 'instagram'];
// business_management: sin él, Facebook no muestra las páginas que están dentro de un portfolio comercial (Meta Business Suite).
// instagram_content_publish e instagram_manage_insights: para publicar en el Instagram unido a la página (y leer sus vistas)
// sin conectar Instagram aparte (eso, en apps nuevas, pide un portfolio comercial).
const FB_TOKEN_PERMS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights'];
const MANUAL_HELP = {
  facebook: {
    title: 'Conectar Facebook con un token',
    url: 'https://developers.facebook.com/tools/explorer/',
    urlLabel: 'Abrir el Explorador de la API Graph',
    steps: [
      'Toca el botón de arriba: se abre el <b>Explorador de la API Graph</b> de Meta (entra con tu Facebook si te lo pide).',
      'A la derecha, en <b>"Aplicación de Meta"</b>, elige <b>tu app</b> (no "Graph API Explorer").',
      'En <b>"Usuario o página"</b> deja <b>"Token de usuario"</b>.',
      `En <b>"Permisos"</b> agrega uno por uno: ${FB_TOKEN_PERMS.map((p) => `<code class="perm">${p}</code>`).join(' ')}`,
      'Toca <b>"Generate Access Token"</b>. En la ventana de Facebook <b>marca tu página</b>, su Instagram y, si te lo pregunta, tu <b>portfolio comercial</b>. Si no te pregunta por las páginas, toca <b>"Editar acceso anterior"</b>: el token solo trae lo que marques.',
      'Copia el token (el texto largo que empieza con <b>EAA</b>) y pégalo aquí abajo.',
    ],
    note: 'Se hace una sola vez: ClipViral lo cambia por uno largo y el token de tu página no vence.',
  },
  instagram: {
    title: 'Conectar Instagram con un token',
    url: 'https://developers.facebook.com/apps/',
    urlLabel: 'Abrir mis apps de Meta',
    steps: [
      'Toca el botón de arriba y entra a <b>tu app</b>.',
      'Ve a <b>Instagram → Configuración de la API con inicio de sesión de Instagram</b>.',
      'En <b>"Generar identificadores de acceso"</b> toca <b>"Agregar cuenta"</b> y entra con tu Instagram (si ya está, sigue).',
      'Toca <b>"Generar token"</b> al lado de tu cuenta, acepta y copia el token (empieza con <b>IG</b>).',
      'Pégalo aquí abajo.',
    ],
    note: 'Ese token dura 60 días y ClipViral lo renueva solo mientras uses la app. Si tu app de Meta no tiene esa opción (o pide un portfolio), no hace falta: conecta Facebook con un token y el Instagram unido a tu página queda conectado solo.',
  },
};

function openManualConnect(platform) {
  const h = MANUAL_HELP[platform];
  const m = modal(`
    <h2>🔑 ${esc(h.title)}</h2>
    <p class="muted tiny">Para usar ClipViral solo con tus cuentas, sin la verificación del negocio. ${esc(h.note)}</p>
    <button class="btn small" data-url>${esc(h.urlLabel)} ↗</button>
    <ol class="manual-steps">${h.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
    <label>Token<input type="password" id="manualToken" placeholder="Pega aquí el token" autocomplete="off" spellcheck="false"/></label>
    <label class="check"><input type="checkbox" id="manualShow"/><span>Mostrar el token</span></label>
    <p class="muted tiny">🔒 El token va directo a tu servidor de ClipViral (en tu PC) y se guarda cifrado. No se lo pases a nadie.</p>
    <p class="error" id="manualErr"></p>
    <div class="modal-actions"><button class="btn ghost" data-c>Cancelar</button><button class="btn primary" data-go><span>Conectar</span></button></div>`);
  $('[data-url]', m.el).onclick = () => api.openUrl(h.url);
  $('[data-c]', m.el).onclick = () => m.close();
  $('#manualShow', m.el).onchange = (e) => { $('#manualToken', m.el).type = e.target.checked ? 'text' : 'password'; };
  $('[data-go]', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    $('#manualErr', m.el).textContent = '';
    const token = $('#manualToken', m.el).value.trim();
    if (!token) { $('#manualErr', m.el).textContent = 'Pega el token primero.'; return; }
    try {
      const r = await api.socialManual(platform, token);
      S.social = r.platforms;
      confetti();
      toast(`${NET[platform].short} conectado: ${r.account}`, 'ok', '🎉');
      for (const w of r.warnings || []) toast(w, 'info', '💡');
      if (platform === 'facebook' && (r.pages || []).length > 1) return choosePage(m, r);
      m.close();
      renderPage(false);
    } catch (err) {
      $('#manualErr', m.el).textContent = err.message;
    }
  });
}

/** Facebook con token: si administras varias páginas, eliges en cuál publicar. */
function choosePage(m, r) {
  $('.modal-card', m.el).innerHTML = `
    <h2>📘 ¿En qué página publico?</h2>
    <p class="muted tiny">El token trae ${r.pages.length} páginas. Puedes cambiarla después en Redes.</p>
    <p class="tiny" style="color:#fcd34d">¿No está la que buscas? Genera el token otra vez y, en la ventana de Facebook, toca "Editar acceso anterior" y marca esa página. Después toca Desconectar en Facebook y conecta con el token nuevo.</p>
    <div class="page-picks">${r.pages.map((pg) => `<label class="opt-row"><input type="radio" name="pg" value="${esc(pg.id)}" ${pg.id === r.pageId ? 'checked' : ''}/>
      ${pg.avatar ? `<img src="${esc(pg.avatar)}" alt="">` : `<span class="net-logo" style="background:${NET.facebook.color}">f</span>`}
      <span><b>${esc(pg.name)}</b><small class="muted tiny" style="display:block">${pg.instagram ? `Instagram: ${esc(pg.instagram)}` : 'Sin Instagram unido'}</small></span></label>`).join('')}</div>
    <div class="modal-actions"><button class="btn primary" data-pick><span>Publicar en esta página</span></button></div>`;
  $('[data-pick]', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    const id = $('input[name=pg]:checked', m.el)?.value;
    try {
      if (id && id !== r.pageId) S.social = await api.socialSetPage(id);
      m.close();
      renderPage(false);
    } catch (err) { toast(err.message, 'bad'); }
  });
}

/**
 * Ventana "Subir a redes": la subida la pide el usuario (ahora o a la hora que elija).
 * prefill (desde Clips sugeridos o Crear publicación): { platforms: ['tiktok'], title, caption, heading, step, onDone }.
 */
async function openUploadModal(clip, prefill = null) {
  let platforms = S.social;
  try { platforms = await api.socialList(); S.social = platforms; } catch (err) { return toast(err.message, 'bad'); }
  const connected = platforms.filter((p) => p.connected);
  const caption = prefill?.caption ?? await api.captionPreview({ clipId: clip.id });
  const done = (S.uploads || []).filter((u) => u.clipId === clip.id && u.status === 'publicado').map((u) => u.platform);
  const wanted = (id) => (prefill?.platforms ? prefill.platforms.includes(id) : !done.includes(id));
  const goLabel = (w) => (w === 'later' ? L('Programar', 'Schedule') : L('Publicar ahora', 'Publish now'));
  const m = modal(`
    <h2>${esc(prefill?.heading || L('Subir a redes', 'Post to networks'))}</h2>
    ${prefill?.step ? `<p class="muted tiny" style="margin:0 0 8px">${L('Paso 2 de 2: revisa el texto y elige cuándo publicar.', 'Step 2 of 2: check the caption and choose when to publish.')}</p>` : ''}
    <div class="up-clip">${clip.thumb ? `<img src="${esc(fileUrl(clip.thumb))}" alt="">` : ''}<div><b>${esc(clip.title)}</b><div class="muted tiny">${fmtClock(clip.duration)} · ${L('vertical', 'vertical')} 9:16</div></div></div>
    ${connected.length ? '' : `<div class="warn-box"><span>🔗</span><div>${L('Primero conecta una cuenta en la sección <b>Redes</b>.', 'First connect an account in <b>Networks</b>.')}</div></div>`}
    <div class="net-picks">${platforms.filter((p) => !prefill?.step || p.connected).map((p) => `
      <label class="net-pick ${p.connected ? '' : 'off'}">
        <input type="checkbox" value="${p.id}" ${p.connected && wanted(p.id) ? 'checked' : ''} ${p.connected ? '' : 'disabled'}/>
        <span class="net-logo" style="background:${NET[p.id].color}">${NET[p.id].icon}</span>
        <span>${NET[p.id].short}${done.includes(p.id) ? ' ✓' : ''}<small class="muted tiny" style="display:block">${p.connected ? (p.id === 'tiktok' ? L('se abre su pantalla', 'opens its own screen') : esc(p.account.name)) : L('sin conectar', 'not connected')}</small></span>
      </label>`).join('')}</div>
    <label>${L('Título', 'Title')}<input id="upTitle" maxlength="100" value="${esc(prefill?.title ?? clip.title)}"/></label>
    <label>${L('Descripción', 'Caption')}<textarea id="upCaption" rows="${prefill?.step ? 4 : 6}">${esc(caption)}</textarea></label>
    <div class="chips" style="align-items:center;margin-bottom:6px">
      <button class="chip active" data-when="now">🚀 ${L('Publicar ahora', 'Publish now')}</button>
      <button class="chip" data-when="later">🕒 ${L('Programar', 'Schedule')}</button>
      <input type="datetime-local" id="upDate" class="hidden" style="max-width:230px"/>
    </div>
    <div class="modal-actions"><button class="btn ghost" data-c>${L('Cancelar', 'Cancel')}</button><button class="btn primary" data-go ${connected.length ? '' : 'disabled'}>${I.upload}<span>${goLabel('now')}</span></button></div>`);
  let when = 'now';
  $$('[data-when]', m.el).forEach((b) => b.addEventListener('click', () => {
    when = b.dataset.when;
    $$('[data-when]', m.el).forEach((x) => x.classList.toggle('active', x === b));
    $('#upDate', m.el).classList.toggle('hidden', when !== 'later');
    $('[data-go] span', m.el).textContent = goLabel(when);
    if (when === 'later' && !$('#upDate', m.el).value) {
      const d = new Date(Date.now() + 3600000);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      $('#upDate', m.el).value = d.toISOString().slice(0, 16);
    }
  }));
  $('[data-c]', m.el).onclick = () => m.close();
  $('[data-go]', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    const chosen = $$('.net-pick input:checked', m.el).map((i) => i.value);
    if (!chosen.length) return toast(L('Elige al menos una red', 'Choose at least one network'), 'bad');
    const scheduledAt = when === 'later' ? new Date($('#upDate', m.el).value).getTime() : undefined;
    if (when === 'later' && !(scheduledAt > Date.now())) return toast(L('Elige una fecha y hora que todavía no pasó', 'Choose a date and time in the future'), 'bad');
    // TikTok va por su propia pantalla (privacidad, interacciones, contenido comercial y confirmación).
    const others = chosen.filter((c) => c !== 'tiktok');
    const caption = $('#upCaption', m.el).value;
    try {
      let jobs = [];
      if (others.length) jobs = await api.uploadsAdd({ clipId: clip.id, platforms: others, title: $('#upTitle', m.el).value, caption, scheduledAt });
      S.uploads = await api.uploadsList();
      updateNavBadges();
      m.close();
      if (others.length) {
        prefill?.onDone?.();
        const nets = others.map((c) => NET[c].short).join(', ');
        toast(!jobs.length ? L('Ya estaba en la cola', 'It was already in the queue')
          : when === 'later' ? L(`Programado en ${nets}: ${fmtWhen(scheduledAt)}`, `Scheduled on ${nets}: ${fmtWhen(scheduledAt)}`)
            : L(`Publicando en ${nets}…`, `Publishing on ${nets}…`), 'ok', when === 'later' ? '🕒' : '🚀');
      }
      if (chosen.includes('tiktok')) {
        openTiktokModal(clip, { caption, at: scheduledAt, atKind: 'fecha', prefer: when === 'later' ? 'programar' : 'ahora', onDone: prefill?.onDone });
      }
    } catch (err) { toast(err.message, 'bad'); }
  });
}

boot();
