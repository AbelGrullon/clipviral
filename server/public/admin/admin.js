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
const loaders = { resumen: loadStats, usuarios: loadUsers, publicaciones: loadPosts, pagos: loadPayments, correos: loadMail, planes: loadPlans, versiones: loadReleases, permisos: loadChecklist, ajustes: loadSettings };
function showTab(name) {
  if (name !== 'publicaciones') clearTimeout(postsTimer);
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
// Los últimos 14 días (el último es hoy), con 0 en los días sin datos.
function ultimos14(rows, key) {
  const map = Object.fromEntries(rows.map((r) => [r.day, r[key] || 0]));
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return days.map((d) => [d, map[d] || 0]);
}

function bars(el, rows, key, format) {
  const days = ultimos14(rows, key);
  const max = Math.max(1e-9, ...days.map(([, v]) => v));
  const total = days.reduce((a, [, v]) => a + v, 0);
  el.innerHTML = `<div class="sum"><b>${format(total)}</b>en los últimos 14 días</div><div class="cols">${days.map(([d, v], i) => {
    const hoy = i === days.length - 1;
    return `<div class="bar${hoy ? ' today' : ''}" data-tip="${hoy ? 'Hoy' : `${d.slice(8)}/${d.slice(5, 7)}`}: ${format(v)}"><b>${v ? format(v) : ''}</b><span style="height:${(v / max) * 100}%;animation-delay:${i * 35}ms"></span><small>${hoy ? 'hoy' : d.slice(8)}</small></div>`;
  }).join('')}</div>`;
}

// Mini gráfico de línea para los números grandes.
function spark(rows, key) {
  const pts = ultimos14(rows, key).map(([, v]) => v);
  const max = Math.max(1e-9, ...pts);
  const xy = pts.map((v, i) => [(i / (pts.length - 1)) * 100, 38 - (v / max) * 32]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line} L100 40 L0 40 Z"/><path class="l" d="${line}"/></svg>`;
}

const ICO = {
  cobro: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  mrr: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  clips: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 9.5l4 2.5-4 2.5z"/>',
  usuarios: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  nuevos: '<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 13-6.2M19 14v6M16 17h6"/>',
  hoy: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  costo: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  ganancia: '<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  horas: '<path d="M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n]}</svg>`;
const inicial = (name) => esc((String(name || '?').trim()[0] || '?').toUpperCase());

// Reparto en una barra (usuarios por plan, clips por modo) con su leyenda.
function reparto(el, obj, names, colors, vacio) {
  const entries = Object.entries(obj);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) { el.innerHTML = `<span class="muted">${vacio}</span>`; return; }
  const color = (k, i) => colors[k] || ['#3a6cff', '#7d9bff', '#b9c8ff', '#1f4bd1', '#5b6b8c'][i % 5];
  el.innerHTML = `<div class="dist">${entries.map(([k, v], i) => `<span style="flex:${v};background:${color(k, i)};animation-delay:${i * 90}ms" title="${esc(names[k] || k)}: ${v}"></span>`).join('')}</div>
    ${entries.map(([k, v], i) => `<span class="pill"><i style="background:${color(k, i)}"></i>${esc(names[k] || k)}<b>${v}</b><small>${Math.round((v / total) * 100)}%</small></span>`).join('')}`;
}

async function loadStats() {
  const s = await api('/admin/stats');
  $('#aiBadge').className = `badge ${s.aiEnabled ? 'on' : 'off'}`;
  $('#aiBadge').textContent = s.aiEnabled ? '● IA Pro activa' : '● IA Pro apagada: pon tu clave de Claude en Ajustes';
  $('#aiBadge').style.cursor = s.aiEnabled ? '' : 'pointer';
  $('#aiBadge').onclick = s.aiEnabled ? null : () => showTab('ajustes');
  const int = (n) => Math.round(n);
  // [título, valor, formato, color, icono, días para el mini gráfico, campo]. Los 4 primeros salen grandes.
  const cards = [
    ['Cobrado este mes', s.incomeMonth, money, 'good', 'cobro', s.incomeDaily, 's'],
    ['Ingreso mensual', s.mrr, money, 'good', 'mrr'],
    ['Clientes pagando', s.paying, int, '', 'clientes'],
    ['Clips sacados', s.clipsTotal, int, '', 'clips', s.clipsDaily, 'n'],
    ['Usuarios', s.totalUsers, int, '', 'usuarios'],
    ['Nuevos (7 días)', s.newUsers7d, int, '', 'nuevos'],
    ['Clips hoy', s.clipsToday, int, '', 'hoy'],
    ['Costo IA del mes', s.aiCostMonth, money, 'warn', 'costo'],
    ['Ganancia estimada', s.profitMonth, money, s.profitMonth >= 0 ? 'good' : 'warn', 'ganancia'],
    ['Horas analizadas', s.aiHoursMonth, (n) => n.toFixed(1), '', 'horas'],
  ];
  const notas = { 1: 'Lo que suman los planes activos cada mes', 2: `De ${s.totalUsers} cuenta${s.totalUsers === 1 ? '' : 's'} en total` };
  $('#stats').innerHTML = cards.map(([label, , , cls, icon, rows, key], i) => `<div class="stat ${i < 4 ? 'big' : ''}" style="animation-delay:${i * 60}ms">
    <div class="label">${ico(icon)}${label}</div><div class="value ${cls}">0</div>${i < 4 && rows ? spark(rows, key) : ''}${notas[i] ? `<div class="nota">${esc(notas[i])}</div>` : ''}</div>`).join('');
  $$('#stats .value').forEach((el, i) => countUp(el, cards[i][1], cards[i][2]));
  bars($('#chartSignups'), s.signups, 'n', (v) => Math.round(v));
  bars($('#chartAi'), s.aiDaily, 'cost', (v) => v.toFixed(2));
  bars($('#chartClips'), s.clipsDaily, 'n', (v) => Math.round(v));
  bars($('#chartIncome'), s.incomeDaily, 's', (v) => v.toFixed(0));
  reparto($('#clipsMode'), s.clipsByMode, { local: 'IA local', ia: 'Claude' }, { ia: '#3a6cff', local: '#9db4ff' }, 'Todavía no se sacaron clips');
  const maxClips = Math.max(1, ...s.topClippers.map((u) => u.n));
  $('#topClippers').innerHTML = s.topClippers.map((u, i) => `<div class="item" style="animation-delay:${i * 60}ms"><span class="pos">${i + 1}</span><div class="grow"><div class="u-name">${esc(u.name)}</div><div class="sub">${esc(u.email)}</div><div class="meter"><i style="width:${(u.n / maxClips) * 100}%"></i></div></div><span class="tag ok">${u.n} clips</span></div>`).join('') || '<span class="muted">Sin clips aún</span>';
  const names = { trial: 'Prueba', local: 'Local', pro: 'Claude', pro247: 'Pro 24/7', vencido: 'Vencidos' };
  reparto($('#byPlan'), s.byPlan, names, { pro: '#3a6cff', local: '#9db4ff', trial: '#6b7a99', pro247: '#1f4bd1', vencido: '#39445f' }, 'Sin usuarios aún');
  $('#recent').innerHTML = s.recent.map((u, i) => `<div class="item" style="animation-delay:${i * 60}ms"><div class="who-row"><span class="av">${inicial(u.name)}</span><div><div class="u-name">${esc(u.name)}</div><div class="sub">${esc(u.email)}</div></div></div><span class="tag ${u.planActive ? 'ok' : 'bad'}">${esc(u.planName)}</span></div>`).join('') || '<span class="muted">Sin registros</span>';
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
      <td><div class="who-row"><span class="av">${inicial(u.name)}</span><div><div class="u-name">${esc(u.name)} ${u.role === 'admin' ? '<span class="tag admin">admin</span>' : ''} ${u.banned ? '<span class="tag bad">suspendido</span>' : ''}</div><div class="u-mail">${esc(u.email)}</div></div></div></td>
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
    ${u.role === 'admin' ? `<label class="check"><input type="checkbox" id="mClave" ${u.claveServidor ? 'checked' : ''} /> 🔑 Puede usar tu clave de Claude (la del servidor): lo que gaste se cobra en tu cuenta</label>
    <p class="muted tiny" style="margin:-4px 0 8px 26px">${u.clavePropia ? 'Tiene su propia clave puesta en la app: usa esa.' : 'No tiene clave propia. Sin esta casilla, no usa Claude hasta que ponga la suya en la app (Ajustes).'}</p>` : ''}
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
  $('#mClave')?.addEventListener('change', async (e) => {
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { claveServidor: e.target.checked } });
      u.claveServidor = e.target.checked;
      toast(e.target.checked ? 'Ahora puede usar tu clave de Claude' : 'Ya no usa tu clave de Claude');
      loadUsers();
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, 'bad'); }
  });
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
  $('#webSame').classList.toggle('hidden', !!f);
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
  let avisoWeb = '';
  try {
    if (exe) {
      const data = new FormData();
      data.set('version', version);
      data.set('notes', form.notes.value);
      data.set('mandatory', form.mandatory.checked ? 'true' : 'false');
      const web = !zip && form.web.checked;
      data.set('web', web ? 'true' : 'false');
      data.set('file', exe);
      const r = await subirArchivo('/api/admin/releases', data, bar);
      hecho.push('las apps la verán al abrirse');
      if (r.descarga) hecho.push('la web ya descarga esta versión');
      if (r.descargaError) avisoWeb = r.descargaError;
    }
    if (zip) {
      bar.firstElementChild.style.width = '0';
      const data = new FormData();
      data.set('version', version);
      data.set('zip', zip);
      await subirArchivo('/api/admin/descarga', data, bar);
      hecho.push('la web ya descarga este .zip');
    }
    if (avisoWeb) toast(avisoWeb, 'bad'); else toast(`¡Listo! ${hecho.join(' y ')}.`);
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

// ---------- Publicaciones que el servidor va a hacer ----------
const NET_NAMES = { facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
const NET_ICONS = { facebook: '📘', instagram: '📸', youtube: '▶️', tiktok: '🎵' };
const POST_STATUS = {
  pendiente: ['', 'Programada'], subiendo: ['admin', 'Subiendo'], tarde: ['bad', 'Hora pasada'],
  publicado: ['ok', 'Publicada'], error: ['bad', 'Falló'], cancelado: ['', 'Cancelada'],
};
const cuando = (ms) => new Date(ms).toLocaleString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
function falta(ms) {
  const min = Math.round((ms - Date.now()) / 60000);
  if (min <= 0) return 'toca ya';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `en ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  return `en ${Math.round(h / 24)} días`;
}
const durTxt = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
function postClip(p) {
  const recorte = p.recorte ? String(p.recorte).replace(/^✂️\s*/, '') : '';
  return `<div class="post-clip"><div class="u-name">${esc(p.title || '(sin título)')}</div>
    ${p.duration ? `<div class="u-mail">⏱️ ${durTxt(p.duration)}${recorte ? ` · ✂️ ${esc(recorte)}` : ''}</div>` : ''}
    ${p.caption ? `<div class="u-mail post-caption">${esc(p.caption)}</div>` : ''}</div>`;
}
const postUser = (p) => `<div class="u-name">${esc(p.user.name)} ${p.user.role === 'admin' ? '<span class="tag admin">admin</span>' : ''}</div><div class="u-mail">${esc(p.user.email)}</div>`;
function postState(p) {
  const [cls, label] = POST_STATUS[p.status] || ['', p.status];
  const extra = p.status === 'subiendo' ? ` ${Math.round((p.progress || 0) * 100)}%` : '';
  const warn = !p.sePublica ? 'Esta cuenta no es admin: el servidor no la publica'
    : !p.conVideo && p.status !== 'publicado' && p.status !== 'cancelado' ? 'Falta el video en el servidor: la app lo vuelve a mandar' : '';
  return `<div class="post-state"><span class="tag ${cls}">${label}${extra}</span>${p.attempts && p.status !== 'publicado' ? ` <span class="u-mail">intento ${p.attempts}</span>` : ''}
    ${p.error ? `<div class="u-mail post-error">${esc(p.error)}</div>` : p.note ? `<div class="u-mail">${esc(p.note)}</div>` : ''}
    ${warn ? `<div class="u-mail post-error">${esc(warn)}</div>` : ''}</div>`;
}
let postsTimer = null;
async function loadPosts() {
  clearTimeout(postsTimer);
  const d = await api('/admin/publicaciones');
  $('#postsBadge').className = `badge ${d.activo ? 'on' : 'off'}`;
  $('#postsBadge').textContent = d.activo
    ? `● Publicando solo · ${d.proximas.length} por publicar`
    : d.puede ? '● El publicador está apagado' : '● Este servidor no puede publicar: le falta desktop/engine (actualízalo)';
  $('#postsNext').innerHTML = d.proximas.map((p) => `<tr>
      <td><div class="u-name">${cuando(p.scheduledAt)}</div><div class="u-mail">${p.status === 'subiendo' ? 'ahora' : p.status === 'tarde' ? 'la hora ya pasó' : falta(p.scheduledAt)}</div></td>
      <td>${NET_ICONS[p.platform] || ''} ${esc(NET_NAMES[p.platform] || p.platform)}</td>
      <td>${postClip(p)}</td>
      <td>${postUser(p)}</td>
      <td>${postState(p)}</td>
      <td><div class="btn-row post-actions">${['pendiente', 'tarde'].includes(p.status)
        ? `<button class="btn small" data-post-now="${esc(p.id)}">Publicar ya</button><button class="btn small danger" data-post-cancel="${esc(p.id)}">Cancelar</button>` : ''}</div></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No hay nada programado en el servidor. Lo que programes desde la app (con "Publicar desde el servidor" encendido) aparece aquí.</td></tr>';
  $('#postsLast').innerHTML = d.recientes.map((p) => `<tr>
      <td><div class="u-name">${cuando(p.publishedAt || p.updatedAt)}</div></td>
      <td>${NET_ICONS[p.platform] || ''} ${esc(NET_NAMES[p.platform] || p.platform)}</td>
      <td>${postClip(p)}${p.url ? `<div class="u-mail"><a href="${esc(p.url)}" target="_blank" rel="noopener">Ver publicación</a></div>` : ''}</td>
      <td>${postUser(p)}</td>
      <td>${postState(p)}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Nada en los últimos 7 días</td></tr>';
  // Se actualiza sola cada 20 segundos mientras la pestaña está abierta (y cada 3 s si algo se está subiendo).
  if (!$('[data-tab="publicaciones"].tab').classList.contains('hidden')) {
    postsTimer = setTimeout(() => loadPosts().catch(() => {}), d.proximas.some((p) => p.status === 'subiendo') ? 3000 : 20000);
  }
}
$('#postsNext').addEventListener('click', async (e) => {
  const now = e.target.closest('[data-post-now]')?.dataset.postNow;
  const cancel = e.target.closest('[data-post-cancel]')?.dataset.postCancel;
  if (!now && !cancel) return;
  if (cancel && !confirm('¿Cancelar esta publicación? No se publicará.')) return;
  const btn = e.target.closest('button');
  btn.disabled = true;
  try {
    await api(`/admin/publicaciones/${encodeURIComponent(now || cancel)}/${now ? 'ahora' : 'cancelar'}`, { method: 'POST' });
    toast(now ? 'Se publica en unos segundos' : 'Publicación cancelada');
    await loadPosts();
    // Para ver enseguida si se subió (o por qué falló), sin esperar la actualización de cada 20 segundos.
    if (now) setTimeout(() => loadPosts().catch(() => {}), 2500);
  } catch (err) {
    toast(err.message, 'bad');
    btn.disabled = false;
  }
});

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
