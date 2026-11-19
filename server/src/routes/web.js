// La web de ClipViral (en tu VPS): información, planes, compra con tarjeta (PayPal) y descarga del programa.
//   /           → inicio (qué es, cómo funciona, piloto, planes, descarga, preguntas)
//   /comprar    → crear cuenta o entrar, elegir plan y pagar con tarjeta
//   /descargar  → baja el .zip que subiste en el panel (Actualizaciones → .zip para la web)
// Las páginas legales (/privacidad, /terminos, /borrar-datos) y la versión en inglés siguen en sitio.js.
//
// Diseño: "sala de control" como la app. Fondo negro, paneles azul noche, rojo solo para la acción principal y lo que
// está "al aire", azul señal para lo seleccionado y los gráficos, y Bahnschrift (angosta) para títulos y números.
// Todo el CSS y el JS van aquí mismo: no se carga nada de internet.
import { Router } from 'express';
import { db, getSetting, supportContact, esEnlace } from '../db.js';
import { paymentsEnabled } from '../pagos.js';
import { descargaInfo, descargaPath, contarDescarga, ultimaVersion } from '../descarga.js';

const router = Router();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(0)} MB`;
const precio = (n) => (Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)));

export function webPlans() {
  return db.prepare('SELECT id, name, price_usd AS priceUsd, uses_ai AS usesAi, description FROM plans WHERE public = 1 AND price_usd > 0 ORDER BY sort').all();
}

// Iconos de línea (24×24, del color del texto).
const ICONOS = {
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  subs: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15h4M13 15h4M7 11h10"/>',
  camjuego: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M6.5 10h11"/><circle cx="12" cy="6.3" r="1.6"/><path d="M9.5 15.5h2.6M10.8 14.2v2.6M14.6 15h.01"/>',
  piloto: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  reloj: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  efectos: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  candado: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  actualiza: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  bajar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  memoria: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  video: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M15 10.5h3M15 13.5h3M5 17v3"/>',
  disco: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  mundo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chispa: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  oido: '<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0"/><path d="M10 9a2 2 0 0 1 4 0"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  tarjeta: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n]}</svg>`;

// Piezas del dibujo del directo (juego + cámara) que se usan en la demo de arriba y en "Así funciona".
const escena = () => `<div class="scene"><div class="city">${[38, 62, 45, 80, 52, 70, 40, 58, 48, 66].map((h) => `<i style="height:${h}%"></i>`).join('')}</div><div class="floor"></div><i class="cross"></i><div class="hud"><span class="hp"><i></i></span><b>24<small>/90</small></b></div></div>`;
const persona = '<span class="person"><i></i></span>';
const telefono = (subs, cls = '') => `<div class="phone ${cls}"><div class="ph-cam">${persona}</div><div class="ph-game">${escena()}</div><div class="subs">${subs}</div></div>`;

const CSS = `
:root{--bg:#000;--navy:#08142f;--navy-2:#0d1d42;--navy-3:#15306b;--line:rgba(120,150,255,.14);--line-2:rgba(120,150,255,.28);--text:#fff;--muted:#9fb0d6;--soft:#c6d1ef;
  --red:#e5161d;--red-2:#ff3a3f;--signal:#3a6cff;--ok:#5ee38c;--ease:cubic-bezier(.2,.9,.3,1);
  --display:"Bahnschrift","DIN Alternate","DIN Condensed","Roboto Condensed","Arial Narrow",system-ui,sans-serif;interpolate-size:allow-keywords}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.6 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;overflow-x:hidden;-webkit-font-smoothing:antialiased}
img{max-width:100%}
a{color:#9db4ff}
::selection{background:var(--signal);color:#fff}
:focus-visible{outline:2px solid var(--signal);outline-offset:3px;border-radius:6px}
h1,h2,h3,.brand,.btn,.price,.num{font-family:var(--display)}
h1,h2,.price,.cond{font-stretch:80%;font-variation-settings:"wdth" 80;font-weight:700;letter-spacing:-.005em}
.ic{width:22px;height:22px;flex:none}
.wrap{max-width:1180px;margin:auto;padding:0 24px}
.hidden{display:none!important}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* Fondo: luces azul noche que se mueven despacio, rejilla de monitor y una barra de barrido */
.bg{position:fixed;inset:0;z-index:-1;overflow:hidden;background:#000;pointer-events:none;--mx:0;--my:0}
.bg:before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(120,150,255,.06) 1px,transparent 1px) 0 0/48px 48px,linear-gradient(90deg,rgba(120,150,255,.06) 1px,transparent 1px) 0 0/48px 48px;
  -webkit-mask-image:radial-gradient(ellipse 85% 65% at 50% 0%,#000 25%,transparent 80%);mask-image:radial-gradient(ellipse 85% 65% at 50% 0%,#000 25%,transparent 80%)}
.bg i{position:absolute;border-radius:50%;will-change:transform}
.bg .b1{width:1000px;height:1000px;left:-380px;top:-460px;background:radial-gradient(closest-side,rgba(28,70,180,.5),rgba(10,26,63,.25) 55%,transparent);animation:d1 38s ease-in-out infinite;translate:calc(var(--mx)*-30px) calc(var(--my)*-30px)}
.bg .b2{width:1100px;height:1100px;right:-480px;top:28vh;background:radial-gradient(closest-side,rgba(17,42,105,.7),rgba(6,16,40,.3) 60%,transparent);animation:d2 46s ease-in-out infinite;translate:calc(var(--mx)*36px) calc(var(--my)*36px)}
.bg .b3{width:620px;height:620px;left:46%;top:4vh;background:radial-gradient(closest-side,rgba(229,22,29,.13),transparent);animation:d3 31s ease-in-out infinite;translate:calc(var(--mx)*50px) calc(var(--my)*50px)}
.bg .sweep{left:0;right:0;top:-20%;height:18%;border-radius:0;background:linear-gradient(180deg,transparent,rgba(58,108,255,.07),transparent);animation:sweep 12s linear infinite}
@keyframes d1{50%{transform:translate(180px,120px) scale(1.08)}}
@keyframes d2{50%{transform:translate(-200px,-90px) scale(.94)}}
@keyframes d3{33%{transform:translate(-160px,140px)}66%{transform:translate(120px,60px) scale(1.1)}}
@keyframes sweep{to{transform:translateY(720%)}}

/* Cabecera */
.top{position:sticky;top:0;z-index:30;border-bottom:1px solid transparent;transition:background .3s,border-color .3s}
.top.solid{background:rgba(0,0,0,.8);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border-color:var(--line)}
.top .wrap{display:flex;align-items:center;gap:16px;height:68px}
.brand{display:flex;align-items:center;gap:10px;font-size:22px;font-weight:700;color:#fff;text-decoration:none}
.brand img{width:32px;height:32px;border-radius:8px}
.nav{margin-left:auto;display:flex;gap:2px;align-items:center}
.nav .l{position:relative;color:var(--muted);text-decoration:none;padding:8px 12px;border-radius:9px;font-size:15px;transition:color .2s}
.nav .l:after{content:"";position:absolute;left:12px;right:12px;bottom:2px;height:2px;border-radius:2px;background:var(--red);transform:scaleX(0);transition:transform .35s var(--ease)}
.nav .l:hover,.nav .l.on{color:#fff}
.nav .l.on:after{transform:scaleX(1)}
.nav .btn{margin-left:8px;padding:9px 18px;font-size:15px}
#prog{position:absolute;left:0;bottom:-1px;height:2px;width:100%;background:var(--signal);transform-origin:0 50%;transform:scaleX(0);box-shadow:0 0 10px rgba(58,108,255,.8)}

/* Botones */
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:14px 24px;border-radius:12px;border:1px solid var(--line-2);background:rgba(13,29,66,.85);
  color:#fff;font-size:17px;font-weight:600;text-decoration:none;cursor:pointer;transition:transform .2s var(--ease),box-shadow .25s,background .2s,border-color .2s}
.btn .ic{width:20px;height:20px}
.btn:hover{transform:translateY(-2px);border-color:rgba(157,180,255,.55)}
.btn:active{transform:translateY(0) scale(.97)}
.btn.red{background:var(--red);border-color:var(--red-2);box-shadow:0 10px 30px rgba(229,22,29,.35),inset 0 1px 0 rgba(255,255,255,.18)}
.btn.red:hover{background:var(--red-2);box-shadow:0 16px 40px rgba(229,22,29,.5),inset 0 1px 0 rgba(255,255,255,.2)}
.btn:hover .baja{animation:baja .9s var(--ease) infinite}
@keyframes baja{50%{transform:translateY(3px)}}
.btn.small{padding:9px 14px;font-size:15px;border-radius:10px}
.btn[disabled]{opacity:.6;cursor:wait;transform:none}

/* Portada */
.hero{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.1fr);gap:52px;align-items:center;padding:48px 0 80px;min-height:calc(100vh - 68px)}
.tag{display:inline-flex;gap:9px;align-items:center;padding:6px 14px;border-radius:99px;border:1px solid var(--line-2);background:rgba(8,20,47,.75);color:#dbe3ff;font-size:14px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--red);animation:vivo 1.6s infinite}
@keyframes vivo{0%{box-shadow:0 0 0 0 rgba(229,22,29,.7)}70%,100%{box-shadow:0 0 0 10px rgba(229,22,29,0)}}
.hero h1{font-size:clamp(52px,6.3vw,94px);line-height:.92;margin:22px 0 24px}
.hero h1 .w{display:inline-block;position:relative;isolation:isolate;animation:wIn .5s var(--ease) both;animation-delay:calc(var(--i)*.13s + .2s)}
.hero h1 .w:before{content:"";position:absolute;inset:.08em -.1em 0;border-radius:.1em;background:var(--red);z-index:-1;opacity:0;animation:wHi .45s linear both;animation-delay:calc(var(--i)*.13s + .2s)}
@keyframes wIn{from{opacity:0;transform:translateY(.22em) scale(.9)}}
@keyframes wHi{0%,55%{opacity:1}100%{opacity:0}}
.lead{color:var(--soft);font-size:20px;line-height:1.55;margin:0 0 30px;max-width:31em}
.cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.note{display:flex;gap:9px;align-items:center;color:var(--muted);font-size:14.5px;margin:20px 0 0}
.note .ic{width:18px;height:18px;color:#8fb0ff}
.luego{animation:sube .8s var(--ease) both;animation-delay:1.15s}
@keyframes sube{from{opacity:0;transform:translateY(14px)}}

/* Demo: el directo, lo que ClipViral escucha y lee, y el clip que sale */
.demo{position:relative;min-height:440px;animation:aparece 1s .35s both}
@keyframes aparece{from{opacity:0;transform:scale(.97)}}
.mon{position:relative;width:80%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;border:1px solid var(--line-2);background:#050c1e;container-type:inline-size;
  display:grid;grid-template-columns:73% 27%;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(58,108,255,.06)}
.view{position:relative;overflow:hidden}
.scene{position:absolute;inset:0;overflow:hidden;container-type:size;background:linear-gradient(180deg,#081a4f 0%,#2550c0 45%,#0b1a44 46%,#040a1c 100%)}
.scene .city{position:absolute;left:0;right:0;top:16%;height:30%;display:flex;align-items:flex-end;gap:2%;padding:0 2%}
.scene .city i{flex:1;background:linear-gradient(180deg,#0e2259,#071433);border-radius:2px 2px 0 0;box-shadow:inset 0 2px 0 rgba(120,160,255,.25)}
.scene .floor{position:absolute;left:-60%;right:-60%;top:46%;height:90%;transform-origin:50% 0;transform:perspective(40cqh) rotateX(62deg);
  background:repeating-linear-gradient(90deg,rgba(120,160,255,.28) 0 1px,transparent 1px 7cqw),repeating-linear-gradient(180deg,rgba(120,160,255,.22) 0 1px,transparent 1px 9cqh);animation:piso 1.6s linear infinite}
@keyframes piso{to{background-position:0 0,0 9cqh}}
.scene .cross{position:absolute;left:50%;top:50%;width:7cqw;aspect-ratio:1;translate:-50% -50%;border:2px solid rgba(255,255,255,.8);border-radius:50%}
.scene .cross:after{content:"";position:absolute;left:50%;top:50%;width:3px;height:3px;translate:-50% -50%;border-radius:50%;background:#fff}
.scene .hud{position:absolute;right:4%;bottom:5%;display:flex;gap:4cqw;align-items:flex-end;font:700 5cqw/1 var(--display)}
.scene .hud small{font-size:.6em;color:#b9c7ee}
.scene .hp{width:18cqw;height:1.6cqw;border-radius:9px;background:rgba(255,255,255,.2);overflow:hidden;margin-bottom:.6cqw}
.scene .hp i{display:block;width:72%;height:100%;background:#fff}
.cam{position:absolute;left:3%;bottom:5%;width:27%;aspect-ratio:4/3;border-radius:6px;overflow:hidden;background:radial-gradient(circle at 72% 22%,#3567ec,#0b1c4a 70%);border:1.5px solid rgba(255,255,255,.75);z-index:1}
.person{position:absolute;left:50%;bottom:0;width:58%;height:86%;translate:-50% 0}
.person:before{content:"";position:absolute;left:50%;top:4%;width:44%;aspect-ratio:1;translate:-50% 0;border-radius:50%;background:#04102e;box-shadow:inset -.18em .12em 0 rgba(130,170,255,.45)}
.person:after{content:"";position:absolute;left:0;right:0;bottom:0;height:44%;border-radius:50% 50% 0 0/85% 85% 0 0;background:#04102e;box-shadow:inset -.2em .2em 0 rgba(130,170,255,.35)}
.person i{position:absolute;left:50%;top:0;width:54%;aspect-ratio:1;translate:-50% 0;border-radius:50%;border:.16em solid #1c2f66;border-bottom-color:transparent;border-left-color:transparent;rotate:-45deg}
.chat{position:relative;background:rgba(4,10,26,.94);border-left:1px solid var(--line);overflow:hidden;font-size:2.15cqw;line-height:1.3}
.chat-h{position:absolute;top:0;left:0;right:0;z-index:1;padding:2.4cqw 2.4cqw 3cqw;font:600 2.2cqw var(--display);color:var(--muted);background:linear-gradient(#040a1a 55%,transparent)}
.chat-list{position:absolute;left:0;right:0;bottom:0;padding:0 2.4cqw 2.4cqw;display:flex;flex-direction:column;gap:1.3cqw}
.chat-list p{margin:0;color:#e4eaff;word-break:break-word;animation:msg .3s var(--ease) both}
.chat-list b{margin-right:.45em}
@keyframes msg{from{opacity:0;transform:translateY(8px)}}
.live{position:absolute;left:2.2cqw;top:2.2cqw;z-index:2;display:flex;gap:1cqw;align-items:center}
.live b{padding:.5cqw 1.3cqw;border-radius:.7cqw;background:var(--red);font:700 2.1cqw var(--display);letter-spacing:.04em}
.live span{padding:.5cqw 1.2cqw;border-radius:.7cqw;background:rgba(0,0,0,.6);font:600 2.1cqw var(--display);font-variant-numeric:tabular-nums}
.flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:3}
.mon.boom .flash{animation:flash .55s ease-out}
.mon.boom .view{animation:sacude .45s}
@keyframes flash{0%{opacity:.5}100%{opacity:0}}
@keyframes sacude{20%{transform:translate(-1.2%,.7%)}40%{transform:translate(1%,-.8%)}60%{transform:translate(-.6%,.4%)}80%{transform:translate(.3%,0)}}
.tl{position:relative;width:80%;margin-top:12px;display:flex;align-items:stretch;gap:12px;padding:10px 12px;border-radius:12px;background:rgba(8,20,47,.82);border:1px solid var(--line)}
.tl-lab{display:flex;flex-direction:column;justify-content:space-around;font:600 12px/1.1 var(--display);color:var(--muted);white-space:nowrap}
.tl-lab span:first-child{color:#8fb0ff}
.tl-track{position:relative;flex:1;height:58px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 94%,transparent)}
.tl-strip{position:absolute;left:0;top:0;bottom:0;display:flex;gap:2px;will-change:transform}
.tl-strip i{position:relative;flex:none;width:5px}
.tl-strip i:before,.tl-strip i:after{content:"";position:absolute;left:0;right:0;border-radius:2px;transition:background .3s,box-shadow .3s}
.tl-strip i:before{bottom:50%;margin-bottom:1px;height:calc(var(--c)*48%);background:var(--signal)}
.tl-strip i:after{top:50%;margin-top:1px;height:calc(var(--v)*48%);background:#c8d4ff;opacity:.7}
.tl-strip i.hot:before,.tl-strip i.hot:after{background:var(--red-2);opacity:1;box-shadow:0 0 8px rgba(255,58,63,.75)}
.tl-head{position:absolute;top:-3px;bottom:-3px;left:62%;width:2px;background:#fff;box-shadow:0 0 10px rgba(255,255,255,.7)}
.tl-head:before{content:"";position:absolute;top:-2px;left:-4px;border:5px solid transparent;border-top-color:#fff}
.status{width:52%;margin:14px 0 0;min-height:44px;display:flex;gap:10px;align-items:flex-start;color:var(--soft);font-size:14.5px;line-height:1.4}
.status i{flex:none;width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--signal);box-shadow:0 0 0 4px rgba(58,108,255,.22);transition:background .3s,box-shadow .3s}
.status.hit i{background:var(--red);box-shadow:0 0 0 4px rgba(229,22,29,.25)}
.status.hit{color:#fff}
.phone{position:absolute;right:0;top:0;width:31%;aspect-ratio:9/16;border-radius:22px;overflow:hidden;border:5px solid #0d1d42;outline:1px solid var(--line-2);background:#040a1c;
  box-shadow:0 30px 70px rgba(0,0,0,.75),0 0 60px rgba(58,108,255,.2);container-type:inline-size;z-index:2}
.ph-cam{position:absolute;left:0;right:0;top:0;height:40%;overflow:hidden;background:radial-gradient(circle at 72% 22%,#3567ec,#0b1c4a 70%);font-size:3cqw}
.ph-cam .person{width:64%;height:88%}
.ph-game{position:absolute;left:0;right:0;top:40%;bottom:0}
.subs{position:absolute;left:5%;right:5%;top:33%;z-index:2;display:flex;flex-wrap:wrap;justify-content:center;gap:.18em .28em;font:800 9.5cqw/1.08 var(--display);text-transform:uppercase;text-align:center;
  text-shadow:0 .07em 0 #000,0 0 .35em rgba(0,0,0,.85)}
.subs span{position:relative;padding:0 .1em;border-radius:.1em;opacity:0;transform:scale(.55);transition:opacity .15s,transform .28s var(--ease),background .12s}
.subs span.v{opacity:1;transform:none}
.subs span.a{background:var(--red);text-shadow:none}
.phone.new{animation:corte .65s var(--ease)}
@keyframes corte{0%{clip-path:inset(28% 0 28% 0 round 18px);filter:brightness(1.8)}100%{clip-path:inset(0 round 18px)}}
.sug{position:absolute;right:0;bottom:0;width:46%;padding:12px 14px;border-radius:14px;background:rgba(8,20,47,.96);border:1px solid var(--line-2);box-shadow:0 20px 50px rgba(0,0,0,.65);
  display:grid;gap:3px;font-size:13.5px;line-height:1.35;opacity:0;transform:translateY(12px) scale(.97);transition:opacity .4s,transform .55s var(--ease);z-index:3}
.sug.on{opacity:1;transform:none}
.sug .fila{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px}
.sug b{font:700 16px var(--display)}
.sug .t{color:#fff}
.sug .h{color:#9db4ff}
.net{display:inline-flex;padding:2px 10px;border-radius:99px;background:rgba(58,108,255,.18);border:1px solid rgba(58,108,255,.5);color:#d6e1ff;font-weight:600;font-size:12px;white-space:nowrap}

/* Secciones */
.sec{padding:120px 0 0}
.sec-head{margin:0 0 44px;max-width:740px}
.sec-head h2{font-size:clamp(40px,5.2vw,66px);line-height:.98;margin:0 0 16px}
.sec-head p{color:var(--soft);font-size:19px;margin:0;max-width:36em}
html.js .rv{opacity:0;transform:translateY(22px);transition:opacity .9s var(--ease),transform .9s var(--ease)}
html.js .rv.in{opacity:1;transform:none}
html.js .rv-w{clip-path:inset(0 100% 0 0);transition:clip-path 1s var(--ease)}
html.js .rv-w.in{clip-path:inset(0 -2% 0 0)}

/* Así funciona: los pasos a la izquierda y la pantalla que cambia a la derecha */
.story{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:64px;align-items:start}
.stage{grid-column:2;grid-row:1;position:sticky;top:max(96px,calc(50vh - 240px));aspect-ratio:1604/1030;border-radius:16px;border:1px solid var(--line-2);background:#040a1c;overflow:hidden;container-type:inline-size;
  box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(58,108,255,.06)}
.steps{grid-column:1;grid-row:1;position:relative;padding:0 0 0 40px}
.steps:before{content:"";position:absolute;left:11px;top:14vh;bottom:14vh;width:2px;background:var(--line)}
.rail{position:absolute;left:11px;top:14vh;width:2px;height:calc(var(--p,0)*(100% - 28vh));background:var(--signal);box-shadow:0 0 12px rgba(58,108,255,.7)}
.step{position:relative;min-height:74vh;display:flex;flex-direction:column;justify-content:center;opacity:.35;transition:opacity .45s}
.step.on{opacity:1}
.step .n{position:absolute;left:-40px;top:calc(50% - 12px);width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#000;border:2px solid var(--line-2);
  font:700 12px var(--display);color:var(--muted);transition:background .3s,border-color .3s,color .3s,transform .3s var(--ease)}
.step.on .n{background:var(--red);border-color:var(--red);color:#fff;transform:scale(1.15)}
.step.done .n{background:var(--signal);border-color:var(--signal);color:#fff}
.step h3{font-size:clamp(28px,3.2vw,38px);font-stretch:80%;font-variation-settings:"wdth" 80;line-height:1.05;margin:0 0 12px}
.step p{color:var(--soft);margin:0;max-width:30em}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chip{display:inline-flex;align-items:center;gap:8px;padding:7px 13px;border-radius:99px;border:1px solid var(--line-2);background:rgba(8,20,47,.8);font-size:14px;color:#e2e8ff}
.chip .ic{width:17px;height:17px;color:#8fb0ff}
.chip.claude{border-color:rgba(58,108,255,.6)}
.lay{position:absolute;inset:0;opacity:0;visibility:hidden;transition:opacity .6s,visibility .6s}
.stage[data-s="1"] .l1,.stage[data-s="2"] .l1,.stage[data-s="3"] .l3,.stage[data-s="4"] .l4{opacity:1;visibility:visible}
.mueve{position:absolute;inset:0;transform-origin:0 0;transition:transform 1.1s var(--ease)}
.mueve img{display:block;width:100%;height:100%}
.stage[data-s="2"] .mueve{transform:scale(1.3) translate(-20.5%,-19%)}
.ring{position:absolute;border:2px solid var(--signal);border-radius:1.2cqw;opacity:0;transition:opacity .5s .4s}
.ring.r1{left:22.6%;top:17.8%;width:73.6%;height:8.4%}
.ring.r2{left:21%;top:29.6%;width:77%;height:17.6%}
.stage[data-s="1"] .r1,.stage[data-s="2"] .r2{opacity:1;animation:ring 1.8s 1s infinite}
@keyframes ring{0%,100%{box-shadow:0 0 0 0 rgba(58,108,255,.5)}50%{box-shadow:0 0 0 1.2cqw rgba(58,108,255,0)}}
.l3{background:radial-gradient(70% 90% at 70% 40%,rgba(37,80,192,.35),transparent),#030816}
.ghost{position:absolute;left:5%;top:20%;width:48%;aspect-ratio:16/9;border-radius:1cqw;overflow:hidden;border:1px solid var(--line-2);opacity:.85}
.ghost .cam{font-size:1.2cqw}
.ghost .crop{position:absolute;border:2px dashed #fff;border-radius:4px}
.ghost .crop.c1{left:2.5%;bottom:4%;width:28%;height:40%;border-color:#8fb0ff}
.ghost .crop.c2{left:36%;top:22%;width:30%;height:72%}
.l3 .flecha{position:absolute;left:55.5%;top:39.5%;width:6cqw;height:6cqw;border-radius:50%;display:grid;place-items:center;background:var(--signal);box-shadow:0 0 0 1cqw rgba(58,108,255,.18);animation:empuja 1.6s var(--ease) infinite}
.l3 .flecha svg{width:55%;height:55%}
@keyframes empuja{50%{transform:translateX(.8cqw)}}
.l3 .phone{right:9%;top:6%;width:29%;border-width:.6cqw}
.l3 .leyenda{position:absolute;left:5%;top:73%;display:flex;flex-wrap:wrap;gap:1cqw;width:50%}
.l3 .leyenda span{display:inline-flex;align-items:center;gap:.8cqw;padding:.7cqw 1.4cqw;border-radius:99px;background:rgba(8,20,47,.9);border:1px solid var(--line-2);font-size:clamp(9px,1.55cqw,14px)}
.l3 .leyenda i{width:1.4cqw;height:1.4cqw;border-radius:3px;border:2px dashed #fff}
.l3 .leyenda i.c1{border-color:#8fb0ff}
.phone.quieto .subs span{opacity:1;transform:none;animation:palabra 2.4s infinite;animation-delay:calc(var(--i)*.4s)}
@keyframes palabra{0%,16%{background:var(--red);text-shadow:none}17%,100%{background:transparent}}
.l4 img{display:block;width:100%;height:100%;filter:brightness(.8)}
.sugcard{position:absolute;left:31%;top:36%;width:55%;display:flex;gap:2.2cqw;padding:2cqw;border-radius:1.6cqw;background:rgba(8,20,47,.97);border:1px solid rgba(58,108,255,.55);
  box-shadow:0 2cqw 6cqw rgba(0,0,0,.7),0 0 0 .6cqw rgba(58,108,255,.12);font-size:clamp(9px,1.5cqw,14px);line-height:1.35;transform:translateY(4cqw) scale(.95);opacity:0;transition:transform .8s .25s var(--ease),opacity .6s .25s}
.stage[data-s="4"] .sugcard{transform:none;opacity:1}
.sugcard .thumb{position:relative;flex:none;width:20%;aspect-ratio:9/16;border-radius:1cqw;overflow:hidden;font-size:.6cqw}
.sugcard .thumb .ph-cam{font-size:.6cqw}
.sc{display:grid;gap:.5cqw;align-content:start;min-width:0}
.sc-nets{display:flex;gap:.7cqw;flex-wrap:wrap}
.sc-nets .net{font-size:clamp(8px,1.2cqw,12px);padding:.2cqw 1cqw}
.sc-nets .net.off{background:transparent;border-color:var(--line);color:var(--muted)}
.sc b{font:700 clamp(13px,2.4cqw,22px) var(--display)}
.sc .h{color:#9db4ff}
.sc .copiar{justify-self:start;margin-top:.6cqw;padding:.7cqw 1.6cqw;border-radius:.8cqw;background:var(--signal);font-weight:600}

/* Piloto */
.split{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:60px;align-items:center}
.shot{position:relative;border-radius:16px;border:1px solid var(--line-2);overflow:hidden;background:#040a1c;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 6px rgba(58,108,255,.06);
  transform:perspective(1400px) rotateY(var(--ry,0deg)) rotateX(var(--rx,0deg));transition:transform .5s var(--ease)}
.shot img{display:block;width:100%}
.shot .scan{position:absolute;left:0;right:0;height:30%;top:-30%;background:linear-gradient(180deg,transparent,rgba(58,108,255,.16),transparent);animation:scan 5s linear infinite}
@keyframes scan{to{transform:translateY(440%)}}
.split h2{font-size:clamp(38px,4.6vw,58px);line-height:1;margin:0 0 16px}
.split > div > p{color:var(--soft);font-size:18px;margin:0}
.ticks{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:14px}
.ticks li{display:grid;grid-template-columns:30px 1fr;gap:10px;color:#e3e9fb}
.ticks .ic{color:#8fb0ff;margin-top:2px}

/* Todo lo que hace: una sola ficha con divisiones finas */
.feats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.feat{position:relative;padding:28px 24px 30px;background:#050d24;transition:background .35s}
.feat:hover{background:#0a1838}
.feat .ic{width:30px;height:30px;color:#8fb0ff;transition:transform .4s var(--ease),color .3s}
.feat:hover .ic{transform:translateY(-3px);color:#fff}
.feat h3{font-size:20px;margin:16px 0 8px;line-height:1.15}
.feat p{margin:0;color:var(--muted);font-size:15px;line-height:1.55}

/* Planes */
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:16px;align-items:stretch}
.plan{position:relative;display:flex;flex-direction:column;gap:14px;padding:30px 28px;border-radius:18px;border:1px solid var(--line-2);background:linear-gradient(180deg,rgba(13,29,66,.9),rgba(8,20,47,.9));overflow:hidden}
.glow:before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(420px circle at var(--x,50%) var(--y,0%),rgba(58,108,255,.2),transparent 60%);opacity:0;transition:opacity .35s}
.glow:hover:before{opacity:1}
.plan.destacado{border-color:rgba(229,22,29,.7);box-shadow:0 0 0 1px rgba(229,22,29,.25),0 24px 60px rgba(229,22,29,.15)}
.plan.destacado:before{background:radial-gradient(420px circle at var(--x,50%) var(--y,0%),rgba(229,22,29,.17),transparent 60%)}
.ribbon{position:absolute;top:20px;right:20px;background:var(--red);padding:3px 12px;border-radius:99px;font:700 13px var(--display)}
.plan h3{margin:0;font-size:28px}
.price{font-size:64px;line-height:.95}
.price .cur{font-size:.36em;vertical-align:1.15em;margin-right:6px;color:var(--soft)}
.price small{font:400 16px "Segoe UI",system-ui,sans-serif;color:var(--muted);letter-spacing:0}
.plan p{margin:0 0 8px;color:var(--soft);font-size:15.5px;line-height:1.6}
.modo{display:inline-flex;align-self:flex-start;align-items:center;gap:8px;padding:6px 13px;border-radius:99px;border:1px solid var(--line-2);background:rgba(0,0,0,.3);font-size:14px;color:#e2e8ff}
.modo .ic{width:17px;height:17px;color:#8fb0ff}
.plan.destacado .modo{border-color:rgba(58,108,255,.6)}
.checks{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.checks li{position:relative;padding-left:30px;font-size:15px;color:#e3e9fb;line-height:1.45}
.checks li .ic{position:absolute;left:0;top:1px;width:19px;height:19px;color:var(--ok)}
.plan .btn{margin-top:auto}
.incl{padding:30px 28px;border-radius:18px;border:1px dashed var(--line-2);background:rgba(0,0,0,.35)}
.incl h3{margin:0 0 16px;font-size:21px}
.pago{display:flex;gap:10px;align-items:center;margin:18px 0 0;color:var(--muted);font-size:14.5px}
.pago .ic{color:#8fb0ff}

/* Descargar */
.dl{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:stretch}
.panel{position:relative;padding:30px;border-radius:18px;border:1px solid var(--line-2);background:linear-gradient(180deg,rgba(13,29,66,.9),rgba(8,20,47,.9));overflow:hidden}
.dl-main{display:flex;flex-direction:column;gap:18px}
.dl-ico{width:58px;height:58px;border-radius:15px;display:grid;place-items:center;background:rgba(229,22,29,.14);border:1px solid rgba(229,22,29,.45);color:#ff8a8d}
.dl-ico .ic{width:28px;height:28px;animation:baja 2.2s var(--ease) infinite}
.dl-main h3{margin:0;font-size:30px}
.facts{display:flex;flex-wrap:wrap;gap:10px 28px;margin:0}
.facts div{display:grid}
.facts dt{font-size:13px;color:var(--muted)}
.facts dd{margin:0;font:600 18px var(--display)}
.pasitos{margin:0;padding:0;list-style:none;counter-reset:m;display:grid;gap:9px;color:var(--soft);font-size:15px}
.pasitos li{counter-increment:m;display:flex;gap:11px;align-items:flex-start}
.pasitos li:before{content:counter(m);flex:none;width:23px;height:23px;margin-top:1px;border-radius:50%;display:grid;place-items:center;background:var(--navy-3);font:700 12px var(--display);color:#fff}
.req{margin:0;padding:0;list-style:none;display:grid;gap:14px}
.req li{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;color:#e3e9fb;font-size:15.5px}
.req .ic{width:34px;height:34px;padding:7px;border-radius:9px;background:rgba(58,108,255,.13);color:#8fb0ff}
.panel h3{margin-top:0}

/* Preguntas */
.faq{max-width:860px;border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;gap:18px;padding:22px 4px;font:600 20px/1.3 var(--display);transition:color .2s}
.faq summary::-webkit-details-marker{display:none}
.faq summary:hover{color:#c9d6ff}
.pm{position:relative;flex:none;width:30px;height:30px;border-radius:50%;border:1px solid var(--line-2);transition:transform .35s var(--ease),background .3s,border-color .3s}
.pm:before,.pm:after{content:"";position:absolute;left:50%;top:50%;width:12px;height:2px;margin:-1px 0 0 -6px;border-radius:2px;background:#fff}
.pm:after{transform:rotate(90deg)}
.faq details[open] .pm{transform:rotate(45deg);background:var(--red);border-color:var(--red)}
.faq details::details-content{block-size:0;overflow:hidden;transition:block-size .4s var(--ease),content-visibility .4s allow-discrete}
.faq details[open]::details-content{block-size:auto}
.faq details p{margin:0 4px 22px;color:var(--soft);max-width:44em}

/* Cierre */
.final{position:relative;margin:120px 0 0;padding:72px 48px;border-radius:24px;border:1px solid var(--line-2);overflow:hidden;
  background:radial-gradient(640px 320px at 85% 0%,rgba(58,108,255,.3),transparent),linear-gradient(180deg,#0d1d42,#08142f)}
.final h2{position:relative;font-size:clamp(40px,5.6vw,72px);line-height:.96;margin:0 0 16px;max-width:11em}
.final p{position:relative;color:var(--soft);font-size:19px;margin:0 0 30px;max-width:30em}
.final .cta{position:relative}
.onda{position:absolute;right:28px;bottom:0;top:22%;width:46%;display:flex;align-items:flex-end;gap:5px;opacity:.5;-webkit-mask-image:linear-gradient(90deg,transparent,#000 40%);mask-image:linear-gradient(90deg,transparent,#000 40%)}
.onda i{flex:1;border-radius:3px 3px 0 0;background:var(--signal);transform-origin:bottom;animation:onda 1.8s ease-in-out infinite alternate;animation-delay:calc(var(--i)*-.13s)}
.onda i.hot{background:var(--red-2)}
@keyframes onda{to{transform:scaleY(.45)}}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px;padding:28px 0;margin-top:90px}
footer .wrap{display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between;align-items:center}
footer a{color:var(--muted)}
footer a:hover{color:#fff}

/* Comprar */
.card{position:relative;background:linear-gradient(180deg,rgba(13,29,66,.88),rgba(8,20,47,.88));border:1px solid var(--line-2);border-radius:18px;padding:26px}
.card h3{font-size:22px}
.buy-head{padding:48px 0 6px;max-width:760px}
.buy-head h1{font-size:clamp(44px,6vw,72px);line-height:.96;margin:0 0 12px}
.buy-head p{color:var(--soft);margin:0;font-size:18px}
.pasos{display:flex;gap:8px;list-style:none;padding:0;margin:24px 0 0;counter-reset:p;flex-wrap:wrap}
.paso{counter-increment:p;display:flex;align-items:center;gap:9px;padding:6px 15px 6px 6px;border-radius:99px;border:1px solid var(--line);color:var(--muted);font-size:14.5px;background:rgba(8,20,47,.7);transition:color .3s,border-color .3s}
.paso:before{content:counter(p);width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:var(--navy-3);font:700 13px var(--display);color:#fff;transition:background .3s}
.paso.on{color:#fff;border-color:rgba(229,22,29,.65)}
.paso.on:before{background:var(--red)}
.paso.ok{color:#dfe6ff;border-color:rgba(58,108,255,.5)}
.paso.ok:before{content:"✓";background:var(--signal)}
.buy{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;padding:28px 0 30px;align-items:start}
.buy-t{font:600 15px var(--display);color:var(--muted);margin:0 0 12px}
.opt{position:relative;display:flex;gap:14px;align-items:center;padding:18px;border-radius:14px;border:1px solid var(--line-2);background:rgba(8,20,47,.75);cursor:pointer;margin-bottom:10px;transition:border-color .25s,box-shadow .25s,transform .2s var(--ease),background .25s}
.opt:hover{transform:translateY(-1px);border-color:rgba(157,180,255,.5)}
.opt input{accent-color:var(--red);width:19px;height:19px;flex:none}
.opt .grow{flex:1}
.opt b{font-family:var(--display);font-size:21px}
.opt .p{font:700 26px var(--display);white-space:nowrap}
.opt:has(input:checked){border-color:var(--red);background:rgba(13,29,66,.9);box-shadow:0 0 0 1px rgba(229,22,29,.35),0 14px 36px rgba(229,22,29,.12)}
label.f{display:block;color:var(--muted);font-size:14px;margin:14px 0 0}
label.f input,label.f select{display:block;width:100%;margin-top:6px;padding:13px 14px;border-radius:11px;border:1px solid var(--line-2);background:#040a1c;color:#fff;font-size:16px;transition:border-color .2s,box-shadow .2s}
label.f input:focus,label.f select:focus{outline:0;border-color:var(--signal);box-shadow:0 0 0 3px rgba(58,108,255,.3)}
.tabs{position:relative;display:flex;gap:6px;background:#040a1c;border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:6px}
.tabs button{flex:1;padding:10px;border-radius:9px;border:0;background:transparent;color:var(--muted);font:600 15px "Segoe UI",system-ui,sans-serif;cursor:pointer;transition:background .25s,color .25s}
.tabs button.on{background:var(--navy-3);color:#fff}
.chk{display:flex;gap:10px;align-items:flex-start;color:var(--muted);font-size:14px;margin-top:14px}
.chk input{margin-top:3px;accent-color:var(--red)}
.msg{margin-top:12px;font-size:15px;min-height:22px}
.msg.bad{color:#ff8a8d}.msg.ok{color:#7ff0a6}
.total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid var(--line);margin-top:18px;padding-top:16px}
.total b{font:700 38px var(--display);font-stretch:80%;font-variation-settings:"wdth" 80}
.who{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(94,227,140,.08);border:1px solid rgba(94,227,140,.3)}
.meta{color:var(--muted);font-size:14px}
.seguro{display:flex;gap:9px;align-items:center;justify-content:center;color:var(--muted);font-size:14px;margin:12px 0 0}
.seguro .ic{width:17px;height:17px}

@media (max-width:960px){
  .hero{grid-template-columns:1fr;min-height:0;padding:36px 0 40px;gap:40px}
  .story{grid-template-columns:1fr;gap:0}
  .stage{grid-column:1;top:76px;z-index:3;margin:0 -4px;box-shadow:0 -10px 0 10px #000,0 22px 26px 8px rgba(0,0,0,.92)}
  .steps{grid-column:1;grid-row:2;padding-left:36px}
  .steps:before,.rail{top:10vh}
  .rail{height:calc(var(--p,0)*(100% - 20vh))}
  .steps:before{bottom:10vh}
  .step{min-height:60vh}
  .step .n{left:-36px}
  .split,.dl,.buy{grid-template-columns:1fr}
  .split .shot-w{order:2}
  .feats{grid-template-columns:1fr 1fr}
  .nav .l{display:none}
  .sec{padding-top:96px}
}
@media (max-width:600px){
  .wrap{padding:0 16px}
  body{font-size:16px}
  .hero h1{font-size:clamp(46px,13vw,64px)}
  .lead{font-size:18px}
  .cta .btn{flex:1 1 auto}
  .demo{min-height:0;padding-bottom:12px}
  .mon,.tl{width:74%}
  .phone{width:36%}
  .tl{padding:8px;gap:8px}
  .tl-lab{font-size:10.5px}
  .tl-track{height:46px}
  .status{width:100%;margin-top:12px;padding-right:0;font-size:14px}
  .sug{position:relative;width:100%;margin-top:10px}
  .feats{grid-template-columns:1fr}
  .sec-head h2{font-size:clamp(36px,11vw,48px)}
  .final{padding:48px 22px 150px}
  .onda{left:22px;right:22px;width:auto;top:auto;height:110px;-webkit-mask-image:none;mask-image:none;opacity:.4}
  .card,.panel,.plan,.incl{padding:22px}
  .opt{padding:14px}
  .opt .p{font-size:22px}
}
@media (prefers-reduced-motion:reduce){
  *,*:before,*:after{animation:none!important;transition:none!important}
  html{scroll-behavior:auto}
  html.js .rv,html.js .rv-w{opacity:1;transform:none;clip-path:none}
}
`;

// Todo lo que se mueve en todas las páginas: barra de avance, cabecera, fondo, aparecer al hacer scroll,
// brillo de las tarjetas, inclinación de las capturas, la sección "Así funciona" y la pestaña activa.
function scriptPagina() {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fino = matchMedia('(pointer: fine)').matches;
  const prog = d.getElementById('prog');
  const top = d.querySelector('.top');
  const bg = d.querySelector('.bg');
  const links = [...d.querySelectorAll('.nav .l')];
  const secciones = links.map((a) => d.getElementById(a.hash.slice(1))).filter(Boolean);

  const story = d.querySelector('.story');
  let historia = () => {};
  if (story) {
    const stage = story.querySelector('.stage');
    const steps = [...story.querySelectorAll('.step')];
    const rail = story.querySelector('.rail');
    historia = () => {
      const vh = innerHeight;
      const angosto = innerWidth <= 960;
      const sb = angosto ? stage.getBoundingClientRect().bottom : 0;
      const linea = angosto ? sb + (vh - sb) * 0.45 : vh * 0.5;
      let cur = 0;
      steps.forEach((s, i) => { if (s.getBoundingClientRect().top < linea) cur = i; });
      steps.forEach((s, i) => { s.classList.toggle('on', i === cur); s.classList.toggle('done', i < cur); });
      if (stage.dataset.s !== String(cur + 1)) stage.dataset.s = String(cur + 1);
      const a = steps[0].getBoundingClientRect();
      const b = steps[steps.length - 1].getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (linea - a.top - a.height / 2) / (b.top + b.height / 2 - a.top - a.height / 2)));
      rail.style.setProperty('--p', p.toFixed(3));
    };
  }

  let pendiente = false;
  const alMover = () => {
    pendiente = false;
    const h = d.documentElement.scrollHeight - innerHeight;
    prog.style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
    top.classList.toggle('solid', scrollY > 8);
    let id = '';
    secciones.forEach((s) => { if (s.getBoundingClientRect().top < innerHeight * 0.4) id = s.id; });
    links.forEach((a) => a.classList.toggle('on', a.hash === `#${id}`));
    historia();
  };
  addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(alMover); } }, { passive: true });
  addEventListener('resize', alMover);
  alMover();

  // Aparecer al hacer scroll.
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  d.querySelectorAll('.rv,.rv-w').forEach((el) => io.observe(el));

  if (reduce || !fino) return;
  // El fondo sigue un poco al ratón.
  addEventListener('pointermove', (e) => {
    bg.style.setProperty('--mx', (e.clientX / innerWidth - 0.5).toFixed(3));
    bg.style.setProperty('--my', (e.clientY / innerHeight - 0.5).toFixed(3));
  }, { passive: true });
  // Brillo que sigue al puntero en los planes.
  d.querySelectorAll('.glow').forEach((el) => el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--x', `${e.clientX - r.left}px`);
    el.style.setProperty('--y', `${e.clientY - r.top}px`);
  }));
  // Las capturas se inclinan un poco hacia el ratón.
  d.querySelectorAll('.tilt').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`);
      el.style.setProperty('--rx', `${((e.clientY - r.top) / r.height - 0.5) * -5}deg`);
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--ry', '0deg'); el.style.setProperty('--rx', '0deg'); });
  });
}

// La demo de la portada: el directo corre, ClipViral lee el chat y escucha la voz, encuentra el momento,
// lo corta en vertical con subtítulos y lo deja listo con su red y su hora.
function scriptDemo() {
  const demo = document.getElementById('demo');
  if (!demo) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => demo.querySelector(s);
  const strip = $('.tl-strip');
  const track = $('.tl-track');
  const chat = $('.chat-list');
  const subs = $('.phone .subs');
  const phone = $('.phone');
  const sug = $('.sug');
  const status = $('.status');
  const reloj = $('.live span');
  const mon = $('.mon');
  const N = 120;
  const W = 7;
  const PICOS = [34, 92];
  let semilla = 11;
  const rnd = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  const cols = [];
  for (let i = 0; i < N; i++) {
    let c = 0.1 + rnd() * 0.3;
    let v = 0.12 + rnd() * 0.34;
    for (const p of PICOS) {
      const dd = Math.abs(i - p);
      if (dd < 7) { const k = Math.exp((-dd * dd) / 7); c = Math.max(c, 0.25 + 0.75 * k); v = Math.max(v, 0.2 + 0.8 * k); }
    }
    cols.push(`<i data-i="${i}" style="--c:${c.toFixed(2)};--v:${v.toFixed(2)}"></i>`);
  }
  strip.innerHTML = cols.join('') + cols.join('');
  const barras = [...strip.children];

  const GENTE = [['mari_08', '#8fb0ff'], ['elkevin', '#ff8a8d'], ['lunita', '#7ff0a6'], ['darkpro', '#ffd36b'], ['yeni.rd', '#c9a7ff'], ['toño', '#8fb0ff'], ['sofi', '#7ff0a6']];
  const CALMA = ['buenas 👋', '¿qué juego es?', 'saludos desde Santiago', 'vamos que se puede', 'jajaja', 'ese mapa está difícil', 'primera vez por aquí', 'like al directo'];
  const EUFORIA = ['JAJAJAJA', 'NOOOO 😂', '¡CLIP!', '🔥🔥🔥', '¿qué fue eso?', 'OTRA VEZ jajaja', 'el mejor momento'];
  const MOMENTOS = [
    { w: ['¡No', 'puede', 'ser,', 'lo', 'hizo', 'otra', 'vez!'], red: 'TikTok', hora: 'Hoy, 7:30 p. m.', t: 'Lo hizo otra vez 😱', h: '#gaming #clips #parati' },
    { w: ['Espera,', 'espera…', '¡mira', 'lo', 'que', 'pasó!'], red: 'Reels', hora: 'Mañana, 12:15 p. m.', t: 'Nadie esperaba este final', h: '#reels #streamer #envivo' },
    { w: ['Esto', 'va', 'directo', 'a', 'los', 'Shorts'], red: 'Shorts', hora: 'Hoy, 9:00 p. m.', t: 'El mejor momento del directo', h: '#shorts #gamer #viral' },
  ];
  let segs = 2 * 3600 + 14 * 60 + 5;
  const hms = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const decir = (texto) => {
    const [u, col] = GENTE[Math.floor(rnd() * GENTE.length)];
    const p = document.createElement('p');
    const b = document.createElement('b');
    b.style.color = col; b.textContent = u;
    p.append(b, texto);
    chat.append(p);
    while (chat.children.length > 10) chat.firstElementChild.remove();
  };
  const estado = (t, hit) => { status.querySelector('span').textContent = t; status.classList.toggle('hit', !!hit); };
  const llenarSug = (m) => {
    sug.querySelector('.net').textContent = m.red;
    sug.querySelector('b').textContent = m.hora;
    sug.querySelector('.t').textContent = m.t;
    sug.querySelector('.h').textContent = m.h;
  };
  const ponerSubs = (m) => {
    subs.innerHTML = '';
    m.w.forEach((w) => { const s = document.createElement('span'); s.textContent = w; subs.append(s); });
    return [...subs.children];
  };
  let k = 0;
  let timers = [];
  const luego = (ms, fn) => timers.push(setTimeout(fn, ms));
  const marcar = (pi) => barras.forEach((b) => b.classList.toggle('hot', Math.abs(Number(b.dataset.i) - PICOS[pi]) <= 3));

  if (reduce) {
    for (let i = 0; i < 7; i++) decir(i < 4 ? CALMA[i] : EUFORIA[i]);
    marcar(0);
    const m = MOMENTOS[0];
    ponerSubs(m).forEach((s, i) => s.classList.add('v', ...(i === 0 ? ['a'] : [])));
    llenarSug(m); sug.classList.add('on');
    estado(`Listo para ${m.red}: con su texto y su hora.`);
    requestAnimationFrame(() => { strip.style.transform = `translateX(${-(PICOS[0] * W - track.clientWidth * 0.62)}px)`; });
    return;
  }

  const momento = (pi) => {
    timers.forEach(clearTimeout); timers = [];
    const m = MOMENTOS[k++ % MOMENTOS.length];
    marcar(pi);
    mon.classList.remove('boom'); void mon.offsetWidth; mon.classList.add('boom');
    EUFORIA.forEach((t, j) => luego(j * 150, () => decir(t)));
    estado(`¡Momento encontrado en ${hms(segs)}! El chat y las risas se dispararon.`, true);
    sug.classList.remove('on');
    luego(1200, () => {
      estado('Cortando en vertical y poniendo los subtítulos…');
      const spans = ponerSubs(m);
      phone.classList.remove('new'); void phone.offsetWidth; phone.classList.add('new');
      spans.forEach((s, j) => luego(250 + j * 340, () => { spans.forEach((x) => x.classList.remove('a')); s.classList.add('v', 'a'); }));
      luego(250 + spans.length * 340 + 450, () => { llenarSug(m); sug.classList.add('on'); estado(`Listo para ${m.red}: con su título, sus hashtags y su hora.`); });
    });
  };

  for (let i = 0; i < 5; i++) decir(CALMA[i]);
  let off = 0;
  let ultimo = 0;
  let corriendo = false;
  let cabeza = 0;
  const armado = [true, true];
  const medir = () => { cabeza = track.clientWidth * 0.62; };
  medir();
  addEventListener('resize', medir);
  off = (PICOS[0] * W - cabeza - 70 + N * W) % (N * W);
  const cuadro = (t) => {
    if (!corriendo) return;
    const dt = ultimo ? Math.min(250, t - ultimo) : 16;
    ultimo = t;
    off = (off + dt * 0.045) % (N * W);
    strip.style.transform = `translate3d(${-off}px,0,0)`;
    const idx = Math.floor((off + cabeza) / W) % N;
    PICOS.forEach((p, pi) => {
      if (armado[pi] && idx >= p && idx <= p + 3) { armado[pi] = false; armado[1 - pi] = true; momento(pi); }
    });
    requestAnimationFrame(cuadro);
  };
  let intervalos = [];
  const arrancar = () => {
    if (corriendo) return;
    corriendo = true; ultimo = 0;
    requestAnimationFrame(cuadro);
    intervalos = [
      setInterval(() => { segs += 1; reloj.textContent = hms(segs); }, 1000),
      setInterval(() => decir(CALMA[Math.floor(rnd() * CALMA.length)]), 1300),
    ];
  };
  const parar = () => { corriendo = false; intervalos.forEach(clearInterval); };
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !document.hidden) arrancar(); else parar(); }).observe(demo);
  document.addEventListener('visibilitychange', () => { if (document.hidden) parar(); else if (visible) arrancar(); });
}

function layout(title, body, { description = '', scripts = '' } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || 'ClipViral saca los mejores momentos de tus directos y videos de YouTube y los convierte en clips verticales con subtítulos.')}">
<meta name="theme-color" content="#000000">
<link rel="icon" href="/web/icono.png">
<script>document.documentElement.classList.add('js')</script>
<style>${CSS}</style>
</head>
<body>
<div class="bg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="sweep"></i></div>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><img src="/web/icono.png" alt="">ClipViral</a>
  <nav class="nav" aria-label="Secciones"><a class="l" href="/#como">Cómo funciona</a><a class="l" href="/#piloto">Piloto</a><a class="l" href="/#planes">Planes</a><a class="l" href="/#descargar">Descargar</a><a class="l" href="/#preguntas">Preguntas</a>
    <a class="btn red" href="/comprar">Comprar</a></nav>
</div><span id="prog"></span></header>
${body}
<footer><div class="wrap">
  <span>© ${new Date().getFullYear()} ClipViral</span>
  <span><a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a> · <a href="/borrar-datos">Borrar datos</a> · <a href="/en">English</a> · ${esEnlace(supportContact()) ? `<a href="${esc(supportContact())}" target="_blank" rel="noopener">Soporte</a>` : `Soporte: ${esc(supportContact())}`}</span>
</div></footer>
<script>(${scriptPagina})();</script>
${scripts}
</body>
</html>`;
}

function descargaBloque() {
  const d = descargaInfo();
  if (!d) {
    return `<div class="panel dl-main rv"><div class="dl-ico">${ic('reloj')}</div><h3>La descarga estará lista muy pronto</h3>
      <p class="meta" style="margin:0">Estamos subiendo la versión nueva${ultimaVersion() ? ` (v${esc(ultimaVersion())})` : ''}. Vuelve en un rato.</p></div>`;
  }
  return `<div class="panel dl-main glow rv">
    <div class="dl-ico">${ic('bajar')}</div>
    <h3>ClipViral para Windows</h3>
    <dl class="facts"><div><dt>Última versión</dt><dd>Versión ${esc(d.version)}</dd></div><div><dt>Tamaño</dt><dd>${mb(d.size)}</dd></div>
      <div><dt>Actualizada</dt><dd>${new Date(d.at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div></dl>
    <div class="cta"><a class="btn red" href="/descargar">${ic('bajar', 'baja')} Descargar ClipViral</a></div>
    <ol class="pasitos"><li>Descomprime el .zip.</li><li>Abre <b>ClipViral-Setup</b> y sigue los pasos.</li><li>Crea tu cuenta en la app. Después se actualiza sola cuando hay versión nueva.</li></ol>
  </div>`;
}

function inicio() {
  const plans = webPlans();
  const d = descargaInfo();
  const titulo = 'Tus directos, convertidos en clips virales'.split(' ').map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(' ');
  const feats = [
    ['target', 'Encuentra los mejores momentos', 'Lee el chat, escucha las risas, los gritos y la euforia, y mira lo que pasa en pantalla para saber dónde explotó tu directo.'],
    ['subs', 'Subtítulos animados', 'Palabra por palabra, sincronizados con la voz, con la letra, los colores y la posición que elijas.'],
    ['camjuego', 'Cámara + juego', 'Para streamers: tu cámara arriba y el juego abajo, en vertical, detectados solos.'],
    ['piloto', 'Piloto automático', 'Vigila tus canales y saca clips solo cuando hay directo o video nuevo, aunque no estés mirando.'],
    ['reloj', 'Listos para publicar', 'Cada clip llega con título, gancho, descripción, hashtags y la mejor hora para TikTok, Reels, Shorts y Facebook.'],
    ['efectos', 'Efectos en una pasada', 'Velocidad, espejo, fondo propio, quitar silencios y voces divertidas.'],
    ['candado', 'Tus videos se quedan en tu PC', 'ClipViral baja el video, lo corta y crea los clips en tu computadora. Tú decides dónde publicarlos.'],
    ['actualiza', 'Se actualiza solo', 'Cuando hay una versión nueva, la app te avisa y se actualiza con un clic.'],
  ];
  const incluye = ['Clips ilimitados', 'Subtítulos animados y formato vertical', 'IA local que ve y escucha (risas, gritos, chat)', 'Piloto automático y Clips sugeridos', 'Actualizaciones incluidas'];
  const planHtml = plans.map((pl, i) => {
    const top = pl.usesAi;
    return `<div class="plan glow rv ${top ? 'destacado' : ''}" style="transition-delay:${i * 90}ms">${top ? '<span class="ribbon">Más popular</span>' : ''}
      <h3>${esc(pl.name)}</h3>
      <div class="price"><span class="cur">US$</span>${precio(pl.priceUsd)}<small> /mes</small></div>
      <span class="modo">${pl.usesAi ? `${ic('chispa')}IA local + Claude` : `${ic('pc')}IA local, todo en tu PC`}</span>
      ${pl.description ? `<p>${esc(pl.description)}</p>` : ''}
      <a class="btn ${top || plans.length === 1 || i === plans.length - 1 ? 'red' : ''}" href="/comprar?plan=${encodeURIComponent(pl.id)}">Comprar ${esc(pl.name)}</a></div>`;
  }).join('');
  const onda = Array.from({ length: 46 }, (_, i) => {
    const h = 18 + Math.abs(Math.sin(i * 0.55) * 46 + Math.sin(i * 1.7) * 18) + (i > 30 && i < 36 ? 30 : 0);
    return `<i class="${i > 30 && i < 36 ? 'hot' : ''}" style="--i:${i};height:${Math.min(100, h).toFixed(0)}%"></i>`;
  }).join('');

  return layout('ClipViral · Clips virales de tus directos', `
<main class="wrap">
  <section class="hero">
    <div>
      <span class="tag"><span class="dot"></span>Para streamers y creadores, en Windows</span>
      <h1 aria-label="Tus directos, convertidos en clips virales">${titulo}</h1>
      <div class="luego">
        <p class="lead">Pega el enlace de un directo o video de YouTube. ClipViral encuentra los mejores momentos con IA y te los entrega en vertical, con subtítulos y listos para TikTok, Reels y Shorts.</p>
        <div class="cta">
          <a class="btn red" href="${d ? '/descargar' : '#descargar'}">${ic('bajar', 'baja')} Descargar para Windows</a>
          <a class="btn" href="#como">Ver cómo funciona</a>
        </div>
        <p class="note">${ic('candado')} Todo se procesa en tu PC: tus videos no se suben a ningún servidor.</p>
      </div>
    </div>
    <div class="demo" id="demo" role="img" aria-label="Animación: ClipViral lee el chat y escucha un directo, encuentra el mejor momento y lo convierte en un clip vertical con subtítulos, listo para TikTok.">
      <div class="mon">
        <div class="view">${escena()}<div class="cam">${persona}</div><div class="live"><b>EN VIVO</b><span>2:14:05</span></div></div>
        <div class="chat"><div class="chat-h">Chat en vivo</div><div class="chat-list"></div></div>
        <i class="flash"></i>
      </div>
      <div class="tl"><div class="tl-lab"><span>Chat</span><span>Voz y risas</span></div><div class="tl-track"><div class="tl-strip"></div><i class="tl-head"></i></div></div>
      <p class="status"><i></i><span>Leyendo el chat y escuchando el directo…</span></p>
      ${telefono('')}
      <div class="sug"><div class="fila"><span class="net">TikTok</span><b>Hoy, 7:30 p. m.</b></div><span class="t">Lo hizo otra vez 😱</span><span class="h">#gaming #clips #parati</span></div>
    </div>
  </section>

  <section class="sec" id="como">
    <div class="sec-head"><h2 class="rv-w">Así funciona</h2><p class="rv">Pegas un enlace y, mientras haces otra cosa, ClipViral mira el video completo por ti. Son cuatro pasos y tú solo haces el primero.</p></div>
    <div class="story">
      <div class="stage" data-s="1" aria-hidden="true">
        <div class="lay l1"><div class="mueve"><img src="/web/app-directo.png" alt="" loading="lazy"><i class="ring r1"></i><i class="ring r2"></i></div></div>
        <div class="lay l3">
          <div class="ghost">${escena()}<div class="cam">${persona}</div><i class="crop c1"></i><i class="crop c2"></i></div>
          <span class="flecha"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
          ${telefono(['Así', 'salen', 'tus', 'clips', 'con', 'subtítulos'].map((w, i) => `<span style="--i:${i}">${w}</span>`).join(''), 'quieto')}
          <div class="leyenda"><span><i class="c1"></i>Tu cámara, arriba</span><span><i></i>El juego, abajo</span></div>
        </div>
        <div class="lay l4"><img src="/web/app-sugeridos.png" alt="" loading="lazy">
          <div class="sugcard"><div class="thumb"><div class="ph-cam">${persona}</div><div class="ph-game">${escena()}</div></div>
            <div class="sc"><div class="sc-nets"><span class="net">TikTok</span><span class="net off">Instagram</span><span class="net off">YouTube</span><span class="net off">Facebook</span></div>
              <b>Hoy, 7:30 p. m.</b><span>Lo hizo otra vez 😱 Nadie esperaba esa jugada</span><span class="h">#gaming #clips #parati</span><span class="copiar">Copiar texto</span></div></div>
        </div>
      </div>
      <div class="steps"><i class="rail"></i>
        <div class="step on"><span class="n">1</span><h3>Pega el enlace</h3>
          <p>Copia el enlace de tu directo o de cualquier video de YouTube y pégalo en ClipViral. Elige cuánto dura cada clip, de 15 segundos a 2 minutos, y el formato.</p></div>
        <div class="step"><span class="n">2</span><h3>La IA encuentra los mejores momentos</h3>
          <p>La IA local de tu PC escucha las risas, los gritos y la euforia, ve qué tan rápido se mueve el chat y mira lo que pasa en pantalla. Con el plan Claude, además, Claude lee todo lo que se dijo y elige lo más viral.</p>
          <div class="chips"><span class="chip">${ic('oido')}Escucha la voz</span><span class="chip">${ic('chat')}Lee el chat</span><span class="chip">${ic('ojo')}Mira la pantalla</span><span class="chip claude">${ic('chispa')}Claude elige y escribe</span></div></div>
        <div class="step"><span class="n">3</span><h3>Sale el clip vertical, con subtítulos</h3>
          <p>Cada momento sale cortado en vertical, con subtítulos palabra por palabra sincronizados con la voz. Si eres streamer, pone tu cámara arriba y el juego abajo, sin que hagas nada.</p></div>
        <div class="step"><span class="n">4</span><h3>Te dice qué subir, dónde y a qué hora</h3>
          <p>En Clips sugeridos te espera cada clip con su título, el gancho, la descripción y los hashtags para TikTok, Reels, Shorts y Facebook, y la mejor hora para subirlo. Lo copias y lo subes.</p></div>
      </div>
    </div>
  </section>

  <section class="sec split" id="piloto">
    <div class="shot-w rv"><div class="shot tilt"><img src="/web/app-piloto.png" alt="Pantalla del Piloto automático de ClipViral: canales que vigila y temas" loading="lazy"><i class="scan"></i></div></div>
    <div>
      <h2 class="rv-w">Piloto automático: clips aunque no estés mirando</h2>
      <p class="rv">Dile qué canales y qué temas te interesan. ClipViral los revisa cada 20 minutos y te deja los mejores clips en Clips sugeridos. Tú decides qué publicar.</p>
      <ul class="ticks rv">
        <li>${ic('video')}<span>Si un canal empieza un directo, lo graba y saca los clips.</span></li>
        <li>${ic('bajar')}<span>Si sube un video nuevo, lo analiza.</span></li>
        <li>${ic('target')}<span>Busca en YouTube lo más visto del día sobre tus temas.</span></li>
        <li>${ic('chispa')}<span>Con el plan Claude, descarta lo que no tiene que ver con tus temas.</span></li>
      </ul>
    </div>
  </section>

  <section class="sec" id="que">
    <div class="sec-head"><h2 class="rv-w">Todo lo que hace por ti</h2><p class="rv">Deja de buscar a mano el mejor momento de 4 horas de directo.</p></div>
    <div class="feats rv">${feats.map(([i, t, p]) => `<div class="feat">${ic(i)}<h3>${t}</h3><p>${p}</p></div>`).join('')}</div>
  </section>

  <section class="sec" id="planes">
    <div class="sec-head"><h2 class="rv-w">Planes</h2><p class="rv">Pago mensual con tarjeta de crédito o débito, por PayPal (no necesitas cuenta PayPal). Cada pago suma 30 días y no se cobra solo.</p></div>
    <div class="plans">${planHtml || '<div class="plan"><p>Pronto publicaremos los planes.</p></div>'}
      <div class="incl rv"><h3>Todos los planes incluyen</h3><ul class="checks">${incluye.map((t) => `<li>${ic('check')}${esc(t)}</li>`).join('')}</ul>
        <p class="pago">${ic('tarjeta')} Se activa al momento en tu cuenta.</p></div>
    </div>
  </section>

  <section class="sec" id="descargar">
    <div class="sec-head"><h2 class="rv-w">Descargar</h2><p class="rv">Descárgalo, instálalo y crea tu cuenta desde la app.</p></div>
    <div class="dl">
      ${descargaBloque()}
      <div class="panel rv"><h3>Lo que necesita tu PC</h3>
        <ul class="req">
          <li>${ic('pc')}<span>Windows 10 u 11 de 64 bits</span></li>
          <li>${ic('memoria')}<span>8 GB de memoria RAM (16 GB recomendado)</span></li>
          <li>${ic('video')}<span>Tarjeta de video NVIDIA recomendada: los clips salen más rápido</span></li>
          <li>${ic('disco')}<span>5 GB libres para las herramientas y tus clips</span></li>
          <li>${ic('mundo')}<span>Internet para leer YouTube</span></li>
        </ul></div>
    </div>
  </section>

  <section class="sec" id="preguntas">
    <div class="sec-head"><h2 class="rv-w">Preguntas frecuentes</h2></div>
    <div class="faq rv">
      <details><summary>¿Cómo compro un plan?<span class="pm"></span></summary><p>Toca <b>Comprar</b>, crea tu cuenta (o entra si ya tienes una), elige tu plan y paga con tarjeta. Tu plan se activa al momento y lo usas entrando a la app con el mismo correo. También puedes comprar desde la app, en <b>Mi plan</b>.</p></details>
      <details><summary>¿Se cobra solo cada mes?<span class="pm"></span></summary><p>No. Cada pago suma 30 días (o los meses que elijas). Cuando se acerca el final te avisamos y renuevas cuando quieras.</p></details>
      <details><summary>¿Qué diferencia hay entre los planes?<span class="pm"></span></summary><p>Con el plan Local todo se hace en tu PC con la IA local. Con el plan Claude, además, Claude (la IA de Anthropic) elige los momentos más virales y escribe los textos; usa tu propia clave de Claude, que pones en la app.</p></details>
      <details><summary>¿Necesito saber editar videos?<span class="pm"></span></summary><p>No. Pegas el enlace y ClipViral corta, pone los subtítulos y arma el clip vertical. Si quieres, cambias la duración, el formato y el estilo de los subtítulos.</p></details>
      <details><summary>¿Mis videos se suben a algún lado?<span class="pm"></span></summary><p>No. ClipViral baja el directo, lo corta y crea los clips en tu propia PC. Tú decides dónde publicarlos.</p></details>
      <details><summary>¿Cómo se actualiza?<span class="pm"></span></summary><p>Solo. Cuando hay una versión nueva, la app te avisa y se actualiza con un clic.</p></details>
    </div>
  </section>

  <section class="final rv">
    <div class="onda" aria-hidden="true">${onda}</div>
    <h2>Tu próximo directo ya tiene clips adentro</h2>
    <p>Descarga ClipViral, pega el enlace y deja que encuentre los momentos por ti.</p>
    <div class="cta"><a class="btn red" href="${d ? '/descargar' : '#descargar'}">${ic('bajar', 'baja')} Descargar para Windows</a><a class="btn" href="/comprar">Comprar un plan</a></div>
  </section>
</main>`, { scripts: `<script>(${scriptDemo})();</script>` });
}

function comprar(req) {
  const plans = webPlans();
  const elegido = plans.find((p) => p.id === req.query.plan)?.id || plans.find((p) => p.usesAi)?.id || plans[0]?.id;
  const pagos = paymentsEnabled();
  return layout('Comprar ClipViral', `
<main class="wrap">
  <div class="buy-head">
    <h1>Comprar ClipViral</h1>
    <p>Elige tu plan y págalo con tarjeta. Se activa en tu cuenta al momento.</p>
    <ol class="pasos" aria-label="Pasos"><li class="paso ok" data-p="1">Elige tu plan</li><li class="paso on" data-p="2">Tu cuenta</li><li class="paso" data-p="3">Paga con tarjeta</li></ol>
  </div>
  <section class="buy">
    <div>
      <p class="buy-t">Tu plan</p>
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
        <h3 style="margin:0 0 14px">Tu cuenta de ClipViral</h3>
        <div class="tabs"><button type="button" class="on" data-t="crear">Crear cuenta</button><button type="button" data-t="entrar">Ya tengo cuenta</button></div>
        <form id="acceso">
          <label class="f" data-solo="crear">Tu nombre<input name="name" autocomplete="name" maxlength="60"></label>
          <label class="f">Correo<input name="email" type="email" autocomplete="email" required></label>
          <label class="f">Contraseña<input name="password" type="password" autocomplete="current-password" minlength="8" required></label>
          <label class="chk" data-solo="crear"><input type="checkbox" name="terms"> <span>Acepto los <a href="/terminos" target="_blank">términos</a> y la <a href="/privacidad" target="_blank">política de privacidad</a>.</span></label>
          <button class="btn red" style="width:100%;margin-top:18px" id="accBtn">Crear cuenta y seguir</button>
        </form>
      </div>
      <div id="listo" class="hidden">
        <div class="who"><span>Conectado como <b id="quien"></b></span><button class="btn small" id="salir" type="button">Cambiar</button></div>
        <div id="planActual" class="meta" style="margin-top:10px"></div>
        ${pagos ? `<button class="btn red" style="width:100%;margin-top:18px" id="pagar">${ic('tarjeta')} Pagar con tarjeta</button>
        <p class="seguro">${ic('candado')} Pago seguro con PayPal. No necesitas cuenta PayPal.</p>`
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
  const paso = (n) => document.querySelectorAll('.paso').forEach((p) => { const i = Number(p.dataset.p); p.classList.toggle('ok', i < n); p.classList.toggle('on', i === n); });
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
    paso(3);
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
    $('#listo').classList.add('hidden'); $('#cuenta').classList.remove('hidden'); setModo('entrar'); paso(2);
  });
  $('#pagar')?.addEventListener('click', async (e) => {
    const p = document.querySelector('input[name=plan]:checked');
    if (!p) return msg('Elige un plan.', 'bad');
    const b = e.currentTarget;
    b.disabled = true; msg('Abriendo la página de pago…');
    try {
      const r = await api('/pagos/crear', { plan: p.value, months: Number($('#meses').value) });
      location.href = r.url;
    } catch (err) { msg(err.message, 'bad'); b.disabled = false; }
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
