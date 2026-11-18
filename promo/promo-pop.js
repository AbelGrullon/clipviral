// Video promocional de ClipViral (versión para clientes) · estilo "pop" (papel, stickers, bordes gruesos)
// Uso: node promo-pop.js [horizontal|vertical]
// - Textos: guion.json · Voz: voz/<escena>_<n>.wav (hecha con el Sintetizador, ver LEEME.md)
// - Clips: los que sacó la app (Videos\ClipViral), importados en VideoLab como originales/cv-clip-*.mp4
// - Subtítulos sincronizados palabra a palabra con Whisper (se guarda en voz/palabras.json)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const VL = 'C:/Users/abels/OneDrive/Desktop/programacion/Herramientas Streaming/TikStar LiveHelper/Video Lab';
const proyectos = require(path.join(VL, 'nucleo/proyectos.js'));
const R = require(path.join(VL, 'nucleo/rutas.js'));

const FORMATO = process.argv[2] === 'vertical' ? 'vertical' : 'horizontal';
const V = FORMATO === 'vertical';
const ID = V ? 'promo-clipviral-pop-vertical' : 'promo-clipviral-pop';
const AQUI = __dirname;
const guion = JSON.parse(fs.readFileSync(path.join(AQUI, 'guion.json'), 'utf8'));
const frasesVoz = JSON.parse(fs.readFileSync(path.join(AQUI, 'voz/frases.json'), 'utf8'));
const P = (h, v) => (V ? v : h);

// ---------------------------------------------------------------- ritmo
const ANTES = 0.25, DESPUES = 0.4, HUECO = 0.18, TEMPO = 1.06;
const PAUSAS = { quees: 2.45, cierre: 0.9 };
const W = V ? 1080 : 1920, H = V ? 1920 : 1080;

function tiempos(id) {
  const esc = guion.escenas.find((e) => e.id === id);
  const s = [], e = [], d = [];
  let t = ANTES;
  esc.frases.forEach((f, i) => {
    const dur = frasesVoz[`${id}_${i}`].dur / TEMPO;
    s.push(t); d.push(dur); t += dur; e.push(t);
    if (i < esc.frases.length - 1) t += HUECO;
  });
  const voz = t - ANTES;
  return { id, s, e, d, voz, dur: ANTES + voz + DESPUES + (PAUSAS[id] || 0), subs: esc.frases.map((f) => f.sub) };
}
const en = (T, i, f) => T.s[i] + T.d[i] * f;

// ---------------------------------------------------------------- Whisper: cuándo dice cada palabra
const WB = 'C:/Users/abels/AppData/Roaming/ClipViral/bin';
const archPalabras = path.join(AQUI, 'voz/palabras.json');
const palabras = fs.existsSync(archPalabras) ? JSON.parse(fs.readFileSync(archPalabras, 'utf8')) : {};
function palabrasDe(clave) {
  const wav = path.join(AQUI, 'voz', `${clave}.wav`);
  const huella = crypto.createHash('sha1').update(fs.readFileSync(wav)).digest('hex').slice(0, 10);
  if (palabras[clave]?.huella === huella) return palabras[clave].p;
  const tmp = path.join(os.tmpdir(), `cvpop-${clave}`);
  execFileSync(R.FFMPEG, ['-loglevel', 'error', '-y', '-i', wav, '-ar', '16000', '-ac', '1', `${tmp}.wav`]);
  execFileSync(`${WB}/whisper/whisper-cli.exe`, ['-m', `${WB}/models/ggml-small-q5_1.bin`, '-l', 'es', '-ml', '1', '-sow', '-oj', '-of', tmp, '-np', `${tmp}.wav`], { stdio: 'ignore' });
  const j = JSON.parse(fs.readFileSync(`${tmp}.json`, 'utf8'));
  const p = j.transcription.map((x) => ({ t: x.offsets.from / 1000, w: x.text.trim() })).filter((x) => x.w);
  palabras[clave] = { huella, p };
  fs.writeFileSync(archPalabras, JSON.stringify(palabras, null, 1));
  return p;
}
// momento (en segundos de la escena) en que se llega a la fracción fr del texto de la frase i
function momento(T, i, fr) {
  const p = palabrasDe(`${T.id}_${i}`);
  const largo = p.reduce((n, x) => n + x.w.length, 0) || 1;
  let acc = 0;
  const puntos = p.map((x) => { const r = [acc / largo, x.t]; acc += x.w.length; return r; });
  puntos.push([1, frasesVoz[`${T.id}_${i}`].dur]);
  let t = puntos[0][1];
  for (let k = 0; k < puntos.length - 1; k++) {
    const [f0, t0] = puntos[k], [f1, t1] = puntos[k + 1];
    if (fr >= f0 && fr <= f1) { t = t0 + (t1 - t0) * (f1 > f0 ? (fr - f0) / (f1 - f0) : 0); break; }
    if (fr > f1) t = t1;
  }
  return T.s[i] + t / TEMPO;
}
// momento en que empieza la palabra `trozo` dentro del subtítulo de la frase i
function cuando(T, i, trozo) {
  const sub = T.subs[i];
  const k = sub.toLowerCase().indexOf(trozo.toLowerCase());
  if (k < 0) throw new Error(`No encuentro "${trozo}" en "${sub}"`);
  return momento(T, i, k / sub.length);
}

// ---------------------------------------------------------------- estilo
const PAPEL = '#f4eee3', TINTA = '#0b0b0f', ROJO = '#e5161d', AZUL = '#3a6cff', NARANJA = '#ff7a1a', AMAR = '#ffd23f',
  VERDE = '#16c172', WA = '#25D366', BLANCO = '#ffffff', ROSA = '#ff4fa3', CIAN = '#2ee6d6';
const F = 'Bahnschrift';
const DURO = (d = 10, color = TINTA) => ({ tipo: 'sombra', x: d, y: d, px: 0, color });
let n = 0;
const uid = (p) => `${p}${++n}`;

function sonido(archivo, desde, volumen = 0.5) { return { id: uid('snd'), tipo: 'sonido', archivo: `sonidos/${archivo}.mp3`, desde, volumen }; }
function papel(extra = {}) {
  let d = '';
  for (let x = 0; x <= W; x += 60) d += `M${x} 0V${H}`;
  for (let y = 0; y <= H; y += 60) d += `M0 ${y}H${W}`;
  return [
    { id: 'papel', tipo: 'forma', forma: 'rect', w: W, h: H, relleno: PAPEL, efectos: [{ tipo: 'grano', v: 0.2 }], fijo: true, ...extra },
    { id: 'rejilla', tipo: 'forma', forma: 'ruta', d, w: W, h: H, relleno: 'none', trazo: 'rgba(11,11,15,0.065)', grosor: 2, fijo: true },
  ];
}
function texto(id, txt, x, y, tam, o = {}) {
  return { id, tipo: 'texto', texto: txt, x, y, tam, fuente: F, peso: 700, color: TINTA, interlineado: 1.0, ...o };
}
function sticker(id, txt, x, y, o = {}) {
  const { tam = 46, color = TINTA, fondo = AMAR, rot = 0, borde = 5, sombra = 8, entrada = { tipo: 'zoom-fuera', dur: 0.3 }, ...resto } = o;
  return { id, tipo: 'texto', texto: txt, x, y, tam, fuente: F, peso: 700, color, interlineado: 1.05, rot,
    fondo: { color: fondo, relleno: '0.14em 0.42em', radio: 0 }, borde: { grosor: borde, color: TINTA }, efectos: [DURO(sombra)], entrada, ...resto };
}
function caja(id, x, y, w, h, relleno, o = {}) {
  const { radio = 16, grosor = 6, sombra = 12, ...resto } = o;
  return { id, tipo: 'forma', forma: 'rect', x, y, w, h, radio, relleno, trazo: TINTA, grosor, efectos: [DURO(sombra)], ...resto };
}
function telefono(id, x, y, w, h, archivo, inicio, o = {}) {
  const { desde = 0, ...resto } = o;
  return [
    { id, tipo: 'forma', forma: 'rect', x, y, w, h, radio: w * 0.12, relleno: TINTA, efectos: [DURO(12)], desde, ...resto },
    { id: `${id}-v`, padre: id, tipo: 'video', archivo, inicio, volumen: 0, w: w - 20, h: h - 20, radio: w * 0.1, ajuste: 'cover', desde },
    { id: `${id}-n`, padre: id, tipo: 'forma', forma: 'rect', w: w * 0.28, h: 14, radio: 7, y: -h / 2 + 22, relleno: TINTA, desde },
  ];
}
function check(id, x, y, desde, o = {}) {
  const { padre, color = VERDE, tam = 46 } = o;
  return [
    { id, padre, tipo: 'forma', forma: 'elipse', x, y, w: tam, h: tam, relleno: BLANCO, trazo: TINTA, grosor: 4, desde, entrada: { tipo: 'pop', dur: 0.3 } },
    { id: `${id}-c`, padre: id, tipo: 'forma', forma: 'ruta', d: `M${tam * 0.24} ${tam * 0.52} L${tam * 0.43} ${tam * 0.7} L${tam * 0.78} ${tam * 0.3}`, w: tam, h: tam,
      relleno: 'none', trazo: color, grosor: 7, desde, dibujar: { desde: desde + 0.1, dur: 0.3 } },
  ];
}
// garabatos hechos a mano (se dibujan solos)
function circulo(id, x, y, w, h, desde, o = {}) {
  const d = `M${w * 0.06} ${h * 0.45} C ${w * 0.08} ${h * 0.02}, ${w * 0.86} ${-h * 0.04}, ${w * 0.95} ${h * 0.4} C ${w * 1.02} ${h * 0.82}, ${w * 0.62} ${h * 0.98}, ${w * 0.4} ${h * 0.94} C ${w * 0.12} ${h * 0.9}, ${-w * 0.02} ${h * 0.7}, ${w * 0.1} ${h * 0.3}`;
  return { id, tipo: 'forma', forma: 'ruta', d, w, h, x, y, relleno: 'none', trazo: o.color || ROJO, grosor: o.grosor || 8, desde, dibujar: { desde, dur: o.dur || 0.5 }, ...o.extra };
}
function subrayado(id, x, y, w, desde, o = {}) {
  const h = 30;
  const d = `M0 ${h * 0.6} Q ${w * 0.25} ${h * 0.1}, ${w * 0.5} ${h * 0.55} T ${w} ${h * 0.35}`;
  return { id, tipo: 'forma', forma: 'ruta', d, w, h, x, y, relleno: 'none', trazo: o.color || ROJO, grosor: o.grosor || 9, desde, dibujar: { desde, dur: o.dur || 0.4 }, ...o.extra };
}
function flecha(id, x, y, w, h, desde, o = {}) {
  // curva de abajo-izquierda a arriba-derecha con punta; o.voltear la espeja en horizontal
  const d = `M${w * 0.04} ${h * 0.9} Q ${w * 0.15} ${h * 0.1}, ${w * 0.92} ${h * 0.14} M${w * 0.74} ${h * 0.02} L${w * 0.94} ${h * 0.14} L${w * 0.76} ${h * 0.32}`;
  return { id, tipo: 'forma', forma: 'ruta', d, w, h, x, y, relleno: 'none', trazo: o.color || TINTA, grosor: o.grosor || 8, desde, dibujar: { desde, dur: o.dur || 0.5 },
    escala: o.voltear ? [-1, 1] : 1, rot: o.rot || 0, ...o.extra };
}
// Barras de color que tapan (al final de una escena) o destapan (al empezar la siguiente)
function barras(modo, t0, colores) {
  const BW = V ? 760 : 900, pos = V ? [-480, 0, 480] : [-700, 0, 800], lejos = V ? 2100 : 2900;
  return colores.map((c, i) => {
    const t = t0 + i * 0.05;
    return { id: uid('barra'), tipo: 'forma', forma: 'rect', w: BW, h: Math.max(W, H) * 2.4, rot: 18, relleno: c, fijo: true,
      x: modo === 'tapa' ? [[t, pos[i] - lejos, 'sale'], [t + 0.3, pos[i]]] : [[0, pos[i]], [t, pos[i], 'entra'], [t + 0.3, pos[i] + lejos]],
      desde: modo === 'tapa' ? t : 0, hasta: modo === 'tapa' ? undefined : t + 0.32 };
  });
}
// Subtítulos del locutor: trozos cortos, palabra a palabra, como los que pone ClipViral
function subtitulos(T) {
  const capas = [];
  T.subs.forEach((sub, i) => {
    const palabrasSub = sub.split(/\s+/);
    const trozos = [];
    let actual = [];
    for (const w of palabrasSub) {
      const largo = [...actual, w].join(' ').length;
      if (actual.length && (largo > (V ? 20 : 26))) { trozos.push(actual); actual = []; }
      actual.push(w);
      if (/[.,:?!…]$/.test(w) && actual.join(' ').length >= 10) { trozos.push(actual); actual = []; }
    }
    if (actual.length) trozos.push(actual);
    let pos = 0;
    const inicios = trozos.map((tr) => { const k = sub.indexOf(tr[0], pos); pos = k + tr.join(' ').length; return k; });
    trozos.forEach((tr, j) => {
      const desde = j === 0 ? T.s[i] - 0.05 : momento(T, i, inicios[j] / sub.length) - 0.04;
      const ultimoDeFrase = j === trozos.length - 1;
      const hasta = ultimoDeFrase ? (i === T.subs.length - 1 ? Math.min(T.e[i] + 0.35, T.dur - 0.3) : T.s[i + 1] - 0.05) : momento(T, i, inicios[j + 1] / sub.length) - 0.04;
      capas.push({ id: `sub${i}-${j}`, tipo: 'texto', texto: tr.join(' '), x: 0, y: P(440, 520), tam: P(54, 60), fuente: F, peso: 700, color: BLANCO, mayusculas: true, fijo: true,
        fondo: { color: TINTA, relleno: '0.14em 0.45em', radio: 4 }, efectos: [DURO(7, ROJO)], desde, hasta,
        animador: { por: 'palabras', efecto: 'pop', cada: 0.06, dur: 0.22 } });
    });
  });
  return capas;
}
// cámara: sacudidas en los golpes
function sacudir(golpes, base = {}) {
  const x = [[0, 0]], y = [[0, 0]];
  golpes.sort((a, b) => a[0] - b[0]).forEach(([t, a = 14]) => {
    [[0.0, 0, 0], [0.035, a, -a * 0.6], [0.07, -a * 0.8, a * 0.7], [0.105, a * 0.5, -a * 0.4], [0.14, -a * 0.25, a * 0.2], [0.18, 0, 0]].forEach(([dt, dx, dy]) => { x.push([t + dt, dx]); y.push([t + dt, dy]); });
  });
  return { x, y, ...base };
}
// recorte de una captura (1604 × 1030): zona (x0,y0)-(x1,y1) centrada en (X, Y) con escala k
const CAP = { w: 1604, h: 1030 };
function zona(id, archivo, x0, y0, x1, y1, X, Y, k, extra = {}) {
  const w = CAP.w * k, h = CAP.h * k;
  const cx = ((x0 + x1) / 2 - CAP.w / 2) * k, cy = ((y0 + y1) / 2 - CAP.h / 2) * k;
  return { id, tipo: 'imagen', archivo, w, h, x: X - cx, y: Y - cy,
    recorte: [y0 / CAP.h * 100, (CAP.w - x1) / CAP.w * 100, (CAP.h - y1) / CAP.h * 100, x0 / CAP.w * 100], ...extra };
}
// posición (relativa al centro del recorte) de un píxel de la captura
const enZona = (x0, y0, x1, y1, k, px, py) => [(px - (x0 + x1) / 2) * k, (py - (y0 + y1) / 2) * k];
function cursor(puntos, desde, hasta, extra = {}) {
  return { id: uid('cur'), tipo: 'forma', forma: 'ruta', d: 'M2 2 L19 45 L26 26 L45 19 Z', w: 54, h: 54, relleno: BLANCO, trazo: TINTA, grosor: 4, union: 'round', ancla: [4, 4], desde, hasta,
    x: puntos.map(([t, x]) => [t, x, 'suave']), y: puntos.map(([t, , y]) => [t, y, 'suave']), efectos: [DURO(5)], entrada: 'fundido', ...extra };
}
function clic(x, y, t, extra = {}) {
  return [
    { id: uid('onda'), tipo: 'forma', forma: 'elipse', x, y, w: 80, h: 80, relleno: 'none', trazo: ROJO, grosor: 6, desde: t, hasta: t + 0.45,
      escala: [[t, 0.3, 'sale'], [t + 0.45, 1.7]], opacidad: [[t, 1], [t + 0.45, 0]], ...extra },
    sonido('clic', t, 0.7),
  ];
}
// tapa la barra de abajo de un "reproductor" (y los subtítulos del clip mientras es horizontal)
function barraReproductor(id, padre, w, h, desde, o = {}) {
  const alto = o.alto || 104;
  return [
    { id, padre, tipo: 'forma', forma: 'rect', y: h / 2 - alto / 2, w, h: alto, relleno: { tipo: 'lineal', angulo: 180, colores: ['rgba(11,11,15,0.55)', 'rgba(11,11,15,0.97)'] }, desde, ...o.extra },
    { id: `${id}-fondo`, padre: id, tipo: 'forma', forma: 'rect', x: 0, y: -4, w: w - 60, h: 10, radio: 5, relleno: 'rgba(255,255,255,0.3)', desde },
    { id: `${id}-prog`, padre: id, tipo: 'forma', forma: 'rect', ancla: [0, 50], x: -(w - 60) / 2, y: -4, w: [[desde, (w - 60) * 0.18], [desde + 6, (w - 60) * 0.32, 'lineal']], h: 10, radio: 5, relleno: ROJO, desde },
    { id: `${id}-vivo`, padre: id, tipo: 'texto', texto: '● EN VIVO', x: -(w - 60) / 2, y: 30, ancla: [0, 50], tam: 26, fuente: F, peso: 700, color: BLANCO, fondo: { color: ROJO, relleno: '0.08em 0.4em', radio: 4 }, desde },
    { id: `${id}-hora`, padre: id, tipo: 'texto', texto: '1:58:12 / 3:12:45', x: (w - 60) / 2, y: 30, ancla: [100, 50], tam: 26, fuente: F, peso: 600, color: BLANCO, desde },
  ];
}

const escenas = [];
function escena(id, capas, extra = {}) {
  const T = tiempos(id);
  escenas.push({ id, plantilla: 'estudio', voz: T.subs.join(' '), transicion: 'ninguna', pausa: PAUSAS[id] || 0,
    datos: { fondo: extra.fondo || PAPEL, ...(extra.camara ? { camara: extra.camara } : {}), capas: capas.flat(4).filter(Boolean) } });
}
const fin = (T) => T.dur - 0.34;

// ================================================================ 1. Gancho
{
  const T = tiempos('gancho');
  const t1 = T.s[1];
  const pw = P(1040, 960), ph = pw * 9 / 16, px = P(-390, 0), py = P(-40, -420);
  const marcas = [0.2, 0.36, 0.5, 0.68, 0.84].map((f, i) => {
    const mx = -(pw - 60) / 2 + (pw - 60) * f, tc = t1 + 0.75 + i * 0.12;
    return { id: `estrella${i}`, padre: 'player', tipo: 'icono', icono: '⭐', tam: P(54, 50), x: mx,
      y: [[tc, ph / 2 - 56, 'entra'], [tc + 0.7, ph / 2 + 420]], desde: t1 + 0.05 + i * 0.07, entrada: { tipo: 'pop', dur: 0.3 },
      rot: [[tc, 0, 'entra'], [tc + 0.7, 160 + i * 30]], opacidad: [[tc + 0.4, 1], [tc + 0.7, 0]] };
  });
  const tx = P(560, 0), ty = P(-170, 110);
  escena('gancho', [
    papel(),
    { id: 'player', tipo: 'forma', forma: 'rect', x: px, y: py, w: pw + 24, h: ph + 24, radio: 20, relleno: TINTA, efectos: [DURO(16)], rot: -2,
      entrada: { tipo: 'caer', dur: 0.45 } },
    { id: 'player-v', padre: 'player', tipo: 'video', archivo: 'originales/cv-clip-picante.mp4', inicio: 5, volumen: 0, w: pw, h: ph, radio: 12, ajuste: 'cover',
      efectos: [{ tipo: 'grises', v: [[t1 + 0.4, 0], [t1 + 1.2, 1]] }, { tipo: 'brillo', v: [[t1 + 0.4, 1], [t1 + 1.2, 0.7]] }] },
    barraReproductor('pbar', 'player', pw, ph, 0),
    ...marcas,
    texto('t1a', '¿HACES', tx, ty - P(130, 0), P(150, 130), { desde: T.s[0], hasta: t1 - 0.05, animador: { por: 'letras', efecto: 'caer', cada: 0.03, dur: 0.4 } }),
    texto('t1b', 'DIRECTOS?', tx, ty + P(10, 125), P(150, 130), { color: ROJO, desde: T.s[0] + 0.25, hasta: t1 - 0.05, animador: { por: 'letras', efecto: 'caer', cada: 0.03, dur: 0.4 } }),
    sticker('t1c', 'O VIDEOS LARGOS', tx + P(30, 0), ty + P(150, 265), { tam: P(56, 58), rot: -4, desde: cuando(T, 0, 'subes') - 0.1, hasta: t1 - 0.05 }),
    sonido('pop', cuando(T, 0, 'subes') - 0.1, 0.4),
    texto('t2a', 'TUS MEJORES\nMOMENTOS', tx, ty - P(60, -60), P(118, 110), { desde: t1 - 0.05, animador: { por: 'palabras', efecto: 'caer', cada: 0.09, dur: 0.4 } }),
    sticker('t2b', 'SE ESTÁN PERDIENDO', tx, ty + P(150, 265), { tam: P(58, 60), rot: 3, fondo: ROJO, color: BLANCO, desde: cuando(T, 1, 'se están') - 0.05,
      efectos: [DURO(8), { tipo: 'glitch', px: [[cuando(T, 1, 'se están'), 14], [cuando(T, 1, 'se están') + 0.5, 0]] }] }),
    sonido('impacto', cuando(T, 1, 'se están') - 0.05, 0.45),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [TINTA, ROJO, AMAR]),
    subtitulos(T),
  ], { camara: sacudir([[cuando(T, 1, 'se están'), 12]]) });
}

// ================================================================ 2. Logo
{
  const T = tiempos('logo');
  const tl = 0.3, tv = cuando(T, 0, 'clips virales');
  let rayos = '';
  const R0 = 1800;
  for (let i = 0; i < 18; i++) {
    const a0 = (i / 18) * Math.PI * 2, a1 = a0 + Math.PI / 18;
    rayos += `M${R0} ${R0} L${R0 + Math.cos(a0) * R0} ${R0 + Math.sin(a0) * R0} L${R0 + Math.cos(a1) * R0} ${R0 + Math.sin(a1) * R0} Z`;
  }
  const lw = P(260, 280);
  escena('logo', [
    { id: 'rayos', tipo: 'forma', forma: 'ruta', d: rayos, w: R0 * 2, h: R0 * 2, relleno: 'rgba(255,255,255,0.09)', rot: [[0, 0], [T.dur, 24, 'lineal']], fijo: true },
    barras('destapa', 0, [TINTA, ROJO, AMAR]),
    telefono('fA', P(-600, -300), P(40, 330), P(300, 300), P(533, 533), 'originales/cv-clip-leche.mp4', 14, { desde: tv - 0.35, rot: -10, entrada: { tipo: 'subir', dur: 0.45, ease: 'atras' } }),
    telefono('fB', P(600, 300), P(40, 330), P(300, 300), P(533, 533), 'originales/cv-clip-nariz.mp4', 11, { desde: tv - 0.2, rot: 10, entrada: { tipo: 'subir', dur: 0.45, ease: 'atras' } }),
    { id: 'icono', tipo: 'imagen', archivo: 'imagenes/clipviral-icono.png', w: lw, h: lw, y: P(-150, -330), radio: lw * 0.22, efectos: [DURO(14)],
      desde: tl, entrada: { tipo: 'zoom-fuera', dur: 0.35 }, mod: { rot: { oscilar: { frec: 1.2, amp: 2 } } } },
    texto('nombre', 'ClipViral', 0, P(70, -80), P(190, 170), { color: BLANCO, sombra: { x: 10, y: 10, px: 0, color: TINTA }, desde: tl + 0.25, animador: { por: 'letras', efecto: 'subir', cada: 0.035, dur: 0.35 } }),
    sticker('lema', '→ CLIPS VIRALES', 0, P(240, 80), { tam: P(64, 64), rot: -3, desde: tv - 0.05 }),
    { id: 'e1', tipo: 'icono', icono: '🔥', tam: 90, x: P(-330, -330), y: P(-300, -620), rot: -12, desde: tl + 0.5, entrada: { tipo: 'pop', dur: 0.35 }, mod: { rot: { oscilar: { frec: 2, amp: 6 } } } },
    { id: 'e2', tipo: 'icono', icono: '✂️', tam: 80, x: P(330, 330), y: P(-330, -600), rot: 14, desde: tl + 0.65, entrada: { tipo: 'pop', dur: 0.35 }, mod: { rot: { oscilar: { frec: 2, amp: 6, semilla: 3 } } } },
    { id: 'e3', tipo: 'icono', icono: '⚡', tam: 80, x: P(-780, -380), y: P(-380, -180), rot: 10, desde: tv, entrada: { tipo: 'pop', dur: 0.35 } },
    { id: 'chispas', tipo: 'particulas', estilo: 'explosion', desde: tl + 0.05, origen: [0, P(-150, -330)], cantidad: 40, colores: [AMAR, BLANCO, TINTA], semilla: 4 },
    sonido('impacto', tl, 0.55), sonido('brillo', tl + 0.25, 0.4), sonido('whoosh', tv - 0.35, 0.35), sonido('pop', tv - 0.05, 0.4),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [AMAR, TINTA, AZUL]),
    subtitulos(T),
  ], { fondo: ROJO, camara: sacudir([[tl + 0.05, 18]], { zoom: [[0, 1.12], [tl, 1.12, 'sale'], [tl + 0.3, 1]] }) });
}

// ================================================================ 3. Qué es (pegar enlace → mejores momentos → subtítulos → vertical → se oye el clip)
{
  const T = tiempos('quees');
  const t1 = T.s[1];
  // A) barra del enlace (captura real)
  // vertical: solo el campo del enlace, más grande para que se lea
  const kB = P(1.32, 1.55), bx0 = P(344, 380), by0 = 184, bx1 = P(1560, 980), by1 = 270;
  const bw = (bx1 - bx0) * kB, bh = (by1 - by0) * kB;
  const by = P(-150, -330);
  const [pgx, pgy] = enZona(bx0, by0, bx1, by1, kB, P(1470, 900), 228);
  const tPegar = cuando(T, 0, 'enlace') + 0.15;
  // B) reproductor → vertical
  const tMej = cuando(T, 1, 'encuentra'), tSub = cuando(T, 1, 'les pone'), tVert = cuando(T, 1, 'y los deja');
  const pw = P(980, 900), ph = pw * 9 / 16, vw = P(380, 520), vh = vw * 16 / 9;
  const cy = P(-60, -120);
  const tMorf = tVert + 0.05, tFinMorf = tMorf + 0.7;
  const tA = T.e[1] + 0.15; // empieza a sonar el clip
  const ini = 12.65 - (tA - t1); // segundo del clip al empezar el reproductor
  const sx = P(-665, 0), rx = P(180, 0); // notas a la izquierda, reproductor a la derecha
  const notas = [
    ['🎯 MEJORES MOMENTOS', tMej, AMAR],
    ['💬 SUBTÍTULOS ANIMADOS', tSub, BLANCO],
    ['📱 FORMATO VERTICAL', tVert, CIAN],
  ];
  const marcasMom = [0.22, 0.47, 0.71].map((f, i) => ({ id: `mom${i}`, padre: 'rep', tipo: 'icono', icono: '⭐', tam: 50, x: -(pw - 60) / 2 + (pw - 60) * f, y: ph / 2 - 60,
    desde: tMej + 0.25 + i * 0.22, hasta: tSub + 0.3, entrada: { tipo: 'pop', dur: 0.3 }, salida: { tipo: 'fundido', dur: 0.2 } }));
  escena('quees', [
    papel(),
    barras('destapa', 0, [AMAR, TINTA, AZUL]),
    // A
    sticker('paso1', '1 · PEGAS EL ENLACE', 0, by - P(150, 190), { tam: P(58, 56), rot: -2, desde: T.s[0], hasta: t1 - 0.05, salida: { tipo: 'subir', dur: 0.25 } }),
    caja('barra', 0, by, bw + 28, bh + 28, TINTA, { radio: 14, rot: -1.5, desde: 0.15, hasta: t1 - 0.05, entrada: { tipo: 'caer', dur: 0.45 }, salida: { tipo: 'subir', dur: 0.25 } }),
    zona('barraImg', 'capturas/cv-directo-local.png', bx0, by0, bx1, by1, 0, 0, kB, { padre: 'barra', desde: 0.15, hasta: t1 - 0.05 }),
    cursor([[0.4, pgx + 260, by + 260], [tPegar - 0.1, pgx, by + pgy], [t1, pgx + 40, by + pgy + 40]], 0.4, t1 - 0.05, { rot: -1.5 }),
    clic(pgx, by + pgy, tPegar),
    { id: 'brilloBarra', tipo: 'forma', forma: 'rect', y: by, w: bw + 50, h: bh + 50, radio: 18, relleno: 'none', trazo: ROJO, grosor: 7, rot: -1.5, desde: tPegar + 0.1, hasta: t1 - 0.05,
      escala: [[tPegar + 0.1, 0.96, 'sale'], [tPegar + 0.4, 1.02]], opacidad: [[tPegar + 0.1, 1], [tPegar + 0.9, 0.4]] },
    sticker('chipD', '🔴 TU DIRECTO', P(-230, -230), by + P(170, 170), { tam: 44, fondo: BLANCO, rot: -3, desde: cuando(T, 0, 'directo'), hasta: t1 - 0.05 }),
    sticker('chipV', '▶ TU VIDEO', P(230, 230), by + P(170, 170), { tam: 44, fondo: BLANCO, rot: 3, desde: cuando(T, 0, 'video') - 0.05, hasta: t1 - 0.05 }),
    sonido('pop', cuando(T, 0, 'directo'), 0.35), sonido('pop', cuando(T, 0, 'video') - 0.05, 0.35),
    // B
    { id: 'rep', tipo: 'forma', forma: 'rect', x: rx, y: cy, w: [[tMorf, pw + 24, 'atras'], [tFinMorf, vw + 24]], h: [[tMorf, ph + 24, 'atras'], [tFinMorf, vh + 24]],
      radio: [[tMorf, 20], [tFinMorf, vw * 0.12]], relleno: TINTA, efectos: [DURO(16)], rot: [[tMorf, 0, 'suave'], [tFinMorf - 0.2, -4, 'suave'], [tFinMorf + 0.2, 0]], desde: t1, entrada: { tipo: 'zoom', dur: 0.4 } },
    { id: 'rep-v', padre: 'rep', tipo: 'video', archivo: 'originales/cv-clip-masmelo.mp4', inicio: ini, volumen: 0, w: [[tMorf, pw, 'atras'], [tFinMorf, vw]], h: [[tMorf, ph, 'atras'], [tFinMorf, vh]],
      radio: [[tMorf, 12], [tFinMorf, vw * 0.1]], ajuste: 'cover', desde: t1, hasta: tA },
    { id: 'rep-a', padre: 'rep', tipo: 'video', archivo: 'originales/cv-clip-masmelo.mp4', inicio: ini + (tA - t1), clave: true, volumen: 1, w: vw, h: vh, radio: vw * 0.1, ajuste: 'cover', desde: tA },
    barraReproductor('rbar', 'rep', pw, ph, t1, { extra: { hasta: tSub + 0.45, salida: { tipo: 'bajar', dur: 0.35 } } }),
    ...marcasMom,
    circulo('circMom', -(pw - 60) / 2 + (pw - 60) * 0.47, ph / 2 - 60, 150, 110, tMej + 0.9, { extra: { padre: 'rep', hasta: tSub + 0.3 } }),
    { id: 'scan', padre: 'rep', tipo: 'forma', forma: 'rect', w: 8, h: ph, relleno: AMAR, efectos: [{ tipo: 'neon', color: AMAR, px: 14, fuerza: 1.5 }],
      x: [[tMej, -pw / 2, 'suave'], [tMej + 1.1, pw / 2]], desde: tMej, hasta: tMej + 1.1 },
    subrayado('subSub', 0, ph / 2 + 40, P(520, 480), tSub + 0.55, { color: ROJO, extra: { padre: 'rep', hasta: tMorf } }),
    ...notas.map(([txt, t, color], i) => sticker(`nota${i}`, txt, sx, P(-300 + i * 150, 420), {
      tam: P(42, 50), fondo: color, rot: [-3, 2, -2][i], desde: t, hasta: V ? (i < 2 ? notas[i + 1][1] : T.e[1] + 0.3) : tA + 0.25,
      entrada: { tipo: 'izquierda', dur: 0.35, ease: 'atras' }, salida: { tipo: 'izquierda', dur: 0.25 } })),
    ...notas.map(([, t]) => sonido('pop', t, 0.4)),
    !V && flecha('fl1', -230, 95, 340, 120, tSub + 0.15, { color: ROJO, rot: 40, extra: { hasta: tMorf } }),
    sticker('916', '9:16', rx + P(330, 330), P(-330, -660), { tam: 72, fondo: ROJO, color: BLANCO, rot: 8, desde: tFinMorf - 0.15, hasta: tA, entrada: { tipo: 'zoom-fuera', dur: 0.3 }, salida: { tipo: 'zoom', dur: 0.2 } }),
    sonido('subida', tMorf - 0.1, 0.45), sonido('impacto', tFinMorf - 0.15, 0.45),
    // pausa: se oye el clip real
    sticker('real', P('🔊 CLIP REAL\nHECHO CON CLIPVIRAL', '🔊 CLIP REAL HECHO CON CLIPVIRAL'), P(580, 0), P(-280, -820), { tam: P(48, 42), fondo: BLANCO, rot: P(4, -2), desde: tA, fijo: true }),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [ROJO, AMAR, TINTA]),
    subtitulos(T),
  ], { camara: { zoom: [[0, 1], [tA, 1, 'suave'], [tA + 0.9, P(1.22, 1.1)]], x: [[0, 0], [tA, 0, 'suave'], [tA + 0.9, rx * P(1.22, 1.1)]], y: [[0, 0], [tA, 0, 'suave'], [tA + 0.9, cy * P(1.22, 1.1)]] } });
}

// ================================================================ 4. Listos para TikTok, Reels y Shorts · se guardan en tu PC
{
  const T = tiempos('listos');
  const t1 = T.s[1];
  const tel = [
    ['tk', 'TIKTOK', TINTA, BLANCO, 'originales/cv-clip-picante.mp4', 8, cuando(T, 0, 'TikTok'), -5],
    ['rl', 'REELS', ROSA, BLANCO, 'originales/cv-clip-papeles.mp4', 13, cuando(T, 0, 'Reels'), 2],
    ['sh', 'SHORTS', ROJO, BLANCO, 'originales/cv-clip-profe.mp4', 10, cuando(T, 0, 'Shorts'), 5],
  ];
  const tw = P(330, 300), th = tw * 16 / 9;
  const xs = P([-560, 0, 560], [-340, 0, 340]), yT = P(-50, -330);
  const lx = 0, ly = P(70, -160), lw = P(700, 820), lh = lw * 0.58;
  const mini = ['picante', 'masmelo', 'leche', 'papeles', 'profe', 'chatgpt'];
  const vuela = t1 + 0.05;
  escena('listos', [
    papel(),
    barras('destapa', 0, [ROJO, AMAR, TINTA]),
    ...tel.flatMap(([id, nombre, fondo, color, archivo, ini, t, rot], i) => [
      telefono(id, xs[i], yT, tw, th, archivo, ini, { desde: t - 0.15, rot, entrada: { tipo: 'caer', dur: 0.35 },
        x: [[vuela, xs[i], 'entra'], [vuela + 0.45, lx]], y: [[vuela, yT, 'entra'], [vuela + 0.45, ly]], escala: [[vuela, 1, 'entra'], [vuela + 0.45, 0.15]], hasta: vuela + 0.45 }),
      sticker(`et-${id}`, nombre, xs[i], yT - th / 2 - P(10, 40), { tam: P(52, 50), fondo, color, rot: -rot, desde: t - 0.05, hasta: vuela + 0.05, salida: { tipo: 'fundido', dur: 0.15 } }),
      sonido('impacto', t - 0.15, 0.3),
    ]),
    // la computadora con la carpeta de clips
    caja('lap', lx, ly, lw, lh, BLANCO, { radio: 18, grosor: 8, desde: vuela + 0.2, entrada: { tipo: 'pop', dur: 0.4 } }),
    { id: 'lapBase', tipo: 'forma', forma: 'ruta', d: `M60 0 H${lw + 140} L${lw + 200} 50 H0 Z`, w: lw + 200, h: 50, x: lx, y: ly + lh / 2 + 22, relleno: TINTA, desde: vuela + 0.2, entrada: { tipo: 'pop', dur: 0.4 } },
    texto('lapT', '📁  Videos › ClipViral', -lw / 2 + 40, -lh / 2 + 46, P(34, 38), { padre: 'lap', ancla: [0, 50], desde: vuela + 0.3 }),
    { id: 'lapL', padre: 'lap', tipo: 'forma', forma: 'rect', y: -lh / 2 + 84, w: lw - 50, h: 4, relleno: TINTA, desde: vuela + 0.3 },
    ...mini.map((m, i) => {
      const mw = P(86, 100), mh = mw * 16 / 9, gap = (lw - 60) / 6;
      return { id: `mini${i}`, padre: 'lap', tipo: 'imagen', archivo: `imagenes/cv-mini-${m}.jpg`, w: mw, h: mh, radio: 8, borde: { grosor: 3, color: TINTA },
        x: -lw / 2 + 30 + gap * (i + 0.5), y: 50, desde: vuela + 0.45 + i * 0.12, entrada: { tipo: 'pop', dur: 0.3 } };
    }),
    ...mini.map((_, i) => sonido('pop', vuela + 0.45 + i * 0.12, 0.2)),
    sticker('enpc', '💻 SE GUARDAN EN TU PC', P(0, 0), P(-400, -640), { tam: P(60, 58), rot: -3, desde: cuando(T, 1, 'se guardan') - 0.05 }),
    sonido('whoosh', vuela, 0.45),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [AZUL, TINTA, NARANJA]),
    subtitulos(T),
  ]);
}

// ================================================================ 5–7. Planes (dos columnas)
const CARD = V ? { w: 940, h: 560, a: [0, -560], b: [0, 60] } : { w: 800, h: 660, a: [-440, -80], b: [440, -80] };
const ITEM0 = V ? -10 : 25, PASO = V ? 62 : 70;
function contenidoTarjeta(id, plan, desde, o = {}) {
  // cabecera y precio (hijos de la tarjeta)
  const L = -CARD.w / 2 + 50, top = -CARD.h / 2;
  const tc = plan === 'local' ? BLANCO : TINTA;
  const op = o.opacidad;
  return [
    texto(`${id}-nom`, plan === 'local' ? '💻 PLAN LOCAL' : '✨ PLAN CLAUDE', L, top + 62, 54, { padre: id, ancla: [0, 50], color: tc, desde, opacidad: op }),
  ];
}
function precio(id, plan, t) {
  const L = -CARD.w / 2 + 50, top = -CARD.h / 2;
  const tc = plan === 'local' ? BLANCO : TINTA;
  const yP = top + P(175, 160);
  return [
    texto(`${id}-pre`, plan === 'local' ? '$20' : '$30', L - 6, yP, P(170, 150), { padre: id, ancla: [0, 50], color: tc, desde: t, entrada: { tipo: 'zoom-fuera', dur: 0.3 },
      sombra: { x: 7, y: 7, px: 0, color: TINTA } }),
    texto(`${id}-mes`, 'AL MES', L + P(290, 255), yP + P(32, 28), P(46, 42), { padre: id, ancla: [0, 50], color: tc, desde: t + 0.1, entrada: { tipo: 'izquierda', dur: 0.3 } }),
    subrayado(`${id}-sub`, L + 140, yP + P(78, 68), 260, t + 0.3, { color: AMAR, grosor: 10, extra: { padre: id } }),
    sonido('impacto', t, 0.45),
    { id: `${id}-div`, padre: id, tipo: 'forma', forma: 'linea', x: 0, y: top + P(280, 248), w: CARD.w - 100, h: 4, trazo: plan === 'local' ? 'rgba(255,255,255,0.55)' : 'rgba(11,11,15,0.45)', grosor: 4, dash: [14, 12], desde: t },
  ];
}
function item(id, plan, i, txt, t, o = {}) {
  const L = -CARD.w / 2 + 50;
  const y = ITEM0 + i * PASO;
  const tc = plan === 'local' ? BLANCO : TINTA;
  return [
    ...check(`${id}-c${i}`, L + 22, y, t, { padre: id, color: o.color || VERDE, tam: P(46, 44) }),
    texto(`${id}-t${i}`, txt, L + 66, y, P(38, 38), { padre: id, ancla: [0, 50], color: o.colorTexto || tc, desde: t, entrada: { tipo: 'izquierda', dur: 0.3 }, ...o.extra }),
    sonido('pop', t, 0.35),
  ];
}

// 5. Hay dos planes
{
  const T = tiempos('planes');
  const tVS = cuando(T, 0, 'Mira') - 0.1;
  const tM = T.dur - 0.48, tF = T.dur;
  const mitad = (id, color, lado) => {
    const [cx, cy] = lado < 0 ? CARD.a : CARD.b;
    const x0 = V ? 0 : lado * W / 4, y0 = V ? lado * H / 4 : 0, w0 = V ? W : W / 2, h0 = V ? H / 2 : H;
    return { id, tipo: 'forma', forma: 'rect', relleno: color, trazo: TINTA, grosor: [[tM, 0], [tF, 6]],
      x: [[tM, x0, 'suave'], [tF, cx]], y: [[0, (V ? lado : -lado) * H, 'sale'], [0.3, y0], [tM, y0, 'suave'], [tF, cy]],
      w: [[tM, w0, 'suave'], [tF, CARD.w]], h: [[tM, h0, 'suave'], [tF, CARD.h]], radio: [[tM, 0], [tF, 16]],
      efectos: [{ tipo: 'sombra', x: [[tM, 0], [tF, 12]], y: [[tM, 0], [tF, 12]], px: 0, color: TINTA }] };
  };
  const Lx = V ? 0 : -W / 4, Ly = V ? -H / 4 : -40, Cx = V ? 0 : W / 4, Cy = V ? H / 4 - 120 : -40;
  escena('planes', [
    papel(),
    mitad('mL', AZUL, -1), mitad('mC', NARANJA, 1),
    texto('pL', 'LOCAL', Lx, Ly, P(190, 190), { color: BLANCO, sombra: { x: 10, y: 10, px: 0, color: TINTA }, desde: 0.2, hasta: tM, entrada: { tipo: 'caer', dur: 0.35 }, salida: { tipo: 'zoom', dur: 0.2 } }),
    sticker('pLp', '$20 AL MES', Lx, Ly + P(150, 150), { tam: 54, fondo: BLANCO, rot: -3, desde: 0.45, hasta: tM, salida: { tipo: 'zoom', dur: 0.2 } }),
    texto('pC', 'CLAUDE', Cx, Cy, P(190, 190), { color: TINTA, sombra: { x: 10, y: 10, px: 0, color: BLANCO }, desde: 0.35, hasta: tM, entrada: { tipo: 'caer', dur: 0.35 }, salida: { tipo: 'zoom', dur: 0.2 } }),
    sticker('pCp', '$30 AL MES', Cx, Cy + P(150, 150), { tam: 54, fondo: BLANCO, rot: 3, desde: 0.6, hasta: tM, salida: { tipo: 'zoom', dur: 0.2 } }),
    { id: 'vs', tipo: 'forma', forma: 'elipse', x: 0, y: P(-40, -60), w: 230, h: 230, relleno: AMAR, trazo: TINTA, grosor: 8, efectos: [DURO(10), { tipo: 'glitch', px: [[tVS, 16], [tVS + 0.45, 0]] }],
      desde: tVS, hasta: tM, entrada: { tipo: 'zoom-fuera', dur: 0.28 }, salida: { tipo: 'zoom', dur: 0.2 }, mod: { rot: { oscilar: { frec: 3, amp: 4 } } } },
    texto('vsT', 'VS', 0, 4, 120, { padre: 'vs', desde: tVS, hasta: tM }),
    sticker('dos', '2 PLANES', 0, P(-430, -860), { tam: 60, fondo: BLANCO, rot: -2, desde: 0.3, hasta: tM, salida: { tipo: 'subir', dur: 0.2 } }),
    sonido('whoosh', 0.02, 0.45), sonido('impacto', tVS, 0.6),
    subtitulos(T),
  ], { camara: sacudir([[tVS + 0.05, 20]]) });
}

// 6. Plan Local
const CL = { id: 'cL', x: CARD.a[0], y: CARD.a[1] }, CC = { id: 'cC', x: CARD.b[0], y: CARD.b[1] };
const ITEMS_L = ['Todo funciona en tu PC', 'Chat, volumen e IA local', 'Sin límite de horas', 'No necesitas clave de Claude'];
{
  const T = tiempos('local');
  const tP = cuando(T, 0, '20') - 0.05;
  const tI = [T.s[1] + 0.05, cuando(T, 1, 'el chat'), T.s[2] + 0.05, cuando(T, 2, 'No necesitas')];
  escena('local', [
    papel(),
    caja(CL.id, CL.x, CL.y, CARD.w, CARD.h, AZUL),
    ...contenidoTarjeta(CL.id, 'local', 0.05),
    ...precio(CL.id, 'local', tP),
    ...ITEMS_L.flatMap((txt, i) => item(CL.id, 'local', i, txt, tI[i])),
    sticker('ilimitado', '∞ SIN LÍMITE', CARD.w / 2 - 150, -CARD.h / 2 + 10, { padre: CL.id, tam: 40, rot: 8, desde: tI[2] + 0.2 }),
    // Claude espera, apagado
    caja(CC.id, CC.x, CC.y, CARD.w, CARD.h, NARANJA, { opacidad: 0.4 }),
    ...contenidoTarjeta(CC.id, 'claude', 0, { opacidad: 0.4 }),
    texto('cC-q', '?', 0, P(60, 50), 260, { padre: CC.id, opacidad: 0.4, mod: { rot: { oscilar: { frec: 1.5, amp: 6 } } } }),
    subtitulos(T),
  ]);
}

// 7. Plan Claude (+ ejemplo real: Claude elige el momento y escribe título y hashtags)
{
  const T = tiempos('claude');
  const tOn = 0.25, tP = cuando(T, 0, '30') - 0.05, tMas = T.s[1] + 0.05;
  const tMove = T.s[2] - 0.05, tMove2 = tMove + 0.5;
  const tLee = T.s[2] + 0.35, tViral = cuando(T, 2, 'elige'), tTit = cuando(T, 2, 'con título') - 0.1, tHash = cuando(T, 2, 'hashtags') - 0.1;
  // dónde queda la tarjeta de Claude cuando la del Local se va
  const dest = V ? CARD.a : CARD.a;
  const fx = P(240, -250), fy = P(-90, 200), fw = P(300, 300), fh = fw * 16 / 9;
  const ex = P(690, 230);
  const Lsale = V ? { y: [[tMove, CL.y, 'entra'], [tMove + 0.45, CL.y - 1300]] } : { x: [[tMove, CL.x, 'entra'], [tMove + 0.45, CL.x - 1500]] };
  escena('claude', [
    papel(),
    caja(CL.id, CL.x, CL.y, CARD.w, CARD.h, AZUL, { ...Lsale, hasta: tMove + 0.5 }),
    ...contenidoTarjeta(CL.id, 'local', 0),
    ...precio(CL.id, 'local', -1).filter((c) => c.tipo !== 'sonido'),
    ...ITEMS_L.flatMap((txt, i) => item(CL.id, 'local', i, txt, -1).filter((c) => c.tipo !== 'sonido')),
    sticker('ilimitado', '∞ SIN LÍMITE', CARD.w / 2 - 150, -CARD.h / 2 + 10, { padre: CL.id, tam: 40, rot: 8, desde: -1 }),
    caja(CC.id, CC.x, CC.y, CARD.w, CARD.h, NARANJA, { opacidad: [[tOn, 0.4], [tOn + 0.3, 1]], escala: [[tOn, 1, 'sale'], [tOn + 0.15, 1.04, 'suave'], [tOn + 0.35, 1]],
      x: [[tMove, CC.x, 'suave'], [tMove2, dest[0]]], y: [[tMove, CC.y, 'suave'], [tMove2, dest[1]]] }),
    ...contenidoTarjeta(CC.id, 'claude', 0, { opacidad: [[tOn, 0.4], [tOn + 0.3, 1]] }),
    texto('cC-q', '?', 0, P(60, 50), 260, { padre: CC.id, opacidad: 0.4, hasta: tOn + 0.25, salida: { tipo: 'zoom', dur: 0.25 } }),
    ...precio(CC.id, 'claude', tP),
    ...item(CC.id, 'claude', 0, 'Todo lo del plan Local', tMas + 0.25, { color: AZUL }),
    { id: 'mas', tipo: 'forma', forma: 'elipse', x: P(0, 0), y: P(-80, -250), w: 110, h: 110, relleno: AMAR, trazo: TINTA, grosor: 7, efectos: [DURO(8)],
      desde: tMas, hasta: tMove, entrada: { tipo: 'zoom-fuera', dur: 0.3 }, salida: { tipo: 'zoom', dur: 0.2 } },
    texto('masT', '+', 0, 2, 100, { padre: 'mas', desde: tMas, hasta: tMove }),
    sonido('impacto', tMas, 0.4),
    ...item(CC.id, 'claude', 1, 'Lee todo el directo', tLee),
    ...item(CC.id, 'claude', 2, 'Elige los momentos más virales', tViral),
    ...item(CC.id, 'claude', 3, 'Con título y hashtags', tTit),
    // ejemplo real
    ...telefono('ej', fx, fy, fw, fh, 'originales/cv-clip-masmelo.mp4', 12.6, { desde: tMove2 - 0.1, rot: 3, entrada: { tipo: 'caer', dur: 0.4 } }),
    { id: 'ej-scan', padre: 'ej', tipo: 'forma', forma: 'rect', w: fw - 20, h: 8, relleno: NARANJA, efectos: [{ tipo: 'neon', color: NARANJA, px: 16, fuerza: 2 }],
      y: [[tMove2, -fh / 2 + 20, 'suave'], [tMove2 + 0.7, fh / 2 - 20, 'suave'], [tMove2 + 1.4, -fh / 2 + 20]], desde: tMove2, hasta: tViral + 0.1 },
    sticker('ej-lee', '✨ CLAUDE LO ESTÁ VIENDO…', fx, fy - fh / 2 - P(60, 60), { tam: P(36, 36), fondo: BLANCO, rot: -3, desde: tMove2 + 0.1, hasta: tViral + 0.1, salida: { tipo: 'fundido', dur: 0.15 } }),
    sticker('ej-viral', '🔥 MOMENTO VIRAL', fx, fy - fh / 2 - P(60, 60), { tam: P(42, 42), fondo: ROJO, color: BLANCO, rot: -3, desde: tViral + 0.1 }),
    sonido('impacto', tViral + 0.1, 0.4),
    { id: 'ej-chispas', tipo: 'particulas', estilo: 'chispas', desde: tViral + 0.1, origen: [fx, fy - fh / 2], cantidad: 28, colores: [AMAR, NARANJA, ROJO], semilla: 7 },
    sticker('ej-tit', '¿Quién será la reina del masmelo? Reto de malvaviscos', ex, P(-150, 70), { tam: P(36, 36), fondo: BLANCO, ancho: P(400, 430), rot: 2, alinear: 'izquierda',
      desde: tTit, entrada: { tipo: 'pop', dur: 0.3 }, animador: { por: 'letras', efecto: 'escribir', cada: 0.018 } }),
    sticker('ej-hash', '#reto #malvaviscos #challenge #viral', ex, P(30, 250), { tam: P(32, 34), fondo: AZUL, color: BLANCO, ancho: P(400, 430), rot: -2, alinear: 'izquierda',
      desde: tHash, entrada: { tipo: 'pop', dur: 0.3 }, animador: { por: 'palabras', efecto: 'pop', cada: 0.08, dur: 0.25 } }),
    sticker('ej-tl', 'TÍTULO', ex - P(140, 150), P(-235, -20), { tam: 26, fondo: AMAR, rot: -6, desde: tTit + 0.1 }),
    sticker('ej-hl', 'HASHTAGS', ex - P(140, 150), P(-35, 170), { tam: 26, fondo: AMAR, rot: -6, desde: tHash + 0.1 }),
    sonido('pop', tTit, 0.35), sonido('pop', tHash, 0.35), sonido('whoosh', tMove, 0.4),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [NARANJA, TINTA, AMAR]),
    subtitulos(T),
  ], { camara: sacudir([[tP + 0.05, 10]]) });
}

// ================================================================ 8. Tu clave de Claude
{
  const T = tiempos('clave');
  const x0 = 345, y0 = 184, x1 = V ? 1195 : 1560, y1 = 420, k = P(1.3, 1.18);
  const zw = (x1 - x0) * k, zh = (y1 - y0) * k, zy = P(-110, -380);
  const [fx, fy] = enZona(x0, y0, x1, y1, k, V ? 782 : 873, 347);
  const [ix] = enZona(x0, y0, x1, y1, k, 400, 347);
  const [bx, by] = enZona(x0, y0, x1, y1, k, 1461, 347);
  const [lx, ly] = enZona(x0, y0, x1, y1, k, 766, 251);
  const tTec = T.s[0] + 0.7, tFinTec = tTec + 0.95, tGuardar = tFinTec + 0.2;
  const tCobra = T.s[1] + 0.05;
  escena('clave', [
    papel(),
    barras('destapa', 0, [NARANJA, TINTA, AMAR]),
    sticker('tit', '🔑 TU PROPIA CLAVE DE CLAUDE', 0, zy - zh / 2 - P(95, 110), { tam: P(62, 56), fondo: NARANJA, rot: -2, desde: T.s[0] }),
    caja('aj', 0, zy, zw + 28, zh + 28, TINTA, { radio: 16, rot: -1, desde: 0.1, entrada: { tipo: 'caer', dur: 0.45 } }),
    zona('ajImg', 'capturas/cv-ajustes.png', x0, y0, x1, y1, 0, 0, k, { padre: 'aj', desde: 0.1 }),
    { id: 'tapa', padre: 'aj', tipo: 'forma', forma: 'rect', x: fx, y: fy, w: (V ? 815 : 990) * k, h: 44 * k, radio: 8 * k, relleno: '#050815', desde: tTec },
    { id: 'llave', padre: 'aj', tipo: 'texto', texto: V ? 'sk-ant-•••••••••••••••••••' : 'sk-ant-••••••••••••••••••••••••••', fuente: 'texto', tam: 19 * k / 0.935, peso: 600, color: '#e2e8f0', ancla: [0, 50], x: ix, y: fy,
      desde: tTec, animador: { por: 'letras', efecto: 'escribir', cada: 0.028 } },
    { id: 'marcador', padre: 'aj', tipo: 'forma', forma: 'rect', x: lx, y: ly, w: 790 * k, h: 30 * k, relleno: 'rgba(255,210,63,0.45)', ancla: [50, 50], desde: tCobra,
      escala: [[tCobra, [0, 1], 'sale'], [tCobra + 0.5, [1, 1]]] },
    !V && cursor([[0.5, bx + 220, zy + by + 240], [tGuardar - 0.1, bx, zy + by], [T.s[1] + 0.4, bx + 70, zy + by + 90]], 0.5, T.s[1] + 0.5, { rot: -1 }),
    !V && clic(bx, zy + by, tGuardar),
    sticker('ok', '✓ GUARDADA', P(bx + 40, 220), zy + by + P(90, 110), { tam: 40, fondo: VERDE, color: BLANCO, rot: 4, desde: tGuardar + 0.15 }),
    sonido('ding', tGuardar + 0.15, 0.4),
    V && { id: 'llaveG', tipo: 'icono', icono: '🔑', tam: 170, x: -260, y: -80, rot: -15, desde: T.s[0] + 0.3, entrada: { tipo: 'pop', dur: 0.4 }, mod: { rot: { oscilar: { frec: 0.8, amp: 6 } } } },
    flecha('flCobra', P(-120, -40), P(170, 70), P(220, 200), P(150, 160), tCobra + 0.4, { rot: P(70, 70) }),
    caja('cuenta', P(250, 0), P(250, 300), P(760, 860), P(140, 150), BLANCO, { rot: 2, desde: tCobra + 0.55, entrada: { tipo: 'pop', dur: 0.35 } }),
    texto('cuentaT', '💳 Se cobra en TU cuenta\nde Claude, según lo que uses', 0, 0, P(42, 44), { padre: 'cuenta', desde: tCobra + 0.6, interlineado: 1.15 }),
    sonido('pop', tCobra + 0.55, 0.4),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [AZUL, AMAR, NARANJA]),
    subtitulos(T),
  ]);
}

// ================================================================ 9. Resumen: quién elige los clips
{
  const T = tiempos('resumen');
  const tL = cuando(T, 0, 'en el Local'), tPC = cuando(T, 0, 'elige tu') + 0.15, tC = T.s[1] + 0.05, tCl = cuando(T, 1, 'elige Claude') + 0.15;
  const pw = P(800, 940), ph = P(560, 500);
  const pa = P([-440, 10], [0, -330]), pb = P([440, 10], [0, 220]);
  const mx0 = 344, my0 = 310, mx1 = 944, my1 = 480, kM = P(0.95, 1.05);
  const panel = (id, [x, y], color, plan, tOn, tRes, cap, mx) => {
    const tc = plan === 'local' ? BLANCO : TINTA;
    return [
      caja(id, x, y, pw, ph, color, { desde: plan === 'local' ? 0.15 : 0.3, entrada: { tipo: 'caer', dur: 0.4 },
        escala: [[tOn, 1, 'sale'], [tOn + 0.15, 1.04, 'suave'], [tOn + 0.35, 1]] }),
      texto(`${id}-n`, plan === 'local' ? 'PLAN LOCAL' : 'PLAN CLAUDE', 0, -ph / 2 + 50, 44, { padre: id, color: tc, desde: plan === 'local' ? 0.15 : 0.3 }),
      caja(`${id}-mc`, 0, -ph / 2 + 70 + (my1 - my0) * kM / 2 + 30, (mx1 - mx0) * kM + 16, (my1 - my0) * kM + 16, TINTA, { padre: id, radio: 12, grosor: 0, sombra: 6, desde: plan === 'local' ? 0.15 : 0.3 }),
      zona(`${id}-m`, cap, mx, my0, mx + 600, my1, 0, 0, kM, { padre: `${id}-mc`, desde: plan === 'local' ? 0.15 : 0.3 }),
      texto(`${id}-e`, 'ELIGE LOS CLIPS:', 0, P(70, 78), 36, { padre: id, color: tc, desde: tOn }),
      texto(`${id}-r`, plan === 'local' ? '💻 TU PC' : '✨ CLAUDE', 0, P(170, 168), P(110, 100), { padre: id, color: tc, sombra: { x: 7, y: 7, px: 0, color: plan === 'local' ? TINTA : BLANCO }, desde: tRes, entrada: { tipo: 'zoom-fuera', dur: 0.3 } }),
      sonido('impacto', tRes, 0.45),
      // velo de papel: apaga el panel que no toca
      { id: `${id}-velo`, padre: id, tipo: 'forma', forma: 'rect', w: pw, h: ph, radio: 16, relleno: PAPEL,
        opacidad: plan === 'local' ? [[tC, 0], [tC + 0.25, 0.6]] : [[0, 0], [tL, 0], [tL + 0.25, 0.6], [tC, 0.6], [tC + 0.25, 0]] },
    ];
  };
  escena('resumen', [
    papel(),
    barras('destapa', 0, [AZUL, AMAR, NARANJA]),
    sticker('res', 'EN RESUMEN', P(-560, 0), P(-440, -880), { tam: 42, fondo: BLANCO, rot: -4, desde: T.s[0] }),
    texto('quien', '¿QUIÉN ELIGE LOS CLIPS?', P(120, 0), P(-430, -790), P(84, 70), { desde: T.s[0] + 0.3, animador: { por: 'palabras', efecto: 'caer', cada: 0.08, dur: 0.35 } }),
    panel('pL', pa, AZUL, 'local', tL, tPC, 'capturas/cv-directo-local.png', 344),
    panel('pC', pb, NARANJA, 'claude', tC, tCl, 'capturas/cv-directo-claude.png', 960),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [TINTA, AZUL, AMAR]),
    subtitulos(T),
  ], { camara: sacudir([[tPC + 0.05, 10], [tCl + 0.05, 10]]) });
}

// ================================================================ 10. Clips guardados y el Piloto
{
  const T = tiempos('piloto');
  const t1 = T.s[1];
  const mini = ['picante', 'masmelo', 'leche', 'papeles', 'profe', 'chatgpt'];
  const mw = P(210, 250), mh = mw * 16 / 9;
  const pos = mini.map((_, i) => V ? [(-1 + (i % 3)) * 310, -560 + Math.floor(i / 3) * 500] : [(-2.5 + i) * 275, -40]);
  const tPil = t1 + 0.0, tSug = cuando(T, 1, 'te sugiere'), tDec = cuando(T, 1, 'Tú decides') - 0.05;
  const pk = P(0.68, 0.6), pw = CAP.w * pk, ph = CAP.h * pk;
  const px = P(170, 0), py = P(-50, -330);
  escena('piloto', [
    papel(),
    barras('destapa', 0, [TINTA, AZUL, AMAR]),
    ...mini.flatMap((m, i) => {
      const t = 0.2 + i * 0.13, rot = [-5, 3, -2, 4, -4, 2][i], [x, y] = pos[i];
      return [
        caja(`pol${i}`, x, y, mw + 24, mh + 24, BLANCO, { radio: 10, grosor: 5, sombra: 9, rot, desde: t, entrada: { tipo: 'caer', dur: 0.4 },
          x: [[tPil, x, 'suave'], [tPil + 0.45, V ? x * 0.5 : -790 + i * 20]], y: [[tPil, y, 'suave'], [tPil + 0.45, V ? 200 : -300 + i * 12]],
          escala: [[tPil, 1, 'suave'], [tPil + 0.45, V ? 0.35 : 0.42]], hasta: T.dur }),
        { id: `pol${i}-i`, padre: `pol${i}`, tipo: 'imagen', archivo: `imagenes/cv-mini-${m}.jpg`, w: mw, h: mh, radio: 6, desde: t },
        sticker(`pol${i}-ok`, '✓ LISTO', 0, mh / 2 - 40, { padre: `pol${i}`, tam: 34, fondo: VERDE, color: BLANCO, rot: -rot - 6, desde: cuando(T, 0, 'listos') + i * 0.1, hasta: tPil }),
        sonido('pop', t, 0.25),
      ];
    }),
    sticker('listos', '✓ LISTOS PARA SUBIR', 0, P(-430, -880), { tam: 60, fondo: AMAR, rot: -2, desde: cuando(T, 0, 'listos') - 0.1, hasta: tPil + 0.1, salida: { tipo: 'subir', dur: 0.2 } }),
    // el Piloto
    caja('pil', px, py, pw + 24, ph + 24, TINTA, { radio: 16, rot: 1.5, desde: tPil, entrada: { tipo: 'derecha', dur: 0.45, ease: 'atras' } }),
    { id: 'pilImg', padre: 'pil', tipo: 'imagen', archivo: 'capturas/cv-piloto.png', w: pw, h: ph, radio: 8, desde: tPil },
    sticker('pilT', '🛰️ EL PILOTO VIGILA TUS CANALES', px, py - ph / 2 - P(70, 75), { tam: P(48, 44), fondo: BLANCO, rot: -2, desde: tPil + 0.25 }),
    caja('noti', P(580, 230), P(-300, 50), P(500, 520), P(130, 130), BLANCO, { radio: 18, rot: -3, desde: tSug, entrada: { tipo: 'caer', dur: 0.4 }, mod: { rot: { oscilar: { frec: 1.5, amp: 1.5 } } } }),
    { id: 'notiI', padre: 'noti', tipo: 'icono', icono: 'bell', tam: 58, color: ROJO, x: P(-190, -200), y: 0, desde: tSug, mod: { rot: { oscilar: { frec: 5, amp: 14 } } } },
    texto('notiT', 'Nuevo clip sugerido\nListo para revisar', P(-140, -150), 0, P(36, 38), { padre: 'noti', ancla: [0, 50], alinear: 'izquierda', interlineado: 1.2, desde: tSug }),
    sonido('ding', tSug, 0.5),
    sticker('decides', '✋ TÚ DECIDES QUÉ PUBLICAR', P(-420, 0), P(300, 400), { tam: P(56, 56), fondo: ROJO, color: BLANCO, rot: -5, desde: tDec, entrada: { tipo: 'zoom-fuera', dur: 0.3 } }),
    sonido('impacto', tDec, 0.5),
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [VERDE, TINTA, AMAR]),
    subtitulos(T),
  ], { camara: sacudir([[tDec + 0.05, 14]]) });
}

// ================================================================ 11. Activarlo
{
  const T = tiempos('activar');
  const t1 = T.s[1], t2 = T.s[2];
  const tA = t1 + 0.05, tB = cuando(T, 1, 'te mandamos'), tC = cuando(T, 1, 'y la pegas');
  const t30 = T.s[2] + 0.05, tRen = cuando(T, 2, 'Si renuevas'), tSuma = cuando(T, 2, 'los días se suman');
  const cw = P(560, 900), ch = P(560, 380);
  const xs = P([-620, 0, 620], [0, 0, 0]), ys = P([-30, -30, -30], [-600, -190, 230]);
  const salida = { tipo: 'caer', dur: 0.4 };
  // recortes reales de la pantalla de activación
  const kc = P(1.0, 1.25);
  const paso = (i, titulo, color, desde) => [
    caja(`st${i}`, xs[i], ys[i], cw, ch, color, { rot: [-2, 1.5, -1][i], desde, hasta: t2 + 0.1, entrada: { tipo: 'caer', dur: 0.4 }, salida }),
    { id: `st${i}-n`, padre: `st${i}`, tipo: 'forma', forma: 'elipse', x: -cw / 2 + 20, y: -ch / 2 + 20, w: 90, h: 90, relleno: AMAR, trazo: TINTA, grosor: 6, desde, entrada: { tipo: 'pop', dur: 0.3 } },
    texto(`st${i}-nn`, String(i + 1), 0, 3, 60, { padre: `st${i}-n`, desde }),
    texto(`st${i}-t`, titulo, 0, -ch / 2 + P(80, 70), P(44, 46), { padre: `st${i}`, color: color === TINTA ? BLANCO : TINTA, desde }),
    sonido('impacto', desde, 0.35),
  ];
  const [ccx, ccy] = enZona(972, 300, 1430, 392, kc, 1346, 346);
  escena('activar', [
    papel(),
    barras('destapa', 0, [VERDE, TINTA, AMAR]),
    texto('facil', 'ACTIVARLO\nES FÁCIL', 0, P(-40, -120), P(170, 160), { desde: T.s[0], hasta: t1, animador: { por: 'palabras', efecto: 'caer', cada: 0.12, dur: 0.4 }, salida: { tipo: 'subir', dur: 0.2 } }),
    sticker('123', '1 · 2 · 3', 0, P(170, 120), { tam: 60, fondo: AMAR, rot: -3, desde: T.s[0] + 0.5, hasta: t1, salida: { tipo: 'zoom', dur: 0.2 } }),
    // paso 1: copias el código
    paso(0, 'COPIAS EL CÓDIGO', BLANCO, tA),
    caja('st0-z', 0, P(30, 40), (1430 - 972) * kc + 16, (392 - 300) * kc + 16, TINTA, { padre: 'st0', radio: 10, grosor: 0, sombra: 6, desde: tA }),
    zona('st0-zi', 'capturas/cv-activar.png', 972, 300, 1430, 392, 0, 0, kc, { padre: 'st0-z', desde: tA }),
    cursor([[tA + 0.2, xs[0] + ccx + 160, ys[0] + P(30, 40) + ccy + 160], [tA + 0.75, xs[0] + ccx, ys[0] + P(30, 40) + ccy]], tA + 0.2, t2, { rot: -2 }),
    clic(xs[0] + ccx, ys[0] + P(30, 40) + ccy, tA + 0.8),
    sticker('st0-ok', '¡COPIADO!', 0, P(170, 140), { padre: 'st0', tam: 40, fondo: VERDE, color: BLANCO, rot: 4, desde: tA + 0.9 }),
    // paso 2: te mandamos una clave
    paso(1, 'TE MANDAMOS\nUNA CLAVE', WA, tB),
    caja('st1-b', 0, P(70, 60), P(440, 520), P(110, 100), BLANCO, { padre: 'st1', radio: 22, grosor: 5, sombra: 6, desde: tB + 0.35, entrada: { tipo: 'pop', dur: 0.3 } }),
    texto('st1-bt', '🔑 Tu clave: ••••-••••-••••', 0, 0, P(32, 36), { padre: 'st1-b', desde: tB + 0.4, animador: { por: 'letras', efecto: 'escribir', cada: 0.02 } }),
    { id: 'st1-w', padre: 'st1', tipo: 'icono', icono: 'message-circle', tam: 70, color: TINTA, grosor: 2.5, x: cw / 2 - 70, y: -ch / 2 + 75, desde: tB, mod: { rot: { oscilar: { frec: 4, amp: 10 } } } },
    sonido('ding', tB + 0.35, 0.4),
    // paso 3: la pegas y activas
    paso(2, 'LA PEGAS Y ACTIVAS', BLANCO, tC),
    caja('st2-z', 0, P(20, 20), (1430 - 972) * kc * P(0.95, 0.95) + 16, (570 - 444) * kc * P(0.95, 0.95) + 16, TINTA, { padre: 'st2', radio: 10, grosor: 0, sombra: 6, desde: tC }),
    zona('st2-zi', 'capturas/cv-activar-clave.png', 972, 444, 1430, 570, 0, 0, kc * 0.95, { padre: 'st2-z', desde: tC }),
    sticker('st2-ok', 'ACTIVADO ✓', 0, P(170, 130), { padre: 'st2', tam: 52, fondo: VERDE, color: BLANCO, rot: -4, desde: tC + 0.55 }),
    { id: 'conf', tipo: 'particulas', estilo: 'confeti', desde: tC + 0.55, origen: [xs[2], ys[2]], cantidad: 70, colores: [AMAR, ROJO, AZUL, VERDE, ROSA], semilla: 11 },
    sonido('brillo', tC + 0.55, 0.4),
    // 30 días que se suman
    caja('cal', P(-380, 0), P(-40, -330), P(520, 560), P(560, 560), BLANCO, { rot: -3, desde: t30, entrada: { tipo: 'zoom-fuera', dur: 0.35 } }),
    { id: 'cal-b', padre: 'cal', tipo: 'forma', forma: 'rect', y: -P(560, 560) / 2 + 55, w: P(520, 560) - 6, h: 110, relleno: ROJO, desde: t30 },
    texto('cal-bt', 'DÍAS DE CLIPVIRAL', 0, -P(560, 560) / 2 + 55, 40, { padre: 'cal', color: BLANCO, desde: t30 }),
    texto('cal-30', '30', 0, 60, 260, { padre: 'cal', desde: t30, hasta: tSuma, escala: [[tSuma - 0.15, [1, 1], 'entra'], [tSuma, [1, 0]]] }),
    texto('cal-60', '60', 0, 60, 260, { padre: 'cal', color: VERDE, sombra: { x: 8, y: 8, px: 0, color: TINTA }, desde: tSuma, escala: [[tSuma, [1, 0], 'sale'], [tSuma + 0.2, [1, 1]]] }),
    sticker('mas30', '+30', P(-80, 300), P(-280, -620), { tam: 90, fondo: AMAR, rot: 10, desde: tRen, hasta: tSuma + 0.05, entrada: { tipo: 'derecha', dur: 0.35, ease: 'atras' },
      x: [[tSuma - 0.3, P(-80, 300), 'entra'], [tSuma, P(-380, 0)]], y: [[tSuma - 0.3, P(-280, -620), 'entra'], [tSuma, P(-40, -330)]], escala: [[tSuma - 0.3, 1, 'entra'], [tSuma, 0.3]] }),
    sticker('cada', 'CADA CLAVE = 30 DÍAS', P(380, 0), P(-170, 110), { tam: P(56, 56), fondo: BLANCO, rot: 2, desde: t30 + 0.2 }),
    sticker('suma', 'MISMO PLAN →\nLOS DÍAS SE SUMAN', P(380, 0), P(40, 300), { tam: P(56, 56), fondo: AMAR, rot: -2, desde: tRen + 0.3 }),
    sonido('subida', tRen, 0.35), sonido('impacto', tSuma, 0.5),
    { id: 'conf2', tipo: 'particulas', estilo: 'explosion', desde: tSuma, origen: [P(-380, 0), P(-40, -330)], cantidad: 40, colores: [VERDE, AMAR, TINTA], semilla: 5 },
    sonido('whoosh', fin(T), 0.5),
    barras('tapa', fin(T), [WA, TINTA, AMAR]),
    subtitulos(T),
  ], { camara: sacudir([[tSuma + 0.05, 14]]) });
}

// ================================================================ 12. Cierre: compra por WhatsApp
{
  const T = tiempos('cierre');
  const t1 = T.s[1];
  const tBot = cuando(T, 0, 'WhatsApp') - 0.05, tNum = cuando(T, 0, '+1') - 0.1;
  const by = P(-190, -420), bw = P(980, 960), bh = 150;
  const ny = P(10, -180);
  const sxp = P(470, 0), syp = P(220, 250), ks = P(1.75, 2.1);
  escena('cierre', [
    papel(),
    barras('destapa', 0, [WA, TINTA, AMAR]),
    { id: 'logoI', tipo: 'imagen', archivo: 'imagenes/clipviral-icono.png', w: 110, h: 110, x: P(-270, -190), y: P(-420, -740), radio: 24, efectos: [DURO(7)], desde: 0.15, entrada: { tipo: 'zoom-fuera', dur: 0.3 } },
    texto('logoT', 'ClipViral', P(-190, -110), P(-420, -740), 96, { ancla: [0, 50], desde: 0.25, animador: { por: 'letras', efecto: 'subir', cada: 0.03, dur: 0.3 } }),
    caja('wa', 0, by, bw, bh, WA, { radio: 26, grosor: 7, sombra: 14, desde: tBot - 0.35, entrada: { tipo: 'zoom-fuera', dur: 0.35 },
      escala: [[tBot + 0.7, 1], [tBot + 0.8, 0.95, 'atras'], [tBot + 0.95, 1]] }),
    { id: 'waI', padre: 'wa', tipo: 'icono', icono: 'message-circle', tam: 84, color: TINTA, grosor: 2.6, x: -bw / 2 + 85, y: 0, desde: tBot - 0.35 },
    texto('waT', 'COMPRA POR WHATSAPP', 40, 4, P(76, 66), { padre: 'wa', desde: tBot - 0.3 }),
    cursor([[tBot, bw / 2 + 150, by + 220], [tBot + 0.7, bw / 2 - 160, by + 20]], tBot, t1, {}),
    clic(bw / 2 - 160, by + 20, tBot + 0.75),
    { id: 'numF', tipo: 'forma', forma: 'rect', x: 0, y: ny + 6, w: P(1080, 1000), h: P(150, 120), relleno: AMAR, rot: -1.5, desde: tNum, escala: [[tNum, [0, 1], 'sale'], [tNum + 0.35, [1, 1]]] },
    texto('num', '+1 849 815 3785', 0, ny, P(140, 118), { desde: tNum, animador: { por: 'letras', efecto: 'subir', cada: 0.03, dur: 0.3 } }),
    subrayado('numS', 0, ny + P(95, 80), P(900, 820), tNum + 0.9, { color: ROJO, grosor: 10 }),
    sticker('plL', '💻 LOCAL · $20/MES', P(-640, -235), P(215, 10), { tam: P(42, 40), fondo: AZUL, color: BLANCO, rot: -3, desde: tNum + 1.2 }),
    sticker('plC', '✨ CLAUDE · $30/MES', P(-170, 235), P(215, 10), { tam: P(42, 40), fondo: NARANJA, rot: 3, desde: tNum + 1.4 }),
    sonido('pop', tNum + 1.2, 0.35), sonido('pop', tNum + 1.4, 0.35),
    // Soporte
    caja('sop', sxp, syp, (295 - 14) * ks + 20, (887 - 832) * ks + 20, TINTA, { radio: 12, grosor: 0, sombra: 8, rot: 2, desde: t1 + 0.1, entrada: { tipo: 'pop', dur: 0.35 } }),
    zona('sopI', 'capturas/cv-licencia.png', 14, 832, 295, 887, 0, 0, ks, { padre: 'sop', desde: t1 + 0.1 }),
    circulo('sopC', sxp, syp, (295 - 14) * ks + 120, (887 - 832) * ks + 90, cuando(T, 1, 'Soporte') - 0.1, { color: ROJO, grosor: 9 }),
    sticker('sopT', '¿DUDAS? DENTRO DE LA APP', sxp, syp + P(105, -120), { tam: P(36, 38), fondo: AMAR, rot: -3, desde: t1 + 0.2 }),
    sonido('pop', t1 + 0.1, 0.4),
    { id: 'negro', tipo: 'forma', forma: 'rect', w: W, h: H, relleno: TINTA, fijo: true, desde: T.dur - 0.6, opacidad: [[T.dur - 0.6, 0], [T.dur, 1]] },
    subtitulos(T),
  ], { camara: sacudir([[tBot - 0.3, 12]]) });
}

// ---------------------------------------------------------------- voz del Sintetizador → VideoLab
const velocidad = 1;
const generado = { voces: {} };
for (const e of escenas) {
  const esc = guion.escenas.find((g) => g.id === e.id);
  const wavs = esc.frases.map((_, i) => path.join(AQUI, 'voz', `${e.id}_${i}.wav`));
  const huella = crypto.createHash('sha1').update(`${e.voz}|${velocidad}`).digest('hex').slice(0, 8);
  const rel = `voz/${ID}/${e.id}-${huella}.wav`;
  const abs = R.medio(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const T = tiempos(e.id);
  const entradas = wavs.flatMap((w) => ['-i', w]);
  const partes = wavs.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,atempo=${TEMPO}${i < wavs.length - 1 ? `,apad=pad_dur=${HUECO}` : ''}[a${i}]`).join(';');
  const filtro = `${partes};${wavs.map((_, i) => `[a${i}]`).join('')}concat=n=${wavs.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5[o]`;
  execFileSync(R.FFMPEG, ['-loglevel', 'error', '-y', ...entradas, '-filter_complex', filtro, '-map', '[o]', '-ar', '48000', '-t', String(T.voz), abs]);
  generado.voces[e.id] = { archivo: rel, dur: Number(T.voz.toFixed(3)), texto: e.voz };
}

const proyecto = {
  id: ID, nombre: V ? 'ClipViral · clientes · estilo pop (vertical)' : 'ClipViral · clientes · estilo pop',
  formato: FORMATO, fps: 30, ritmo: { antes: ANTES, despues: DESPUES }, voz: { velocidad },
  musica: { archivo: 'musica/energia.mp3', volumen: 0.1, volumenSinVoz: 0.2 },
  marca: {
    nombre: 'ClipViral', partes: ['Clip', 'Viral'],
    colores: { a: ROJO, b: AMAR, c: AZUL, fondo: PAPEL, capa: BLANCO, texto: TINTA, texto2: '#3a3a44', tinta: TINTA, exito: VERDE },
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
