// La web de ClipViral (en tu VPS): información, planes, compra con tarjeta (PayPal) y descarga del programa.
//   /           → inicio (qué es, cómo funciona, planes, descarga, preguntas)
//   /comprar    → crear cuenta o entrar, elegir plan y pagar con tarjeta
//   /descargar  → baja el .zip que subiste en el panel (Actualizaciones → .zip para la web)
// Las páginas legales (/privacidad, /terminos, /borrar-datos) y la versión en inglés siguen en sitio.js.
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { paymentsEnabled } from '../pagos.js';
import { descargaInfo, descargaPath, contarDescarga, ultimaVersion } from '../descarga.js';

const router = Router();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(0)} MB`;
const precio = (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)));

export function webPlans() {
  return db.prepare('SELECT id, name, price_usd AS priceUsd, uses_ai AS usesAi, description FROM plans WHERE public = 1 AND price_usd > 0 ORDER BY sort').all();
}

const CSS = `
:root{--bg:#000;--panel:#08142f;--panel-2:#0d1d42;--line:rgba(120,150,255,.16);--text:#fff;--muted:#a9b4d6;--red:#e5161d;--red-2:#ff3a3f;--blue:#3a6cff;
  --display:"Bahnschrift","DIN Alternate","Segoe UI Variable Display","Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 "Segoe UI",system-ui,-apple-system,sans-serif;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(900px 520px at 85% -10%,rgba(58,108,255,.28),transparent 60%),radial-gradient(700px 480px at -10% 30%,rgba(229,22,29,.16),transparent 60%),
  linear-gradient(rgba(120,150,255,.05) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(120,150,255,.05) 1px,transparent 1px) 0 0/44px 44px}
a{color:#9db4ff}
h1,h2,h3,.brand,.price,.btn,.num{font-family:var(--display)}
.wrap{max-width:1120px;margin:auto;padding:0 20px}
header{position:sticky;top:0;z-index:5;background:rgba(0,0,0,.72);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
header .wrap{display:flex;align-items:center;gap:14px;height:64px}
.brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:.3px}
.brand img{width:32px;height:32px;border-radius:8px}
header nav{margin-left:auto;display:flex;gap:4px;align-items:center}
header nav a{color:var(--muted);text-decoration:none;padding:8px 12px;border-radius:9px;font-size:15px}
header nav a:hover{color:#fff;background:rgba(255,255,255,.06)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:13px 22px;border-radius:12px;border:1px solid var(--line);background:var(--panel-2);
  color:#fff;font-size:17px;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s,background .15s}
.btn:hover{transform:translateY(-1px)}
.btn.red{background:var(--red);border-color:var(--red-2);box-shadow:0 10px 30px rgba(229,22,29,.35)}
.btn.red:hover{background:var(--red-2);box-shadow:0 14px 36px rgba(229,22,29,.5)}
.btn.small{padding:9px 14px;font-size:15px;border-radius:10px}
.btn[disabled]{opacity:.6;cursor:wait;transform:none}
header .btn{padding:8px 14px;font-size:15px}
.hero{padding:70px 0 40px;display:grid;grid-template-columns:1.05fr 1fr;gap:44px;align-items:center}
.tag{display:inline-flex;gap:8px;align-items:center;padding:6px 12px;border-radius:99px;border:1px solid var(--line);background:rgba(13,29,66,.6);color:var(--muted);font-size:14px}
.tag b{color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 0 0 rgba(229,22,29,.7);animation:live 1.6s infinite}
@keyframes live{70%{box-shadow:0 0 0 10px rgba(229,22,29,0)}100%{box-shadow:0 0 0 0 rgba(229,22,29,0)}}
.hero h1{font-size:clamp(38px,5.4vw,64px);line-height:1.04;margin:18px 0 16px;letter-spacing:-.5px}
.hero h1 em{font-style:normal;color:var(--red-2)}
.hero p.lead{color:var(--muted);font-size:19px;margin:0 0 26px;max-width:560px}
.cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.cta small{color:var(--muted);font-size:13px;width:100%}
.shot{position:relative;border-radius:18px;border:1px solid var(--line);overflow:hidden;background:var(--panel);box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(58,108,255,.07)}
.shot img{display:block;width:124%;margin-left:-24%}
.hero .shot{transform:perspective(1400px) rotateY(-8deg) rotateX(3deg)}
.section{padding:56px 0}
.section h2{font-size:clamp(28px,3.6vw,40px);margin:0 0 8px}
.section .sub{color:var(--muted);margin:0 0 28px;max-width:680px;font-size:17px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card{background:linear-gradient(180deg,rgba(13,29,66,.72),rgba(8,20,47,.72));border:1px solid var(--line);border-radius:16px;padding:22px}
.card h3{margin:10px 0 6px;font-size:19px}
.card p{margin:0;color:var(--muted);font-size:15px}
.ico{width:44px;height:44px;display:grid;place-items:center;border-radius:12px;background:rgba(58,108,255,.14);border:1px solid rgba(58,108,255,.35);font-size:21px}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;counter-reset:s}
.steps .card{position:relative;padding-top:52px}
.steps .card:before{counter-increment:s;content:counter(s);position:absolute;top:16px;left:22px;font:700 26px var(--display);color:var(--red-2)}
.split{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:center}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px;max-width:780px}
.plan{position:relative;display:flex;flex-direction:column;gap:12px}
.plan.top{border-color:rgba(229,22,29,.6);box-shadow:0 0 0 1px rgba(229,22,29,.3),0 20px 50px rgba(229,22,29,.12)}
.plan .ribbon{position:absolute;top:-12px;right:18px;background:var(--red);padding:3px 11px;border-radius:99px;font-size:13px;font-weight:700}
.price{font-size:44px;font-weight:700;line-height:1}
.price small{font-size:16px;color:var(--muted);font-weight:400}
.plan ul{margin:0;padding:0;list-style:none;display:grid;gap:7px}
.plan li{padding-left:24px;position:relative;color:#dfe5f7;font-size:15px}
.plan li:before{content:"✓";position:absolute;left:0;color:#5ee38c;font-weight:700}
.plan .btn{margin-top:auto}
.dl{display:grid;grid-template-columns:1.2fr 1fr;gap:20px;align-items:stretch}
.dl .big{display:flex;flex-direction:column;gap:14px;justify-content:center}
.meta{color:var(--muted);font-size:14px}
.req{margin:0;padding:0;list-style:none;display:grid;gap:8px}
.req li{display:flex;gap:10px;color:#dfe5f7}
details{background:rgba(8,20,47,.7);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 0 10px}
summary{cursor:pointer;font-weight:600;font-size:17px;list-style:none}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";float:right;color:var(--muted);font-size:22px;line-height:1}
details[open] summary:after{content:"–"}
details p{color:var(--muted);margin:10px 0 0}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px;padding:26px 0;margin-top:30px}
footer .wrap{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
footer a{color:var(--muted)}
/* Comprar */
.buy{display:grid;grid-template-columns:1fr 1fr;gap:20px;padding:40px 0 30px;align-items:start}
.opt{display:flex;gap:12px;align-items:center;padding:16px;border-radius:14px;border:1px solid var(--line);background:rgba(8,20,47,.7);cursor:pointer;margin-bottom:10px}
.opt input{accent-color:var(--red);width:18px;height:18px}
.opt .grow{flex:1}
.opt b{font-family:var(--display);font-size:19px}
.opt .p{font:700 22px var(--display)}
.opt:has(input:checked){border-color:var(--red);box-shadow:0 0 0 1px rgba(229,22,29,.35)}
label.f{display:block;color:var(--muted);font-size:14px;margin:12px 0 0}
label.f input,label.f select{display:block;width:100%;margin-top:6px;padding:12px 14px;border-radius:11px;border:1px solid var(--line);background:#050c1e;color:#fff;font-size:16px}
label.f input:focus,label.f select:focus{outline:2px solid var(--blue);border-color:transparent}
.tabs{display:flex;gap:6px;background:#050c1e;border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:6px}
.tabs button{flex:1;padding:10px;border-radius:9px;border:0;background:transparent;color:var(--muted);font:600 15px inherit;cursor:pointer}
.tabs button.on{background:var(--panel-2);color:#fff}
.chk{display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:14px;margin-top:12px}
.chk input{margin-top:3px;accent-color:var(--red)}
.msg{margin-top:12px;font-size:15px;min-height:22px}
.msg.bad{color:#ff8a8d}.msg.ok{color:#7ff0a6}
.total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--line);margin-top:16px;padding-top:14px}
.total b{font:700 30px var(--display)}
.hidden{display:none!important}
.who{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(94,227,140,.08);border:1px solid rgba(94,227,140,.3)}
@media (max-width:900px){.hero,.split,.dl,.buy{grid-template-columns:1fr}.grid{grid-template-columns:1fr 1fr}.steps{grid-template-columns:1fr 1fr}.hero .shot{transform:none}}
@media (max-width:600px){.grid,.steps{grid-template-columns:1fr}header nav a.hide-m{display:none}.hero{padding-top:40px}}
`;

function layout(title, body, { description = '' } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || 'ClipViral saca los mejores momentos de tus directos y videos de YouTube y los convierte en clips verticales con subtítulos.')}">
<link rel="icon" href="/web/icono.png">
<style>${CSS}</style>
</head>
<body>
<header><div class="wrap">
  <a class="brand" href="/"><img src="/web/icono.png" alt="">ClipViral</a>
  <nav><a class="hide-m" href="/#como">Cómo funciona</a><a class="hide-m" href="/#planes">Planes</a><a class="hide-m" href="/#descargar">Descargar</a>
    <a class="btn red" href="/comprar">Comprar</a></nav>
</div></header>
${body}
<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ClipViral</span>
  <span><a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a> · <a href="/borrar-datos">Borrar datos</a> · <a href="/en">English</a>${getSetting('support_contact') ? ` · Soporte: ${esc(getSetting('support_contact'))}` : ''}</span>
</div></footer>
</body>
</html>`;
}

function descargaBloque() {
  const d = descargaInfo();
  if (!d) {
    return `<div class="card big"><h3 style="margin:0">La descarga estará lista muy pronto</h3>
      <p>Estamos subiendo la versión nueva${ultimaVersion() ? ` (v${esc(ultimaVersion())})` : ''}. Vuelve en un rato.</p></div>`;
  }
  return `<div class="card big">
    <div class="ico">⬇️</div>
    <h3 style="margin:0;font-size:24px">ClipViral para Windows</h3>
    <div class="meta">Versión ${esc(d.version)} · ${mb(d.size)} · actualizada el ${new Date(d.at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <div class="cta"><a class="btn red" href="/descargar">⬇ Descargar ClipViral</a></div>
    <p class="meta" style="margin:0">Descomprime el .zip, abre <b>ClipViral-Setup</b> y crea tu cuenta. La app se actualiza sola cuando hay versión nueva.</p>
  </div>`;
}

function inicio() {
  const plans = webPlans();
  const d = descargaInfo();
  const feats = [
    ['🎯', 'Encuentra los mejores momentos', 'Lee el chat, escucha las risas, los gritos y la euforia, y mira lo que pasa en pantalla para saber dónde explotó tu directo.'],
    ['💬', 'Subtítulos animados', 'Cada clip sale vertical, con subtítulos palabra por palabra sincronizados con la voz y el estilo que elijas.'],
    ['🎮', 'Cámara + juego', 'Para streamers: tu cámara arriba y el juego abajo, en vertical, detectados solos.'],
    ['🤖', 'Piloto automático', 'Vigila tus canales y saca clips solo cuando hay directo, aunque no estés mirando.'],
    ['✨', 'Listos para publicar', 'Cada clip llega con título, gancho, descripción, hashtags y la mejor hora para TikTok, Reels, Shorts y Facebook.'],
    ['🎛️', 'Efectos', 'Velocidad, espejo, fondo propio, quitar silencios y voces divertidas, en una sola pasada.'],
  ];
  const pasos = [
    ['Descarga e instala', 'Baja ClipViral para Windows e instálalo en un minuto.'],
    ['Crea tu cuenta', 'Con tu correo y una contraseña, desde la misma app.'],
    ['Elige tu plan', 'Paga con tarjeta de crédito o débito. Se activa al instante.'],
    ['Pega un enlace', 'Tu directo o video de YouTube: ClipViral hace el resto.'],
  ];
  const planHtml = plans.map((pl, i) => {
    const top = pl.usesAi;
    const items = ['Clips ilimitados', 'Subtítulos animados y formato vertical', 'IA local que ve y escucha (risas, gritos, chat)', 'Piloto automático y Clips sugeridos', 'Actualizaciones incluidas'];
    if (pl.usesAi) items.splice(3, 0, 'Claude elige los momentos más virales y escribe títulos y hashtags (con tu propia clave de Claude)');
    return `<div class="card plan ${top ? 'top' : ''}">${top ? '<span class="ribbon">⭐ Más popular</span>' : ''}
      <h3 style="margin:0;font-size:24px">${esc(pl.name)}</h3>
      <div class="price">US$ ${precio(pl.priceUsd)}<small> /mes</small></div>
      ${pl.description ? `<p>${esc(pl.description)}</p>` : ''}
      <ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <a class="btn ${top || plans.length === 1 || i === plans.length - 1 ? 'red' : ''}" href="/comprar?plan=${encodeURIComponent(pl.id)}">Comprar ${esc(pl.name)}</a></div>`;
  }).join('');
  return layout('ClipViral · Clips virales de tus directos', `
<main class="wrap">
  <section class="hero">
    <div>
      <span class="tag"><span class="dot"></span> Para streamers y creadores · <b>Windows</b></span>
      <h1>Tus directos, convertidos en <em>clips virales</em></h1>
      <p class="lead">ClipViral mira tus directos y videos de YouTube, encuentra los mejores momentos y te los entrega en vertical, con subtítulos y listos para TikTok, Reels y Shorts.</p>
      <div class="cta">
        <a class="btn red" href="${d ? '/descargar' : '#descargar'}">⬇ Descargar para Windows</a>
        <a class="btn" href="#planes">Ver planes</a>
        <small>Todo se procesa en tu PC: tus videos no se suben a ningún servidor.</small>
      </div>
    </div>
    <div class="shot"><img src="/web/app-directo.png" alt="Pantalla de ClipViral: pega el enlace de tu directo"></div>
  </section>

  <section class="section" id="que">
    <h2>Todo lo que hace por ti</h2>
    <p class="sub">Deja de buscar a mano el mejor momento de 4 horas de directo.</p>
    <div class="grid">${feats.map(([i, t, p]) => `<div class="card"><div class="ico">${i}</div><h3>${t}</h3><p>${p}</p></div>`).join('')}</div>
  </section>

  <section class="section" id="como">
    <h2>Cómo empezar</h2>
    <p class="sub">En menos de 5 minutos estás sacando tu primer clip.</p>
    <div class="steps">${pasos.map(([t, p]) => `<div class="card"><h3 style="margin-top:0">${t}</h3><p>${p}</p></div>`).join('')}</div>
  </section>

  <section class="section split">
    <div class="shot"><img src="/web/app-sugeridos.png" alt="Clips sugeridos con hora y texto para cada red"></div>
    <div>
      <h2>Cada clip, con su texto y su hora</h2>
      <p class="sub">En <b>Clips sugeridos</b> te espera cada clip nuevo con el título, el gancho, la descripción y los hashtags de cada red, y la mejor hora para subirlo. Cópialo y súbelo.</p>
      <a class="btn red" href="/comprar">Empezar ahora</a>
    </div>
  </section>

  <section class="section" id="planes">
    <h2>Planes</h2>
    <p class="sub">Pago mensual con tarjeta de crédito o débito (por PayPal, no necesitas cuenta PayPal). Cada pago suma 30 días.</p>
    <div class="plans">${planHtml || '<div class="card"><p>Pronto publicaremos los planes.</p></div>'}</div>
  </section>

  <section class="section" id="descargar">
    <h2>Descargar</h2>
    <p class="sub">Descárgalo, instálalo y crea tu cuenta desde la app.</p>
    <div class="dl">
      ${descargaBloque()}
      <div class="card"><h3 style="margin-top:0">Lo que necesita tu PC</h3>
        <ul class="req">
          <li>🪟 Windows 10 u 11 de 64 bits</li>
          <li>🧠 8 GB de memoria RAM (16 GB recomendado)</li>
          <li>🎮 Tarjeta de video NVIDIA recomendada (los clips salen más rápido)</li>
          <li>💾 5 GB libres para las herramientas y tus clips</li>
          <li>🌐 Internet para leer YouTube</li>
        </ul></div>
    </div>
  </section>

  <section class="section" id="preguntas">
    <h2>Preguntas frecuentes</h2>
    <details><summary>¿Cómo compro un plan?</summary><p>Toca <b>Comprar</b>, crea tu cuenta (o entra si ya tienes una), elige tu plan y paga con tarjeta. Tu plan se activa al momento y lo usas entrando a la app con el mismo correo. También puedes comprar desde la app, en <b>Mi plan</b>.</p></details>
    <details><summary>¿Se cobra solo cada mes?</summary><p>No. Cada pago suma 30 días (o los meses que elijas). Cuando se acerca el final te avisamos y renuevas cuando quieras.</p></details>
    <details><summary>¿Qué diferencia hay entre los planes?</summary><p>Con el plan Local todo se hace en tu PC con la IA local. Con el plan Claude, además, Claude (la IA de Anthropic) elige los momentos más virales y escribe los textos; usa tu propia clave de Claude, que pones en la app.</p></details>
    <details><summary>¿Mis videos se suben a algún lado?</summary><p>No. ClipViral baja el directo, lo corta y crea los clips en tu propia PC. Tú decides dónde publicarlos.</p></details>
    <details><summary>¿Cómo se actualiza?</summary><p>Solo. Cuando hay una versión nueva, la app te avisa y se actualiza con un clic.</p></details>
  </section>
</main>`);
}

function comprar(req) {
  const plans = webPlans();
  const elegido = plans.find((p) => p.id === req.query.plan)?.id || plans.find((p) => p.usesAi)?.id || plans[0]?.id;
  const pagos = paymentsEnabled();
  return layout('Comprar ClipViral', `
<main class="wrap">
  <section class="buy">
    <div>
      <h1 style="font-size:40px;margin:0 0 6px">Comprar ClipViral</h1>
      <p class="sub" style="color:var(--muted);margin:0 0 20px">Elige tu plan y págalo con tarjeta. Se activa en tu cuenta al momento.</p>
      <form id="planes">${plans.map((pl) => `
        <label class="opt"><input type="radio" name="plan" value="${esc(pl.id)}" data-price="${pl.priceUsd}" ${pl.id === elegido ? 'checked' : ''}>
          <span class="grow"><b>${esc(pl.name)}</b><br><span style="color:var(--muted);font-size:14px">${esc(pl.description || (pl.usesAi ? 'Con Claude (tu propia clave)' : 'Todo en tu PC'))}</span></span>
          <span class="p">US$ ${precio(pl.priceUsd)}<small style="font-size:13px;color:var(--muted);font-weight:400">/mes</small></span></label>`).join('')}
        <label class="f">¿Cuántos meses?<select id="meses">${[1, 3, 6, 12].map((n) => `<option value="${n}">${n} ${n > 1 ? 'meses' : 'mes'}</option>`).join('')}</select></label>
        <div class="total"><span style="color:var(--muted)">Total</span><b id="total">US$ 0</b></div>
      </form>
      <p class="meta" style="margin-top:18px">¿Ya tienes ClipViral? Entra en la app con el mismo correo y verás tu plan activo. ¿Todavía no? <a href="/#descargar">Descárgalo aquí</a>.</p>
    </div>
    <div class="card">
      <div id="cuenta">
        <h3 style="margin:0 0 12px">Tu cuenta de ClipViral</h3>
        <div class="tabs"><button type="button" class="on" data-t="crear">Crear cuenta</button><button type="button" data-t="entrar">Ya tengo cuenta</button></div>
        <form id="acceso">
          <label class="f" data-solo="crear">Tu nombre<input name="name" autocomplete="name" maxlength="60"></label>
          <label class="f">Correo<input name="email" type="email" autocomplete="email" required></label>
          <label class="f">Contraseña<input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
          <label class="chk" data-solo="crear"><input type="checkbox" name="terms"> <span>Acepto los <a href="/terminos" target="_blank">términos</a> y la <a href="/privacidad" target="_blank">política de privacidad</a>.</span></label>
          <button class="btn red" style="width:100%;margin-top:16px" id="accBtn">Crear cuenta y seguir</button>
        </form>
      </div>
      <div id="listo" class="hidden">
        <div class="who"><span>Conectado como <b id="quien"></b></span><button class="btn small" id="salir" type="button">Cambiar</button></div>
        <div id="planActual" class="meta" style="margin-top:10px"></div>
        ${pagos ? `<button class="btn red" style="width:100%;margin-top:16px" id="pagar">💳 Pagar con tarjeta</button>
        <p class="meta" style="text-align:center;margin:10px 0 0">Pago seguro con PayPal. No necesitas cuenta PayPal.</p>`
    : '<p class="msg bad">El pago con tarjeta no está disponible en este momento. Intenta de nuevo más tarde.</p>'}
      </div>
      <div class="msg" id="msg"></div>
    </div>
  </section>
</main>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'clipviral-web-token';
  let token = null; try { token = sessionStorage.getItem(KEY); } catch {}
  let modo = 'crear';
  const msg = (t, k = '') => { const m = $('#msg'); m.textContent = t || ''; m.className = 'msg ' + k; };
  const api = async (url, body, method) => {
    const r = await fetch('/api' + url, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || 'Algo falló. Intenta otra vez.'), { status: r.status });
    return d;
  };
  const total = () => {
    const p = document.querySelector('input[name=plan]:checked');
    const n = Number($('#meses').value);
    $('#total').textContent = p ? 'US$ ' + (Number(p.dataset.price) * n).toFixed(2).replace(/\\.00$/, '') : '—';
  };
  document.querySelectorAll('input[name=plan]').forEach((i) => i.addEventListener('change', total));
  $('#meses').addEventListener('change', total);
  total();
  const setModo = (m) => {
    modo = m;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === m));
    document.querySelectorAll('[data-solo=crear]').forEach((e) => e.classList.toggle('hidden', m !== 'crear'));
    $('#accBtn').textContent = m === 'crear' ? 'Crear cuenta y seguir' : 'Entrar y seguir';
    $('#acceso').password.autocomplete = m === 'crear' ? 'new-password' : 'current-password';
    msg('');
  };
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setModo(b.dataset.t)));
  const fecha = (s) => new Date(s).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
  const mostrar = (me) => {
    $('#cuenta').classList.add('hidden'); $('#listo').classList.remove('hidden');
    $('#quien').textContent = me.user.email;
    const p = me.user.plan || {};
    $('#planActual').textContent = !p.active ? 'Todavía no tienes un plan activo.' : p.expires ? 'Tu plan ' + p.name + ' está activo hasta el ' + fecha(p.expires) + '. Si pagas el mismo plan, se suma.' : 'Tu plan ' + p.name + ' está activo y no vence.';
  };
  const entrar = async () => { try { mostrar(await api('/me')); } catch (e) { token = null; try { sessionStorage.removeItem(KEY); } catch {} } };
  if (token) entrar();
  $('#acceso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target; const b = $('#accBtn'); b.disabled = true; msg('');
    try {
      if (modo === 'crear' && !f.terms.checked) throw new Error('Para crear la cuenta acepta los términos.');
      if (modo === 'crear' && f.name.value.trim().length < 2) throw new Error('Escribe tu nombre.');
      const body = { email: f.email.value.trim(), password: f.password.value, device: 'Web' };
      const d = modo === 'crear' ? await api('/auth/register', { ...body, name: f.name.value.trim(), acceptTerms: true }) : await api('/auth/login', body);
      token = d.token; try { sessionStorage.setItem(KEY, token); } catch {}
      await entrar();
      msg(modo === 'crear' ? '¡Cuenta creada! Ahora paga tu plan.' : '', 'ok');
    } catch (err) { msg(err.message, 'bad'); } finally { b.disabled = false; }
  });
  $('#salir').addEventListener('click', async () => {
    try { await api('/auth/logout', {}); } catch {}
    token = null; try { sessionStorage.removeItem(KEY); } catch {}
    $('#listo').classList.add('hidden'); $('#cuenta').classList.remove('hidden'); setModo('entrar');
  });
  $('#pagar')?.addEventListener('click', async (e) => {
    const p = document.querySelector('input[name=plan]:checked');
    if (!p) return msg('Elige un plan.', 'bad');
    e.target.disabled = true; msg('Abriendo la página de pago…');
    try {
      const r = await api('/pagos/crear', { plan: p.value, months: Number($('#meses').value) });
      location.href = r.url;
    } catch (err) { msg(err.message, 'bad'); e.target.disabled = false; }
  });
})();
</script>`, { description: 'Compra tu plan de ClipViral con tarjeta y empieza a sacar clips virales de tus directos.' });
}

router.get('/', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(inicio()); });
router.get('/comprar', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(comprar(req)); });
router.get('/descargar', (req, res) => {
  const file = descargaPath();
  if (!file) return res.redirect('/#descargar');
  contarDescarga();
  res.download(file, descargaInfo().name);
});

export default router;
