// Genera el proyecto de VideoLab del video promocional de la versión para clientes.
// (Versión anterior, la de fondo oscuro. Usa guion.json y voz/ de la carpeta promo.)
// Uso: node proyecto-videolab.js [horizontal|vertical]
// - Lee guion.json (textos) y voz/frases.json (duraciones de la voz del Sintetizador).
// - Une las frases de cada escena en un .wav y lo deja donde VideoLab lo reutiliza
//   (datos/voz/<proyecto>/<escena>-<huella>.wav), así el render usa ESTA voz y no Piper.
// - Guarda el proyecto con la misma función que usa la herramienta proyecto_guardar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VL = 'C:/Users/abels/OneDrive/Desktop/programacion/Herramientas Streaming/TikStar LiveHelper/Video Lab';
const proyectos = require(path.join(VL, 'nucleo/proyectos.js'));
const R = require(path.join(VL, 'nucleo/rutas.js'));

const FORMATO = process.argv[2] === 'vertical' ? 'vertical' : 'horizontal';
const V = FORMATO === 'vertical';
const ID = V ? 'promo-clipviral-clientes-vertical' : 'promo-clipviral-clientes';
const AQUI = path.join(__dirname, '..'); // guion.json y voz/ están en promo/
const guion = JSON.parse(fs.readFileSync(path.join(AQUI, 'guion.json'), 'utf8'));
const frasesVoz = fs.existsSync(path.join(AQUI, 'voz/frases.json')) ? JSON.parse(fs.readFileSync(path.join(AQUI, 'voz/frases.json'), 'utf8')) : {};

// ---------------------------------------------------------------- ritmo
const ANTES = 0.25, DESPUES = 0.45, HUECO = 0.18, TEMPO = 1.06; // TEMPO: la voz va un 6 % más rápida (mismo tono)
const W = V ? 1080 : 1920, H = V ? 1920 : 1080;

function tiempos(idEscena) {
  const esc = guion.escenas.find((e) => e.id === idEscena);
  const s = [], e = [], d = [];
  let t = ANTES;
  esc.frases.forEach((f, i) => {
    const dur = (frasesVoz[`${idEscena}_${i}`]?.dur ?? Math.max(1.5, f.voz.length / 15)) / TEMPO;
    s.push(t); d.push(dur); t += dur; e.push(t);
    if (i < esc.frases.length - 1) t += HUECO;
  });
  const voz = t - ANTES;
  return { s, e, d, voz, dur: ANTES + voz + DESPUES + (esc.pausa || 0), subs: esc.frases.map((f) => f.sub), frases: esc.frases };
}
// momento dentro de la frase i (0-1)
const en = (T, i, f) => T.s[i] + T.d[i] * f;

// ---------------------------------------------------------------- estilo
const GRAD = { tipo: 'lineal', angulo: 100, colores: ['#a855f7', '#ec4899', '#fb923c'] };
const AZUL = '#38bdf8', NARANJA = '#ff8a4c', VERDE = '#34d399', WA = '#25D366', TXT2 = '#a5b4cf';
const FONDO = { tipo: 'rejilla', base: '#05060f', color: 'rgba(129,140,248,0.07)', tam: 70, vel: 6 };
const CAP = { w: 1604, h: 1030 };

let n = 0;
const uid = (p) => `${p}${++n}`;

function brillo(x, y, r, color, extra = {}) {
  return { id: uid('brillo'), tipo: 'forma', forma: 'elipse', w: r, h: r, x, y, relleno: { tipo: 'radial', colores: [color, 'rgba(0,0,0,0)'] }, mod: { escala: { oscilar: { frec: 0.35, amp: 0.06, semilla: n } } }, ...extra };
}
function sonido(archivo, desde, volumen = 0.5) { return { id: uid('snd'), tipo: 'sonido', archivo: `sonidos/${archivo}.mp3`, desde, volumen }; }

function subtitulos(T, desdeIdx = 0) {
  const capas = [];
  T.subs.forEach((txt, i) => {
    if (i < desdeIdx) return;
    const ultimo = i === T.subs.length - 1;
    capas.push({
      id: `sub${i}`, tipo: 'texto', texto: txt, fuente: 'texto', tam: V ? 42 : 40, peso: 700, color: '#ffffff', interlineado: 1.25,
      y: V ? 500 : 442, ancho: V ? 940 : 1560, fijo: true,
      fondo: { color: 'rgba(6,8,22,0.86)', relleno: '0.32em 0.8em', radio: 20 },
      desde: Math.max(0, T.s[i] - 0.08), hasta: ultimo ? T.e[i] + DESPUES * 0.85 : T.e[i] + HUECO,
      entrada: { tipo: 'subir', dur: 0.22, dist: 16 },
    });
  });
  return capas;
}

// pixel (px, py) de una captura colocada en {x, y, w} → coordenadas del video
function enCap(img, px, py) { const k = img.w / CAP.w; return [img.x + (px - CAP.w / 2) * k, img.y + (py - CAP.h / 2) * k]; }
// lo mismo, pero relativo al centro de la captura (para capas hijas con padre = captura)
function rel(img, px, py) { const k = img.w / CAP.w; return [(px - CAP.w / 2) * k, (py - CAP.h / 2) * k]; }
function captura(id, archivo, img, extra = {}) {
  return { id, tipo: 'imagen', archivo, x: img.x, y: img.y, w: img.w, h: Math.round(img.w * CAP.h / CAP.w), radio: 18,
    borde: { grosor: 2, color: 'rgba(255,255,255,0.14)' }, efectos: [{ tipo: 'sombra', x: 0, y: 30, px: 60, color: 'rgba(0,0,0,0.65)' }], ...extra };
}
// Recorta una zona de una captura y la pone centrada en (X, Y) con escala k
function zona(id, archivo, x0, y0, x1, y1, X, Y, k, extra = {}) {
  const w = CAP.w * k, h = CAP.h * k;
  const cx = ((x0 + x1) / 2 - CAP.w / 2) * k, cy = ((y0 + y1) / 2 - CAP.h / 2) * k;
  return { id, tipo: 'imagen', archivo, w, h, x: X - cx, y: Y - cy,
    recorte: [y0 / CAP.h * 100, (CAP.w - x1) / CAP.w * 100, (CAP.h - y1) / CAP.h * 100, x0 / CAP.w * 100], ...extra };
}
function resalte(x, y, w, h, desde, color = '#ec4899', extra = {}) {
  return { id: uid('res'), tipo: 'forma', forma: 'rect', x, y, w, h, radio: 14, relleno: 'rgba(0,0,0,0)', trazo: color, grosor: 4,
    efectos: [{ tipo: 'neon', color, px: 14, fuerza: 1.4 }], desde, entrada: { tipo: 'pop', dur: 0.35 }, mod: { opacidad: { oscilar: { frec: 2, amp: 0.15 } } }, ...extra };
}
function cursor(puntos, desde, hasta, extra = {}) {
  // puntos: [[t, x, y], ...]
  return { id: uid('cur'), tipo: 'forma', forma: 'ruta', d: 'M2 2 L19 45 L26 26 L45 19 Z', w: 48, h: 48, relleno: '#ffffff', trazo: '#0b0d18', grosor: 3, union: 'round', ancla: [4, 4], desde, hasta,
    x: puntos.map(([t, x]) => [t, x, 'suave']), y: puntos.map(([t, , y]) => [t, y, 'suave']),
    efectos: [{ tipo: 'sombra', x: 0, y: 6, px: 10, color: 'rgba(0,0,0,0.6)' }], entrada: 'fundido', ...extra };
}
function clic(x, y, t, color = '#ffffff') {
  return [
    { id: uid('onda'), tipo: 'forma', forma: 'elipse', x, y, w: 70, h: 70, relleno: 'rgba(0,0,0,0)', trazo: color, grosor: 4, desde: t, hasta: t + 0.5,
      escala: [[t, 0.3], [t + 0.5, 1.6, 'sale']], opacidad: [[t, 1], [t + 0.5, 0]] },
    sonido('clic', t, 0.7),
  ];
}
function pastilla(texto, x, y, desde, { color = '#ffffff', fondo = 'rgba(15,20,40,0.92)', tam = 32, entrada = 'pop', peso = 700, extra = {} } = {}) {
  return { id: uid('pil'), tipo: 'texto', texto, x, y, tam, peso, color, fuente: 'texto', fondo: { color: fondo, relleno: '0.4em 0.9em', radio: 999 }, desde, entrada, ...extra };
}
function telefono(id, x, y, w, h, video, recorte, desde, extra = {}) {
  // marco + pantalla con el video (la pantalla es hija del marco)
  return [
    { id, tipo: 'forma', forma: 'rect', x, y, w, h, radio: w * 0.13, relleno: '#0b0d18', trazo: 'rgba(255,255,255,0.22)', grosor: 3,
      efectos: [{ tipo: 'sombra', x: 0, y: 30, px: 50, color: 'rgba(0,0,0,0.7)' }], desde, ...extra },
    { id: `${id}-v`, padre: id, tipo: 'video', archivo: video, inicio: recorte, volumen: 0, w: w - 22, h: h - 22, radio: w * 0.11, ajuste: 'cover', desde },
    { id: `${id}-n`, padre: id, tipo: 'forma', forma: 'rect', w: w * 0.3, h: 18, radio: 9, y: -h / 2 + 26, relleno: '#05060f', desde },
  ];
}

// ---------------------------------------------------------------- tarjetas de plan
function tarjetaPlan(p, desde, { item = [], precioT, entrada } = {}) {
  // p: { id, x, nombre, icono, color, precio, borde, rellenos }
  const cw = V ? 960 : 760, ch = V ? 560 : 660;
  const L = -cw / 2 + 50;
  const yPre = V ? 175 : 200, yLin = V ? 265 : 300, yIt = V ? 320 : 370, paso = V ? 58 : 72;
  const yTop = -ch / 2;
  const capas = [
    { id: p.id, tipo: 'forma', forma: 'rect', x: p.x, y: p.y, w: cw, h: ch, radio: 34, relleno: { tipo: 'lineal', angulo: 160, colores: p.rellenos },
      trazo: p.color, grosor: 3, efectos: [{ tipo: 'neon', color: p.color, px: 18, fuerza: 1 }], desde, entrada: entrada || 'pop' },
    { id: `${p.id}-ic`, padre: p.id, tipo: 'icono', icono: p.icono, tam: 62, color: p.color, x: L + 30, y: yTop + 80, desde },
    { id: `${p.id}-nom`, padre: p.id, tipo: 'texto', texto: `Plan ${p.nombre}`, fuente: 'titulo', tam: 58, peso: 800, color: '#ffffff', ancla: [0, 50], x: L + 80, y: yTop + 80, desde },
    { id: `${p.id}-pre`, padre: p.id, tipo: 'texto', texto: `$${p.precio}`, fuente: 'titulo', tam: 130, peso: 800, color: p.color, ancla: [0, 50], x: L, y: yTop + yPre, desde: precioT ?? desde, entrada: { tipo: 'pop', dur: 0.45 } },
    { id: `${p.id}-mes`, padre: p.id, tipo: 'texto', texto: 'al mes', fuente: 'texto', tam: 40, peso: 600, color: TXT2, ancla: [0, 50], x: L + 275, y: yTop + yPre + 22, desde: precioT ?? desde, entrada: { tipo: 'izquierda', dur: 0.4, retraso: 0.1 } },
    { id: `${p.id}-lin`, padre: p.id, tipo: 'forma', forma: 'rect', w: cw - 100, h: 2, relleno: 'rgba(255,255,255,0.12)', y: yTop + yLin, desde },
  ];
  item.forEach(([texto, t, icono = 'circle-check', color = VERDE], i) => {
    const y = yTop + yIt + i * paso;
    capas.push({ id: `${p.id}-i${i}i`, padre: p.id, tipo: 'icono', icono, tam: 40, color, x: L + 20, y, desde: t, entrada: { tipo: 'pop', dur: 0.35 } });
    capas.push({ id: `${p.id}-i${i}t`, padre: p.id, tipo: 'texto', texto, fuente: 'texto', tam: V ? 38 : 36, peso: 600, color: '#eef2ff', ancla: [0, 50], x: L + 60, y, desde: t, entrada: { tipo: 'izquierda', dur: 0.35, dist: 30 } });
    capas.push(sonido('pop', t, 0.35));
  });
  return capas;
}
function apagar(idCapa, x, y, w, h, desde, a = 0.6) {
  return { id: uid('apaga'), tipo: 'forma', forma: 'rect', x, y, w, h, radio: 34, relleno: `rgba(5,6,15,${a})`, desde, entrada: { tipo: 'fundido', dur: 0.4 } };
}

const LOCAL = { id: 'cLocal', nombre: 'Local', icono: 'cpu', color: AZUL, precio: 20, rellenos: ['#0f1d3a', '#080d1d'] };
const CLAUDE = { id: 'cClaude', nombre: 'Claude', icono: 'sparkles', color: NARANJA, precio: 30, rellenos: ['#2b1420', '#120b18'] };
const ITEMS_LOCAL = ['Todo funciona en tu PC', 'Chat, volumen e IA local', 'Sin límite de horas', 'No necesitas clave de Claude'];
const ITEMS_CLAUDE = ['Todo lo del plan Local', 'Claude lee todo el directo', 'Elige los momentos más virales', 'Con título y hashtags'];
const posPlanes = V ? { a: [0, -520], b: [0, 100] } : { a: [-410, -40], b: [410, -40] };

// ---------------------------------------------------------------- escenas
const escenas = [];
function escena(id, transicion, capas, extra = {}) {
  const T = tiempos(id);
  escenas.push({ id, plantilla: 'estudio', voz: T.subs.join(' '), transicion, pausa: guion.escenas.find((g) => g.id === id).pausa || 0, datos: { fondo: extra.fondo || FONDO, ...(extra.camara ? { camara: extra.camara } : {}), capas: capas.filter(Boolean) } });
}

// 1. Gancho
{
  const T = tiempos('gancho');
  const s1 = T.s[1];
  const marcas = (V ? [-380, -230, -75, 75, 230, 380] : [-560, -340, -110, 120, 340, 560]).map((x, i) => {
    const t0 = s1 + 0.15 + i * 0.1, t1 = s1 + 1 + i * 0.07;
    return { id: `fuego${i}`, tipo: 'icono', icono: '🔥', tam: 52, color: '#fb923c', x, y: V ? 360 : 250, desde: t0, entrada: { tipo: 'pop', dur: 0.3 },
      opacidad: [[t1, 1], [t1 + 0.6, 0.18]], efectos: [{ tipo: 'grises', v: [[t1, 0], [t1 + 0.6, 1]] }, { tipo: 'neon', color: '#fb923c', px: 10, fuerza: [[t1, 1], [t1 + 0.6, 0]] }] };
  });
  escena('gancho', 'ninguna', [
    { id: 'juego', tipo: 'video', archivo: 'videos/kill-2.mp4', w: W, h: H, inicio: 1.5, volumen: 0, ajuste: 'cover',
      efectos: [{ tipo: 'desenfoque', px: 4 }, { tipo: 'brillo', v: 0.45 }, { tipo: 'saturacion', v: 1.3 }], escala: [[0, 1.15], [6, 1.02, 'lineal']] },
    { id: 'vin', tipo: 'forma', forma: 'rect', w: W, h: H, relleno: { tipo: 'radial', colores: ['rgba(5,6,15,0.15)', 'rgba(5,6,15,0.92)'] } },
    pastilla('●  EN VIVO', V ? -330 : -770, V ? -760 : -440, 0.1, { fondo: '#e11d48', tam: 30, extra: { mod: { escala: { oscilar: { frec: 1.3, amp: 0.035 } } } } }),
    pastilla('⏱  3 h 12 min de directo', V ? 70 : -440, V ? -760 : -440, 0.25, { tam: 30, entrada: 'izquierda' }),
    { id: 't1', tipo: 'texto', texto: V ? '¿Haces directos\no subes videos\nlargos?' : '¿Haces directos\no subes videos largos?', fuente: 'titulo', tam: V ? 100 : 104, peso: 800, color: '#ffffff', y: V ? -120 : -40,
      desde: T.s[0] - 0.15, hasta: s1 - 0.05, animador: { por: 'palabras', efecto: 'subir', cada: 0.07, dur: 0.45 }, sombra: { x: 0, y: 8, px: 30, color: 'rgba(0,0,0,0.7)' }, salida: { tipo: 'desenfoque', dur: 0.2 } },
    { id: 't2', tipo: 'texto', texto: V ? 'Tus mejores\nmomentos se\nestán perdiendo…' : 'Tus mejores momentos\nse están perdiendo…', fuente: 'titulo', tam: V ? 100 : 104, peso: 800, color: GRAD, y: V ? -120 : -60,
      desde: s1 - 0.05, entrada: { tipo: 'desenfoque', dur: 0.35 }, efectos: [{ tipo: 'glitch', px: [[s1, 18], [s1 + 0.5, 0]] }] },
    { id: 'barra', tipo: 'forma', forma: 'rect', w: V ? 900 : 1320, h: 8, radio: 4, relleno: 'rgba(255,255,255,0.2)', y: V ? 360 : 250, desde: s1, entrada: { tipo: 'revelar', dur: 0.5 } },
    ...marcas,
    { id: 'cabezal', tipo: 'forma', forma: 'elipse', w: 22, h: 22, relleno: '#ffffff', y: V ? 360 : 250, desde: s1, x: [[s1, V ? -450 : -660], [T.dur, V ? 450 : 660, 'lineal']], efectos: [{ tipo: 'neon', color: '#ffffff', px: 12, fuerza: 1 }] },
    sonido('whoosh', s1 - 0.1, 0.55),
  ]);
}

// 2. Logo
{
  const T = tiempos('logo');
  escena('logo', 'destello', [
    brillo(0, -80, 1000, 'rgba(236,72,153,0.42)', { escala: [[0, 0.5], [0.8, 1, 'sale']] }),
    { id: 'rayos', tipo: 'forma', forma: 'sol', w: 900, h: 900, y: -120, relleno: 'rgba(255,255,255,0.035)', rot: [[0, 0], [5, 40, 'lineal']] },
    { id: 'icono', tipo: 'imagen', archivo: 'imagenes/clipviral-icono.png', w: 220, h: 220, radio: 50, y: -150, desde: 0.1, entrada: { tipo: 'pop', dur: 0.65 },
      efectos: [{ tipo: 'sombra', x: 0, y: 18, px: 44, color: 'rgba(236,72,153,0.6)' }], mod: { rot: { oscilar: { frec: 0.5, amp: 3 } } } },
    { id: 'nombre', tipo: 'texto', texto: 'ClipViral', fuente: 'titulo', tam: V ? 150 : 150, peso: 800, color: GRAD, y: 50, animador: { por: 'letras', efecto: 'subir', cada: 0.045, dur: 0.5, retraso: 0.35 } },
    { id: 'lema', tipo: 'texto', texto: 'Directos y videos  →  clips virales', fuente: 'texto', tam: V ? 44 : 44, peso: 600, color: '#cbd5e1', y: 165, desde: 0.95, entrada: { tipo: 'subir', dur: 0.45 } },
    { id: 'chispas', tipo: 'particulas', estilo: 'chispas', origen: [0, -150], cantidad: 60, desde: 0.35, colores: ['#f472b6', '#fb923c', '#a855f7', '#ffffff'] },
    sonido('brillo', 0.25, 0.55),
    ...subtitulos(T),
  ], { fondo: { tipo: 'radial', colores: ['#1d1240', '#05060f'] } });
}

// 3. Qué es: pegas el enlace → mejores momentos, subtítulos, vertical
{
  const T = tiempos('quees');
  const s1 = T.s[1];
  const img = V ? { x: 0, y: -560, w: 1000 } : { x: -330, y: -95, w: 1020 };
  const [ux, uy] = rel(img, 951, 229), k = img.w / CAP.w;
  const [px, py] = enCap(img, 1470, 228);
  const tel = V ? { x: 0, y: 215, w: 250, h: 444 } : { x: 600, y: -40, w: 390, h: 694 };
  const chips = V
    ? [['✨  Mejores momentos', -225, -200], ['💬  Subtítulos animados', 225, -200], ['📱  Formato vertical', 0, -128]]
    : [['✨  Mejores momentos', -690, 300], ['💬  Subtítulos animados', -290, 300], ['📱  Formato vertical', 90, 300]];
  const tChips = [en(T, 1, 0.12), en(T, 1, 0.42), en(T, 1, 0.78)];
  escena('quees', 'deslizar', [
    brillo(-400, -100, 1000, 'rgba(56,189,248,0.22)'),
    brillo(600, 0, 800, 'rgba(236,72,153,0.25)'),
    captura('cap', 'capturas/cv-directo-local.png', img, { entrada: { tipo: 'subir', dur: 0.6 } }),
    resalte(ux, uy, 1180 * k, 90 * k, T.s[0] + 0.35, '#ec4899', { padre: 'cap' }),
    cursor([[0, px + 260, py + 260], [T.s[0] + 1.0, px, py], [s1 + 0.5, px + 40, py + 50]], 0.2, s1 + 0.6),
    ...clic(px, py, T.s[0] + 1.05),
    ...telefono('tel', tel.x, tel.y, tel.w, tel.h, 'videos/kill-4-doble.mp4', 5, s1 - 0.25, { entrada: { tipo: 'derecha', dur: 0.55 } }),
    { id: 'tel-badge', padre: 'tel', tipo: 'texto', texto: '9:16', tam: 28, peso: 800, color: '#ffffff', y: -tel.h / 2 - 40, fondo: { color: '#ec4899', relleno: '0.25em 0.7em', radio: 999 }, desde: s1 + 0.2, entrada: 'pop' },
    { id: 'tel-s1', padre: 'tel', tipo: 'texto', texto: '¡DOBLE', fuente: 'titulo', tam: 62, peso: 900, color: '#ffffff', contorno: { color: '#000', grosor: 7 }, y: tel.h * 0.18, desde: tChips[1], hasta: tChips[1] + 0.8, entrada: { tipo: 'pop', dur: 0.25 } },
    { id: 'tel-s2', padre: 'tel', tipo: 'texto', texto: 'BAJA! 🔥', fuente: 'titulo', tam: 62, peso: 900, color: '#facc15', contorno: { color: '#000', grosor: 7 }, y: tel.h * 0.18, desde: tChips[1] + 0.8, entrada: { tipo: 'pop', dur: 0.25 } },
    !V && { id: 'flecha', tipo: 'forma', forma: 'ruta', d: V ? 'M0 -40 Q 40 20 0 80' : 'M0 0 Q 70 -60 150 0', x: V ? 0 : 290, y: V ? -110 : -40, relleno: 'none', trazo: '#ec4899', grosor: 6, cap: 'round', dibujar: { desde: s1 - 0.2, dur: 0.5 }, w: 160, h: 120 },
    ...chips.map(([texto, x, y], i) => pastilla(texto, x, y, tChips[i], { tam: V ? 34 : 30, fondo: 'rgba(12,16,34,0.95)', extra: { borde: { grosor: 2, color: 'rgba(236,72,153,0.6)' } } })),
    sonido('whoosh', s1 - 0.25, 0.45),
    ...tChips.map((t) => sonido('pop', t, 0.4)),
    ...subtitulos(T),
  ]);
}

// 4. Listos para TikTok, Reels y Shorts — y se guardan en tu PC
{
  const T = tiempos('listos');
  const s1 = T.s[1];
  const redes = [['TikTok', '#111827', '#22d3ee', 'videos/kill-1.mp4', 2], ['Reels', '#c026d3', '#ffffff', 'videos/cod-2.mp4', 1.5], ['Shorts', '#ef4444', '#ffffff', 'videos/kill-3.mp4', 7.5]];
  const tRed = [en(T, 0, 0.42), en(T, 0, 0.66), en(T, 0, 0.86)];
  const pw = V ? 290 : 280, ph = Math.round(pw * 16 / 9);
  const xs = V ? [-330, 0, 330] : [-380, 0, 380];
  const yT = V ? -260 : -60;
  const capas = [brillo(0, -60, 1200, 'rgba(168,85,247,0.25)')];
  redes.forEach(([nombre, fondo, color, video, rc], i) => {
    const id = `ph${i}`;
    const tIn = 0.15 + i * 0.12, tOut = s1 + 0.1 + i * 0.08;
    capas.push(...telefono(id, xs[i], yT, pw, ph, video, rc, tIn, {
      entrada: { tipo: 'subir', dur: 0.5 }, x: [[tOut, xs[i]], [tOut + 0.55, 0, 'entra']], y: [[tOut, yT], [tOut + 0.55, V ? 120 : 60, 'entra']],
      escala: [[tOut, 1], [tOut + 0.55, 0.15, 'entra']], hasta: tOut + 0.56,
    }));
    capas.push(pastilla(nombre, xs[i], yT - ph / 2 - 50, tRed[i], { fondo, color, tam: 38, peso: 800, extra: { hasta: tOut, borde: { grosor: 2, color: 'rgba(255,255,255,0.25)' } } }));
    capas.push(sonido('pop', tRed[i], 0.45));
  });
  capas.push(
    { id: 'pc', tipo: 'icono', icono: '💻', tam: V ? 300 : 280, y: V ? 40 : -20, desde: s1 + 0.35, entrada: { tipo: 'pop', dur: 0.5 } },
    { id: 'carpeta', tipo: 'icono', icono: '📁', tam: 120, x: V ? 120 : 130, y: V ? -60 : -90, desde: s1 + 0.6, entrada: { tipo: 'pop', dur: 0.45 }, rot: 8 },
    pastilla('📁  Carpeta de clips · en tu PC', 0, V ? 290 : 225, s1 + 0.85, { tam: 36, extra: { borde: { grosor: 2, color: 'rgba(250,204,21,0.6)' } } }),
    sonido('whoosh', s1 + 0.1, 0.45), sonido('ding', s1 + 0.6, 0.45),
    ...subtitulos(T),
  );
  escena('listos', 'zoom', capas);
}

// 5. Dos planes
{
  const T = tiempos('planes');
  const [ax, ay] = V ? [0, -330] : [-420, -40];
  const [bx, by] = V ? [0, 250] : [420, -40];
  escena('planes', 'glitch', [
    brillo(ax, ay, 900, 'rgba(56,189,248,0.3)'), brillo(bx, by, 900, 'rgba(255,138,76,0.3)'),
    { id: 'tit', tipo: 'texto', texto: 'Dos planes', fuente: 'titulo', tam: 80, peso: 800, color: '#ffffff', y: V ? -700 : -330, animador: { por: 'letras', efecto: 'subir', cada: 0.04, dur: 0.4 } },
    { id: 'pa', tipo: 'texto', texto: '💻  Local', fuente: 'titulo', tam: 96, peso: 800, color: '#ffffff', x: ax, y: ay, fondo: { color: 'rgba(56,189,248,0.18)', relleno: '0.3em 0.7em', radio: 30 }, borde: undefined, desde: 0.2, entrada: { tipo: V ? 'bajar' : 'izquierda', dur: 0.5, dist: 400 } },
    { id: 'pb', tipo: 'texto', texto: '✨  Claude', fuente: 'titulo', tam: 96, peso: 800, color: '#ffffff', x: bx, y: by, fondo: { color: 'rgba(255,138,76,0.2)', relleno: '0.3em 0.7em', radio: 30 }, desde: 0.35, entrada: { tipo: V ? 'subir' : 'derecha', dur: 0.5, dist: 400 } },
    { id: 'pa$', tipo: 'texto', texto: '$20 al mes', fuente: 'texto', tam: 44, peso: 700, color: AZUL, x: ax, y: ay + 120, desde: 0.6, entrada: 'subir' },
    { id: 'pb$', tipo: 'texto', texto: '$30 al mes', fuente: 'texto', tam: 44, peso: 700, color: NARANJA, x: bx, y: by + 120, desde: 0.75, entrada: 'subir' },
    { id: 'vs', tipo: 'texto', texto: 'VS', fuente: 'titulo', tam: 90, peso: 900, color: GRAD, y: V ? -40 : -40, desde: 0.75, entrada: { tipo: 'zoom', dur: 0.4 }, mod: { escala: { oscilar: { frec: 1.5, amp: 0.05 } } } },
    sonido('whoosh', 0.15, 0.5), sonido('impacto', 0.75, 0.45),
    ...subtitulos(T),
  ]);
}

// 6. Plan Local
{
  const T = tiempos('local');
  const tPrecio = en(T, 0, 0.45);
  const items = [[ITEMS_LOCAL[0], en(T, 1, 0.05)], [ITEMS_LOCAL[1], en(T, 1, 0.45)], [ITEMS_LOCAL[2], en(T, 2, 0.0)], [ITEMS_LOCAL[3], en(T, 2, 0.45)]];
  const cw = V ? 960 : 760, ch = V ? 560 : 660;
  escena('local', 'cortina', [
    brillo(posPlanes.a[0], posPlanes.a[1], 1100, 'rgba(56,189,248,0.25)'),
    ...tarjetaPlan({ ...LOCAL, x: posPlanes.a[0], y: posPlanes.a[1] }, 0.1, { item: items, precioT: tPrecio, entrada: { tipo: V ? 'bajar' : 'izquierda', dur: 0.5 } }),
    ...tarjetaPlan({ ...CLAUDE, x: posPlanes.b[0], y: posPlanes.b[1] }, 0.2, { entrada: { tipo: V ? 'subir' : 'derecha', dur: 0.5 } }),
    apagar('cClaude', posPlanes.b[0], posPlanes.b[1], cw + 8, ch + 8, 0.2, 0.68),
    sonido('ding', tPrecio, 0.5),
    ...subtitulos(T),
  ]);
}

// 7. Plan Claude
{
  const T = tiempos('claude');
  const tPrecio = en(T, 0, 0.5);
  const itemsL = ITEMS_LOCAL.map((t) => [t, 0]);
  const items = [[ITEMS_CLAUDE[0], en(T, 1, 0.1), 'layers', NARANJA], [ITEMS_CLAUDE[1], en(T, 2, 0.0), 'sparkles', NARANJA], [ITEMS_CLAUDE[2], en(T, 2, 0.4), 'trending-up', NARANJA], [ITEMS_CLAUDE[3], en(T, 2, 0.75), 'file-text', NARANJA]];
  const cw = V ? 960 : 760, ch = V ? 560 : 660;
  const [mx, my] = V ? [-400, -210] : [0, -40];
  escena('claude', 'ninguna', [
    brillo(posPlanes.b[0], posPlanes.b[1], 1100, 'rgba(255,138,76,0.25)', { desde: 0.2, entrada: 'fundido' }),
    ...tarjetaPlan({ ...LOCAL, x: posPlanes.a[0], y: posPlanes.a[1] }, 0, { item: itemsL }).filter((c) => c.tipo !== 'sonido'),
    apagar('cLocal', posPlanes.a[0], posPlanes.a[1], cw + 8, ch + 8, 0.15, 0.55),
    ...tarjetaPlan({ ...CLAUDE, x: posPlanes.b[0], y: posPlanes.b[1] }, 0, { item: items, precioT: tPrecio }),
    { id: 'mas', tipo: 'texto', texto: '+', fuente: 'titulo', tam: 90, peso: 900, color: '#ffffff', x: mx, y: my, fondo: { color: NARANJA, relleno: '0 0.32em', radio: 999 }, desde: en(T, 1, 0.1), entrada: { tipo: 'zoom', dur: 0.4 } },
    { id: 'badge', tipo: 'texto', texto: '★  Todo lo del Local + Claude', fuente: 'texto', tam: 30, peso: 800, color: '#1a0d06', x: posPlanes.b[0], y: posPlanes.b[1] - ch / 2, fondo: { color: NARANJA, relleno: '0.35em 0.9em', radio: 999 }, desde: en(T, 1, 0.3), entrada: 'pop' },
    sonido('ding', tPrecio, 0.5), sonido('impacto', en(T, 1, 0.1), 0.35),
    ...subtitulos(T),
  ]);
}

// 8. Tu propia clave de Claude (Ajustes)
{
  const T = tiempos('clave');
  // Vertical: solo la tarjeta "Clave de Claude", recortada y grande. Horizontal: la pantalla entera y la cámara se acerca.
  const zV = V ? zona('aj', 'capturas/cv-ajustes.png', 345, 190, 1195, 425, 0, -430, 1.25, { radio: 22, entrada: { tipo: 'zoom', dur: 0.5 } }) : null;
  const img = V ? { x: zV.x, y: zV.y, w: CAP.w * 1.25 } : { x: 0, y: 20, w: 1500 };
  const [cx, cy] = enCap(img, 951, 301); // tarjeta "Clave de Claude"
  const z = 1.42;
  const [ix, iy] = rel(img, 400, 347), k = img.w / CAP.w;
  const [bx, by] = enCap(img, 1461, 347);
  const tTec = T.s[0] + 0.9, tFin = tTec + 1.0;
  const [lx, ly] = rel(img, 766, 251);
  const [tx, ty] = rel(img, V ? 782 : 873, 347);
  escena('clave', 'desenfoque', [
    V ? zV : captura('aj', 'capturas/cv-ajustes.png', img, { entrada: { tipo: 'zoom', dur: 0.5 } }),
    !V && { id: 'sombraAbajo', tipo: 'forma', forma: 'rect', w: W, h: 520, y: 280, fijo: true, desde: 0.9, entrada: { tipo: 'fundido', dur: 0.6 },
      relleno: { tipo: 'lineal', angulo: 180, colores: ['rgba(5,6,15,0)', 'rgba(5,6,15,0.92)', 'rgba(5,6,15,0.98)'] } },
    { id: 'tapa', padre: 'aj', tipo: 'forma', forma: 'rect', x: tx, y: ty, w: (V ? 815 : 990) * k, h: 44 * k, radio: 8 * k, relleno: '#050815', desde: tTec },
    { id: 'clave', padre: 'aj', tipo: 'texto', texto: V ? 'sk-ant-••••••••••••••••••••' : 'sk-ant-••••••••••••••••••••••••', fuente: 'texto', tam: 19 * k / 0.935, peso: 600, color: '#e2e8f0', ancla: [0, 50], x: ix, y: iy,
      desde: tTec, animador: { por: 'letras', efecto: 'escribir', cada: 0.03 } },
    { id: 'marca', padre: 'aj', tipo: 'forma', forma: 'rect', x: lx, y: ly, w: 800 * k, h: 26 * k, radio: 6, relleno: 'rgba(250,204,21,0.28)', ancla: [50, 50],
      desde: T.s[1], escala: [[T.s[1], [0, 1]], [T.s[1] + 0.6, [1, 1], 'sale']] },
    !V && cursor([[0.2, bx + 200, by + 220], [tFin, bx, by], [T.s[1] + 0.3, bx + 60, by + 80]], 0.3, T.s[1] + 0.4, { fijo: false }),
    ...(V ? [] : clic(bx, by, tFin + 0.05)),
    V && { id: 'llave', tipo: 'icono', icono: '🔑', tam: 150, y: 0, desde: T.s[0] + 0.4, entrada: { tipo: 'pop', dur: 0.45 }, mod: { rot: { oscilar: { frec: 0.8, amp: 6 } } } },
    pastilla('🔑  Tu clave · tu cuenta de Claude', 0, V ? 200 : 330, T.s[1] + 0.15, { tam: 38, extra: { fijo: true, borde: { grosor: 2, color: 'rgba(255,138,76,0.7)' } } }),
    ...subtitulos(T),
  ], { camara: V ? undefined : { x: [[0, 0], [0.6, 0], [1.6, cx * z, 'suave']], y: [[0, 0], [0.6, 0], [1.6, cy * z, 'suave']], zoom: [[0, 1], [0.6, 1], [1.6, z, 'suave']] } });
}

// 9. Resumen: quién elige los clips
{
  const T = tiempos('resumen');
  const s1 = T.s[1];
  const kZ = V ? 0.86 : 1.28;
  const yZ = V ? -690 : -285;
  const colX = V ? [-250, 250] : [-420, 420];
  const colY = V ? -120 : 90;
  const col = (i, p, quien, detalle, t) => {
    const id = `col${i}`;
    return [
      { id, tipo: 'forma', forma: 'rect', x: colX[i], y: colY, w: V ? 470 : 700, h: V ? 560 : 400, radio: 30, relleno: { tipo: 'lineal', angulo: 160, colores: p.rellenos }, trazo: p.color, grosor: 3,
        efectos: [{ tipo: 'neon', color: p.color, px: 16, fuerza: 1 }], desde: 0.25 + i * 0.15, entrada: { tipo: 'subir', dur: 0.45 } },
      { id: `${id}-p`, padre: id, tipo: 'texto', texto: `Plan ${p.nombre} · $${p.precio}`, fuente: 'texto', tam: V ? 34 : 34, peso: 700, color: TXT2, y: V ? -220 : -140, desde: 0.25 + i * 0.15 },
      { id: `${id}-ic`, padre: id, tipo: 'icono', icono: p.icono, tam: V ? 100 : 90, color: p.color, y: V ? -110 : -50, desde: t, entrada: { tipo: 'pop', dur: 0.4 } },
      { id: `${id}-q`, padre: id, tipo: 'texto', texto: quien, fuente: 'titulo', tam: V ? 66 : 72, peso: 800, color: '#ffffff', y: V ? 20 : 45, desde: t, entrada: { tipo: 'subir', dur: 0.4 } },
      { id: `${id}-d`, padre: id, tipo: 'texto', texto: detalle, fuente: 'texto', tam: V ? 30 : 30, peso: 600, color: TXT2, y: V ? 150 : 125, ancho: V ? 420 : 620, interlineado: 1.3, desde: t + 0.2, entrada: 'fundido' },
    ];
  };
  escena('resumen', 'barrido', [
    { id: 'pregunta', tipo: 'texto', texto: '¿Quién elige los mejores momentos?', fuente: 'titulo', tam: V ? 56 : 56, peso: 800, color: '#ffffff', y: V ? -870 : -472, ancho: V ? 960 : undefined, animador: { por: 'palabras', efecto: 'subir', cada: 0.05, dur: 0.4 } },
    zona('modoL', 'capturas/cv-directo-local.png', 342, 311, 1561, 482, 0, yZ, kZ, { radio: 18, desde: 0, hasta: s1, entrada: 'fundido' }),
    zona('modoC', 'capturas/cv-directo-claude.png', 342, 311, 1561, 482, 0, yZ, kZ, { radio: 18, desde: s1, entrada: { tipo: 'fundido', dur: 0.2 } }),
    ...col(0, LOCAL, 'Tu PC', 'IA local: chat, volumen y lo que pasa en el video', en(T, 0, 0.55)),
    ...col(1, CLAUDE, 'Claude', 'Lee todo el directo · título y hashtags', s1 + 0.1),
  ].concat([
    { id: 'apagaC', tipo: 'forma', forma: 'rect', x: colX[1], y: colY, w: V ? 476 : 706, h: V ? 566 : 406, radio: 30, relleno: 'rgba(5,6,15,0.6)', desde: 0.4, hasta: s1 + 0.05, salida: { tipo: 'fundido', dur: 0.25 } },
    { id: 'apagaL', tipo: 'forma', forma: 'rect', x: colX[0], y: colY, w: V ? 476 : 706, h: V ? 566 : 406, radio: 30, relleno: 'rgba(5,6,15,0.55)', desde: s1 + 0.05, entrada: { tipo: 'fundido', dur: 0.3 } },
    sonido('pop', en(T, 0, 0.55), 0.45), sonido('pop', s1 + 0.1, 0.45),
    ...subtitulos(T),
  ]));
}

// 10. Clips guardados + Piloto que sugiere
{
  const T = tiempos('piloto');
  const s1 = T.s[1];
  const vids = [['videos/cod-1.mp4', 1], ['videos/kill-3.mp4', 7.5], ['videos/kill-1.mp4', 1.5]];
  const xs = V ? [-330, 0, 330] : [-420, 0, 420];
  const pw = V ? 290 : 310, ph = Math.round(pw * 16 / 9);
  const yC = V ? -350 : -45;
  const capas = [brillo(0, 0, 1200, 'rgba(52,211,153,0.16)')];
  vids.forEach(([v, rc], i) => {
    const id = `clip${i}`;
    capas.push(...telefono(id, xs[i], yC, pw, ph, v, rc, 0.15 + i * 0.15, { entrada: { tipo: 'subir', dur: 0.45 }, hasta: s1 + 0.05, salida: { tipo: 'bajar', dur: 0.3 } }));
    capas.push({ id: `${id}-ok`, padre: id, tipo: 'texto', texto: '✓ Listo para subir', fuente: 'texto', tam: 26, peso: 800, color: '#052e1c', y: ph / 2 - 50, fondo: { color: VERDE, relleno: '0.3em 0.75em', radio: 999 }, desde: en(T, 0, 0.45) + i * 0.15, entrada: 'pop' });
    capas.push(sonido('pop', en(T, 0, 0.45) + i * 0.15, 0.35));
  });
  const img = V ? { x: 0, y: -330, w: 1040 } : { x: -150, y: -40, w: 1300 };
  capas.push(
    captura('pil', 'capturas/cv-piloto.png', img, { desde: s1, entrada: { tipo: 'zoom-fuera', dur: 0.5 }, escala: [[s1, 1], [T.dur, 1.04, 'lineal']] }),
    resalte(...rel(img, 795, 140), 920 * img.w / CAP.w, 60 * img.w / CAP.w, s1 + 0.6, VERDE, { padre: 'pil' }),
    { id: 'aviso', tipo: 'grupo', x: V ? 0 : 560, y: V ? 330 : -150, desde: en(T, 1, 0.3), entrada: { tipo: 'derecha', dur: 0.45 } },
    { id: 'aviso-f', padre: 'aviso', tipo: 'forma', forma: 'rect', w: 520, h: 190, radio: 26, relleno: 'rgba(12,18,36,0.97)', trazo: VERDE, grosor: 2, efectos: [{ tipo: 'sombra', x: 0, y: 20, px: 40, color: 'rgba(0,0,0,0.6)' }], desde: en(T, 1, 0.3) },
    { id: 'aviso-t', padre: 'aviso', tipo: 'texto', texto: '🎯  Nuevo clip sugerido', fuente: 'texto', tam: 34, peso: 800, color: '#ffffff', ancla: [0, 50], x: -225, y: -45, desde: en(T, 1, 0.3) },
    { id: 'aviso-d', padre: 'aviso', tipo: 'texto', texto: 'Con la hora, el texto y los\nhashtags listos para copiar', fuente: 'texto', tam: 27, peso: 500, color: TXT2, alinear: 'izquierda', ancla: [0, 50], x: -225, y: 30, interlineado: 1.3, desde: en(T, 1, 0.3) },
    pastilla('✋  Tú decides qué publicar', V ? 0 : 560, V ? 120 : 110, en(T, 1, 0.72), { fondo: VERDE, color: '#052e1c', tam: 40, peso: 800 }),
    sonido('whoosh', s1 - 0.05, 0.45), sonido('ding', en(T, 1, 0.3), 0.45), sonido('pop', en(T, 1, 0.72), 0.5),
    ...subtitulos(T),
  );
  escena('piloto', 'deslizar-arriba', capas);
}

// 11. Activación
{
  const T = tiempos('activar');
  const s1 = T.s[1], s2 = T.s[2];
  const img = V ? { x: 0, y: -420, w: 1060 } : { x: 0, y: -50, w: 1400 };
  const k = img.w / CAP.w;
  const [cx, cy] = enCap(img, 1346, 347);   // botón Copiar código
  const [ax, ay] = enCap(img, 1201, 715);   // botón Activar
  const t1 = en(T, 1, 0.05), t2 = en(T, 1, 0.42), t3 = en(T, 1, 0.75);
  const pasos = [[481, t1], [525, t2], [578, t3]];
  const capas = [
    captura('act', 'capturas/cv-activar.png', img, { entrada: { tipo: 'zoom', dur: 0.5 } }),
    { id: 'act2', tipo: 'imagen', archivo: 'capturas/cv-activar-clave.png', x: img.x, y: img.y, w: img.w, h: Math.round(img.w * CAP.h / CAP.w), radio: 18, desde: t3 + 0.15, entrada: { tipo: 'fundido', dur: 0.25 } },
    resalte(...rel(img, 1201, 346), 470 * k, 92 * k, t1, '#ec4899', { padre: 'act', hasta: t2 }),
    ...pasos.map(([py, t], i) => ({ id: `paso${i}`, padre: 'act', tipo: 'forma', forma: 'rect', x: rel(img, 380, py)[0], y: rel(img, 380, py)[1], w: 690 * k, h: 46 * k, radio: 10, relleno: 'rgba(236,72,153,0.16)', trazo: '#ec4899', grosor: 2, desde: t, hasta: i < 2 ? pasos[i + 1][1] : s2, entrada: 'fundido' })),
    cursor([[t1 - 0.6, cx + 200, cy + 200], [t1 + 0.2, cx, cy], [t3 + 0.1, ax + 60, ay + 40], [t3 + 0.6, ax, ay]], t1 - 0.6, s2),
    ...clic(cx, cy, t1 + 0.25),
    pastilla('📋  Código copiado', V ? 0 : 400, V ? 30 : -330, t1 + 0.3, { tam: 30, extra: { hasta: t2 + 0.3 } }),
    { id: 'wa', tipo: 'grupo', x: V ? 0 : -470, y: V ? 160 : 290, desde: t2, hasta: s2, entrada: { tipo: 'subir', dur: 0.4 } },
    { id: 'wa-f', padre: 'wa', tipo: 'forma', forma: 'rect', w: 600, h: 130, radio: 24, relleno: '#0b3d2c', trazo: WA, grosor: 2, desde: t2, efectos: [{ tipo: 'sombra', x: 0, y: 16, px: 30, color: 'rgba(0,0,0,0.6)' }] },
    { id: 'wa-i', padre: 'wa', tipo: 'icono', icono: 'message-circle', tam: 56, color: WA, x: -240, desde: t2 },
    { id: 'wa-t', padre: 'wa', tipo: 'texto', texto: 'Tu clave para esta PC 🔑\n•••••-•••••-•••••-•••••…', fuente: 'texto', tam: 28, peso: 700, color: '#e8fff3', alinear: 'izquierda', ancla: [0, 50], x: -195, interlineado: 1.35, desde: t2 },
    ...clic(ax, ay, t3 + 0.65),
    { id: 'confeti', tipo: 'particulas', estilo: 'confeti', origen: [ax, ay], cantidad: 80, desde: t3 + 0.7 },
    pastilla('✓  Activado', ax, ay - 110 * k * 1.6, t3 + 0.7, { fondo: VERDE, color: '#052e1c', tam: 40, peso: 800, extra: { hasta: s2 } }),
    sonido('ding', t3 + 0.7, 0.5), sonido('whoosh', t2, 0.35),
    // 30 días que se suman
    { id: 'velo', tipo: 'forma', forma: 'rect', w: W, h: H, relleno: 'rgba(5,6,15,0.72)', desde: s2 - 0.1, entrada: { tipo: 'fundido', dur: 0.3 } },
    { id: 'cal', tipo: 'icono', icono: 'calendar', tam: 150, color: '#ffffff', x: V ? 0 : -380, y: V ? -520 : -90, desde: s2, entrada: { tipo: 'pop', dur: 0.4 } },
    { id: 'd30', tipo: 'texto', texto: '30 días', fuente: 'titulo', tam: 130, peso: 800, color: '#ffffff', ancla: [V ? 50 : 0, 50], x: V ? 0 : -260, y: V ? -330 : -110, desde: s2 + 0.1, hasta: en(T, 2, 0.6), entrada: { tipo: 'subir', dur: 0.4 } },
    { id: 'd60', tipo: 'texto', texto: '60 días', fuente: 'titulo', tam: 130, peso: 800, color: GRAD, ancla: [V ? 50 : 0, 50], x: V ? 0 : -260, y: V ? -330 : -110, desde: en(T, 2, 0.6), entrada: { tipo: 'zoom', dur: 0.35 } },
    pastilla('por cada clave', V ? 0 : -60, V ? -190 : 20, s2 + 0.3, { tam: 34, extra: { hasta: en(T, 2, 0.6) } }),
    pastilla('+30  ·  Renuevas y los días se suman', V ? 0 : 20, V ? -190 : 20, en(T, 2, 0.6), { fondo: 'rgba(52,211,153,0.18)', color: VERDE, tam: 34, peso: 800, extra: { borde: { grosor: 2, color: VERDE } } }),
    sonido('pop', s2 + 0.1, 0.4), sonido('ding', en(T, 2, 0.6), 0.5),
    ...subtitulos(T),
  ];
  escena('activar', 'circulo', capas);
}

// 12. Cierre: WhatsApp + Soporte
{
  const T = tiempos('cierre');
  const s1 = T.s[1];
  const yS = V ? 260 : 255;
  escena('cierre', 'destello', [
    brillo(0, -120, 1300, 'rgba(37,211,102,0.2)'),
    brillo(0, 300, 900, 'rgba(236,72,153,0.2)'),
    { id: 'logo', tipo: 'imagen', archivo: 'imagenes/clipviral-icono.png', w: 96, h: 96, radio: 24, x: V ? -150 : -150, y: V ? -700 : -410, desde: 0.05, entrada: 'pop' },
    { id: 'logot', tipo: 'texto', texto: 'ClipViral', fuente: 'titulo', tam: 64, peso: 800, color: GRAD, ancla: [0, 50], x: V ? -85 : -85, y: V ? -700 : -410, desde: 0.1, entrada: 'izquierda' },
    { id: 'boton', tipo: 'grupo', y: V ? -420 : -215, desde: 0.2, entrada: { tipo: 'pop', dur: 0.5 }, mod: { escala: { oscilar: { frec: 1.2, amp: 0.025 } } } },
    { id: 'boton-f', padre: 'boton', tipo: 'forma', forma: 'rect', w: V ? 920 : 960, h: 140, radio: 70, relleno: WA, efectos: [{ tipo: 'neon', color: WA, px: 26, fuerza: 1.2 }], desde: 0.2 },
    { id: 'boton-i', padre: 'boton', tipo: 'icono', icono: 'message-circle', tam: 72, color: '#ffffff', x: V ? -360 : -370, desde: 0.2 },
    { id: 'boton-t', padre: 'boton', tipo: 'texto', texto: 'Compra por WhatsApp', fuente: 'titulo', tam: V ? 64 : 66, peso: 800, color: '#ffffff', x: 40, desde: 0.2 },
    { id: 'tel', tipo: 'texto', texto: '+1 849 815 3785', fuente: 'titulo', tam: V ? 112 : 120, peso: 800, color: '#ffffff', y: V ? -220 : -40, animador: { por: 'letras', efecto: 'pop', cada: 0.05, dur: 0.35, retraso: en(T, 0, 0.35) } },
    pastilla('💻  Local · $20 al mes', V ? 0 : -270, V ? -60 : 100, en(T, 0, 0.7), { tam: 34, color: AZUL, extra: { borde: { grosor: 2, color: AZUL } } }),
    pastilla('✨  Claude · $30 al mes', V ? 0 : 270, V ? 30 : 100, en(T, 0, 0.8), { tam: 34, color: NARANJA, extra: { borde: { grosor: 2, color: NARANJA } } }),
    zona('soporte', 'capturas/cv-licencia.png', 14, 832, 295, 887, V ? 0 : -80, yS, 1.6, { desde: s1 + 0.05, entrada: { tipo: 'pop', dur: 0.4 }, radio: 0 }),
    { id: 'anillo', tipo: 'forma', forma: 'rect', x: V ? 0 : -80, y: yS, w: 281 * 1.6 + 24, h: 55 * 1.6 + 24, radio: 30, relleno: 'rgba(0,0,0,0)', trazo: '#ec4899', grosor: 4,
      desde: s1 + 0.4, efectos: [{ tipo: 'neon', color: '#ec4899', px: 16, fuerza: 1.3 }], mod: { escala: { oscilar: { frec: 1.6, amp: 0.04 } } }, entrada: 'pop' },
    { id: 'soporte-t', tipo: 'texto', texto: 'dentro de la app', fuente: 'texto', tam: 34, peso: 600, color: TXT2, ancla: [V ? 50 : 0, 50], x: V ? 0 : 190, y: V ? yS + 110 : yS, desde: s1 + 0.6, entrada: 'izquierda' },
    sonido('impacto', 0.2, 0.4), sonido('pop', s1 + 0.05, 0.45),
    ...subtitulos(T),
    { id: 'negro', tipo: 'forma', forma: 'rect', w: W, h: H, relleno: '#000000', desde: T.dur - 0.7, opacidad: [[T.dur - 0.7, 0], [T.dur, 1]], fijo: true },
  ], { fondo: { tipo: 'radial', colores: ['#0d1a2a', '#05060f'] } });
}

// ---------------------------------------------------------------- voz del Sintetizador → VideoLab
const ffmpeg = R.FFMPEG;
const velocidad = 1;
const generado = { voces: {} };
for (const e of escenas) {
  const esc = guion.escenas.find((g) => g.id === e.id);
  const wavs = esc.frases.map((_, i) => path.join(AQUI, 'voz', `${e.id}_${i}.wav`));
  if (!wavs.every((w) => fs.existsSync(w))) { console.log('Falta voz de', e.id); continue; }
  const huella = crypto.createHash('sha1').update(`${e.voz}|${velocidad}`).digest('hex').slice(0, 8);
  const rel = `voz/${ID}/${e.id}-${huella}.wav`;
  const abs = R.medio(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const T = tiempos(e.id);
  {
    const entradas = wavs.flatMap((w) => ['-i', w]);
    const partes = wavs.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,atempo=${TEMPO}${i < wavs.length - 1 ? `,apad=pad_dur=${HUECO}` : ''}[a${i}]`).join(';');
    const filtro = `${partes};${wavs.map((_, i) => `[a${i}]`).join('')}concat=n=${wavs.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5[o]`;
    execFileSync(ffmpeg, ['-loglevel', 'error', '-y', ...entradas, '-filter_complex', filtro, '-map', '[o]', '-ar', '48000', '-t', String(T.voz), abs]);
  }
  generado.voces[e.id] = { archivo: rel, dur: Number(T.voz.toFixed(3)), texto: e.voz };
}

const proyecto = {
  id: ID, nombre: V ? 'ClipViral · versión para clientes (vertical)' : 'ClipViral · versión para clientes',
  formato: FORMATO, fps: 30, ritmo: { antes: ANTES, despues: DESPUES }, voz: { velocidad },
  musica: { archivo: 'musica/energia.mp3', volumen: 0.11, volumenSinVoz: 0.32 },
  marca: {
    nombre: 'ClipViral', partes: ['Clip', 'Viral'],
    colores: { a: '#a855f7', b: '#ec4899', c: '#fb923c', fondo: '#05060f', capa: '#0d1226', texto: '#f3f4ff', texto2: TXT2, tinta: '#05060f', exito: VERDE },
    fuentes: { titulo: { familia: 'Space Grotesk', archivo: 'fuentes/space-grotesk.woff2' }, texto: { familia: 'Inter', archivo: 'fuentes/inter.woff2' } },
    simbolo: { imagen: 'imagenes/clipviral-icono.png' },
  },
  escenas,
  generado,
};
const r = proyectos.guardar(proyecto);
const total = escenas.reduce((s, e) => s + tiempos(e.id).dur, 0);
console.log(`Guardado ${ID}: ${escenas.length} escenas, ~${total.toFixed(1)} s`);
if (r.avisos.length) console.log('Avisos:', r.avisos);
