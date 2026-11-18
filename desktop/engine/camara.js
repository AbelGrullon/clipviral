// Formato "Cámara + juego": en un directo horizontal encuentra el recuadro de la cámara del streamer
// y prepara el video vertical con la cámara arriba y el juego abajo.
//  1. La IA que mira el video (o Claude, en el plan Claude) dice dónde está el recuadro.
//  2. El borde se ajusta solo al marco real (las orillas que no cambian de una foto a otra).
//  3. Se miden las franjas negras del juego (las de cine) para no meterlas en el vertical.
//  4. Se elige qué parte del juego va abajo, sin que se cuele la cámara.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');
const { grabFrames } = require('./vista');

const OLLAMA = 'http://127.0.0.1:11434';
const OUT_W = 1080;
const OUT_H = 1920;

const SCHEMA = {
  type: 'object',
  properties: { camara: { type: 'boolean' }, caja: { type: 'array', items: { type: 'integer' } } },
  required: ['camara', 'caja'],
};

const PROMPT = 'This is a frame from a live stream. Many streamers show their webcam (the real person filmed by a camera) '
  + 'in a small rectangle on top of the game. If there is a webcam rectangle, give its bounding box as [x1, y1, x2, y2] '
  + 'in 0-1000 relative coordinates, covering the whole webcam rectangle including its frame. '
  + 'Characters inside the game are NOT the webcam. If the whole image is a camera (no game), answer false. '
  + 'Reply JSON: {"camara": true|false, "caja": [x1,y1,x2,y2]}';

/** Convierte [x1,y1,x2,y2] (0 a 1000) en { x, y, w, h } (0 a 1). null si no tiene sentido como cámara. */
function boxFrom(caja) {
  if (!Array.isArray(caja) || caja.length !== 4) return null;
  const [x1, y1, x2, y2] = caja.map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const c = (v) => Math.max(0, Math.min(1000, v)) / 1000;
  const box = { x: c(Math.min(x1, x2)), y: c(Math.min(y1, y2)), w: 0, h: 0 };
  box.w = c(Math.max(x1, x2)) - box.x;
  box.h = c(Math.max(y1, y2)) - box.y;
  return validBox(box) ? box : null;
}

/** Una cámara de streamer: ni diminuta ni casi toda la pantalla (eso ya no es "cámara + juego"). */
function validBox(b) {
  if (!b || ![b.x, b.y, b.w, b.h].every(Number.isFinite)) return false;
  const area = b.w * b.h;
  return b.w >= 0.08 && b.h >= 0.08 && area >= 0.015 && area <= 0.45 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.001 && b.y + b.h <= 1.001;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

/**
 * Junta lo que se vio en varias fotos: la mayoría tiene que ver la cámara y en el mismo lugar.
 * Devuelve la caja del medio (mediana de cada borde) o null.
 */
function agree(boxes) {
  const seen = boxes.filter(Boolean);
  if (!seen.length || seen.length * 2 < boxes.length) return null;
  const med = (k) => { const v = seen.map(k).sort((p, q) => p - q); return v[Math.floor((v.length - 1) / 2)]; };
  const x1 = med((b) => b.x); const y1 = med((b) => b.y);
  const box = { x: x1, y: y1, w: med((b) => b.x + b.w) - x1, h: med((b) => b.y + b.h) - y1 };
  if (!validBox(box)) return null;
  const close = seen.filter((b) => iou(b, box) >= 0.6).length;
  return close * 2 >= boxes.length ? box : null;
}

// Para ubicar la cámara alcanza un modelo liviano: el de 4b acierta casi al píxel y responde en ~1 s por foto.
const CAM_MODELS = ['qwen3-vl:4b-instruct', 'qwen3-vl:2b-instruct', 'qwen3-vl:8b-instruct', 'qwen3-vl'];

/**
 * Qué modelo de Ollama usar para encontrar la cámara: el que elegiste en Ajustes si está descargado;
 * si no elegiste ninguno, uno que ve imágenes y ya esté instalado. null si no hay (o Ollama está apagado).
 */
async function localCamModel(preferred) {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
    const { models = [] } = await res.json();
    const names = models.map((m) => m.name || m.model || '');
    const has = (id) => names.find((n) => n === id || n.startsWith(`${id}:`) || n.startsWith(id));
    if (preferred && has(preferred)) return has(preferred);
    for (const id of CAM_MODELS) if (has(id)) return has(id);
    return null;
  } catch {
    return null;
  }
}

/** La IA local mira una foto y dice dónde está la cámara. */
async function askLocal(model, b64, { timeoutMs = 180000 } = {}) {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model, stream: false, format: SCHEMA, keep_alive: '30m', options: { temperature: 0 },
      messages: [{ role: 'user', content: PROMPT, images: [b64] }],
    }),
  });
  if (!res.ok) throw new Error(`La IA que mira el video respondió ${res.status}`);
  const body = await res.json();
  let parsed = {};
  try { parsed = JSON.parse(body.message?.content || '{}'); } catch {}
  return parsed.camara ? boxFrom(parsed.caja) : null;
}

/** Fotos en gris y chicas (para medir bordes): [{ w, h, px: Uint8Array }]. */
async function grayFrames({ ffmpeg, segments, times, tempDir, w = 480, h = 270 }) {
  fs.mkdirSync(tempDir, { recursive: true });
  const out = [];
  for (const [i, t] of times.entries()) {
    const seg = segments.find((s) => t >= s.start && t < s.start + s.duration) || segments[segments.length - 1];
    if (!seg) continue;
    const file = path.join(tempDir, `gris-${i}.raw`);
    try {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', Math.max(0, t - seg.start).toFixed(2), '-i', seg.file,
        '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', file]);
      const px = fs.readFileSync(file);
      if (px.length === w * h) out.push({ w, h, px });
    } catch {
      // Una foto que no sale no frena nada.
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  return out;
}

/**
 * Ajusta la caja al marco real de la cámara: busca cerca de cada borde la línea que se ve en TODAS las fotos
 * (el marco no se mueve; el juego sí). Si no hay una línea clara, deja el borde como estaba.
 */
function refineBox(box, frames) {
  if (!frames.length) return box;
  const { w: W, h: H } = frames[0];
  // Borde "fijo": de cada píxel, el cambio más chico entre todas las fotos.
  const gx = new Float32Array(W * H).fill(Infinity);
  const gy = new Float32Array(W * H).fill(Infinity);
  for (const { px } of frames) {
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        gx[i] = Math.min(gx[i], Math.abs(px[i + 1] - px[i - 1]));
        gy[i] = Math.min(gy[i], Math.abs(px[i + W] - px[i - W]));
      }
    }
  }
  const col = (x, ya, yb) => { let s = 0; for (let y = ya; y < yb; y++) s += gx[y * W + x]; return s / Math.max(1, yb - ya); };
  const row = (y, xa, xb) => { let s = 0; for (let x = xa; x < xb; x++) s += gy[y * W + x]; return s / Math.max(1, xb - xa); };
  const bx1 = box.x * W; const bx2 = (box.x + box.w) * W;
  const by1 = box.y * H; const by2 = (box.y + box.h) * H;
  // Se mide en la parte central de cada lado (las esquinas a veces son redondas).
  const ya = Math.round(by1 + (by2 - by1) * 0.15); const yb = Math.round(by2 - (by2 - by1) * 0.15);
  const xa = Math.round(bx1 + (bx2 - bx1) * 0.15); const xb = Math.round(bx2 - (bx2 - bx1) * 0.15);
  const snap = (pos, max, score, reach) => {
    const lo = Math.max(1, Math.round(pos - reach)); const hi = Math.min(max - 2, Math.round(pos + reach));
    let best = Math.round(Math.max(1, Math.min(max - 2, pos))); let bestScore = score(best);
    const startScore = bestScore;
    for (let p = lo; p <= hi; p++) { const s = score(p); if (s > bestScore) { best = p; bestScore = s; } }
    // Solo si es una línea de verdad: fuerte y bastante más marcada que donde estaba.
    return bestScore >= 14 && bestScore >= startScore * 1.3 ? best : pos;
  };
  const rx = Math.max(4, W * 0.05); const ry = Math.max(4, H * 0.06);
  const x1 = snap(bx1, W, (x) => col(x, ya, yb), rx);
  const x2 = snap(bx2, W, (x) => col(x, ya, yb), rx);
  const y1 = snap(by1, H, (y) => row(y, xa, xb), ry);
  const y2 = snap(by2, H, (y) => row(y, xa, xb), ry);
  const out = { x: x1 / W, y: y1 / H, w: (x2 - x1) / W, h: (y2 - y1) / H };
  return validBox(out) && iou(out, box) >= 0.5 ? out : box;
}

/**
 * Franjas negras (las de cine, arriba/abajo o a los lados): filas o columnas oscuras y parejas en TODAS las fotos.
 * Devuelve el área del juego (0 a 1).
 */
function blackBars(frames) {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  if (!frames.length) return full;
  const { w: W, h: H } = frames[0];
  const dark = (get, n) => frames.every(({ px }) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += get(px, i);
    const mean = sum / n;
    let dev = 0;
    for (let i = 0; i < n; i++) dev += Math.abs(get(px, i) - mean);
    return mean <= 28 && dev / n <= 4;
  });
  const rowDark = (y) => dark((px, i) => px[y * W + i], W);
  const colDark = (x) => dark((px, i) => px[i * W + x], H);
  let top = 0; while (top < H * 0.25 && rowDark(top)) top++;
  let bottom = H; while (bottom > H * 0.75 && rowDark(bottom - 1)) bottom--;
  let left = 0; while (left < W * 0.25 && colDark(left)) left++;
  let right = W; while (right > W * 0.75 && colDark(right - 1)) right--;
  // Un pixel de margen: el borde de la franja a veces queda medio gris.
  if (top) top++; if (bottom < H) bottom--; if (left) left++; if (right < W) right--;
  return { x: left / W, y: top / H, w: (right - left) / W, h: (bottom - top) / H };
}

/** Mide el video: tamaño en píxeles y dónde está el juego de verdad (sin franjas negras). */
async function measureVideo({ ffmpeg, segments, times, tempDir }) {
  const seg = segments[0];
  if (!seg) return null;
  let size = null;
  try {
    const { err } = await run(ffmpeg, ['-hide_banner', '-i', seg.file, '-frames:v', '1', '-an', '-f', 'null', '-'], { timeoutMs: 60000 });
    const dims = err.match(/Video:.*?\b(\d{3,5})x(\d{3,5})\b/);
    if (dims) size = { w: Number(dims[1]), h: Number(dims[2]) };
  } catch {}
  if (!size) return null;
  const area = blackBars(await grayFrames({ ffmpeg, segments, times, tempDir }));
  const game = { x: Math.round(area.x * size.w), y: Math.round(area.y * size.h), w: Math.round(area.w * size.w), h: Math.round(area.h * size.h) };
  return { ...size, game };
}

const even = (v) => Math.max(0, Math.round(v / 2) * 2);

/**
 * Plan del vertical: qué parte va arriba (cámara) y qué parte del juego va abajo, en píxeles del video.
 * cam: caja de la cámara (0 a 1). video: { w, h, game: { x, y, w, h } }.
 */
function planSplit(cam, video) {
  const W = video.w; const H = video.h;
  const g = video.game || { x: 0, y: 0, w: W, h: H };
  // Cámara: un poquito hacia adentro, para que no se cuele una raya del juego.
  const inX = cam.w * W * 0.012; const inY = cam.h * H * 0.012;
  const camPx = { x: cam.x * W, y: cam.y * H, w: cam.w * W, h: cam.h * H };
  const camCrop = {
    x: even(camPx.x + inX), y: even(camPx.y + inY),
    w: even(camPx.w - 2 * inX), h: even(camPx.h - 2 * inY),
  };
  camCrop.w = Math.min(camCrop.w, W - camCrop.x);
  camCrop.h = Math.min(camCrop.h, H - camCrop.y);
  // Alto de la cámara en el vertical: según su forma, entre un 25 % y un 40 % de la pantalla.
  const camH = even(Math.max(480, Math.min(760, OUT_W / (camCrop.w / camCrop.h))));
  const gameH = OUT_H - camH;
  const ratio = OUT_W / gameH;
  // Juego: el pedazo más grande con la forma de la parte de abajo.
  let cw = Math.min(g.w, g.h * ratio);
  let ch = cw / ratio;
  if (ch > g.h) { ch = g.h; cw = ch * ratio; }
  cw = even(cw); ch = even(ch);
  // Margen alrededor de la cámara: muchos marcos tienen sombra o brillo que se sale de la caja.
  const gap = Math.max(24, W * 0.025);
  const avoid = { x: camPx.x - gap, y: camPx.y - gap, w: camPx.w + 2 * gap, h: camPx.h + 2 * gap };
  const overlap = (x) => {
    const ix = Math.max(0, Math.min(x + cw, avoid.x + avoid.w) - Math.max(x, avoid.x));
    const top = g.y + (g.h - ch) / 2;
    const iy = Math.max(0, Math.min(top + ch, avoid.y + avoid.h) - Math.max(top, avoid.y));
    return ix * iy;
  };
  const minX = g.x; const maxX = g.x + g.w - cw;
  const center = g.x + (g.w - cw) / 2;
  let x = center;
  if (overlap(center) > 0) {
    // Se corre hacia el lado contrario de la cámara; si no alcanza, el lugar donde menos se ve.
    const options = [avoid.x - cw, avoid.x + avoid.w, minX, center, maxX]
      .map((v) => Math.max(minX, Math.min(maxX, v)))
      .sort((a, b) => overlap(a) - overlap(b) || Math.abs(a - center) - Math.abs(b - center));
    x = options[0];
  }
  const gameCrop = { x: even(Math.max(0, x)), y: even(g.y + (g.h - ch) / 2), w: cw, h: ch };
  return { camCrop, camH, gameH, gameCrop };
}

/**
 * Busca la cámara en un tramo del video.
 * Con IA local (model): 3 fotos y la mayoría tiene que coincidir. Sin ella, askClaude([fotos]) → [x1,y1,x2,y2] | null.
 * Devuelve { box, b64 (una foto para mostrar), by: 'local'|'claude' } o { box: null }.
 */
async function findCamera({ ffmpeg, segments, times, tempDir, model, askClaude }) {
  const frames = await grabFrames({ ffmpeg, segments, times, tempDir, width: 960 });
  if (!frames.length) return { box: null };
  let box = null;
  let by = null;
  if (model) {
    const boxes = [];
    for (const f of frames) boxes.push(await askLocal(model, f.b64).catch(() => null));
    box = agree(boxes);
    by = 'local';
  } else if (askClaude) {
    box = boxFrom(await askClaude(frames.slice(0, 2).map((f) => f.b64)));
    by = 'claude';
  }
  if (box) box = refineBox(box, await grayFrames({ ffmpeg, segments, times, tempDir }));
  return { box, b64: frames[Math.floor(frames.length / 2)].b64, by };
}

/** Cámaras marcadas a mano, por canal (los streamers casi siempre la tienen en el mismo lugar). */
class CamStore {
  constructor(file) { this.file = file; }
  #all() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  static key(channel) { return String(channel || '').trim().toLowerCase() || '(sin canal)'; }
  get(channel) {
    const it = this.#all()[CamStore.key(channel)];
    return it && validBox(it.box) ? it.box : null;
  }
  set(channel, box) {
    const all = this.#all();
    const k = CamStore.key(channel);
    if (box && validBox(box)) all[k] = { box, at: new Date().toISOString() };
    else delete all[k];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2));
  }
  list() { return Object.entries(this.#all()).map(([channel, v]) => ({ channel, ...v })); }
}

module.exports = { boxFrom, validBox, iou, agree, refineBox, blackBars, grayFrames, measureVideo, planSplit, findCamera, localCamModel, CamStore, PROMPT, SCHEMA };
