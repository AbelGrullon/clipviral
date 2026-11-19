'use strict';
// `api` viene de preload.js (window.api).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  user: null, plans: [], info: {}, settings: {}, comps: null, appInfo: {},
  engine: null, logs: [], activity: [], clips: [], producing: null, done: null,
  page: 'directo', update: null,
};

// ---------- Íconos ----------
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const I = {
  live: svg('<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>'),
  clips: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  plan: svg('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M11 3 8 9l4 12 4-12-3-6"/><path d="M2 9h20"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>', 'fill="currentColor"'),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>', 'fill="currentColor"'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  eye: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  wave: svg('<path d="M2 12h3l3-8 4 16 3-8h7"/>'),
  sparkles: svg('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  cpu: svg('<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>'),
  yt: svg('<path d="M22.5 6.4a2.8 2.8 0 0 0-2-2C18.8 4 12 4 12 4s-6.8 0-8.5.4a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1 12a29 29 0 0 0 .5 5.6 2.8 2.8 0 0 0 2 2C5.2 20 12 20 12 20s6.8 0 8.5-.4a2.8 2.8 0 0 0 2-2A29 29 0 0 0 23 12a29 29 0 0 0-.5-5.6z"/><polygon points="10 15 15 12 10 9" fill="currentColor"/>'),
  paste: svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'),
  film: svg('<rect x="2" y="2" width="20" height="20" rx="2.5"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>'),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>'),
};

// ---------- Pantallas en inglés ----------
// Para grabar el video de la revisión de Meta (quienes revisan leen inglés): el menú, la entrada, Redes,
// Crear publicación y Estadísticas se ven en inglés. Se enciende en Redes o en Ajustes. Lo demás sigue en español.
const EN = () => !!S.settings?.pantallasEnIngles;
const L = (es, en) => (EN() ? en : es);
/** Textos fijos del HTML (pantalla de entrada): data-en="English". El español se guarda en data-es. */
function applyStaticLang() {
  document.documentElement.lang = EN() ? 'en' : 'es';
  document.querySelectorAll('[data-en]').forEach((el) => {
    if (el.dataset.es === undefined) el.dataset.es = el.innerHTML;
    el.innerHTML = EN() ? el.dataset.en : el.dataset.es;
  });
  document.querySelectorAll('[data-en-ph]').forEach((el) => {
    if (el.dataset.esPh === undefined) el.dataset.esPh = el.placeholder;
    el.placeholder = EN() ? el.dataset.enPh : el.dataset.esPh;
  });
}
async function setEnglish(on) {
  S.settings = await api.setSettings({ pantallasEnIngles: !!on });
  applyStaticLang();
  renderNav();
  renderUserCard();
  renderPage(false);
}

// ---------- Utilidades ----------
const fmtClock = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(t % 60).padStart(2, '0')}`;
};
const fmtNum = (n) => Number(n || 0).toLocaleString('es');
const timeOf = (ms) => new Date(ms).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function fileUrl(p) {
  if (!p) return '';
  const parts = p.replace(/\\/g, '/').split('/');
  return `file:///${parts.map((x, i) => (i === 0 && /^[A-Za-z]:$/.test(x) ? x : encodeURIComponent(x))).join('/')}`;
}
function daysLeft(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function toast(msg, kind = 'ok', icon) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<i>${icon || (kind === 'bad' ? '⚠️' : kind === 'ok' ? '✅' : 'ℹ️')}</i><span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, kind === 'bad' ? 5200 : 3600);
}

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn, .chip, .mode, .icon-btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  btn.append(span);
  setTimeout(() => span.remove(), 600);
});

function countUp(el, to, fmt = fmtNum, ms = 900) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function withLoading(btn, fn) {
  btn.classList.add('loading');
  try { return await fn(); } finally { btn.classList.remove('loading'); }
}

// Confeti cuando sale un clip nuevo
function confetti() {
  const c = $('#confetti');
  const ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#e5161d', '#ff3a3f', '#ffffff', '#3a6cff', '#1c3f99', '#9dbaff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35,
    vx: (Math.random() - .5) * 16, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 3,
    c: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
  }));
  const end = performance.now() + 2600;
  const frame = (now) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += .4; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.globalAlpha = Math.max(0, (end - now) / 2600);
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (now < end) requestAnimationFrame(frame); else ctx.clearRect(0, 0, c.width, c.height);
  };
  requestAnimationFrame(frame);
}

function modal(html, { dismissable = true, onClose, wide = false } = {}) {
  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `<div class="card modal-card" ${wide ? 'style="width:auto;max-width:94vw"' : ''}>${html}</div>`;
  $('#modalRoot').append(root);
  const close = () => {
    root.classList.add('out');
    setTimeout(() => root.remove(), 250);
    onClose?.();
  };
  if (dismissable) {
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    const esc2 = (e) => { if (e.key === 'Escape') { close(); removeEventListener('keydown', esc2); } };
    addEventListener('keydown', esc2);
  }
  return { el: root, close };
}

function confirmBox(title, text, okLabel = 'Sí', danger = false) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="modal-actions"><button class="btn ghost" data-no>${L('Cancelar', 'Cancel')}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes><span>${esc(okLabel)}</span></button></div>`,
    { onClose: () => resolve(false) });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { resolve(true); m.el.remove(); };
  });
}

// ---------- Arranque ----------
async function boot() {
  const minSplash = new Promise((r) => setTimeout(r, 900));
  try { S.appInfo = await api.appInfo(); } catch {}
  S.cliente = S.appInfo?.edicion === 'cliente';
  try { S.settings = await api.getSettings(); applyStaticLang(); } catch {}
  let me = null;
  try { me = await api.session(); } catch {}
  await minSplash;
  $('#splash').classList.add('out');
  setTimeout(() => $('#splash').remove(), 500);
  if (S.cliente && me?.licencia && !me.licencia.active) showActivar(me.licencia);
  else if (me?.crearAdmin) showCrearAdmin();
  else if (me?.user) await showMain(me);
  else {
    showAuth();
    if (me?.error && me.offline) $('#authError').textContent = me.error;
  }
}

// ---------- Activar (versión para clientes) ----------
const ACT_WHY = {
  nueva: ['Activa ClipViral', 'Para usar ClipViral necesitas una clave de activación. Cada clave da 30 días.'],
  vencida: ['Tu licencia venció', 'Pasaron los días de tu clave. Pide una nueva para seguir sacando clips. Los clips que ya hiciste siguen en tu carpeta de Videos.'],
  reloj: ['Revisa la fecha de tu PC', 'La fecha y hora de esta PC están atrasadas. Ponlas bien (Configuración de Windows → Hora e idioma) y vuelve a abrir ClipViral.'],
  'otra-pc': ['Esta clave es de otra PC', 'La clave guardada se hizo para otra computadora. Pide una clave para el código de esta PC.'],
  invalida: ['Activa ClipViral', 'La clave guardada no es válida. Pide una nueva.'],
};
function showActivar(lic) {
  if (isRunning()) S.engine = null;
  $('#main').classList.add('hidden');
  $('#auth').classList.add('hidden');
  $$('.modal').forEach((m) => m.remove());
  $('#activar').classList.remove('hidden');
  const [title, why] = ACT_WHY[lic?.reason] || ACT_WHY.nueva;
  $('#actTitle').textContent = title;
  $('#actWhy').textContent = why;
  $('#actMachine').textContent = lic?.machine || '—';
  $('#actError').textContent = '';
}
$('#actBuy').addEventListener('click', () => comprarWeb());
$('#actCopy').addEventListener('click', async () => {
  await api.copy($('#actMachine').textContent);
  toast('Código copiado. Mándaselo a quien te vendió ClipViral.', 'ok', '📋');
});
$('#actPaste').addEventListener('click', async () => {
  const text = await api.paste().catch(() => '');
  if (text) $('#actKey').value = String(text).trim();
});
$('#actForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#actError').textContent = '';
  withLoading($('button[type=submit]', e.target), async () => {
    try {
      const lic = await api.activarLicencia($('#actKey').value);
      const me = await api.session();
      if (!me?.user) throw new Error(me?.error || 'No se pudo abrir ClipViral. Cierra y vuelve a abrir la app.');
      $('#activar').classList.add('hidden');
      $('#actKey').value = '';
      await showMain(me);
      confetti();
      toast(`¡ClipViral activado! Plan ${lic.planName}: ${lic.daysLeft} días.`, 'ok', '🎉');
    } catch (err) { $('#actError').textContent = err.message; }
  });
});
api.onLicenciaVencida?.((lic) => { if (S.cliente) showActivar(lic); });

// ---------- Entrar / registrarse ----------
function showAuth() {
  $('#main').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  // Versión de administradores: la cuenta se crea una sola vez; después solo se entra.
  if (S.appInfo?.edicion === 'admin') $('.auth-tabs').classList.add('hidden');
}

/** Versión de administradores, primera vez: crear la cuenta del administrador de esta PC. */
function showCrearAdmin() {
  showAuth();
  $('[data-auth=register]').click();
  $('.auth-tabs').classList.add('hidden');
  $('#registerForm').insertAdjacentHTML('afterbegin', '<div class="crear-admin"><h2>Crea tu cuenta de administrador</h2><p class="muted">Con este correo y contraseña entrarás a ClipViral desde ahora. Tendrás todo: Agente, Redes, Estadísticas y la clave de Claude.</p></div>');
  $('#registerForm button[type=submit] span').textContent = 'Crear mi cuenta';
  $('#registerForm .muted.tiny')?.classList.add('hidden');
  S.creandoAdmin = true;
}

$$('.auth-tabs button').forEach((b) => b.addEventListener('click', () => {
  const reg = b.dataset.auth === 'register';
  $$('.auth-tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('.auth-tabs').classList.toggle('register', reg);
  $('#loginForm').classList.toggle('hidden', reg);
  $('#registerForm').classList.toggle('hidden', !reg);
  $('#authError').textContent = '';
}));

$('#loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('button[type=submit]', e.target);
  $('#authError').textContent = '';
  withLoading(btn, async () => {
    try {
      const me = await api.login({ email: f.get('email'), password: f.get('password') });
      await showMain(me);
      toast(L(`¡Hola de nuevo, ${me.user.name.split(' ')[0]}!`, `Welcome back, ${me.user.name.split(' ')[0]}!`), 'ok', '👋');
    } catch (err) { $('#authError').textContent = err.message; }
  });
});

// Olvidé mi contraseña: 1) correo → 2) código de 6 números + contraseña nueva.
$('#forgotBtn').addEventListener('click', () => {
  const m = modal(`<h2>Recuperar contraseña</h2>
    <div id="fStep1"><p class="muted">Escribe el correo de tu cuenta y te enviamos un código de 6 números.</p>
      <label>Correo<input id="fEmail" type="email" value="${esc($('#loginForm [name=email]').value)}" /></label></div>
    <div id="fStep2" class="hidden"><p class="muted">Si el correo tiene una cuenta, te llegó un código (revisa también Spam). Vence en 30 minutos.</p>
      <label>Código<input id="fCode" inputmode="numeric" maxlength="6" placeholder="123456" /></label>
      <label>Contraseña nueva<input id="fPass" type="password" minlength="8" placeholder="Mínimo 8 caracteres" /></label></div>
    <p id="fErr" class="error"></p>
    <div class="modal-actions"><button class="btn ghost" data-c>Cancelar</button><button class="btn primary" data-go><span>Enviar código</span></button></div>`);
  $('[data-c]', m.el).onclick = () => m.close();
  let step = 1;
  $('[data-go]', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    $('#fErr', m.el).textContent = '';
    const email = $('#fEmail', m.el).value.trim();
    try {
      if (step === 1) {
        await api.forgotPassword(email);
        step = 2;
        $('#fStep1', m.el).classList.add('hidden');
        $('#fStep2', m.el).classList.remove('hidden');
        $('[data-go] span', m.el).textContent = 'Cambiar contraseña';
        $('#fCode', m.el).focus();
        return;
      }
      const me = await api.resetPassword({ email, code: $('#fCode', m.el).value, password: $('#fPass', m.el).value });
      m.close();
      await showMain(me);
      toast('Contraseña cambiada. ¡Ya entraste!', 'ok', '🔑');
    } catch (err) { $('#fErr', m.el).textContent = err.message; }
  });
});

$('#registerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('button[type=submit]', e.target);
  $('#authError').textContent = '';
  withLoading(btn, async () => {
    try {
      const me = await api.register({ name: f.get('name'), email: f.get('email'), password: f.get('password'), acceptTerms: f.get('acceptTerms') === 'on' });
      await showMain(me);
      confetti();
      toast(S.creandoAdmin ? '¡Listo! Ya eres el administrador de este ClipViral.' : '¡Cuenta creada! Tu prueba gratis ya empezó.', 'ok', '🎉');
    } catch (err) { $('#authError').textContent = err.message; }
  });
});

// ---------- App principal ----------
const PAGES = [
  { id: 'directo', label: 'Directo', en: 'Live', icon: I.live },
  { id: 'piloto', label: 'Piloto', en: 'Autopilot', icon: svg('<path d="M12 2 4 7v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7z"/><path d="m9 12 2 2 4-4"/>') },
  { id: 'sugeridos', label: 'Clips sugeridos', en: 'Suggested clips', icon: I.sparkles },
  { id: 'clips', label: 'Mis clips', en: 'My clips', icon: I.clips },
  { id: 'redes', admin: true, label: 'Redes', en: 'Networks', icon: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>') },
  { id: 'stats', admin: true, label: 'Estadísticas', en: 'Statistics', icon: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>') },
  { id: 'agente', soloAdmin: true, label: 'Agente', en: 'Agent', icon: svg('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3" r="1"/>') },
  { id: 'competencia', label: 'Competencia', en: 'Competitors', icon: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>') },
  { id: 'claves', soloAdmin: true, completa: true, label: 'Claves de clientes', en: 'Customer keys', icon: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l3 3M15 8l2 2"/>') },
  { id: 'panel', soloAdmin: true, link: true, label: 'Panel de administración', en: 'Admin panel', icon: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/>') },
  { id: 'plan', label: 'Mi plan', en: 'My plan', icon: I.plan },
  { id: 'ajustes', label: 'Ajustes', en: 'Settings', icon: I.settings },
];

async function showMain(me) {
  applyMe(me);
  // Se vuelve a preguntar al entrar, así el menú (por ejemplo "Claves de clientes") siempre está al día.
  try { S.appInfo = { ...S.appInfo, ...(await api.appInfo()) }; } catch {}
  [S.settings, S.clips] = await Promise.all([api.getSettings(), api.listClips()]);
  applyStaticLang();
  api.componentsStatus().then((c) => { S.comps = c; if (S.page === 'directo' && !isRunning()) renderPage(false); }).catch(() => {});
  const running = await api.engineState().catch(() => null);
  if (running) { S.engine = running.stats; S.logs = running.logs; }
  $('#auth').classList.add('hidden');
  $('#main').classList.remove('hidden');
  renderNav();
  initMenu();
  go(S.page);
  checkUpdates();
  // Revisa que la PC tenga todo lo necesario (si falta algo, lo pide) y analiza su rendimiento.
  // La primera vez va primero el análisis, porque la configuración sugerida cambia qué hay que descargar.
  const checkReq = () => api.systemCheck().then((r) => { S.system = r; if (!r.ok) showRequirements(r); }).catch(() => {});
  api.perfState().then((st) => {
    if (!st.seen) startupPerf(st).then(checkReq);
    else { checkReq(); startupPerf(st); }
  }).catch(checkReq);
  api.uploadsList().then((u) => { S.uploads = u; updateNavBadges(); }).catch(() => {});
  api.pilotState().then((p) => { S.pilot = p; updateNavBadges(); }).catch(() => {});
  api.sugList().then((s) => { S.sug = s; updateNavBadges(); }).catch(() => {});
}

function applyMe(me) {
  S.user = me.user;
  S.plans = me.plans || [];
  S.info = me.info || {};
  const a = $('#announce');
  a.classList.toggle('hidden', !S.info.announcement);
  a.textContent = S.info.announcement ? `📣 ${S.info.announcement}` : '';
  renderUserCard();
}

async function refreshMe() {
  const me = await api.session();
  if (me?.user) applyMe(me);
  else if (me?.loggedOut) { toast(me.error, 'bad'); showAuth(); }
}

/** Publicar en redes (a mano o automático) es solo para administradores: la app de Meta y TikTok está en modo desarrollo. */
function canPublish() {
  return S.info?.publicar ?? S.user?.role === 'admin';
}

function renderNav() {
  const nav = $('#nav');
  $$('button', nav).forEach((b) => b.remove());
  for (const p of PAGES) {
    if (p.admin && !canPublish()) continue;
    if (p.soloAdmin && S.user?.role !== 'admin') continue;
    if (p.completa && S.cliente) continue;
    if (p.id === 'claves' && !S.appInfo?.generaClaves) continue;
    const label = p.id === 'plan' && S.cliente ? L('Mi licencia', 'My license') : L(p.label, p.en);
    const b = document.createElement('button');
    b.dataset.page = p.id;
    b.innerHTML = `${p.icon}<span class="nav-label">${esc(label)}</span>`;
    b.title = label;
    // El panel de administración se abre en el navegador (usuarios, membresías, pagos, versiones).
    b.onclick = p.link ? () => api.openUrl(`${String(S.appInfo?.serverUrl || '').replace(/\/+$/, '')}/admin/`) : () => go(p.id);
    nav.append(b);
  }
  updateNavBadges();
}

function updateNavBadges() {
  const live = $('#nav [data-page=directo]');
  const clips = $('#nav [data-page=clips]');
  if (!live) return;
  live.querySelector('.dot')?.remove();
  if (isRunning()) live.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
  clips.querySelector('.count')?.remove();
  if (S.clips.length) clips.insertAdjacentHTML('beforeend', `<span class="count">${S.clips.length}</span>`);
  const redes = $('#nav [data-page=redes]');
  redes?.querySelector('.count')?.remove();
  const pending = (S.uploads || []).filter((u) => u.status === 'pendiente' || u.status === 'subiendo').length;
  if (redes && pending) redes.insertAdjacentHTML('beforeend', `<span class="count">${pending}</span>`);
  // Piloto: punto verde si está encendido, número si hay sugerencias esperando que decidas.
  const pil = $('#nav [data-page=piloto]');
  pil?.querySelector('.dot, .count')?.remove();
  const sugg = (S.pilot?.found || []).filter((c) => c.status === 'sugerencia').length;
  if (pil && sugg) pil.insertAdjacentHTML('beforeend', `<span class="count">${sugg}</span>`);
  else if (pil && S.settings?.piloto?.activo) pil.insertAdjacentHTML('beforeend', '<span class="dot ok-dot"></span>');
  // Clips sugeridos: cuántos clips esperan que los subas.
  const sug = $('#nav [data-page=sugeridos]');
  sug?.querySelector('.count')?.remove();
  const toPost = S.sug?.counts?.nueva || 0;
  if (sug && toPost) sug.insertAdjacentHTML('beforeend', `<span class="count">${toPost}</span>`);
}

// ---------- Menú desplegable ----------
// Se abre o se cierra con el botón de arriba del menú (se recuerda). En ventanas angostas queda cerrado.
function menuOpen() {
  try { return localStorage.getItem('menuAbierto') !== '0'; } catch { return true; }
}
function applyMenu() {
  const open = menuOpen() && window.innerWidth >= 900;
  $('#main').classList.toggle('menu-closed', !open);
  const t = $('#navToggle');
  t.setAttribute('aria-expanded', String(open));
  t.title = open ? L('Ocultar menú', 'Hide menu') : L('Mostrar menú', 'Show menu');
  t.querySelector('.nav-label').textContent = t.title;
}
function initMenu() {
  $('#navToggle').onclick = () => {
    try { localStorage.setItem('menuAbierto', menuOpen() ? '0' : '1'); } catch {}
    if (window.innerWidth < 900) { toast(L('La ventana es angosta: agrándala para ver el menú completo.', 'The window is narrow: make it wider to see the full menu.'), 'ok', '↔️'); return; }
    applyMenu();
  };
  window.addEventListener('resize', applyMenu);
  applyMenu();
}

// ---------- Fondo dinámico ----------
// La luz del fondo sigue un poco al mouse, y se enciende en rojo ("al aire") mientras graba un directo o el agente trabaja.
function initBackground() {
  const bg = $('.bg');
  if (!bg || bg.dataset.on) return;
  bg.dataset.on = '1';
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let raf = 0;
    window.addEventListener('pointermove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        bg.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        bg.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    });
  }
  const onAir = () => document.body.classList.toggle('on-air', !$('#main').classList.contains('hidden') && (isRunning() || !!S.agent?.busy));
  setInterval(onAir, 1500);
}
initBackground();

function movePill() {
  const btn = $(`#nav [data-page=${S.page}]`);
  const pill = $('.nav-pill');
  if (!btn || !pill) return;
  pill.style.height = `${btn.offsetHeight}px`;
  pill.style.transform = `translateY(${btn.offsetTop}px)`;
  $$('#nav button').forEach((b) => b.classList.toggle('active', b === btn));
}

function renderUserCard() {
  const u = S.user;
  if (!u) return;
  if (S.cliente) {
    api.licencia().then((lic) => {
      const d = lic.daysLeft;
      const status = d <= 5 ? `<span class="badge warn">${d} día${d === 1 ? '' : 's'}</span>` : '<span class="badge ok">Activo</span>';
      $('#userCard').innerHTML = `<div class="user-row"><div class="avatar">${esc(u.name.trim()[0]?.toUpperCase() || '?')}</div>
        <div style="min-width:0;flex:1"><div class="user-name">${esc(u.name)}</div><div class="user-plan">Plan ${esc(lic.planName || '')} · ${d} día${d === 1 ? '' : 's'}</div></div>${status}</div>`;
    }).catch(() => {});
    $('#userCard').onclick = () => go('plan');
    return;
  }
  const p = u.plan;
  const left = daysLeft(p.expires);
  const status = !p.active ? `<span class="badge bad">${L('Vencido', 'Expired')}</span>`
    : left !== null && left <= 5 ? `<span class="badge warn">${L(`${left} día${left === 1 ? '' : 's'}`, `${left} day${left === 1 ? '' : 's'}`)}</span>`
      : `<span class="badge ok">${L('Activo', 'Active')}</span>`;
  $('#userCard').innerHTML = `
    <div class="user-row"><div class="avatar">${esc(u.name[0]?.toUpperCase() || '?')}</div>
      <div style="min-width:0;flex:1"><div class="user-name">${esc(u.name)}</div><div class="user-plan">${esc(u.role === 'admin' ? L('Administrador', 'Administrator') : p.name)}</div></div>${status}</div>
    ${p.usesAi && u.role !== 'admin' ? `<div><div class="progress"><span style="width:${Math.min(100, (p.aiSecondsUsed / 36 / Math.max(1, p.aiHours)))}%"></span></div>
      <div class="tiny muted" style="margin-top:5px">${L('IA Pro', 'AI Pro')}: ${(p.aiSecondsUsed / 3600).toFixed(1)} ${L('de', 'of')} ${p.aiHours >= 100000 ? '∞' : p.aiHours} h</div></div>` : ''}`;
  $('#userCard').onclick = () => go('plan');
}

function isRunning() { return !!S.engine && S.engine.state !== 'done'; }

function go(page) {
  // Redes y Estadísticas son solo para administradores (publicar en redes).
  if (PAGES.find((p) => p.id === page)?.admin && !canPublish()) page = 'clips';
  if (PAGES.find((p) => p.id === page)?.soloAdmin && S.user?.role !== 'admin') page = 'clips';
  if (page === 'ajustes') S.claude = null; // se vuelve a revisar la clave al entrar (pudo cambiar desde el panel)
  S.page = page;
  movePill();
  renderPage(true);
}

function renderPage(animate) {
  const el = $('#page');
  ({ directo: renderDirecto, piloto: renderPiloto, sugeridos: renderSugeridos, clips: renderClips, redes: renderRedes, stats: renderStats, competencia: renderCompetencia, agente: renderAgente, claves: renderClaves, plan: S.cliente ? renderLicencia : renderPlan, ajustes: renderAjustes })[S.page]?.(el);
  if (animate) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); el.scrollTop = 0; }
  movePill();
}

// ---------- Página: Directo ----------
function missingComponents() {
  const c = S.comps;
  if (!c) return false;
  return !c.ytdlp || !c.deno || !c.ffmpeg || !c.whisper || !c.models?.[S.settings.whisperModel]?.installed;
}

function saveSetting(patch) {
  Object.assign(S.settings, patch);
  // Junta los cambios hechos casi al mismo tiempo (antes se perdía el primero).
  saveSetting.pending = { ...(saveSetting.pending || {}), ...patch };
  clearTimeout(saveSetting.t);
  saveSetting.t = setTimeout(() => {
    const p = saveSetting.pending;
    saveSetting.pending = null;
    api.setSettings(p).catch(() => {});
  }, 200);
}

// Precisión de Claude (modo IA Pro): qué hace cada nivel y cuánto cuesta más o menos.
const PRECISION_HINT = {
  normal: 'Rápida y barata: Haiku revisa el directo y Sonnet elige los clips. Más o menos 6 centavos de dólar por hora de directo.',
  alta: 'Claude Opus elige y corta los clips: entiende mejor el humor y el contexto, y corta en mejor momento. Más o menos 20 centavos por hora de directo, y tarda un poco más.',
  maxima: 'Sonnet revisa todo el directo con más cuidado (se le escapan menos momentos) y Opus elige y corta. Más o menos 40 centavos por hora de directo.',
};

/** Etiqueta de los clips que pidió el streamer o el chat ("saca ese clip"). */
function pedidoBadge(c) {
  if (!c?.pedido) return '';
  const quien = c.pedido.quien === 'chat' ? 'el chat' : 'el streamer';
  return `<span class="badge pedido" title="${esc(`Lo pidió ${quien}: “${c.pedido.frase || 'saca ese clip'}”`)}">🎯 Pedido por ${quien}</span>`;
}

function renderDirecto(el) {
  if (isRunning()) return renderLive(el);
  const s = S.settings;
  const plan = S.user.plan;
  const iaLocked = !plan.usesAi;
  if (s.mode === 'ia' && iaLocked) s.mode = 'local';
  const chips = (key, opts) => opts.map(([v, label, extra = '']) => `<button class="chip ${String(s[key]) === String(v) ? 'active' : ''}" data-key="${key}" data-val="${v}">${extra}${label}</button>`).join('');
  el.innerHTML = `
    <div class="page-head"><div><h1>Nuevo directo</h1><p class="muted">Pega el enlace y ClipViral hace el resto.</p></div>
      <button class="btn ghost small" id="openFolder">${I.folder} Carpeta de clips</button></div>
    ${S.done ? `<div class="done-box"><div class="big">🎉</div><div><b>¡Terminado!</b><div class="muted">Se guardaron ${S.done.clips} clip${S.done.clips === 1 ? '' : 's'} listos para subir.</div></div>
      <button class="btn primary small" id="seeClips"><span>Ver clips sugeridos</span></button></div>` : ''}
    ${!plan.active ? `<div class="warn-box"><span style="font-size:22px">⏳</span><div><b>Tu plan venció</b><div class="muted tiny">Renuévalo para seguir sacando clips.</div></div><button class="btn primary small" data-go="plan"><span>Ver planes</span></button></div>` : ''}
    ${missingComponents() ? `<div class="warn-box"><span style="font-size:22px">🧩</span><div><b>Falta instalar algunas herramientas</b><div class="muted tiny">Solo la primera vez. Se descargan solas (unos 360 MB).</div></div><button class="btn primary small" id="goInstall"><span>Instalar ahora</span></button></div>` : ''}
    ${needsClaudeKey() && s.mode === 'ia' ? `<div class="warn-box"><span style="font-size:22px">🔑</span><div><b>Falta tu clave de Claude</b><div class="muted tiny">La IA Pro usa tu propia cuenta de Claude. Pega tu clave una vez y listo, o usa el modo Local.</div></div><button class="btn primary small" id="goClaudeKey"><span>Poner clave</span></button></div>` : ''}
    <div class="grid stagger">
      <div class="card">
        <div class="url-box">${I.yt}<input id="url" placeholder="https://www.youtube.com/watch?v=…  (directo en vivo o video)" value="${esc(s.lastUrl || '')}" spellcheck="false" />
          <button class="btn small" id="pasteBtn">${I.paste} Pegar</button></div>
      </div>
      <div class="modes">
        <button class="mode ${s.mode === 'local' ? 'active' : ''}" data-mode="local"><span class="check-dot"></span>
          <div class="mode-icon">${I.cpu}</div><b>Local</b><small>Todo en tu PC: chat, volumen e IA local. Sin límite de horas.</small></button>
        <button class="mode ${s.mode === 'ia' ? 'active' : ''}" data-mode="ia">${iaLocked ? `<span class="lock badge">${I.lock} Pro</span>` : '<span class="check-dot"></span>'}
          <div class="mode-icon">${I.sparkles}</div><b>IA Pro con Claude</b><small>Claude lee todo el directo y elige los momentos más virales con título y hashtags.</small></button>
      </div>
      <div class="card">
        <div class="opt-row"><span>Duración</span><div class="chips">${chips('clipSeconds', [[15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s'], [120, '2 min']])}</div></div>
        <div class="opt-row"><span>Formato</span><div class="chips">${chips('style', [['blur', 'Vertical con fondo', '<i class="fmt"></i>'], ['recorte', 'Vertical recortado', '<i class="fmt"></i>'], ['camara', 'Cámara + juego', '<i class="fmt split"></i>'], ['horizontal', 'Horizontal', '<i class="fmt wide"></i>']])}</div></div>
        <p class="muted tiny cam-hint ${s.style === 'camara' ? '' : 'hidden'}" id="camHint">Para directos de juegos con la cámara del streamer en una esquina: la cámara va arriba y el juego abajo.
          La encuentra sola la IA que mira el video (o Claude, en el modo IA Pro). Si se equivoca, toca "Ajustar cámara" mientras graba. Los subtítulos van más chicos, dentro de la cámara, para no tapar el juego. Si no hay cámara, el clip va con fondo.</p>
        <div class="opt-row"><span>Subtítulos</span><div class="chips" style="align-items:center">
          <label class="toggle" title="Subtítulos"><input type="checkbox" id="subsToggle" ${s.subtitles ? 'checked' : ''}/><span></span></label>
          <span class="muted tiny">Colores, letra y posición en "Estilo del clip" ↓</span></div></div>
        ${s.mode === 'local' ? `<div class="opt-row"><span>Sensibilidad</span><div class="chips">${chips('sensitivity', [['baja', 'Solo lo mejor'], ['media', 'Normal'], ['alta', 'Más clips']])}</div></div>` : ''}
        ${s.mode === 'ia' ? `<div class="opt-row"><span>Precisión de Claude</span><div class="chips">${chips('precision', [['normal', 'Normal'], ['alta', 'Alta'], ['maxima', 'Máxima']])}</div></div>
          <p class="muted tiny" id="precisionHint">${esc(PRECISION_HINT[s.precision] || PRECISION_HINT.normal)} Lo cobra tu cuenta de Claude.</p>` : ''}
        <p class="muted tiny">🎯 Si el streamer dice "saca ese clip" (o el chat escribe !clip), la app saca un clip de lo que acaba de pasar.</p>
        <div class="opt-row"><span>Máx. clips por hora</span><div class="range-wrap"><input type="range" min="1" max="20" id="maxPerHour" value="${s.maxPerHour}"/><b id="maxPerHourVal">${s.maxPerHour}</b></div></div>
      </div>
      <div class="card" id="styleCard"></div>
      <button class="btn primary start-btn" id="startBtn" ${!plan.active ? 'disabled' : ''}>${I.play}<span>Iniciar</span></button>
    </div>`;

  $('#openFolder').onclick = () => api.openClipsFolder();
  $('#seeClips')?.addEventListener('click', () => { S.done = null; go('sugeridos'); });
  $('#goInstall')?.addEventListener('click', () => { go('ajustes'); setTimeout(() => $('#installAll')?.click(), 400); });
  $('#goClaudeKey')?.addEventListener('click', goClaudeKey);
  $$('[data-go]', el).forEach((b) => { b.onclick = () => go(b.dataset.go); });
  $('#pasteBtn').onclick = async () => { $('#url').value = (await api.paste()).trim(); $('#url').focus(); };
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#startBtn').click(); });
  $$('.mode', el).forEach((m) => m.addEventListener('click', () => {
    if (m.dataset.mode === 'ia' && iaLocked) {
      toast('La IA con Claude está en el plan Claude. Mira los planes.', 'info', '✨');
      return setTimeout(() => go('plan'), 500);
    }
    saveSetting({ mode: m.dataset.mode });
    renderDirecto(el);
  }));
  $$('.chip[data-key]', el).forEach((c) => c.addEventListener('click', () => {
    const val = c.dataset.key === 'clipSeconds' ? Number(c.dataset.val) : c.dataset.val;
    saveSetting({ [c.dataset.key]: val });
    $$(`.chip[data-key=${c.dataset.key}]`, el).forEach((x) => x.classList.toggle('active', x === c));
    if (c.dataset.key === 'style') $('#camHint')?.classList.toggle('hidden', val !== 'camara');
    if (c.dataset.key === 'precision' && $('#precisionHint')) $('#precisionHint').textContent = `${PRECISION_HINT[val] || PRECISION_HINT.normal} Lo cobra tu cuenta de Claude.`;
  }));
  $('#subsToggle').onchange = (e) => { saveSetting({ subtitles: e.target.checked }); renderStylePreview(); };
  renderStyleCard($('#styleCard'));
  $('#maxPerHour').oninput = (e) => { $('#maxPerHourVal').textContent = e.target.value; saveSetting({ maxPerHour: Number(e.target.value) }); };

  $('#startBtn').onclick = () => {
    const url = $('#url').value.trim();
    if (!url) { $('#url').focus(); return toast('Pega primero el enlace del directo', 'bad'); }
    if (S.settings.mode === 'ia' && needsClaudeKey()) {
      toast('Primero pon tu clave de Claude (o elige el modo Local)', 'bad', '🔑');
      return goClaudeKey();
    }
    withLoading($('#startBtn'), async () => {
      try {
        S.logs = []; S.activity = []; S.done = null; S.producing = null;
        const s2 = S.settings;
        S.engine = await api.startEngine({
          url, mode: s2.mode, clipSeconds: s2.clipSeconds, style: s2.style, subtitles: s2.subtitles,
          sensitivity: s2.sensitivity, maxPerHour: s2.maxPerHour, precision: s2.precision || 'normal',
        });
        S.settings.lastUrl = url;
        updateNavBadges();
        renderPage(true);
      } catch (err) {
        S.engine = null;
        if (err.message.startsWith('REQUISITOS')) {
          showRequirements(await api.systemCheck(S.settings.mode));
        } else {
          toast(err.message, 'bad');
        }
      }
    });
  };
}

function renderLive(el) {
  const st = S.engine;
  const info = st.info || {};
  // Con Claude (IA Pro) se ve cuánto va costando.
  const withCost = st.mode === 'ia' || st.aiCalls > 0;
  el.innerHTML = `
    <div class="grid">
      <div class="card live-head pop-in">
        ${info.thumbnail ? `<img class="live-thumb" src="${esc(info.thumbnail)}" alt="">` : `<div class="live-thumb"></div>`}
        <div class="grow">
          <div style="display:flex;gap:8px;flex-wrap:wrap" id="liveBadges"></div>
          <div class="live-title">${esc(info.title || 'Abriendo el enlace…')}</div>
          <div class="muted">${esc(info.channel || '')}</div>
        </div>
        ${S.settings.style === 'camara' ? '<button class="btn ghost" id="camBtn" title="Marcar dónde está la cámara del streamer">📷 <span>Ajustar cámara</span></button>' : ''}
        <button class="btn danger" id="stopBtn">${I.stop}<span>Detener</span></button>
      </div>
      <div class="grid ${withCost ? 'cols-5' : 'cols-4'} stagger">
        <div class="card stat"><div class="label">${I.clock} Grabado</div><div class="value" id="stRec">0:00</div></div>
        <div class="card stat"><div class="label">${I.wave} Analizado</div><div class="value" id="stAna">0:00</div></div>
        <div class="card stat"><div class="label">${I.chat} Mensajes del chat</div><div class="value" id="stChat">0</div></div>
        <div class="card stat"><div class="label">${I.film} Clips creados</div><div class="value" id="stClips">0</div></div>
        ${withCost ? `<div class="card stat cost-stat" title="Lo que van costando las consultas a Claude en este directo (se cobra en tu cuenta de Claude)">
          <div class="label">💲 Gasto de Claude</div><div class="value" id="stCost">US$ 0.00</div><div class="stat-sub" id="stCostSub">Todavía sin consultas</div></div>` : ''}
      </div>
      <div class="card pop-in"><h3>📈 Actividad del directo <span class="muted tiny">(los picos son posibles clips)</span></h3><canvas class="chart" id="chart"></canvas></div>
      <div class="grid cols-2">
        <div class="card pop-in"><h3>📝 Lo que está pasando</h3><div class="feed" id="feed"></div></div>
        <div class="card pop-in"><h3>🔥 Clips de este directo</h3><div id="producing"></div><div class="mini-clips" id="miniClips"></div></div>
      </div>
    </div>`;
  $('#stopBtn').onclick = async () => {
    const msg = S.engine?.info && !S.engine.info.isLive
      ? 'Deja de revisar el resto del video y crea los clips de lo que ya revisó. Si el video todavía se está bajando, espera a que termine para cortarlos.'
      : 'Se termina de analizar lo grabado y se crean los clips que falten.';
    if (!(await confirmBox('¿Detener?', msg, 'Detener', true))) return;
    $('#stopBtn').classList.add('loading');
    api.stopEngine();
  };
  $('#camBtn')?.addEventListener('click', ajustarCamara);
  $('#feed').innerHTML = S.logs.slice(-80).reverse().map(feedItem).join('');
  renderMiniClips();
  renderProducing();
  updateLive(st, true);
  requestAnimationFrame(drawChart);
}

// ---------- Cámara + juego: marcar la cámara a mano ----------
const camOk = (b) => b && b.w >= 0.08 && b.h >= 0.08 && b.w * b.h >= 0.015 && b.w * b.h <= 0.45;

async function ajustarCamara() {
  const btn = $('#camBtn');
  btn?.classList.add('loading');
  let shot;
  try { shot = await api.camaraFoto(); } catch (err) { return toast(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad'); } finally { btn?.classList.toggle('loading', false); }
  camModal(shot);
}

/** shot: { image, box (0 a 1) o null, manual, channel } */
function camModal(shot) {
  let box = shot.box ? { ...shot.box } : null;
  const m = modal(`<div class="cam-modal"><h2>📷 Ajustar cámara</h2>
    <p class="muted">Arrastra sobre la foto para marcar el recuadro de la cámara del streamer. Se guarda para <b>${esc(shot.channel || 'este canal')}</b>
      y se usa desde el próximo clip (también en sus próximos directos).</p>
    <div class="cam-pick" id="camPick"><img src="${shot.image}" alt="" draggable="false"><div class="cam-box hidden" id="camBox"><span>Cámara</span></div></div>
    <p class="error" id="camErr"></p>
    <div class="modal-actions">
      ${shot.manual ? '<button class="btn ghost" data-auto>Que la busque sola</button>' : ''}
      <button class="btn ghost" data-no>Cancelar</button>
      <button class="btn primary" data-save><span>Guardar cámara</span></button>
    </div></div>`, { wide: true });
  const pick = $('#camPick', m.el);
  const frame = $('#camBox', m.el);
  const draw = () => {
    frame.classList.toggle('hidden', !box);
    if (box) Object.assign(frame.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
    $('[data-save]', m.el).disabled = !camOk(box);
    $('#camErr', m.el).textContent = box && box.w > 0.02 && !camOk(box)
      ? (box.w * box.h > 0.45 ? 'Es muy grande: marca solo el recuadro de la cámara.' : 'Es muy chico: marca todo el recuadro de la cámara.') : '';
  };
  draw();
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const at = (e) => { const r = pick.getBoundingClientRect(); return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) }; };
  let from = null;
  pick.onpointerdown = (e) => { from = at(e); pick.setPointerCapture(e.pointerId); box = { ...from, w: 0, h: 0 }; draw(); };
  pick.onpointermove = (e) => {
    if (!from) return;
    const p = at(e);
    box = { x: Math.min(from.x, p.x), y: Math.min(from.y, p.y), w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y) };
    draw();
  };
  pick.onpointerup = () => { from = null; };
  $('[data-no]', m.el).onclick = m.close;
  $('[data-auto]', m.el)?.addEventListener('click', async () => {
    await api.camaraGuardar(shot.channel, null);
    m.close();
    toast('Listo: la cámara se vuelve a buscar sola', 'ok', '📷');
  });
  $('[data-save]', m.el).onclick = async () => {
    await api.camaraGuardar(shot.channel, box);
    m.close();
    toast('Cámara guardada para este canal. Se usa desde el próximo clip.', 'ok', '📷');
  };
}

function feedItem(l) {
  return `<div class="feed-item ${l.kind}"><time>${timeOf(l.at)}</time><span>${esc(l.text)}</span></div>`;
}

function updateLive(st, first) {
  if (S.page !== 'directo' || !$('#stRec')) return;
  $('#stRec').textContent = fmtClock(st.recorded);
  $('#stAna').textContent = fmtClock(st.analyzed);
  countUp($('#stChat'), st.chatMessages, fmtNum, first ? 0 : 600);
  const clipsEl = $('#stClips');
  if (Number(clipsEl.dataset.v || 0) !== st.clips) {
    countUp(clipsEl, st.clips, fmtNum, 500);
    if (!first) { clipsEl.classList.remove('bump'); void clipsEl.offsetWidth; clipsEl.classList.add('bump'); }
  }
  updateCost(st);
  const info = st.info || {};
  $('#liveBadges').innerHTML = `${info.isLive ? '<span class="badge live">EN VIVO</span>' : info.title ? '<span class="badge">VIDEO</span>' : ''}
    <span class="badge ${st.mode === 'ia' ? 'grad' : ''}">${st.mode === 'ia' ? '✨ IA Pro' : '💻 Local'}</span>
    ${st.state === 'finishing' ? '<span class="badge warn">Terminando…</span>' : st.state === 'starting' ? '<span class="badge">Iniciando…</span>' : ''}`;
}

/** Dólares: con centavos chicos se muestran más decimales (una consulta a Haiku cuesta menos de un centavo). */
function fmtUsd(v) {
  const n = Number(v) || 0;
  return `US$ ${n === 0 ? '0.00' : n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
}

function updateCost(st) {
  const el = $('#stCost');
  if (!el) return;
  const cost = Number(st.aiCostUsd) || 0;
  const calls = Number(st.aiCalls) || 0;
  if (el.dataset.v !== String(cost)) {
    const changed = el.dataset.v !== undefined;
    el.dataset.v = String(cost);
    el.textContent = fmtUsd(cost);
    if (changed) { el.classList.toggle('bump', false); void el.offsetWidth; el.classList.toggle('bump', true); }
  }
  // Cuánto saldría una hora de directo a este ritmo (cuando ya hay bastante analizado para estimar).
  const perHour = st.analyzed >= 300 && cost > 0 ? cost / (st.analyzed / 3600) : 0;
  $('#stCostSub').textContent = !calls ? 'Todavía sin consultas'
    : `${fmtNum(calls)} consulta${calls === 1 ? '' : 's'}${perHour ? ` · ≈ ${fmtUsd(perHour)} por hora` : ''}`;
}

function renderMiniClips() {
  const box = $('#miniClips');
  if (!box) return;
  const streamId = S.engine?.info?.id;
  const list = S.clips.filter((c) => c.stream?.id === streamId).slice(0, 20);
  box.innerHTML = list.length ? list.map((c) => `<div class="mini-clip" data-id="${esc(c.id)}">
      <img src="${esc(fileUrl(c.thumb))}" alt=""><div style="min-width:0"><b>${esc(c.title)}</b>
      <span class="badge" style="margin-top:6px">🔥 ${c.score}/10</span> ${pedidoBadge(c)} <span class="muted tiny">${fmtClock(c.duration)}</span></div></div>`).join('')
    : `<div class="empty" style="padding:30px 10px"><div class="big" style="font-size:38px">🎬</div><div class="muted">Los clips aparecerán aquí apenas estén listos.</div></div>`;
  $$('.mini-clip', box).forEach((m) => { m.onclick = () => openPlayer(S.clips.find((c) => c.id === m.dataset.id)); });
}

function renderProducing() {
  const box = $('#producing');
  if (!box) return;
  box.innerHTML = S.producing ? `<div class="producing" style="margin-bottom:10px"><div class="spinner"></div><div><b>Creando clip…</b><div class="muted tiny">${esc(S.producing.title)}</div></div></div>` : '';
}

function drawChart() {
  const c = $('#chart');
  if (!c) return;
  const ratio = devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  c.width = w * ratio; c.height = h * ratio;
  const ctx = c.getContext('2d');
  ctx.scale(ratio, ratio);
  const pts = S.activity.slice(-360);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke(); }
  if (pts.length < 2) {
    ctx.fillStyle = 'rgba(155,155,184,.8)';
    ctx.font = '13px Segoe UI';
    ctx.fillText('Esperando el primer pedazo del directo (unos 2 minutos)…', 12, h / 2);
    return;
  }
  const max = Math.max(3, ...pts.map((p) => p.score)) * 1.1;
  const x = (i) => (i / (pts.length - 1)) * w;
  const y = (v) => h - (v / max) * (h - 10) - 4;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#3a6cff'); grad.addColorStop(.6, '#8fb0ff'); grad.addColorStop(1, '#ff3a3f');
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, 'rgba(58,108,255,.32)'); fill.addColorStop(1, 'rgba(58,108,255,0)');
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (!i) ctx.moveTo(x(i), y(p.score));
    else { const xc = (x(i - 1) + x(i)) / 2; ctx.quadraticCurveTo(x(i - 1), y(pts[i - 1].score), xc, (y(pts[i - 1].score) + y(p.score)) / 2); }
  });
  ctx.lineTo(w, y(pts[pts.length - 1].score));
  ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  // Marcas de clips
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t;
  for (const clip of S.clips.filter((cl) => cl.stream?.id === S.engine?.info?.id)) {
    const mid = (clip.start + clip.end) / 2;
    if (mid < t0 || mid > t1) continue;
    const px = ((mid - t0) / Math.max(1, t1 - t0)) * w;
    ctx.fillStyle = '#facc15';
    ctx.beginPath(); ctx.arc(px, 10, 5, 0, Math.PI * 2); ctx.fill();
  }
}
addEventListener('resize', () => requestAnimationFrame(drawChart));

// ---------- Eventos del motor ----------
api.onLog((l) => {
  S.logs.push(l);
  if (S.logs.length > 300) S.logs.shift();
  const feed = $('#feed');
  if (feed) { feed.insertAdjacentHTML('afterbegin', feedItem(l)); if (feed.children.length > 80) feed.lastElementChild.remove(); }
});
api.onStats((st) => {
  const wasRunning = isRunning();
  S.engine = st;
  if (S.page === 'directo' && isRunning() && !$('#stRec')) renderPage(false);
  else updateLive(st);
  if (wasRunning !== isRunning()) updateNavBadges();
});
api.onActivity((pts) => { S.activity.push(...pts); drawChart(); });
api.onProducing((p) => { S.producing = p; renderProducing(); });
api.onClip((c) => {
  S.clips.unshift(c);
  S.producing = null;
  renderProducing();
  renderMiniClips();
  drawChart();
  updateNavBadges();
  confetti();
  toast(`Nuevo clip: ${c.title}`, 'ok', '🔥');
  if (S.page === 'clips') renderPage(false);
});
api.onModeChange(() => { toast('Se acabaron las horas de IA Pro. Sigo en modo Local.', 'info', '💻'); refreshMe(); });
api.onDone((d) => {
  S.done = d;
  S.producing = null;
  if (S.engine) S.engine.state = 'done';
  updateNavBadges();
  refreshMe().catch(() => {});
  toast(`Terminado: ${d.clips} clip${d.clips === 1 ? '' : 's'} guardado${d.clips === 1 ? '' : 's'}`, 'ok', '🎉');
  if (S.page === 'directo') renderPage(true);
});

// ---------- Página: Clips ----------
function renderClips(el) {
  const streams = [...new Map(S.clips.map((c) => [c.stream?.id, c.stream])).values()].filter(Boolean);
  el.innerHTML = `
    <div class="page-head"><div><h1>Mis clips</h1><p class="muted">${S.clips.length} clip${S.clips.length === 1 ? '' : 's'} listos para subir</p></div>
      <div style="display:flex;gap:10px">
        <select id="streamFilter" class="search"><option value="">Todos los directos</option>${streams.map((s) => `<option value="${esc(s.id)}">${esc(s.title.slice(0, 50))}</option>`).join('')}</select>
        <input id="clipSearch" class="search" placeholder="Buscar…" />
        <button class="btn" id="openFolder2">${I.folder} Abrir carpeta</button></div></div>
    <div id="clipGrid"></div>`;
  const draw = () => {
    const q = $('#clipSearch').value.toLowerCase();
    const sid = $('#streamFilter').value;
    const list = S.clips.filter((c) => (!sid || c.stream?.id === sid) && (!q || `${c.title} ${c.hashtags.join(' ')} ${c.stream?.title}`.toLowerCase().includes(q)));
    const grid = $('#clipGrid');
    if (!list.length) {
      grid.innerHTML = `<div class="empty"><div class="big">🎬</div><h3>${S.clips.length ? 'No hay clips con esa búsqueda' : 'Todavía no tienes clips'}</h3>
        <p class="muted">${S.clips.length ? 'Prueba con otra palabra.' : 'Ve a "Directo", pega un enlace y presiona Iniciar.'}</p>
        ${S.clips.length ? '' : '<button class="btn primary" data-go="directo"><span>Empezar</span></button>'}</div>`;
      $$('[data-go]', grid).forEach((b) => { b.onclick = () => go(b.dataset.go); });
      return;
    }
    grid.innerHTML = `<div class="clip-grid stagger">${list.map((c) => `
      <div class="clip-card" data-id="${esc(c.id)}">
        <div class="clip-media" data-act="play">
          ${c.thumb ? `<img src="${esc(fileUrl(c.thumb))}" alt="" loading="lazy">` : ''}
          <div class="play"><span>▶</span></div>
          <span class="badge score">🔥 ${c.score}/10</span><span class="dur">${fmtClock(c.duration)}</span>
        </div>
        <div class="clip-body">${pedidoBadge(c)}<div class="clip-title">${esc(c.title)}</div>
          <div class="clip-tags">${esc(c.hashtags.join(' '))}</div>
          <div class="clip-src">${esc(c.stream?.channel || '')} · ${new Date(c.createdAt).toLocaleDateString('es')}</div></div>
        <div class="clip-actions">
          <button class="icon-btn" data-act="suggest" title="Preparar para publicar (Clips sugeridos)">${I.sparkles}</button>
          ${canPublish() ? `<button class="icon-btn up" data-act="upload" title="Subir a redes">${uploadedIcons(c.id) || I.upload}</button>` : ''}
          <button class="icon-btn" data-act="copy" title="Copiar título y hashtags">${I.copy}</button>
          <button class="icon-btn" data-act="reveal" title="Mostrar en la carpeta">${I.folder}</button>
          <button class="icon-btn del" data-act="delete" title="Borrar">${I.trash}</button>
        </div>
      </div>`).join('')}</div>`;
    $$('.clip-card', grid).forEach((card) => {
      const clip = S.clips.find((c) => c.id === card.dataset.id);
      const media = $('.clip-media', card);
      let video;
      media.addEventListener('mouseenter', () => {
        if (!video) { video = document.createElement('video'); video.src = fileUrl(clip.file); video.muted = true; video.loop = true; media.prepend(video); }
        video.currentTime = 0;
        video.play().then(() => media.classList.add('playing')).catch(() => {});
      });
      media.addEventListener('mouseleave', () => { media.classList.remove('playing'); video?.pause(); });
      card.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'play') openPlayer(clip);
        if (act === 'upload') openUploadModal(clip);
        if (act === 'suggest') suggestClip(clip);
        if (act === 'copy') { await api.copy(clipText(clip)); toast('Título y hashtags copiados', 'ok', '📋'); }
        if (act === 'reveal') api.revealClip(clip.file);
        if (act === 'delete') {
          if (!(await confirmBox('¿Borrar este clip?', `Se borrará "${clip.title}" de tu PC.`, 'Borrar', true))) return;
          card.style.transition = 'all .35s'; card.style.transform = 'scale(.85)'; card.style.opacity = '0';
          await api.deleteClip(clip.id);
          S.clips = S.clips.filter((c) => c.id !== clip.id);
          updateNavBadges();
          setTimeout(() => { $('.page-head p', el).textContent = `${S.clips.length} clips listos para subir`; draw(); }, 330);
        }
      });
    });
  };
  $('#clipSearch').oninput = draw;
  $('#streamFilter').onchange = draw;
  $('#openFolder2').onclick = () => api.openClipsFolder();
  draw();
}

function clipText(c) {
  return `${c.title}\n\n${c.description ? `${c.description}\n\n` : ''}${c.hashtags.join(' ')}`;
}

function openPlayer(clip) {
  if (!clip) return;
  const m = modal(`
    <div class="player">
      <video src="${esc(fileUrl(clip.file))}" controls autoplay></video>
      <div style="display:flex;flex-direction:column;gap:12px;min-width:260px;max-width:360px">
        <div><span class="badge">🔥 ${clip.score}/10</span> <span class="badge">${fmtClock(clip.duration)}</span> <span class="badge ${clip.mode === 'ia' ? 'grad' : ''}">${clip.mode === 'ia' ? '✨ IA Pro' : '💻 Local'}</span> ${pedidoBadge(clip)}</div>
        <h2 style="margin:0">${esc(clip.title)}</h2>
        ${clip.reason ? `<div class="muted tiny">Por qué: ${esc(clip.reason)}</div>` : ''}
        <div class="copy-box">${esc(clipText(clip))}</div>
        <div class="muted tiny">De: ${esc(clip.stream?.channel || '')} — minuto ${fmtClock(clip.start)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto">
          <button class="btn primary small" data-a="copy">${I.copy}<span>Copiar texto</span></button>
          <button class="btn small" data-a="reveal">${I.folder} Ver en carpeta</button>
          <button class="btn small ghost" data-a="close">Cerrar</button>
        </div>
      </div>
    </div>`, { wide: true });
  $('[data-a=copy]', m.el).onclick = async () => { await api.copy(clipText(clip)); toast('Copiado', 'ok', '📋'); };
  $('[data-a=reveal]', m.el).onclick = () => api.revealClip(clip.file);
  $('[data-a=close]', m.el).onclick = () => m.close();
}

// ---------- Página: Plan ----------
function renderPlan(el) {
  const p = S.user.plan;
  const left = daysLeft(p.expires);
  const pct = p.usesAi ? Math.min(100, (p.aiSecondsUsed / 36) / Math.max(1, p.aiHours)) : 0;
  el.innerHTML = `
    <div class="page-head"><div><h1>Mi plan</h1><p class="muted">Elige el plan que mejor va contigo.</p></div>
      <button class="btn ghost small" id="refreshPlan">↻ Actualizar</button></div>
    <div class="grid">
      <div class="card plan-hero pop-in">
        <div class="ring" style="--p:0" id="ring"><div><b>${p.usesAi ? `${Math.round(pct)}%` : '∞'}</b><small>${p.usesAi ? 'horas IA usadas' : 'uso local'}</small></div></div>
        <div style="flex:1">
          <div style="display:flex;gap:8px;align-items:center"><h2 style="margin:0">${esc(p.name)}</h2>
            ${p.active ? '<span class="badge ok">Activo</span>' : '<span class="badge bad">Vencido</span>'}</div>
          <p class="muted" style="margin:6px 0">${p.expires ? (left > 0 ? `Vence en ${left} día${left === 1 ? '' : 's'} (${new Date(p.expires).toLocaleDateString('es')})` : `Venció el ${new Date(p.expires).toLocaleDateString('es')}`) : 'Sin fecha de vencimiento'}</p>
          ${p.usesAi ? `<p style="margin:0">IA Pro: <b>${(p.aiSecondsUsed / 3600).toFixed(1)} h</b> usadas de <b>${p.aiHours >= 100000 ? '∞' : `${p.aiHours} h`}</b> este mes</p>` : '<p style="margin:0">Modo Local ilimitado. Con el plan Claude, Claude elige los clips usando tu propia clave.</p>'}
          <p class="muted tiny" style="margin-top:8px">Soporte: ${soporteTexto()}</p>
        </div>
      </div>
      <div class="plans stagger">
        ${S.plans.map((pl) => `
          <div class="card plan ${pl.id === 'pro' ? 'popular' : ''} ${pl.id === p.id && p.active ? 'current' : ''}">
            ${pl.id === 'pro' ? '<span class="badge grad ribbon">⭐ Más popular</span>' : ''}
            <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">${esc(pl.name)}</h3>${pl.usesAi ? '<span class="badge grad">✨ Claude</span>' : '<span class="badge">💻 Local</span>'}</div>
            <div class="plan-price">$${pl.priceUsd % 1 ? pl.priceUsd.toFixed(2) : pl.priceUsd}<small> /mes</small></div>
            <div class="muted tiny">${esc(pl.description)}</div>
            <ul>
              <li>Clips ilimitados en modo Local</li>
              <li>Subtítulos animados y formato vertical</li>
              <li>IA local que ve y escucha: risas, gritos, chat y reacciones</li>
              ${pl.usesAi ? `<li><span>${pl.aiHours >= 100000 ? '<b>Claude sin límite de horas</b>' : `<b>${pl.aiHours} h</b> al mes con Claude`}, con tu propia clave de Claude</span></li><li>Títulos, descripciones y hashtags automáticos</li>` : '<li>Títulos y hashtags con IA local (Ollama)</li>'}
            </ul>
            <button class="btn ${pl.id === 'pro' ? 'primary' : ''} wide" data-buy="${pl.id}"><span>${pl.id === p.id && p.active ? 'Renovar (+1 mes)' : 'Elegir plan'}</span></button>
          </div>`).join('')}
      </div>
      <div class="card hidden" id="myPayments"><h3 style="margin-top:0">Mis pagos</h3><div id="myPaymentsList"></div></div>
    </div>`;
  renderMyPayments();
  requestAnimationFrame(() => setTimeout(() => {
    const ring = $('#ring');
    if (!ring) return;
    const start = performance.now();
    const anim = (now) => { const t = Math.min(1, (now - start) / 1000); ring.style.setProperty('--p', (pct || (p.usesAi ? 0 : 100)) * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(anim); };
    requestAnimationFrame(anim);
  }, 100));
  $('#refreshPlan').onclick = (e) => withLoading(e.currentTarget, async () => { await refreshMe(); renderPage(false); toast('Plan actualizado'); });
  $$('[data-buy]', el).forEach((b) => { b.onclick = () => buyPlan(S.plans.find((x) => x.id === b.dataset.buy)); });
}

// ---------- Mi licencia (versión para clientes) ----------
async function renderLicencia(el) {
  const lic = await api.licencia().catch(() => null);
  if (!lic) return;
  const fin = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  el.innerHTML = `
    <div class="page-head"><div><h1>Mi licencia</h1><p class="muted">Cada clave da 30 días. Pide la siguiente antes de que se acabe: si es del mismo plan, los días se suman.</p></div></div>
    <div class="grid">
      <div class="card pop-in">
        <div style="display:flex;gap:10px;align-items:center"><h2 style="margin:0">Plan ${esc(lic.planName)} · ${lic.daysLeft} día${lic.daysLeft === 1 ? '' : 's'}</h2>
          ${lic.daysLeft <= 5 ? '<span class="badge warn">Pide tu próxima clave</span>' : '<span class="badge ok">Activa</span>'}</div>
        <p class="muted" style="margin:6px 0 0">Vence el ${esc(fin)}.</p>
        <button class="btn primary" id="licBuy" style="margin-top:14px"><span>🛒 Comprar o renovar en la web</span></button>
        <p style="margin:10px 0 0">${lic.plan === 'claude' ? 'Claude elige los mejores momentos con tu propia clave de Claude (ponla en Ajustes), además de la IA local.' : 'La IA local de tu PC saca los clips. Para que Claude elija los clips, pide una clave del plan Claude.'}</p>
      </div>
      <div class="card">
        <h3>Renovar</h3>
        <span class="act-label">Código de esta PC</span>
        <div class="act-code"><b>${esc(lic.machine)}</b><button class="btn small" id="licCopy">Copiar código</button></div>
        <label>Clave nueva<textarea id="licKey" rows="4" spellcheck="false" placeholder="Pega aquí la clave nueva" style="width:100%;resize:none;font:500 13px/1.5 Consolas,monospace"></textarea></label>
        <div class="net-actions" style="margin-top:8px"><button class="btn small" id="licPaste">Pegar</button><button class="btn small primary" id="licGo"><span>Activar clave nueva</span></button></div>
        <p class="error" id="licErr"></p>
      </div>
    </div>`;
  $('#licBuy').onclick = comprarWeb;
  $('#licCopy').onclick = async () => { await api.copy(lic.machine); toast('Código copiado', 'ok', '📋'); };
  $('#licPaste').onclick = async () => { const t = await api.paste().catch(() => ''); if (t) $('#licKey').value = String(t).trim(); };
  $('#licGo').onclick = (e) => withLoading(e.currentTarget, async () => {
    $('#licErr').textContent = '';
    try {
      const st = await api.activarLicencia($('#licKey').value);
      toast(`Clave activada. Plan ${st.planName}: ${st.daysLeft} días.`, 'ok', '🎉');
      await refreshMe();
      renderPage(false);
    } catch (err) { $('#licErr').textContent = err.message; }
  });
}

// ---------- Claves de clientes (solo tu versión) ----------
async function renderClaves(el) {
  let data;
  try { data = await api.licenciasLista(); } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const fecha = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  el.innerHTML = `
    <div class="page-head"><div><h1>Claves de clientes</h1><p class="muted">El cliente te manda el código que ve al abrir ClipViral. Aquí haces su clave y se la envías.</p></div></div>
    ${data.disponible ? '' : `<div class="card"><p class="error">Falta tu clave privada. Debe estar en ${esc(data.carpeta)}\\clave-privada.pem</p></div>`}
    <div class="grid">
      <div class="card pop-in">
        <h3>Nueva clave</h3>
        <label>Código de la PC del cliente<input id="clCode" placeholder="ABCD-EFGH" maxlength="12" spellcheck="false" autocomplete="off" style="font:600 18px var(--font-display);letter-spacing:2px" /></label>
        <span class="act-label">Plan del cliente</span>
        <div class="chips" id="clPlan" style="margin-bottom:12px">${Object.entries(data.planes).map(([id, pl], i) => `<button type="button" class="chip ${i === 0 ? 'active' : ''}" data-plan="${id}" title="${esc(pl.desc)}">${esc(pl.name)} · $${pl.price}</button>`).join('')}</div>
        <div style="display:grid;grid-template-columns:120px 1fr;gap:12px">
          <label>Días<input id="clDays" type="number" min="1" max="255" value="30" /></label>
          <label>Nota (para ti)<input id="clNote" maxlength="80" placeholder="Nombre del cliente" /></label>
        </div>
        <button class="btn primary" id="clGo" ${data.disponible ? '' : 'disabled'}><span>Crear clave</span></button>
        <p class="error" id="clErr"></p>
        <div id="clOut" class="${S.lastKey ? '' : 'hidden'}" style="margin-top:12px">
          <div class="lic-key" id="clKey">${esc(S.lastKey || '')}</div>
          <div class="net-actions" style="margin-top:8px"><button class="btn small primary" id="clCopy">Copiar clave</button></div>
        </div>
      </div>
      <div class="card">
        <h3>Claves que hiciste</h3>
        ${data.emitidas.length ? data.emitidas.slice(0, 50).map((k, i) => `<div class="lic-row"><span>${fecha(k.at)}</span><b>${esc(k.codigo)}</b>
          <span class="muted">${esc(k.nota || '—')} · ${esc(data.planes[k.plan]?.name || 'Claude')} · ${k.dias} días</span><button class="btn small ghost" data-copy="${i}">Copiar</button></div>`).join('')
    : '<p class="muted">Todavía no hiciste ninguna.</p>'}
        <p class="tiny muted" style="margin-top:12px">Guarda una copia de la carpeta ${esc(data.carpeta)} (por ejemplo en un USB). Si pierdes la clave privada, no podrás hacer claves para los clientes que ya tienen la app.</p>
      </div>
    </div>`;
  $('#clGo').onclick = (e) => withLoading(e.currentTarget, async () => {
    $('#clErr').textContent = '';
    try {
      const plan = $('#clPlan .chip.active')?.dataset.plan;
      const r = await api.generarLicencia({ codigo: $('#clCode').value, plan, dias: Number($('#clDays').value), nota: $('#clNote').value });
      await api.copy(r.clave);
      toast('Clave creada y copiada. Pégasela al cliente.', 'ok', '🔑');
      S.lastKey = r.clave;
      renderPage(false);
    } catch (err) { $('#clErr').textContent = err.message; }
  });
  $('#clCopy').onclick = () => api.copy(S.lastKey).then(() => toast('Clave copiada', 'ok'));
  $$('#clPlan .chip', el).forEach((c) => { c.onclick = () => $$('#clPlan .chip', el).forEach((x) => x.classList.toggle('active', x === c)); });
  $$('[data-copy]', el).forEach((b) => { b.onclick = () => api.copy(data.emitidas[Number(b.dataset.copy)].clave).then(() => toast('Clave copiada', 'ok')); });
}

const PAY_LABEL = { pagado: ['ok', 'Pagado'], cancelado: ['', 'Cancelado'], error: ['bad', 'Error'] };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** Lista de pagos del cliente en "Mi plan". */
async function renderMyPayments() {
  const box = $('#myPayments');
  if (!box) return;
  const { payments } = await api.myPayments().catch(() => ({ payments: [] }));
  if (!$('#myPayments')) return;
  if (!payments.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  $('#myPaymentsList').innerHTML = payments.map((p) => {
    const [cls, label] = PAY_LABEL[p.status] || ['', p.status];
    const name = S.plans.find((x) => x.id === p.plan)?.name || p.plan;
    return `<div class="pay-row"><div><b>Plan ${esc(name)}</b> · ${p.months} mes${p.months > 1 ? 'es' : ''}<div class="muted tiny">${fmtDate(p.paidAt || p.createdAt)}${p.expiresAfter ? ` · activo hasta ${fmtDate(p.expiresAfter)}` : ''}</div></div>
      <div style="text-align:right"><b>$${Number(p.amount).toFixed(2)}</b><div><span class="badge ${cls}">${label}</span></div></div></div>`;
  }).join('');
}

// Comprar: solo por la web (cuenta + tarjeta). Ya no se vende por WhatsApp.
const WEB_CLIPVIRAL = 'https://cviral.duckdns.org';
const PAYPAL_ACTIVO = true; // en "Mi plan" se paga con tarjeta (PayPal) dentro de la app; si no, se abre la web
// Soporte: todo va al servidor de Discord de ClipViral (ahí el bot abre un ticket).
const SOPORTE_DISCORD = 'https://discord.gg/2k4Q3bBMh';
function soporteDiscord() {
  api.openUrl(SOPORTE_DISCORD);
  toast('Se abrió Discord para pedir ayuda', 'ok', '💬');
}
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-soporte-link]');
  if (link) { e.preventDefault(); return api.openUrl(link.dataset.soporteLink); }
  if (e.target.closest('#supportBtn, [data-soporte]')) soporteDiscord();
});
/** "Soporte: …" del servidor. Si es un enlace, se puede tocar; si no hay nada, va el de Discord. */
function soporteTexto() {
  const c = String(S.info?.supportContact || '').trim() || SOPORTE_DISCORD;
  return /^https?:\/\//i.test(c) ? `<a href="#" data-soporte-link="${esc(c)}">${esc(c)}</a>` : esc(c);
}

/** Abre la página de compra de la web (la del VPS al que está conectada la app; si no, cviral.duckdns.org). */
function comprarWeb() {
  const base = S.appInfo?.central && /^https?:\/\//.test(S.appInfo.serverUrl || '') ? S.appInfo.serverUrl : WEB_CLIPVIRAL;
  api.openUrl(`${base.replace(/\/+$/, '')}/comprar`);
  toast('Se abrió la web para comprar tu plan', 'ok', '🛒');
}

async function buyPlan(pl) {
  if (!PAYPAL_ACTIVO) return comprarWeb();
  const link = S.info.paymentLink;
  const status = await api.payStatus().catch(() => ({ enabled: false }));
  const p = S.user.plan;
  const renew = pl.id === p.id && p.active && p.expires;
  const m = modal(`<h2>Plan ${esc(pl.name)}</h2>
    <p class="muted">Precio: <b style="color:var(--text)">$${pl.priceUsd} al mes</b>. Cada pago suma <b style="color:var(--text)">1 mes</b> de licencia.</p>
    ${status.enabled ? `
      <label>¿Cuántos meses?<select id="payMonths">${[1, 3, 6, 12].map((n) => `<option value="${n}">${n} mes${n > 1 ? 'es' : ''} — $${(pl.priceUsd * n).toFixed(2)}</option>`).join('')}</select></label>
      <p class="muted tiny">${renew ? `Se suma a tu plan actual (vence el ${fmtDate(p.expires)}).` : 'Tu plan se activa en cuanto se confirme el pago.'}
        Pagas con tarjeta de crédito o débito en la página segura de PayPal; no necesitas cuenta PayPal.${status.mode === 'sandbox' ? ' <b>(Modo de prueba: no se cobra de verdad)</b>' : ''}</p>
      <div id="payState" class="muted tiny"></div>`
    : `<p>${link ? 'Te llevamos a la página de pago. Cuando se confirme, tu plan se activa en tu cuenta.' : 'El pago con tarjeta no está disponible en este momento. Intenta de nuevo más tarde.'}</p>
      <p class="muted tiny">Usa el mismo correo de tu cuenta: <b>${esc(S.user.email)}</b></p>`}
    <p class="muted tiny">Soporte: ${soporteTexto()}</p>
    <div class="modal-actions"><button class="btn ghost" data-c>Cerrar</button>
      ${status.enabled ? '<button class="btn ghost hidden" data-check><span>Ya pagué</span></button><button class="btn primary" data-card><span>💳 Pagar con tarjeta</span></button>'
        : (link ? '<button class="btn primary" data-pay><span>Ir a pagar</span></button>' : '')}</div>`);
  $('[data-c]', m.el).onclick = () => m.close();
  $('[data-pay]', m.el)?.addEventListener('click', () => { api.openUrl(link); m.close(); });
  let orderId = null;
  const state = (t) => { const el = $('#payState', m.el); if (el) el.innerHTML = t; };
  const finish = async (payment) => {
    if (payment?.status === 'pagado') {
      await refreshMe();
      m.close();
      if (S.page === 'plan') renderPage(false);
      confetti();
      toast(`¡Pago listo! Plan ${pl.name} activo hasta el ${fmtDate(payment.expiresAfter)}.`, 'ok', '🎉');
      return true;
    }
    return false;
  };
  $('[data-card]', m.el)?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    state('Se abrió la ventana de pago. Completa el pago ahí; esta ventana se actualiza sola.');
    try {
      const r = await api.payStart({ plan: pl.id, months: Number($('#payMonths', m.el).value) });
      orderId = r.id;
      if (await finish(r.payment)) return;
      if (r.outcome === 'cancelado') { state('Cancelaste el pago. No se cobró nada.'); return; }
      $('[data-check]', m.el).classList.remove('hidden');
      state(r.error ? esc(r.error) : 'Todavía no vemos el pago. Si ya pagaste, toca <b>Ya pagué</b> en unos segundos.');
    } catch (err) { state(`<span class="error">${esc(err.message)}</span>`); }
  }));
  $('[data-check]', m.el)?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    try {
      const r = await api.payVerify(orderId);
      if (!(await finish(r.payment))) state(r.payment?.status === 'cancelado' ? 'El pago se canceló. No se cobró nada.' : 'PayPal todavía no lo confirma. Espera un minuto y vuelve a tocar <b>Ya pagué</b>.');
    } catch (err) { state(`<span class="error">${esc(err.message)}</span>`); }
  }));
}

// ---------- Página: Ajustes ----------
const progressState = {};
// La barra de progreso se mueve en todas partes donde aparece esa herramienta (Ajustes, "Antes de empezar", análisis).
api.onComponentProgress(({ id, frac, text }) => {
  progressState[id] = { frac, text };
  activeInstalls.add(id);
  for (const row of document.querySelectorAll(`[data-comp="${id}"], [data-req-install="${id}"]`)) {
    row.querySelector('.prog')?.classList.remove('hidden');
    const bar = row.querySelector('.progress span');
    if (bar) bar.style.width = `${Math.round(frac * 100)}%`;
    const t = row.querySelector('.ptext');
    if (t) t.textContent = text;
  }
});
// Cuando termina una descarga (bien o mal), se actualiza todo lo que muestre "Falta" o "Arreglar".
api.onComponentsChanged(async ({ id }) => {
  activeInstalls.delete(id);
  delete progressState[id];
  S.comps = await api.componentsStatus().catch(() => S.comps);
  refreshAfterInstall();
});

// La ventana "Antes de empezar" deja aquí cómo actualizarse mientras está abierta.
let reqModalRefresh = null;

function refreshAfterInstall() {
  if (S.page === 'ajustes') renderPage(false);
  // Lo instalado cambia lo que conviene (por ejemplo, con Whisper para NVIDIA se sugiere el modelo Preciso).
  if (S.perf) api.perfAnalyze().then((r) => { S.perf = r; if (S.page === 'ajustes') renderPerfCard($('#perfCard')); }).catch(() => {});
  if (S.page === 'directo' && $('#goInstall') && !missingComponents()) $('#goInstall').closest('.warn-box')?.remove();
  reqModalRefresh?.();
}
api.onOllamaProgress(({ model, frac, text }) => {
  const row = model && model === S.settings?.visionModel && $('#visionRow') ? $('#visionRow') : $('#ollamaRow');
  if (row) { $('.progress span', row).style.width = `${Math.round(frac * 100)}%`; $('.ptext', row).textContent = text; }
});

// Lo que se está descargando ahora (sigue aunque cambies de página).
const activeInstalls = new Set();
const MODEL_DESC = { base: 'El más rápido, para PCs sencillas.', small: 'Buen equilibrio: sirve en casi todas las PCs.', medium: 'El más preciso; ideal con tarjeta NVIDIA.' };

const isInstalling = (id) => activeInstalls.has(id) || !!S.comps?.installing?.[id];

/** Instala una herramienta. Solo "Reinstalar" (force) vuelve a bajar algo que ya está instalado. */
async function installComp(id, { force = false } = {}) {
  activeInstalls.add(id);
  if (S.page === 'ajustes') renderPage(false);
  try {
    const r = await api.installComponent(id, { force });
    if (r?.alreadyInstalled) {
      activeInstalls.delete(id);
      S.comps = await api.componentsStatus().catch(() => S.comps);
      refreshAfterInstall();
      toast('Ya estaba instalado ✓', 'ok', '🧩');
    } else {
      toast('Instalado correctamente', 'ok', '🧩');
    }
    return true;
  } catch (err) {
    toast(`No se pudo instalar: ${err.message}`, 'bad');
    return false;
  } finally {
    // Las pantallas se actualizan con el aviso "components:changed" que manda la app al terminar.
    activeInstalls.delete(id);
  }
}

function renderAjustes(el) {
  const c = S.comps;
  const s = S.settings;
  if (!c) { el.innerHTML = '<div class="empty"><div class="spinner"></div></div>'; api.componentsStatus().then((x) => { S.comps = x; if (S.page === 'ajustes') renderPage(false); }); return; }
  const hasNv = c.gpu?.hasNvidia;
  const recModel = S.perf?.suggested?.whisperModel;
  // Estado de cada herramienta: Instalado / Descargando / Falta (necesaria) / Opcional (no hace falta)
  const compRow = (id, icon, name, desc, ok, { optional = false, btnLabel = 'Instalar', badges = '', noButton = false } = {}) => {
    const busy = isInstalling(id);
    const pr = progressState[id] || c.installing?.[id] || {};
    const badge = busy ? '<span class="badge warn">Descargando…</span>'
      : ok ? '<span class="badge ok">Instalado</span>'
        : optional ? '<span class="badge">Opcional</span>' : '<span class="badge bad">Falta</span>';
    const btn = noButton ? '' : `<button class="btn small ${ok ? 'ghost' : optional ? '' : 'primary'}" data-install="${id}" ${ok ? 'data-force="1"' : ''} ${busy ? 'disabled' : ''}>${busy ? 'Descargando…' : ok ? 'Reinstalar' : btnLabel}</button>`;
    return `
    <div class="comp ${busy ? 'busy' : ''}" data-comp="${id}"><div class="comp-icon">${icon}</div>
      <div class="grow"><b>${name}</b> ${badge} ${badges}
        <div class="muted tiny">${desc}</div>
        <div class="prog ${busy ? '' : 'hidden'}"><div class="progress"><span style="width:${Math.round((pr.frac || 0) * 100)}%"></span></div><div class="ptext">${esc(pr.text || 'Preparando…')}</div></div></div>
      ${btn}</div>`;
  };
  const ollama = c.ollama || {};
  const aiModels = c.ollamaModels || [];
  const isSel = (m) => !!s.ollamaModel && (m.id === s.ollamaModel || m.id === `${s.ollamaModel}:latest`);
  const aiOpt = (m) => `<option value="${esc(m.id)}" ${isSel(m) ? 'selected' : ''}>${esc(m.label)} · ${m.sizeGb} GB${m.recommended ? ' ⭐ Recomendado' : ''}${m.fit === 'pesado' ? ' · muy pesado' : ''}</option>`;
  const aiSel = aiModels.find(isSel);
  const visModels = c.visionModels || [];
  const visSel = visModels.find((m) => m.id === s.visionModel);
  const visRec = visModels.find((m) => m.recommended);
  const visOpt = (m) => `<option value="${esc(m.id)}" ${m.id === s.visionModel ? 'selected' : ''}>${esc(m.id.replace(/^qwen3-vl:/, 'Qwen3-VL ').replace('-instruct', ''))} · ${m.sizeGb} GB${m.recommended ? ' ⭐ Recomendado' : ''}${m.fit === 'pesado' ? ' · muy pesado' : ''}</option>`;
  const aiRec = aiModels.find((m) => m.recommended);
  el.innerHTML = `
    <div class="page-head"><div><h1>Ajustes</h1><p class="muted">Herramientas, IA local, carpeta y cuenta.</p></div></div>
    ${S.user.role === 'admin' || S.user.plan?.usesAi ? '<div class="card pop-in" id="claudeCard" style="margin-bottom:16px"></div>' : ''}
    <div class="card pop-in" id="sysCard" style="margin-bottom:16px"></div>
    <div class="card pop-in" id="perfCard" style="margin-bottom:16px"></div>
    <div class="grid cols-2 stagger">
      <div class="card">
        <h3>🧩 Herramientas</h3>
        <p class="muted tiny" style="margin-top:-4px">"Falta" = la app lo necesita. "Opcional" = solo si quieres usarlo.</p>
        ${compRow('ytdlp', '📥', 'yt-dlp', 'Se conecta al directo de YouTube.', c.ytdlp)}
        ${compRow('deno', '🦕', 'Deno', `YouTube lo pide para leer los videos (${c.denoMb || 41} MB).`, c.deno)}
        ${compRow('ffmpeg', '🎞️', 'FFmpeg', 'Corta los clips y pone los subtítulos.', c.ffmpeg)}
        ${compRow('whisper-cpu', '🗣️', 'Whisper', c.whisperFlavor === 'gpu' ? 'Pasa la voz a texto. Tienes la versión para NVIDIA.' : 'Pasa la voz a texto con el procesador (9 MB).', c.whisper, { noButton: c.whisperFlavor === 'gpu' })}
        ${hasNv ? compRow('whisper-gpu', '⚡', 'Whisper para NVIDIA', `Subtítulos más rápidos usando tu ${esc(c.gpu.name)}. Pesa unos 650 MB.`, c.whisperFlavor === 'gpu', { optional: true }) : ''}
        ${Object.entries(c.models).map(([k, m]) => {
    const inUse = k === s.whisperModel;
    const badges = `${inUse ? '<span class="badge grad">En uso</span>' : ''}${recModel === k ? ' <span class="badge ok">⭐ Recomendado</span>' : ''}`;
    return compRow(`model-${k}`, inUse ? '⭐' : '🧠', `Modelo de voz: ${m.label}`, `${m.sizeMb} MB · ${MODEL_DESC[k] || ''}`, m.installed, { optional: !inUse, btnLabel: 'Descargar', badges });
  }).join('')}
        <div class="setting"><div class="grow"><b>Modelo de voz a usar</b><small>Más preciso = más lento.</small></div>
          <select id="whisperModel">${Object.entries(c.models).map(([k, m]) => `<option value="${k}" ${k === s.whisperModel ? 'selected' : ''}>${m.label}${recModel === k ? ' ⭐' : ''}${m.installed ? '' : ' (hay que descargarlo)'}</option>`).join('')}</select></div>
        ${hasNv && c.whisperFlavor === 'gpu' ? '<p class="muted tiny">Si tu tarjeta no es compatible con Whisper, la app cambia sola al procesador.</p>' : ''}
        <button class="btn primary wide" id="installAll" style="margin-top:10px">${I.download}<span>Instalar todo lo necesario</span></button>
      </div>

      <div class="grid">
        <div class="card">
          <h3>🤖 IA local (plan Local)</h3>
          <div class="setting"><div class="grow"><b>Ollama</b><small>${ollama.running ? `Funcionando · ${ollama.models.length} modelo(s)` : 'No está abierto. Ábrelo o instálalo desde ollama.com'}</small></div>
            ${ollama.running ? '<span class="badge ok">Activo</span>' : '<span class="badge bad">Apagado</span>'}</div>
          <div class="setting stack" id="ollamaRow"><div class="grow"><b>Modelo para títulos y filtro</b><small>Revisa cada momento y le pone título y hashtags.</small>
            <div class="prog hidden"><div class="progress"><span></span></div><div class="ptext"></div></div></div>
            <select id="ollamaModel"><option value="">No usar IA local</option>
              ${aiModels.some((m) => m.installed) ? `<optgroup label="Instalados en tu PC">${aiModels.filter((m) => m.installed).map(aiOpt).join('')}</optgroup>` : ''}
              <optgroup label="Para descargar">${aiModels.filter((m) => !m.installed).map(aiOpt).join('')}</optgroup>
            </select>
            ${aiSel ? `<div class="model-note ${aiSel.fit}">${aiSel.recommended ? '⭐ <b>Recomendado para tu PC.</b> ' : ''}${esc(aiSel.note)}</div>`
    : aiRec ? `<div class="model-note">💡 Para tu PC recomendamos <b>${esc(aiRec.label)}</b>${aiRec.installed ? ', que ya tienes instalado' : ` (${aiRec.sizeGb} GB)`}.</div>` : ''}</div>
          ${ollama.running && s.ollamaModel && !ollama.models.some((m) => m.startsWith(s.ollamaModel)) ? `<button class="btn small primary" id="pullModel">Descargar ${esc(aiSel?.label || 'este modelo')}</button>` : ''}
        </div>

        <div class="card" id="senseCard">
          <h3>👂👀 IA que ve y escucha (plan Local)</h3>
          <p class="muted tiny" style="margin-top:-4px">Un clip sale solo si <b>coinciden</b> varias señales: lo que se dice y el chat, lo que se oye (risas, gritos, aplausos) y lo que se ve. Con sensibilidad "Baja" tienen que coincidir las tres.</p>
          ${compRow('oido', '👂', 'Detector de sonidos', `Reconoce risas, gritos, aplausos, sorpresa y golpes. Funciona en cualquier PC (${c.oido?.mb || 90} MB).`, !!c.oido?.installed, { optional: true, btnLabel: 'Descargar' })}
          <div class="setting"><div class="grow"><b>Escuchar los videos</b><small>Usa el detector de sonidos para encontrar y confirmar momentos.</small></div><label class="toggle"><input type="checkbox" id="oidoOn" ${s.oido !== false ? 'checked' : ''}/><span></span></label></div>
          <div class="setting stack" id="visionRow"><div class="grow"><b>👀 Modelo que mira el video</b><small>Mira unas fotos de cada momento y decide si se ve llamativo. También escribe el título y los hashtags.</small>
            <div class="prog hidden"><div class="progress"><span></span></div><div class="ptext"></div></div></div>
            <select id="visionModel"><option value="">No mirar el video</option>${visModels.map(visOpt).join('')}</select>
            ${visSel ? `<div class="model-note ${visSel.fit}">${visSel.recommended ? '⭐ <b>Recomendado para tu PC.</b> ' : ''}${esc(visSel.desc || '')}${visSel.installed ? '' : ' Hay que descargarlo.'}</div>`
    : visRec ? `<div class="model-note">💡 Para tu PC recomendamos <b>${esc(visRec.id)}</b>${visRec.installed ? ', que ya tienes instalado' : ` (${visRec.sizeGb} GB)`}.</div>` : ''}</div>
          ${!ollama.running ? '<p class="muted tiny">Para mirar el video hace falta Ollama abierto.</p>'
    : visSel && !visSel.installed ? `<button class="btn small primary" id="pullVision">Descargar ${esc(visSel.id)}</button>` : ''}
        </div>

        <div class="card">
          <h3>🎬 Clips</h3>
          <div class="setting"><div class="grow"><b>Carpeta de clips</b><div class="path">${esc(s.outputDir)}</div></div><button class="btn small" id="pickFolder">Cambiar</button></div>
          <div class="setting"><div class="grow"><b>Idioma del directo</b><small>"Automático" detecta el idioma solo.</small></div>
            <select id="language">${[['auto', 'Automático'], ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués']].map(([v, l]) => `<option value="${v}" ${s.language === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          ${hasNv ? `<div class="setting"><div class="grow"><b>Usar la NVIDIA para el video</b><small>Crea los clips mucho más rápido.</small></div><label class="toggle"><input type="checkbox" id="gpuEncode" ${s.gpuEncode ? 'checked' : ''}/><span></span></label></div>` : ''}
        </div>
      </div>

      ${S.cliente ? '' : `<div class="card">
        <h3>👤 Cuenta</h3>
        <div class="setting"><div class="grow"><b>${esc(S.user.name)}</b><small>${esc(S.user.email)}</small></div><button class="btn small danger" id="logoutBtn">Cerrar sesión</button></div>
        <div class="setting"><div class="grow"><b>🌐 Pantallas en inglés (para el video de Meta)</b><small>El menú, la entrada, Redes, Crear publicación y Estadísticas se ven en inglés, para que quien revisa en Meta las entienda. Lo demás sigue en español.</small></div><label class="toggle"><input type="checkbox" id="langToggle" ${s.pantallasEnIngles ? 'checked' : ''}/><span></span></label></div>
        <form id="pwForm" style="margin-top:10px">
          <label>Contraseña actual<input type="password" name="current" required /></label>
          <label>Nueva contraseña<input type="password" name="next" minlength="8" required /></label>
          <button class="btn small" type="submit">Cambiar contraseña</button>
        </form>
      </div>`}

      <div class="card">
        <h3>🚀 Acerca de</h3>
        <div class="setting"><div class="grow"><b>ClipViral v${esc(S.appInfo.version || '')}</b><small id="updStatus">${S.update?.available ? `Hay una versión nueva: v${esc(S.update.version)}` : 'Estás al día'}</small></div>
          <button class="btn small" id="checkUpd">Buscar actualizaciones</button></div>
      </div>

      <div class="card" id="ytCookCard">
        <h3>🍪 Cookies de YouTube</h3>
        <p class="muted tiny">Si la app te dice que YouTube pidió confirmar que no eres un robot, conecta aquí tu sesión de YouTube. Se guarda solo en esta PC.</p>
        <div class="setting"><div class="grow"><b>Usar mi sesión de YouTube desde</b><small id="ckState"></small></div>
          <select id="ckMode">
            <option value="">No usar cookies</option>
            <option value="archivo">Archivo cookies.txt (recomendado)</option>
            <option value="edge">Microsoft Edge</option>
            <option value="chrome">Google Chrome</option>
            <option value="firefox">Firefox</option>
            <option value="brave">Brave</option>
          </select></div>
        <ol class="tiny muted" style="margin:8px 0 0;padding-left:18px;line-height:1.6">
          <li>En Chrome o Edge instala la extensión <b>«Get cookies.txt LOCALLY»</b>.</li>
          <li>Abre <b>youtube.com</b> con tu sesión iniciada (mejor una cuenta de YouTube secundaria, no la principal).</li>
          <li>Toca la extensión → <b>Export</b>. Se descarga un archivo .txt.</li>
          <li>Aquí toca <b>Elegir archivo cookies.txt</b> y elige ese archivo. Luego <b>Probar</b>.</li>
        </ol>
        <p class="tiny muted" style="margin-top:6px">Leer directo de Chrome o Edge muchas veces no funciona: esos navegadores bloquean sus cookies. Si lo eliges, ciérralos del todo antes de sacar clips. Si un día vuelve el aviso del robot, exporta el archivo otra vez.</p>
        <div class="net-actions" style="margin-top:8px">
          <button class="btn small primary" id="ckPick">Elegir archivo cookies.txt</button>
          <button class="btn small" id="ckTest">Probar</button>
          <button class="btn small" id="ckGuide">📖 Ver cómo, paso a paso</button>
        </div>
        <p class="tiny" id="ckMsg" style="margin-top:8px"></p>
      </div>

      ${S.cliente || S.user?.role !== 'admin' ? '' : `<div class="card" id="srvCard">
        <h3>🖥️ Servidor de ClipViral</h3>
        <p class="muted tiny">Ahí están tu cuenta, tus redes conectadas y lo que programas. Con el de esta PC, lo programado se publica mientras la PC esté encendida. Con el de tu VPS, aunque la apagues.</p>
        <div class="setting"><div class="grow"><b id="srvNow">${esc(S.appInfo.serverUrl || '')}</b><small id="srvState">Revisando…</small></div></div>
        <label>Dirección de tu VPS<input id="vpsUrl" placeholder="https://tu-vps.duckdns.org" spellcheck="false" autocomplete="off" /></label>
        <div class="net-actions" style="margin-top:8px">
          <button class="btn small" id="vpsTest">Probar</button>
          <button class="btn small primary" id="vpsUse">Usar mi VPS</button>
          <button class="btn small ghost hidden" id="srvLocal">Volver al de esta PC</button>
        </div>
        <p class="tiny" id="vpsMsg" style="margin-top:8px"></p>
      </div>`}
    </div>`;

  $$('[data-install]', el).forEach((b) => { b.onclick = () => installComp(b.dataset.install, { force: b.dataset.force === '1' }); });
  $('#installAll').onclick = (e) => withLoading(e.currentTarget, async () => {
    const st = S.comps;
    const steps = [];
    if (!st.ytdlp) steps.push('ytdlp');
    if (!st.deno) steps.push('deno');
    if (!st.ffmpeg) steps.push('ffmpeg');
    if (!st.whisper) steps.push('whisper-cpu');
    if (!st.models[S.settings.whisperModel]?.installed) steps.push(`model-${S.settings.whisperModel}`);
    if (!steps.length) return toast('Ya tienes todo lo necesario. Lo que dice «Opcional» no hace falta.', 'ok', '👌');
    for (const id of steps) {
      $(`[data-comp="${id}"] .prog`)?.classList.remove('hidden');
      if (!(await installComp(id))) return;
    }
    confetti();
    toast('¡Todo listo! Ya puedes sacar clips.', 'ok', '🎉');
  });
  // Se guarda antes de volver a revisar, para que la revisión no mire el modelo anterior.
  $('#whisperModel').onchange = async (e) => { S.settings = await api.setSettings({ whisperModel: e.target.value }); renderPage(false); };
  $('#ollamaModel').onchange = async (e) => {
    S.settings = await api.setSettings({ ollamaModel: e.target.value });
    S.comps = await api.componentsStatus().catch(() => S.comps);
    renderPage(false);
  };
  $('#oidoOn').onchange = (e) => saveSetting({ oido: e.target.checked });
  $('#visionModel').onchange = async (e) => {
    S.settings = await api.setSettings({ visionModel: e.target.value });
    S.comps = await api.componentsStatus().catch(() => S.comps);
    renderPage(false);
  };
  $('#pullVision')?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    $('#visionRow .prog').classList.remove('hidden');
    try { await api.pullOllama(S.settings.visionModel); toast('Modelo descargado', 'ok', '👀'); } catch (err) { toast(err.message, 'bad'); }
    S.comps = await api.componentsStatus();
    renderPage(false);
  }));
  $('#pullModel')?.addEventListener('click', (e) => withLoading(e.currentTarget, async () => {
    $('#ollamaRow .prog').classList.remove('hidden');
    try { await api.pullOllama(S.settings.ollamaModel); toast('Modelo descargado', 'ok', '🤖'); } catch (err) { toast(err.message, 'bad'); }
    S.comps = await api.componentsStatus();
    renderPage(false);
  }));
  $('#pickFolder').onclick = async () => { const dir = await api.pickFolder(); if (dir) { saveSetting({ outputDir: dir }); renderPage(false); } };
  $('#language').onchange = (e) => saveSetting({ language: e.target.value });
  $('#gpuEncode')?.addEventListener('change', (e) => saveSetting({ gpuEncode: e.target.checked }));
  $('#langToggle')?.addEventListener('change', (e) => setEnglish(e.target.checked).catch((err) => toast(err.message, 'bad')));
  bindServerCard();
  bindCookiesCard();
  if ($('#logoutBtn')) $('#logoutBtn').onclick = async () => {
    if (isRunning()) return toast('Detén la grabación antes de salir', 'bad');
    if (!(await confirmBox('¿Cerrar sesión?', 'Tus clips se quedan guardados en tu PC.', 'Cerrar sesión', true))) return;
    await api.logout();
    S.user = null;
    showAuth();
  };
  if ($('#pwForm')) $('#pwForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    withLoading($('button', e.target), async () => {
      try { await api.changePassword({ current: f.get('current'), next: f.get('next') }); e.target.reset(); toast('Contraseña cambiada', 'ok', '🔒'); } catch (err) { toast(err.message, 'bad'); }
    });
  };
  $('#checkUpd').onclick = (e) => withLoading(e.currentTarget, async () => {
    await checkUpdates(true);
    $('#updStatus').textContent = S.update?.available ? `Hay una versión nueva: v${S.update.version}` : 'Estás al día';
  });
  renderSystemCard($('#sysCard'));
  renderPerfCard($('#perfCard'));
  renderClaudeCard($('#claudeCard'));
}

// ---------- Guía: cómo poner (o renovar) las cookies de YouTube desde Chrome o Edge ----------
// Se abre sola cuando YouTube pide "confirmar que no eres un robot" (o las cookies que había ya no sirven),
// y también desde Ajustes → Cookies de YouTube.
const COOKIE_EXT_URL = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
const COOKIE_STEPS = {
  chrome: [
    'Abre la extensión <b>Get cookies.txt LOCALLY</b> en la tienda de Chrome y toca <b>Añadir a Chrome</b> → <b>Añadir extensión</b>. (Si ya la tienes, salta este paso.)<div class="ckg-btns"><button class="btn small" data-ck-open="ext">🧩 Abrir la tienda de Chrome</button></div>',
    'Entra a <b>youtube.com</b> y revisa que tu sesión esté iniciada (arriba a la derecha se ve tu foto). Mejor con una cuenta de YouTube secundaria, no la principal.<div class="ckg-btns"><button class="btn small" data-ck-open="yt">▶️ Abrir YouTube</button></div>',
    'Estando en YouTube, toca la <b>pieza de rompecabezas 🧩</b> (arriba a la derecha) → <b>Get cookies.txt LOCALLY</b> → <b>Export</b>. Se descarga un archivo parecido a <i>www.youtube.com_cookies.txt</i>.',
    'Vuelve aquí y toca <b>Subir el archivo cookies.txt</b>. Se abre tu carpeta de Descargas: elige ese archivo. La app prueba sola si YouTube ya te deja pasar.',
  ],
  edge: [
    'Copia este enlace y pégalo en <b>Edge</b>: es la extensión <b>Get cookies.txt LOCALLY</b> (Edge puede usar las de la tienda de Chrome).<div class="ckg-btns"><button class="btn small" data-ck-copy>📋 Copiar el enlace</button></div>',
    'Arriba sale un aviso <b>Permitir extensiones de otras tiendas</b>: toca <b>Permitir</b> y, en la ventanita, otra vez <b>Permitir</b>.',
    'Toca <b>Obtener</b> (o <b>Añadir a Chrome</b>) → <b>Agregar extensión</b>. (Si ya la tienes, salta hasta aquí.)',
    'En Edge entra a <b>youtube.com</b> y revisa que tu sesión esté iniciada (arriba a la derecha se ve tu foto). Mejor con una cuenta de YouTube secundaria, no la principal.',
    'Estando en YouTube, toca el icono de <b>Extensiones 🧩</b> (arriba a la derecha) → <b>Get cookies.txt LOCALLY</b> → <b>Export</b>. Se descarga un archivo parecido a <i>www.youtube.com_cookies.txt</i>.',
    'Vuelve aquí y toca <b>Subir el archivo cookies.txt</b>. Se abre tu carpeta de Descargas: elige ese archivo. La app prueba sola si YouTube ya te deja pasar.',
  ],
};
let cookiesGuide = null;
function openCookiesGuide({ vencidas = false, desdeAjustes = false } = {}) {
  if (cookiesGuide) return;
  api.cookiesGuideSeen?.().catch(() => {});
  let browser = 'chrome';
  try { if (localStorage.getItem('ckBrowser') === 'edge') browser = 'edge'; } catch {}
  const intro = desdeAjustes
    ? 'Así conectas tu sesión de YouTube con un archivo «cookies.txt». Toma un minuto y se guarda solo en esta PC.'
    : vencidas
      ? 'YouTube volvió a pedir que confirmes que no eres un robot: las cookies que subiste ya no sirven (YouTube las cambia cada cierto tiempo). Exporta unas nuevas: toma un minuto.'
      : 'YouTube pidió confirmar que no eres un robot. Para seguir sacando clips, la app necesita tu sesión de YouTube (un archivo «cookies.txt»). Toma un minuto y se guarda solo en esta PC.';
  const m = modal(`
    <h2 data-ckguide>🍪 ${vencidas && !desdeAjustes ? 'Renueva tus cookies de YouTube' : 'Conecta tu sesión de YouTube'}</h2>
    <p class="muted">${intro}</p>
    <div class="ckg-tabs" role="tablist">
      <button class="btn small" data-ck-tab="chrome" role="tab">Google Chrome</button>
      <button class="btn small" data-ck-tab="edge" role="tab">Microsoft Edge</button>
    </div>
    <ol class="ckg-steps" id="ckgSteps"></ol>
    <details class="ckg-more">
      <summary>¿Te lo vuelve a pedir seguido? Así duran más</summary>
      <p class="tiny muted">Si sigues usando YouTube en esa ventana, YouTube cambia las cookies y las que subiste dejan de servir. Para que duren semanas:</p>
      <ol class="tiny muted">
        <li>Ve a Extensiones (🧩 → <b>Administrar extensiones</b>), abre <b>Detalles</b> de Get cookies.txt LOCALLY y enciende <b>Permitir en incógnito</b> (en Edge: <b>Permitir en InPrivate</b>).</li>
        <li>Abre una ventana de incógnito o InPrivate (<b>Ctrl + Mayús + N</b>), entra a youtube.com e inicia sesión.</li>
        <li>Exporta igual que arriba y <b>cierra esa ventana</b> (sin cerrar sesión). Sube ese archivo aquí.</li>
      </ol>
    </details>
    <p class="tiny" id="ckgMsg" aria-live="polite"></p>
    <div class="modal-actions">
      <button class="btn ghost" data-c>Ahora no</button>
      <button class="btn primary" id="ckgPick"><span>📂 Subir el archivo cookies.txt</span></button>
    </div>`, { onClose: () => { cookiesGuide = null; } });
  cookiesGuide = m;
  const msg = (text, kind) => { const p = $('#ckgMsg', m.el); p.textContent = text; p.style.color = kind === 'bad' ? '#fca5a5' : kind === 'warn' ? '#fcd34d' : kind === 'ok' ? '#86efac' : ''; };
  const show = (b) => {
    browser = b;
    try { localStorage.setItem('ckBrowser', b); } catch {}
    m.el.querySelectorAll('[data-ck-tab]').forEach((t) => { const on = t.dataset.ckTab === b; t.classList.toggle('primary', on); t.setAttribute('aria-selected', on); });
    $('#ckgSteps', m.el).innerHTML = COOKIE_STEPS[b].map((s) => `<li>${s}</li>`).join('');
  };
  show(browser);
  m.el.querySelectorAll('[data-ck-tab]').forEach((t) => { t.onclick = () => show(t.dataset.ckTab); });
  $('#ckgSteps', m.el).onclick = async (e) => {
    const open = e.target.closest('[data-ck-open]');
    if (open) api.openUrl(open.dataset.ckOpen === 'yt' ? 'https://www.youtube.com' : COOKIE_EXT_URL);
    if (e.target.closest('[data-ck-copy]')) {
      await api.copy(COOKIE_EXT_URL).catch(() => {});
      msg('✔ Enlace copiado. Pégalo en la barra de direcciones de Edge (Ctrl + V) y pulsa Enter.', 'ok');
    }
  };
  $('[data-c]', m.el).onclick = () => m.close();
  $('#ckgPick', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    try {
      const info = await api.cookiesPick();
      if (!info) return;
      msg('Archivo guardado. Probando con YouTube… (puede tardar un poco)');
      const r = await api.cookiesTest(S.settings?.lastUrl).catch((err) => ({ ok: false, error: err.message }));
      if ($('#ytCookCard')) bindCookiesCard();
      if (r.ok) {
        msg(`✔ Listo: YouTube dejó leer «${r.title}». Ya puedes seguir sacando clips.`, 'ok');
        $('[data-c]', m.el).textContent = 'Cerrar';
        $('#ckgPick', m.el).style.display = 'none'; // (.btn usa display: inline-flex, que le gana a hidden)
      } else {
        msg(`${r.error} Revisa que exportaste estando en youtube.com con tu sesión iniciada, y prueba otra vez.`, 'bad');
      }
    } catch (err) { msg(err.message, 'bad'); }
  });
}
api.onCookiesNeeded?.((r) => openCookiesGuide(r || {}));

// ---------- Cookies de YouTube (cuando YouTube pide "no soy un robot") ----------
function bindCookiesCard() {
  const card = $('#ytCookCard');
  if (!card) return;
  const msg = (text, kind) => { const p = $('#ckMsg', card); p.textContent = text; p.style.color = kind === 'bad' ? '#fca5a5' : kind === 'warn' ? '#fcd34d' : kind === 'ok' ? '#86efac' : ''; };
  const NAMES = { edge: 'Microsoft Edge', chrome: 'Google Chrome', firefox: 'Firefox', brave: 'Brave' };
  const show = (info) => {
    if (!info || !$('#ckMode', card)) return;
    $('#ckMode', card).value = info.mode || '';
    $('#ckState', card).textContent = info.mode === 'archivo' ? (info.file ? '✔ Usando tu archivo cookies.txt' : 'Falta elegir el archivo cookies.txt')
      : info.mode ? `Leyendo las cookies de ${NAMES[info.mode]} (ciérralo antes de sacar clips)` : 'Sin cookies (YouTube puede pedir lo del robot)';
  };
  api.cookiesInfo().then(show).catch(() => {});
  $('#ckMode', card).onchange = async (e) => {
    const mode = e.target.value;
    if (mode === 'archivo') {
      const info = await api.cookiesInfo().catch(() => null);
      if (!info?.file) { msg('Ahora toca «Elegir archivo cookies.txt».', 'warn'); }
    }
    try { show(await api.cookiesSet(mode)); if (mode !== 'archivo') msg(mode ? 'Guardado. Toca «Probar».' : 'Listo: ya no se usan cookies.', 'ok'); } catch (err) { msg(err.message, 'bad'); }
  };
  $('#ckPick', card).onclick = (e) => withLoading(e.currentTarget, async () => {
    try {
      const info = await api.cookiesPick();
      if (!info) return;
      show(info);
      msg('✔ Archivo guardado. Toca «Probar» para ver si YouTube ya te deja pasar.', 'ok');
    } catch (err) { msg(err.message, 'bad'); }
  });
  $('#ckGuide', card).onclick = () => openCookiesGuide({ desdeAjustes: true });
  $('#ckTest', card).onclick = (e) => withLoading(e.currentTarget, async () => {
    msg('Probando con YouTube… (puede tardar un poco)');
    const r = await api.cookiesTest(S.settings?.lastUrl).catch((err) => ({ ok: false, error: err.message }));
    if (r.ok) msg(`✔ Funciona: YouTube dejó leer «${r.title}». Ya puedes sacar clips.`, 'ok');
    else msg(r.error, 'bad');
  });
}

// ---------- Servidor de ClipViral: esta PC o tu VPS ----------
function bindServerCard() {
  const card = $('#srvCard');
  if (!card) return;
  const msg = (text, kind) => { const p = $('#vpsMsg', card); p.textContent = text; p.style.color = kind === 'bad' ? '#fca5a5' : kind === 'warn' ? '#fcd34d' : kind === 'ok' ? '#86efac' : ''; };
  const show = (info) => {
    if (!info || !$('#srvNow', card)) return;
    $('#srvNow', card).textContent = info.local ? '💻 El de esta PC' : `☁️ Tu VPS: ${info.url.replace(/^https?:\/\//, '')}`;
    $('#srvState', card).textContent = !info.ok ? 'No contesta ahora.'
      : !info.publica ? 'Contesta, pero es una versión anterior: no publica solo lo programado.'
        : info.local ? 'Publica lo programado mientras la PC esté encendida.' : 'Publica lo programado aunque apagues la PC.';
    $('#srvLocal', card).classList.toggle('hidden', info.local);
    if (!info.local && !$('#vpsUrl', card).value) $('#vpsUrl', card).value = info.url;
  };
  api.serverInfo().then(show).catch(() => {});
  const test = async () => {
    const r = await api.serverTest($('#vpsUrl', card).value);
    $('#vpsUrl', card).value = r.url;
    if (!r.publica) { msg('Tu VPS contesta, pero su servidor es de una versión anterior. Vuelve a instalarlo en el VPS con la copia nueva.', 'warn'); return null; }
    msg(r.https ? '✔ Tu VPS contesta y publica solo lo programado.' : '✔ Tu VPS contesta. ⚠️ Pero sin https (sin candado): tu contraseña y tus conexiones viajarían sin cifrar. Úsalo solo para probar y ponle una dirección con https (GUIA-VPS.md).', r.https ? 'ok' : 'warn');
    return r;
  };
  $('#vpsTest', card).onclick = (e) => withLoading(e.currentTarget, async () => { try { await test(); } catch (err) { msg(err.message, 'bad'); } });
  $('#vpsUse', card).onclick = (e) => withLoading(e.currentTarget, async () => {
    let r;
    try { r = await test(); } catch (err) { msg(err.message, 'bad'); return; }
    if (!r) return;
    const ok = await confirmBox('¿Usar tu VPS?',
      `Tu cuenta, tus redes y lo que programes van a estar en ${r.url.replace(/^https?:\/\//, '')}. Lo que ya tienes programado se pasa a tu VPS. Para terminar el cambio, cierra y abre ClipViral (si en el VPS tu contraseña es otra, te la pedirá).${r.https ? '' : ' Ojo: sin https, úsalo solo para probar.'}`,
      'Usar mi VPS');
    if (!ok) return;
    const info = await api.serverUse(r.url);
    show(info);
    msg(`Listo. Cierra y abre ClipViral para terminar el cambio.${movedText(info)}`, 'ok');
    toast('Servidor cambiado. Cierra y abre ClipViral.', 'info', '☁️');
  });
  $('#srvLocal', card).onclick = async () => {
    if (!(await confirmBox('¿Volver al servidor de esta PC?', 'Lo que tienes programado en tu VPS se pasa a esta PC (y se publica mientras esté encendida). Para terminar el cambio, cierra y abre ClipViral.', 'Volver a esta PC'))) return;
    const info = await api.serverUse(null);
    show(info);
    msg(`Listo. Cierra y abre ClipViral para terminar el cambio.${movedText(info)}`, 'ok');
  };
  function movedText(info) {
    return (info.moved ? ` ${info.moved} publicación(es) programada(s) se pasan al servidor nuevo.` : '')
      + (info.kept ? ` ${info.kept} no se pudieron pasar (sin conexión o ya se estaban publicando): siguen en el servidor anterior.` : '');
  }
}

// ---------- Clave de Claude (IA Pro) ----------
// La ven los administradores y los clientes del plan Claude. Cada cuenta puede poner su propia clave.
function needsClaudeKey() {
  // Un cliente del plan Claude usa la suya; un admin, la suya o (si el dueño lo permite) la del servidor.
  return (S.user?.role === 'admin' || !!S.user?.plan?.usesAi) && S.info?.aiEnabled === false;
}

function goClaudeKey() {
  go('ajustes');
  setTimeout(() => {
    $('#claudeCard')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#claudeCard input[name=key]')?.focus();
  }, 350);
}

const CLAUDE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

function renderClaudeCard(el) {
  if (!el) return;
  const head = (badge) => `<div class="setting"><div class="grow"><b style="font-size:16px">🔑 Clave de Claude (IA Pro)</b>
    <small>La IA Pro usa tu propia cuenta de Claude: lo que gaste se cobra ahí. La clave se guarda cifrada y nunca se muestra completa.</small></div>${badge}</div>`;
  const st = S.claude;
  if (!st) {
    el.innerHTML = `${head('<span class="badge">Revisando…</span>')}`;
    api.claudeKey()
      .then((x) => { S.claude = x; renderClaudeCard($('#claudeCard')); })
      .catch((err) => { el.innerHTML = `${head('<span class="badge warn">Sin conexión</span>')}<p class="muted tiny">${esc(err.message)}</p>`; });
    return;
  }
  // own: su propia clave. server: un admin que usa la del servidor (la del dueño), si el dueño se lo permite en el panel.
  const saved = st.own ?? (st.enabled && !st.server);
  const admin = S.user?.role === 'admin';
  const now = saved ? `✅ Usas tu propia clave: <b>${esc(st.masked)}</b>. Lo que gastes se cobra en tu cuenta de Claude.`
    : st.server ? `✅ Usas la clave de Claude del servidor: <b>${esc(st.masked)}</b>. Si pegas la tuya aquí, se usa la tuya.`
      : st.unreadable ? '⚠️ Había una clave guardada pero ya no se puede leer. Pégala otra vez.'
        : admin ? 'Todavía no tienes clave, así que la IA Pro está apagada. Pega la tuya, o pide al dueño del servidor que te deje usar la suya. El modo Local funciona igual.'
          : 'Todavía no hay clave, así que la IA Pro está apagada. El modo Local funciona igual.';
  el.innerHTML = `
    ${head(st.enabled ? '<span class="badge ok">Activa</span>' : '<span class="badge bad">Falta</span>')}
    <p class="tiny" style="margin:2px 0 12px">${now}</p>
    <form id="claudeForm" class="key-row" autocomplete="off">
      <input type="password" name="key" placeholder="Pega aquí tu clave (empieza con sk-ant-)" spellcheck="false" />
      <button class="btn primary small" type="submit"><span>Probar y guardar</span></button>
      ${saved ? '<button class="btn small ghost" type="button" id="claudeRemove">Quitar</button>' : ''}
    </form>
    <p class="muted tiny" style="margin:10px 0 0">¿No tienes clave? <a href="#" id="claudeGet">Créala en console.anthropic.com → API Keys</a> y pon saldo en Billing. Probarla no cuesta nada.</p>`;

  const apply = (next) => {
    S.claude = next;
    S.info.aiEnabled = next.enabled;
    renderClaudeCard($('#claudeCard'));
    refreshMe().catch(() => {});
  };
  $('#claudeGet', el).onclick = (e) => { e.preventDefault(); api.openUrl(CLAUDE_KEYS_URL); };
  $('#claudeForm', el).onsubmit = (e) => {
    e.preventDefault();
    const key = e.target.key.value.trim();
    if (!key) { e.target.key.focus(); return toast('Pega tu clave de Claude primero', 'bad'); }
    withLoading($('button[type=submit]', e.target), async () => {
      try {
        apply(await api.saveClaudeKey(key));
        confetti();
        toast('¡La clave funciona! La IA Pro ya está activa.', 'ok', '✨');
      } catch (err) { toast(err.message, 'bad'); }
    });
  };
  $('#claudeRemove', el)?.addEventListener('click', async () => {
    const texto = st.puedeServidor ? 'Vuelves a usar la clave de Claude del servidor.' : 'La IA Pro se apaga hasta que pongas otra. El modo Local sigue funcionando.';
    if (!(await confirmBox('¿Quitar tu clave de Claude?', texto, 'Quitar', true))) return;
    try { apply(await api.removeClaudeKey()); toast('Clave quitada', 'info'); } catch (err) { toast(err.message, 'bad'); }
  });
}

// ---------- Actualizaciones ----------
async function checkUpdates(manual) {
  // La versión para clientes no tiene servidor de actualizaciones: le das el instalador nuevo.
  if (S.cliente) { if (manual) toast('Para actualizar, instala la versión nueva que te envíen.', 'ok'); return; }
  const info = await api.checkUpdates().catch(() => null);
  S.update = info;
  if (info?.available) showUpdate(info);
  else if (manual) toast(info?.error || 'Tienes la última versión', info?.error ? 'bad' : 'ok');
}
setInterval(() => { if (S.user && !S.update?.available) checkUpdates(); }, 30 * 60 * 1000);
// Si desde el panel te cambian el rol (administrador o no) o la membresía, la app se pone al día sola.
setInterval(async () => {
  if (!S.user || S.cliente) return;
  const before = `${S.user.role}|${S.info?.publicar}`;
  await refreshMe().catch(() => {});
  if (S.user && before !== `${S.user.role}|${S.info?.publicar}`) { renderNav(); renderPage(false); toast(S.user.role === 'admin' ? 'Ahora tienes acceso de administrador.' : 'Tu acceso cambió.', 'ok', '🔑'); }
}, 3 * 60 * 1000);

function showUpdate(info) {
  if ($('.modal [data-upd]')) return;
  const m = modal(`<div data-upd>
    <div style="font-size:40px;animation:phoneFloat 3s ease-in-out infinite">🚀</div>
    <h2>Nueva versión disponible: v${esc(info.version)}</h2>
    <p class="muted">${info.mandatory ? 'Esta actualización es obligatoria para seguir usando la app.' : 'Trae mejoras y arreglos. Tarda menos de un minuto.'}</p>
    ${info.notes ? `<div class="notes">${esc(info.notes)}</div>` : ''}
    <div class="prog hidden" style="margin-top:14px"><div class="progress"><span></span></div><div class="tiny muted ptext" style="margin-top:6px"></div></div>
    <div class="modal-actions">${info.mandatory ? '' : '<button class="btn ghost" data-later>Más tarde</button>'}<button class="btn primary" data-now><span>Actualizar ahora</span></button></div></div>`,
  { dismissable: !info.mandatory });
  $('[data-later]', m.el)?.addEventListener('click', () => m.close());
  $('[data-now]', m.el).onclick = (e) => withLoading(e.currentTarget, async () => {
    $('.prog', m.el).classList.remove('hidden');
    const off = api.onUpdateProgress(({ frac, got }) => {
      $('.progress span', m.el).style.width = `${Math.round(frac * 100)}%`;
      $('.ptext', m.el).textContent = `Descargando… ${(got / 1048576).toFixed(1)} MB`;
    });
    try {
      await api.installUpdate();
      $('.ptext', m.el).textContent = 'Instalando… la app se va a reiniciar.';
    } catch (err) {
      toast(err.message, 'bad');
    } finally { off(); }
  });
}

// boot() se llama al final de extras.js, cuando ya cargó todo.
