'use strict';
// Pantallas del kit: inicio (qué video y lista de lo que hay que tener listo), cuenta regresiva,
// panel de pasos mientras graba, armando el video, listo y error.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const ANTES = [
  'ClipViral abierto y con la sesión <b>cerrada</b> (Ajustes → Cerrar sesión), para que se vea cómo se entra.',
  'Pantallas en inglés encendidas: en ClipViral, <b>Redes → botón "English"</b> (o Ajustes → Pantallas en inglés).',
  'Facebook / Instagram <b>desconectados</b> en ClipViral, y la sesión de Facebook / Instagram <b>cerrada en el navegador</b>.',
  'Un clip <b>hecho con contenido tuyo</b>, de 3 a 90 segundos (Facebook no acepta Reels más largos).',
  'Nada privado en pantalla y las notificaciones en silencio (Windows: "No molestar"). Cierra lo que no uses.',
];

let S = null;
let tipo = 'facebook';

function draw() {
  const view = $('#view');
  const foot = $('#foot');
  $('#close').style.display = ['grabando', 'cuenta', 'armando'].includes(S.fase) ? 'none' : '';
  document.body.classList.toggle('panel', ['grabando', 'cuenta'].includes(S.fase));

  if (S.fase === 'inicio') {
    $('#title').textContent = 'ClipViral · Grabar video para Meta';
    view.innerHTML = `
      <h1>🎬 Video de demostración para Meta</h1>
      <p class="muted">Graba tu pantalla mientras haces cada paso. Un panel pequeño te dice qué hacer y <b>no sale en el video</b>.
        Al final, ClipViral arma el video con <b>subtítulos en inglés</b> que explican cada paso y qué permiso usa.</p>
      <h2>1. ¿Qué video vas a grabar?</h2>
      ${S.videos.map((v) => `<label class="opt"><input type="radio" name="tipo" value="${v.id}" ${v.id === tipo ? 'checked' : ''}>
        <span><b>${esc(v.nombre)}</b> · ${v.pasos} pasos<small>${v.permisos.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</small></span></label>`).join('')}
      <p class="tiny muted">Recomendado: un video de Facebook y otro de Instagram (cada uno con su inicio de sesión).</p>
      <h2>2. Antes de grabar</h2>
      ${ANTES.map((t, i) => `<label class="check"><input type="checkbox" data-antes="${i}"><span>${t}</span></label>`).join('')}
      <h2>3. Mientras grabas</h2>
      <ol class="tiny">
        <li>Haz lo que dice el panel. Las contraseñas las escribes tú.</li>
        <li>Al terminar cada paso toca <b>✓ Listo</b> o presiona <b>F9</b>. Si te adelantaste, <b>F8</b> vuelve atrás.</li>
        <li>No cortes: si algo sale mal, toca <b>Cancelar</b> y empieza de nuevo.</li>
      </ol>
      <p class="tiny muted">El video se guarda en: <span class="path">${esc(S.carpeta)}</span></p>`;
    foot.innerHTML = `${S.ffmpeg ? '<span class="tiny ok">✅ FFmpeg listo</span>' : '<span class="tiny bad">❌ Falta FFmpeg: abre ClipViral una vez</span>'}
      <span class="grow"></span><button id="folder">📂 Carpeta</button><button class="primary big" id="go" ${S.ffmpeg ? '' : 'disabled'}>● Empezar a grabar</button>`;
    document.querySelectorAll('[name=tipo]').forEach((r) => r.addEventListener('change', () => { tipo = r.value; }));
    const updateGo = () => {
      const all = [...document.querySelectorAll('[data-antes]')].every((c) => c.checked);
      $('#go').textContent = all ? '● Empezar a grabar' : '● Empezar igual';
    };
    document.querySelectorAll('[data-antes]').forEach((c) => c.addEventListener('change', updateGo));
    updateGo();
    $('#go').onclick = () => kit.do('empezar', tipo);
    $('#folder').onclick = () => kit.do('abrirCarpeta');
    return;
  }

  if (S.fase === 'cuenta') {
    $('#title').textContent = 'Empieza a grabar en…';
    view.innerHTML = `<div class="count">${S.cuenta || ''}</div><p class="muted tiny" style="text-align:center">Este panel no sale en el video. Puedes moverlo arrastrando la barra de arriba.</p>`;
    foot.innerHTML = '';
    return;
  }

  if (S.fase === 'grabando') {
    const p = S.pasos[S.paso] || {};
    const last = S.paso === S.pasos.length - 1;
    $('#title').innerHTML = `<span class="rec"><span class="dot"></span>GRABANDO ${clock(S.segundos)}</span>`;
    view.innerHTML = `<div class="step-n">Paso ${S.paso + 1} de ${S.pasos.length}${p.optional ? ' · opcional' : ''}</div>
      <div class="todo">${esc(p.es)}</div>
      ${p.perm ? `<div>${String(p.perm).split(', ').map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="en">Subtítulo: ${esc(p.en)}</div>`;
    foot.innerHTML = `<button id="back" ${S.paso ? '' : 'disabled'} title="F8">◀ Atrás</button>
      ${p.optional ? '<button id="skip" title="Este paso no sale en el video">Saltar</button>' : ''}
      <button id="cancel" class="x" title="Cancelar y empezar de nuevo" style="font-size:13px">Cancelar</button>
      <span class="grow"></span>
      <button class="primary big" id="next" title="F9">${last ? '■ Terminar' : '✓ Listo'}${S.atajos ? ' · F9' : ''}</button>`;
    $('#next').onclick = () => kit.do('listo');
    $('#back').onclick = () => kit.do('atras');
    if ($('#skip')) $('#skip').onclick = () => kit.do('saltar');
    // Cancelar pide un segundo toque (el panel no puede abrir ventanas de confirmación mientras graba).
    $('#cancel').onclick = (e) => {
      const b = e.currentTarget;
      if (b.dataset.sure) return kit.do('cancelar');
      b.dataset.sure = '1';
      b.textContent = '¿Borrar lo grabado? Toca otra vez';
      b.style.color = '#fca5a5';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Cancelar'; b.style.color = ''; } }, 3500);
    };
    return;
  }

  if (S.fase === 'armando') {
    $('#title').textContent = 'Armando el video…';
    view.innerHTML = `<h1>⏳ Armando el video con subtítulos</h1>
      <p class="muted">No cierres esta ventana. Tarda más o menos lo mismo que duró la grabación.</p>
      <div class="progress"><span style="width:${Math.round((S.progreso || 0) * 100)}%"></span></div>
      <p class="tiny muted">${Math.round((S.progreso || 0) * 100)}%</p>`;
    foot.innerHTML = '';
    return;
  }

  if (S.fase === 'listo') {
    $('#title').textContent = 'ClipViral · Video listo';
    view.innerHTML = `<h1>✅ ¡Video listo!</h1>
      <p>Duración: <b>${clock(S.duracion || 0)}</b> · Tamaño: <b>${S.mb} MB</b></p>
      <p class="path">${esc(S.salida)}</p>
      <h2>Ahora</h2>
      <ol class="tiny">
        <li><b>Míralo completo</b> antes de subirlo: que se lean los subtítulos y se vea cada paso.</li>
        <li>En Meta: <b>Revisión de la app → Solicitudes → cada permiso → "Subir screencast"</b>. Sube este mismo video en cada permiso que aparece en sus subtítulos.</li>
        <li>Junto al video quedaron los subtítulos (.srt) y una lista de qué paso va en qué minuto (pasos.txt).</li>
      </ol>
      ${S.mb > 100 ? '<p class="tiny bad">Pesa bastante: si Meta no lo acepta, graba de nuevo con menos pasos o cierra programas que se muevan en pantalla.</p>' : ''}`;
    foot.innerHTML = `<button id="again">Grabar otro</button><span class="grow"></span><button id="folder">📂 Abrir carpeta</button><button class="primary" id="play">▶ Ver el video</button>`;
    $('#again').onclick = () => kit.do('otro');
    $('#folder').onclick = () => kit.do('abrirCarpeta');
    $('#play').onclick = () => kit.do('verVideo');
    return;
  }

  if (S.fase === 'error') {
    $('#title').textContent = 'ClipViral · Algo salió mal';
    view.innerHTML = `<h1>⚠️ No se pudo terminar</h1><div class="err">${esc(S.error)}</div>`;
    foot.innerHTML = '<span class="grow"></span><button id="folder">📂 Abrir carpeta</button><button class="primary" id="again">Volver al inicio</button>';
    $('#again').onclick = () => kit.do('otro');
    $('#folder').onclick = () => kit.do('abrirCarpeta');
  }
}

$('#close').onclick = () => kit.do('cerrar');
kit.onUpdate((s) => { const repaint = !S || s.fase !== S.fase || s.paso !== S.paso || s.fase !== 'grabando'; S = s; if (repaint) draw(); else if (S.fase === 'grabando') $('#title').innerHTML = `<span class="rec"><span class="dot"></span>GRABANDO ${clock(S.segundos)}</span>`; });
kit.state().then((s) => { S = s; draw(); });
