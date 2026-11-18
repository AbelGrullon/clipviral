const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fecha = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
};

let token = localStorage.getItem('cv_admin_token');
let plansCache = [];
const planName = (id) => plansCache.find((p) => p.id === id)?.name || id;

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error(data.error || 'Sesión vencida'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3200);
}

// Efecto de onda en todos los botones
document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  btn.append(span);
  setTimeout(() => span.remove(), 600);
});

function countUp(el, to, format = (n) => Math.round(n)) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900);
    el.textContent = format(to * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Sesión ----------
function logout() {
  if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  token = null;
  localStorage.removeItem('cv_admin_token');
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#loginError').textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password'), device: 'Panel web' } });
    if (data.user.role !== 'admin') {
      token = data.token; logout();
      throw new Error('Esta cuenta no es de administrador');
    }
    token = data.token;
    localStorage.setItem('cv_admin_token', token);
    await start();
  } catch (err) {
    $('#loginError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#logout').addEventListener('click', logout);

async function start() {
  try {
    const me = await api('/me');
    if (me.user.role !== 'admin') return logout();
    $('#meName').textContent = `${me.user.name} · ${me.user.email}`;
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    showTab('resumen');
  } catch {
    logout();
  }
}

// ---------- Pestañas ----------
const loaders = { resumen: loadStats, usuarios: loadUsers, pagos: loadPayments, correos: loadMail, planes: loadPlans, versiones: loadReleases, permisos: loadChecklist, ajustes: loadSettings };
function showTab(name) {
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach((t) => {
    const show = t.dataset.tab === name;
    t.classList.toggle('hidden', !show);
    if (show) { t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; }
  });
  loaders[name]?.().catch((err) => toast(err.message, 'bad'));
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

// ---------- Resumen ----------
function bars(el, rows, key, format) {
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const map = Object.fromEntries(rows.map((r) => [r.day, r[key] || 0]));
  const max = Math.max(1e-9, ...days.map((d) => map[d] || 0));
  el.innerHTML = days.map((d, i) => {
    const v = map[d] || 0;
    return `<div class="bar" title="${d}: ${format(v)}"><b>${v ? format(v) : ''}</b><span style="height:${(v / max) * 100}%;animation-delay:${i * 35}ms"></span><small>${d.slice(8)}</small></div>`;
  }).join('');
}

async function loadStats() {
  const s = await api('/admin/stats');
  $('#aiBadge').className = `badge ${s.aiEnabled ? 'on' : 'off'}`;
  $('#aiBadge').textContent = s.aiEnabled ? '● IA Pro activa' : '● IA Pro apagada: pon tu clave de Claude en Ajustes';
  $('#aiBadge').style.cursor = s.aiEnabled ? '' : 'pointer';
  $('#aiBadge').onclick = s.aiEnabled ? null : () => showTab('ajustes');
  const cards = [
    ['Usuarios', s.totalUsers, (n) => Math.round(n), ''],
    ['Nuevos (7 días)', s.newUsers7d, (n) => Math.round(n), ''],
    ['Clientes pagando', s.paying, (n) => Math.round(n), ''],
    ['Cobrado este mes', s.incomeMonth, money, 'good'],
    ['Ingreso mensual', s.mrr, money, 'good'],
    ['Clips sacados', s.clipsTotal, (n) => Math.round(n), ''],
    ['Clips hoy', s.clipsToday, (n) => Math.round(n), ''],
    ['Costo IA del mes', s.aiCostMonth, money, 'warn'],
    ['Ganancia estimada', s.profitMonth, money, s.profitMonth >= 0 ? 'good' : 'warn'],
    ['Horas analizadas', s.aiHoursMonth, (n) => n.toFixed(1), ''],
  ];
  $('#stats').innerHTML = cards.map(([label], i) => `<div class="stat" style="animation-delay:${i * 60}ms"><div class="label">${label}</div><div class="value ${cards[i][3]}">0</div></div>`).join('');
  $$('#stats .value').forEach((el, i) => countUp(el, cards[i][1], cards[i][2]));
  bars($('#chartSignups'), s.signups, 'n', (v) => Math.round(v));
  bars($('#chartAi'), s.aiDaily, 'cost', (v) => v.toFixed(2));
  bars($('#chartClips'), s.clipsDaily, 'n', (v) => Math.round(v));
  bars($('#chartIncome'), s.incomeDaily, 's', (v) => v.toFixed(0));
  const modes = { local: '💻 IA local', ia: '✨ Claude' };
  $('#clipsMode').innerHTML = Object.entries(s.clipsByMode).map(([k, v]) => `<span class="pill">${esc(modes[k] || k)}<b>${v}</b></span>`).join('') || '<span class="muted">Todavía no se sacaron clips</span>';
  $('#topClippers').innerHTML = s.topClippers.map((u) => `<div class="item"><div><div class="u-name">${esc(u.name)}</div><div class="sub">${esc(u.email)}</div></div><span class="tag ok">${u.n} clips</span></div>`).join('') || '<span class="muted">Sin clips aún</span>';
  const names = { trial: 'Prueba', local: 'Local', pro: 'Claude', pro247: 'Pro 24/7', vencido: 'Vencidos' };
  $('#byPlan').innerHTML = Object.entries(s.byPlan).map(([k, v]) => `<span class="pill">${esc(names[k] || k)}<b>${v}</b></span>`).join('') || '<span class="muted">Sin usuarios aún</span>';
  $('#recent').innerHTML = s.recent.map((u) => `<div class="item"><div><div class="u-name">${esc(u.name)}</div><div class="sub">${esc(u.email)}</div></div><span class="tag ${u.planActive ? 'ok' : 'bad'}">${esc(u.planName)}</span></div>`).join('') || '<span class="muted">Sin registros</span>';
}

// ---------- Usuarios ----------
let usersCache = [];
let searchTimer;
$('#userSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadUsers, 250); });

async function loadUsers() {
  if (!plansCache.length) plansCache = (await api('/admin/plans')).plans;
  const { users } = await api(`/admin/users?q=${encodeURIComponent($('#userSearch').value)}`);
  usersCache = users;
  $('#usersBody').innerHTML = users.map((u, i) => `
    <tr style="animation-delay:${Math.min(i, 20) * 25}ms">
      <td><div class="u-name">${esc(u.name)} ${u.role === 'admin' ? '<span class="tag admin">admin</span>' : ''} ${u.banned ? '<span class="tag bad">suspendido</span>' : ''}</div><div class="u-mail">${esc(u.email)}</div></td>
      <td><span class="tag ${u.planActive ? 'ok' : 'bad'}">${esc(u.planName)}</span></td>
      <td>${u.role === 'admin' ? '—' : fecha(u.planExpires)}</td>
      <td>${u.clips}</td>
      <td>${u.paid ? money(u.paid) : '—'}</td>
      <td>${fecha(u.lastLogin)}</td>
      <td><button class="btn small" data-edit="${u.id}">Gestionar</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No hay usuarios</td></tr>';
}

$('#usersBody').addEventListener('click', (e) => {
  const id = e.target.closest('[data-edit]')?.dataset.edit;
  if (id) openUser(usersCache.find((u) => u.id === Number(id)));
});

function openUser(u) {
  $('#modalCard').innerHTML = `
    <h2>${esc(u.name)}</h2>
    <p class="muted">${esc(u.email)} · registrado el ${fecha(u.createdAt)}</p>
    <label>Plan<select id="mPlan">${plansCache.map((p) => `<option value="${p.id}" ${p.id === u.plan ? 'selected' : ''}>${esc(p.name)} — ${money(p.price_usd)}/mes</option>`).join('')}</select></label>
    <label>Vence<input id="mExpires" type="date" value="${u.planExpires ? u.planExpires.slice(0, 10) : ''}" /></label>
    <label class="check"><input type="checkbox" id="mNotify" checked /> Avisarle por correo si cambia su plan o su fecha</label>
    <div class="modal-actions">
      <button class="btn small" data-days="30">+1 mes</button>
      <button class="btn small" data-days="90">+90 días</button>
      <button class="btn small" data-days="365">+1 año</button>
      <button class="btn small" id="mManual">💵 Registrar pago manual</button>
      <button class="btn small" id="mMail">✉️ Enviarle un correo</button>
    </div>
    <div id="mDetail" class="muted tiny" style="margin-top:10px">Cargando historial…</div>
    <label style="margin-top:12px">Nueva contraseña (opcional)<input id="mPass" type="text" placeholder="Mínimo 8 caracteres" /></label>
    <div class="modal-actions">
      <button class="btn primary" id="mSave"><span>Guardar cambios</span></button>
      <button class="btn ${u.banned ? '' : 'danger'}" id="mBan">${u.banned ? 'Reactivar' : 'Suspender'}</button>
      <button class="btn ghost" id="mRole">${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
      <button class="btn danger" id="mDelete">Eliminar</button>
      <button class="btn ghost" id="mClose">Cerrar</button>
    </div>`;
  $('#modal').classList.remove('hidden');
  const patch = async (body, msg) => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { ...body, notify: $('#mNotify')?.checked } }); toast(msg); closeModal(); loadUsers(); }
    catch (err) { toast(err.message, 'bad'); }
  };
  $$('[data-days]', $('#modalCard')).forEach((b) => b.addEventListener('click', () => patch({ plan: $('#mPlan').value, addDays: Number(b.dataset.days) }, `Se agregaron ${b.dataset.days} días`)));
  $('#mManual').onclick = async () => {
    const plan = $('#mPlan').value;
    const price = plansCache.find((p) => p.id === plan)?.price_usd || 0;
    const months = Number(prompt('¿Cuántos meses pagó?', '1'));
    if (!months) return;
    const amount = Number(prompt('¿Cuánto pagó en USD?', String(price * months)));
    if (!Number.isFinite(amount)) return;
    try {
      await api(`/admin/users/${u.id}/pago-manual`, { method: 'POST', body: { plan, months, amount, note: 'Pago manual', notify: $('#mNotify').checked } });
      toast(`Pago registrado: +${months} mes${months > 1 ? 'es' : ''}`); closeModal(); loadUsers();
    } catch (err) { toast(err.message, 'bad'); }
  };
  $('#mMail').onclick = () => { closeModal(); showTab('correos'); setTimeout(() => { $('#noticeTo').value = `user:${u.id}`; $('#noticeForm [name=subject]').focus(); }, 300); };
  api(`/admin/users/${u.id}/detalle`).then((d) => {
    const st = { pagado: '✅', cancelado: '✖️', error: '⚠️' };
    const pays = d.payments.map((p) => `${st[p.status] || '•'} ${fecha(p.paid_at || p.created_at)} · ${money(p.amount)} · ${esc(planName(p.plan))} · ${p.months} mes${p.months > 1 ? 'es' : ''}`).join('<br>') || 'Sin pagos';
    const mails = d.mails.map((m) => `${m.ok ? '✅' : '⚠️'} ${fecha(m.created_at)} · ${esc(m.subject)}`).join('<br>') || 'Sin correos';
    $('#mDetail').innerHTML = `<b>Clips:</b> ${d.user.clips} (${d.clipsByMode.local || 0} local, ${d.clipsByMode.ia || 0} Claude)${d.clipsLast ? ` · último ${fecha(d.clipsLast)}` : ''}<br>
      <b>Pagos:</b><br>${pays}<br><b>Correos:</b><br>${mails}`;
  }).catch(() => { $('#mDetail').textContent = ''; });
  $('#mBan').onclick = () => patch({ banned: !u.banned }, u.banned ? 'Cuenta reactivada' : 'Cuenta suspendida');
  $('#mRole').onclick = () => patch({ role: u.role === 'admin' ? 'user' : 'admin' }, 'Rol actualizado');
  $('#mSave').onclick = () => {
    const body = { plan: $('#mPlan').value, planExpires: $('#mExpires').value ? `${$('#mExpires').value}T23:59:59` : null };
    if ($('#mPass').value) body.newPassword = $('#mPass').value;
    patch(body, 'Cambios guardados');
  };
  $('#mDelete').onclick = async () => {
    if (!confirm(`¿Eliminar la cuenta de ${u.email}? No se puede deshacer.`)) return;
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('Cuenta eliminada'); closeModal(); loadUsers(); }
    catch (err) { toast(err.message, 'bad'); }
  };
  $('#mClose').onclick = closeModal;
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- Planes ----------
async function loadPlans() {
  plansCache = (await api('/admin/plans')).plans;
  $('#plans').innerHTML = plansCache.map((p, i) => {
    const low = p.ai_hours * 0.04;
    const high = p.ai_hours * 0.10;
    return `
    <form class="card plan-card pop-in" data-plan="${p.id}" style="animation-delay:${i * 70}ms">
      <label>Nombre<input name="name" value="${esc(p.name)}" /></label>
      <label>Precio mensual (USD)<input name="price_usd" type="number" step="0.01" min="0" value="${p.price_usd}" /></label>
      <label>Horas de IA Pro al mes ${p.uses_ai ? '' : '(este plan no usa Claude)'}<input name="ai_hours" type="number" min="0" value="${p.ai_hours}" ${p.uses_ai ? '' : 'disabled'} /></label>
      <label>Descripción<textarea name="description" rows="3">${esc(p.description)}</textarea></label>
      <label class="check"><input type="checkbox" name="public" ${p.public ? 'checked' : ''} /> Mostrar en la app</label>
      <div class="margin">${p.uses_ai
        ? `Costo de IA si usa todas las horas: ${money(low)} – ${money(high)}<br>Ganancia mínima por cliente: <b>${money(p.price_usd - high)}</b>`
        : 'Sin costo de IA para ti: <b>todo es ganancia</b>'}</div>
      <button class="btn primary" type="submit"><span>Guardar</span></button>
    </form>`;
  }).join('');
}
$('#plans').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = new FormData(form);
  try {
    await api(`/admin/plans/${form.dataset.plan}`, {
      method: 'PUT',
      body: { name: f.get('name'), price_usd: Number(f.get('price_usd')), ai_hours: f.get('ai_hours') === null ? undefined : Number(f.get('ai_hours')), description: f.get('description'), public: f.get('public') === 'on' },
    });
    toast('Plan guardado');
    loadPlans();
  } catch (err) { toast(err.message, 'bad'); }
});

// ---------- Actualizaciones ----------
const drop = $('#drop');
const fileInput = drop.querySelector('input');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) { fileInput.files = e.dataTransfer.files; showFile(); } });
fileInput.addEventListener('change', showFile);
function showFile() {
  const f = fileInput.files[0];
  $('#dropText').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : 'Arrastra aquí el instalador (.exe) o haz clic';
  const m = f?.name.match(/(\d+\.\d+\.\d+)/);
  if (m && !$('#releaseForm [name=version]').value) $('#releaseForm [name=version]').value = m[1];
}

// El .zip para el botón "Descargar" de la web.
const dropZip = $('#dropZip');
const zipInput = dropZip.querySelector('input');
['dragenter', 'dragover'].forEach((ev) => dropZip.addEventListener(ev, (e) => { e.preventDefault(); dropZip.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dropZip.addEventListener(ev, (e) => { e.preventDefault(); dropZip.classList.remove('over'); }));
dropZip.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) { zipInput.files = e.dataTransfer.files; showZip(); } });
zipInput.addEventListener('change', showZip);
function showZip() {
  const f = zipInput.files[0];
  $('#dropZipText').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : 'Descarga de la web (.zip)';
  const m = f?.name.match(/(\d+\.\d+\.\d+)/);
  if (m && !$('#releaseForm [name=version]').value) $('#releaseForm [name=version]').value = m[1];
}

/** Sube un archivo con barra de avance. */
function subirArchivo(url, data, bar) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.firstElementChild.style.width = `${(ev.loaded / ev.total) * 100}%`; };
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body); else reject(new Error(body.error || 'No se pudo subir'));
    };
    xhr.onerror = () => reject(new Error('Error de conexión al subir'));
    xhr.send(data);
  });
}

$('#releaseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const exe = fileInput.files[0];
  const zip = zipInput.files[0];
  if (!exe && !zip) return toast('Elige el instalador (.exe), el .zip para la web, o los dos', 'bad');
  const version = form.version.value.trim();
  const bar = $('#uploadProgress');
  bar.classList.remove('hidden');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  const hecho = [];
  try {
    if (exe) {
      const data = new FormData();
      data.set('version', version);
      data.set('notes', form.notes.value);
      data.set('mandatory', form.mandatory.checked ? 'true' : 'false');
      data.set('file', exe);
      await subirArchivo('/api/admin/releases', data, bar);
      hecho.push('las apps la verán al abrirse');
    }
    if (zip) {
      bar.firstElementChild.style.width = '0';
      const data = new FormData();
      data.set('version', version);
      data.set('zip', zip);
      await subirArchivo('/api/admin/descarga', data, bar);
      hecho.push('la web ya descarga este .zip');
    }
    toast(`¡Listo! ${hecho.join(' y ')}.`);
    form.reset(); showFile(); showZip();
  } catch (err) {
    toast(hecho.length ? `${err.message} (lo anterior sí se subió: ${hecho.join(' y ')})` : err.message, 'bad');
  } finally {
    btn.disabled = false;
    bar.classList.add('hidden');
    bar.firstElementChild.style.width = '0';
    loadReleases();
  }
});

async function loadReleases() {
  api('/admin/descarga').then(({ descarga: d }) => {
    $('#webNow').innerHTML = d
      ? `🌐 La web descarga ahora: <b>v${esc(d.version)}</b> · ${(d.size / 1048576).toFixed(1)} MB · ${d.downloads} descargas · <a href="/descargar" target="_blank">probar</a> · <a href="/" target="_blank">ver la web</a>`
      : '🌐 La web todavía no tiene .zip para descargar: el botón "Descargar" dice que estará lista pronto.';
  }).catch(() => {});
  const { releases } = await api('/admin/releases');
  $('#releases').innerHTML = releases.map((r) => `
    <div class="item">
      <div><div class="u-name">v${esc(r.version)} ${r.mandatory ? '<span class="tag bad">obligatoria</span>' : ''}</div>
      <div class="sub">${fecha(r.created_at)} · ${(r.size / 1048576).toFixed(1)} MB · ${r.downloads} descargas</div>
      ${r.notes ? `<div class="sub">${esc(r.notes)}</div>` : ''}</div>
      <button class="btn small danger" data-del="${r.id}">Borrar</button>
    </div>`).join('') || '<span class="muted">Aún no has publicado versiones</span>';
}
$('#releases').addEventListener('click', async (e) => {
  const id = e.target.closest('[data-del]')?.dataset.del;
  if (!id || !confirm('¿Borrar esta versión?')) return;
  try { await api(`/admin/releases/${id}`, { method: 'DELETE' }); toast('Versión borrada'); loadReleases(); }
  catch (err) { toast(err.message, 'bad'); }
});

// ---------- Clave de Claude ----------
function showClaude(st) {
  $('#claudeBadge').className = `badge ${st.enabled ? 'on' : 'off'}`;
  $('#claudeBadge').textContent = st.enabled ? 'IA Pro activa' : 'Falta la clave';
  $('#claudeNow').innerHTML = st.source === 'panel'
    ? `✅ Clave guardada aquí: <code>${esc(st.masked)}</code>${st.hasEnv ? ' <span class="muted">(tiene prioridad sobre la del archivo .env)</span>' : ''}`
    : st.source === 'env'
      ? `✅ Se está usando la clave del archivo <code>server/.env</code>: <code>${esc(st.masked)}</code>. Si pones una aquí, se usa esta.`
      : st.unreadable
        ? '<span style="color:#fcd34d">⚠️ Había una clave guardada pero no se puede leer (cambió la llave de cifrado). Ponla otra vez.</span>'
        : '<span style="color:#fca5a5">Todavía no hay clave: la IA Pro está apagada.</span>';
  $('#claudeRemove').classList.toggle('hidden', st.source !== 'panel');
}
async function loadClaude() {
  showClaude(await api('/admin/claude'));
}
$('#claudeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const label = btn.querySelector('span');
  btn.disabled = true;
  label.textContent = 'Probando con Claude…';
  try {
    showClaude(await api('/admin/claude', { method: 'PUT', body: { key: e.target.key.value } }));
    e.target.reset();
    toast('¡Listo! La clave funciona y la IA Pro ya está activa.');
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
    label.textContent = 'Probar y guardar';
  }
});
$('#claudeRemove').addEventListener('click', async () => {
  if (!confirm('¿Quitar la clave de Claude guardada? La IA Pro se apaga (salvo que haya una en el archivo .env).')) return;
  try { showClaude(await api('/admin/claude', { method: 'DELETE' })); toast('Clave quitada'); }
  catch (err) { toast(err.message, 'bad'); }
});

// ---------- Ajustes ----------
async function loadSettings() {
  loadClaude().catch((err) => toast(err.message, 'bad'));
  const { settings, redirects, social, uploads } = await api('/admin/settings');
  for (const form of [$('#settingsForm'), $('#socialForm')]) {
    for (const [k, v] of Object.entries(settings)) if (form[k]) form[k].value = v;
  }
  $$('[data-redirect]').forEach((el) => { el.textContent = redirects[el.dataset.redirect] || ''; el.title = 'Clic para copiar'; });
  $$('[data-social]').forEach((el) => {
    const on = social[el.dataset.social];
    el.className = `badge ${on ? 'on' : 'off'}`;
    el.textContent = on ? 'Activa' : 'Sin configurar';
  });
  $('#uploadStats').textContent = uploads.length
    ? `Subidas este mes: ${uploads.map((u) => `${u.platform} ${u.ok} bien${u.failed ? ` / ${u.failed} con error` : ''}`).join(' · ')}`
    : 'Todavía no hay subidas este mes.';
}
$$('[data-redirect]').forEach((el) => el.addEventListener('click', async () => {
  await navigator.clipboard.writeText(el.textContent);
  toast('Dirección copiada');
}));

// ---------- Permisos de redes: lo que falta y las direcciones para copiar ----------
const NET_ICON = { tiktok: '🎵', instagram: '📸', facebook: '📘', youtube: '▶️' };
function checkRow(i) {
  const mark = i.ok === true ? '<span class="ck ok">✓</span>' : i.ok === false ? '<span class="ck bad">✗</span>' : '<span class="ck copy">📋</span>';
  return `<div class="ck-row ${i.ok === false ? 'missing' : ''}">
    ${mark}
    <div class="grow"><b>${esc(i.label)}</b>${i.optional ? ' <span class="tag">opcional</span>' : ''}
      ${i.copy ? `<code class="redirect" data-copy="${esc(i.copy)}" title="Clic para copiar">${esc(i.copy)}</code>` : ''}
      ${i.where ? `<div class="muted tiny">📍 ${esc(i.where)}</div>` : ''}
      ${i.help ? `<div class="tiny" style="color:#fcd34d">${esc(i.help)}</div>` : ''}</div>
  </div>`;
}
async function loadChecklist() {
  const { checklist: c, deletions } = await api('/admin/settings');
  const badge = (ready, total) => `<span class="badge ${ready === total ? 'on' : 'off'}">${ready === total ? 'Listo' : `Faltan ${total - ready}`}</span>`;
  $('#checklist').innerHTML = `
    <div class="card"><h3>🌐 Para todas las redes ${badge(c.commonReady, c.commonTotal)}</h3>
      ${c.https ? '' : '<p class="tiny" style="color:#fcd34d">Las direcciones de abajo todavía usan tu servidor local. Cuando el servidor esté en tu VPS con https, pon la dirección en Ajustes → Conexión con redes y aquí aparecerán las definitivas.</p>'}
      ${c.common.map(checkRow).join('')}
      <p class="muted tiny">Pedidos de borrado de datos recibidos de Meta: ${deletions}.</p></div>
    ${Object.entries(c.networks).map(([id, n]) => `
      <div class="card"><h3>${NET_ICON[id] || ''} ${esc(n.name)} ${badge(n.ready, n.total)}</h3>${n.items.map(checkRow).join('')}</div>`).join('')}`;
  $$('#checklist [data-copy]').forEach((el) => el.addEventListener('click', async () => {
    await navigator.clipboard.writeText(el.dataset.copy);
    toast('Copiado');
  }));
}
for (const id of ['#settingsForm', '#socialForm']) {
  $(id).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/admin/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      toast('Ajustes guardados');
      loadSettings();
    } catch (err) { toast(err.message, 'bad'); }
  });
}

// Arranque
if (token) start(); else $('#login').classList.remove('hidden');


// ---------- Pagos (PayPal) ----------
const PAY_STATUS = { pagado: ['ok', 'Pagado'], cancelado: ['', 'Cancelado'], error: ['bad', 'Error'], creado: ['', 'Sin pagar'] };
async function loadPayments() {
  const d = await api('/admin/pagos');
  if (!plansCache.length) plansCache = (await api('/admin/plans')).plans;
  const f = $('#paypalForm');
  f.mode.value = d.config.mode;
  f.clientId.value = d.config.clientId || '';
  f.secret.value = '';
  f.secret.placeholder = d.config.hasSecret ? '•••••• guardado (déjalo vacío para no cambiarlo)' : 'Pega aquí el Secret';
  $('#payBadge').className = `badge ${d.enabled ? 'on' : 'off'}`;
  $('#payBadge').textContent = d.enabled ? `● Pagos activos (${d.config.mode === 'live' ? 'real' : 'prueba'})` : '● Pagos apagados: pon tus claves de PayPal';
  $('#paymentsBody').innerHTML = d.payments.map((p) => {
    const [cls, label] = PAY_STATUS[p.status] || ['', p.status];
    return `<tr><td><div class="u-name">${esc(p.name)}</div><div class="u-mail">${esc(p.email)}</div></td>
      <td>${esc(planName(p.plan))} · ${p.months} mes${p.months > 1 ? 'es' : ''}${p.provider === 'manual' ? ' <span class="tag">manual</span>' : ''}</td>
      <td>${money(p.amount)}</td><td><span class="tag ${cls}">${label}</span></td>
      <td>${fecha(p.paid_at || p.created_at)}</td><td>${fecha(p.expires_after)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Todavía no hay pagos</td></tr>';
}
$('#paypalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/admin/pagos/config', { method: 'PUT', body: { mode: f.mode.value, clientId: f.clientId.value, ...(f.secret.value ? { secret: f.secret.value } : {}) } });
    toast('Guardado');
    loadPayments();
  } catch (err) { toast(err.message, 'bad'); }
});
$('#paypalTest').addEventListener('click', async () => {
  try { await api('/admin/pagos/probar', { method: 'POST' }); toast('¡PayPal respondió! Las claves funcionan.'); }
  catch (err) { toast(err.message, 'bad'); }
});

// ---------- Correos ----------
async function loadMail() {
  const d = await api('/admin/correo');
  const f = $('#mailForm');
  f.user.value = d.config.user || '';
  f.fromName.value = d.config.fromName || '';
  f.host.value = d.config.host || '';
  f.port.value = d.config.port || '';
  f.pass.value = '';
  f.pass.placeholder = d.config.hasPass ? '•••••• guardada (déjalo vacío para no cambiarla)' : 'Las 16 letras que te da Google';
  for (const k of ['bienvenida', 'pago', 'vencimiento']) f[k].checked = !!d.config.auto[k];
  $('#mailBadge').className = `badge ${d.enabled ? 'on' : 'off'}`;
  $('#mailBadge').textContent = d.enabled ? '● Correos activos' : '● Correos apagados: configura tu Gmail';
  if (!plansCache.length) plansCache = (await api('/admin/plans')).plans;
  if (!usersCache.length) usersCache = (await api('/admin/users?q=')).users;
  const sel = $('#noticeTo');
  const keep = sel.value;
  sel.innerHTML = `<option value="todos">Todos los clientes</option><option value="activos">Clientes con plan activo</option><option value="vencidos">Clientes con plan vencido</option>
    ${plansCache.filter((p) => p.public).map((p) => `<option value="plan:${p.id}">Plan ${esc(p.name)}</option>`).join('')}
    <optgroup label="Una sola cuenta">${usersCache.map((u) => `<option value="user:${u.id}">${esc(u.name)} · ${esc(u.email)}</option>`).join('')}</optgroup>`;
  if (keep) sel.value = keep;
  const kinds = { bienvenida: 'Bienvenida', codigo: 'Código de contraseña', clave_cambiada: 'Contraseña cambiada', pago: 'Pago recibido', licencia: 'Licencia', vence_pronto: 'Por vencer', vencio: 'Vencido', aviso: 'Aviso', prueba: 'Prueba' };
  $('#mailLog').innerHTML = d.log.map((m) => `<div class="item"><div><div class="u-name">${esc(m.subject)}</div><div class="sub">${esc(m.email)} · ${fecha(m.created_at)}${m.error ? ` · ${esc(m.error)}` : ''}</div></div><span class="tag ${m.ok ? 'ok' : 'bad'}">${esc(kinds[m.kind] || m.kind)}</span></div>`).join('') || '<span class="muted">Todavía no se envió ningún correo</span>';
}
$('#mailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/admin/correo/config', { method: 'PUT', body: {
      user: f.user.value, fromName: f.fromName.value, host: f.host.value || 'smtp.gmail.com', port: Number(f.port.value) || 465,
      ...(f.pass.value ? { pass: f.pass.value } : {}),
      auto: { bienvenida: f.bienvenida.checked, pago: f.pago.checked, vencimiento: f.vencimiento.checked },
    } });
    toast('Guardado');
    loadMail();
  } catch (err) { toast(err.message, 'bad'); }
});
$('#mailTest').addEventListener('click', async () => {
  try { const r = await api('/admin/correo/prueba', { method: 'POST' }); toast(`Correo de prueba enviado a ${r.to}`); loadMail(); }
  catch (err) { toast(err.message, 'bad'); }
});
$('#noticeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { to: f.to.value, subject: f.subject.value, message: f.message.value };
  try {
    const { count } = await api('/admin/correo/aviso', { method: 'POST', body: { ...body, preview: true } });
    if (!confirm(`¿Enviar "${body.subject}" a ${count} cuenta${count > 1 ? 's' : ''}?`)) return;
    await api('/admin/correo/aviso', { method: 'POST', body });
    toast(`Enviando a ${count} cuenta${count > 1 ? 's' : ''}…`);
    f.subject.value = ''; f.message.value = '';
    setTimeout(loadMail, 1500);
  } catch (err) { toast(err.message, 'bad'); }
});
