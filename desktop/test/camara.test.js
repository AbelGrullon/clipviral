const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { boxFrom, validBox, agree, iou, blackBars, refineBox, planSplit, CamStore } = require('../engine/camara');
const { videoFilter, subsInCam, CAM_SUB_SCALE } = require('../engine/clipper');
const { buildAss } = require('../engine/subtitles');

test('caja de la IA: 0-1000 a 0-1, y descarta lo que no puede ser una cámara', () => {
  const b = boxFrom([708, 173, 980, 453]);
  assert.ok(Math.abs(b.x - 0.708) < 1e-9 && Math.abs(b.w - 0.272) < 1e-9 && Math.abs(b.h - 0.28) < 1e-9);
  assert.deepStrictEqual(boxFrom([980, 453, 708, 173]), b, 'las esquinas al revés también sirven');
  assert.strictEqual(boxFrom([0, 0, 1000, 1000]), null, 'toda la pantalla no es "cámara + juego"');
  assert.strictEqual(boxFrom([10, 10, 40, 40]), null, 'demasiado chica');
  assert.strictEqual(boxFrom([1, 2, 3]), null);
  assert.strictEqual(boxFrom(null), null);
});

test('varias fotos: la mayoría tiene que ver la cámara en el mismo lugar', () => {
  const a = { x: 0.71, y: 0.17, w: 0.27, h: 0.28 };
  const b = { x: 0.712, y: 0.172, w: 0.268, h: 0.279 };
  const lejos = { x: 0.05, y: 0.6, w: 0.25, h: 0.3 };
  const ok = agree([a, b, { ...a, x: 0.709 }]);
  assert.ok(ok && iou(ok, a) > 0.95);
  assert.ok(agree([a, b, null]), '2 de 3 alcanza');
  assert.strictEqual(agree([a, null, null]), null, '1 de 3 no alcanza');
  assert.strictEqual(agree([a, lejos, { x: 0.4, y: 0.05, w: 0.2, h: 0.2 }]), null, 'si no coinciden, no se adivina');
  assert.strictEqual(agree([]), null);
});

// Foto gris de prueba: juego "ruidoso", franjas negras arriba y abajo, y un marco fijo de cámara.
function fakeFrames(n = 3, { W = 480, H = 270, bars = 16, cam = { x: 340, y: 48, w: 128, h: 74 } } = {}) {
  const frames = [];
  for (let f = 0; f < n; f++) {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (y < bars || y >= H - bars) { px[i] = 8; continue; }
        px[i] = 40 + ((x * 7 + y * 13 + f * 101) % 90); // el juego cambia de una foto a otra
        const inCam = x >= cam.x && x < cam.x + cam.w && y >= cam.y && y < cam.y + cam.h;
        const onBorder = inCam && (x < cam.x + 3 || x >= cam.x + cam.w - 3 || y < cam.y + 3 || y >= cam.y + cam.h - 3);
        if (onBorder) px[i] = 250; // marco fijo y brillante
        else if (inCam) px[i] = 120;
      }
    }
    frames.push({ w: W, h: H, px });
  }
  return frames;
}

test('franjas negras de cine: se encuentran y no se meten en el vertical', () => {
  const area = blackBars(fakeFrames());
  assert.ok(Math.abs(area.y - 17 / 270) < 0.01, `arriba ${area.y}`);
  assert.ok(Math.abs(area.y + area.h - (270 - 17) / 270) < 0.01, `abajo ${area.y + area.h}`);
  assert.strictEqual(area.x, 0);
  assert.strictEqual(area.w, 1);
  assert.deepStrictEqual(blackBars(fakeFrames(3, { bars: 0 })), { x: 0, y: 0, w: 1, h: 1 });
});

test('el borde de la cámara se ajusta solo al marco real', () => {
  const frames = fakeFrames();
  const real = { x: 340 / 480, y: 48 / 270, w: 128 / 480, h: 74 / 270 };
  const corrida = { x: real.x - 0.025, y: real.y + 0.03, w: real.w + 0.04, h: real.h - 0.05 };
  const fixed = refineBox(corrida, frames);
  assert.ok(iou(fixed, real) > 0.93, `iou ${iou(fixed, real)}`);
  assert.ok(iou(fixed, real) > iou(corrida, real));
});

test('plan del vertical: cámara arriba, juego abajo sin franjas y sin que se cuele la cámara', () => {
  const cam = { x: 0.7125, y: 0.181, w: 0.2675, h: 0.2704 };
  const plan = planSplit(cam, { w: 1920, h: 1080, game: { x: 0, y: 64, w: 1920, h: 952 } });
  assert.strictEqual(plan.camH + plan.gameH, 1920);
  const g = plan.gameCrop;
  for (const v of [g.x, g.y, g.w, g.h, plan.camCrop.x, plan.camCrop.w]) assert.strictEqual(v % 2, 0, 'medidas pares (las pide el video)');
  assert.ok(g.y >= 64 && g.y + g.h <= 64 + 952, 'el juego no toma las franjas negras');
  assert.ok(g.x + g.w <= cam.x * 1920 - 40, 'el pedazo del juego queda al lado de la cámara, con margen (el brillo del marco no se cuela)');
  // Sin franjas (juego a pantalla completa): el recorte es más ancho y aun así no toca la cámara.
  const full = planSplit(cam, { w: 1920, h: 1080 });
  assert.ok(full.gameCrop.x + full.gameCrop.w <= cam.x * 1920 - 40, `${full.gameCrop.x + full.gameCrop.w}`);
  assert.ok(Math.abs(g.w / g.h - 1080 / plan.gameH) < 0.01, 'misma forma que la parte de abajo');
  const c = plan.camCrop;
  assert.ok(c.x >= cam.x * 1920 && c.x + c.w <= (cam.x + cam.w) * 1920 + 1, 'la cámara se recorta hacia adentro');

  // Cámara abajo a la izquierda: el juego se corre o queda centrado, pero siempre dentro del cuadro.
  const p2 = planSplit({ x: 0.02, y: 0.65, w: 0.25, h: 0.3 }, { w: 1280, h: 720 });
  assert.ok(p2.gameCrop.x >= 0 && p2.gameCrop.x + p2.gameCrop.w <= 1280);
  assert.ok(p2.camH >= 480 && p2.camH <= 760);
});

test('filtro de FFmpeg: apila cámara y juego; sin plan, el formato normal', () => {
  const split = { camCrop: { x: 1374, y: 200, w: 502, h: 284 }, camH: 610, gameH: 1310, gameCrop: { x: 568, y: 64, w: 784, h: 952 } };
  const f = videoFilter('camara', true, { split, mirror: true });
  // La cámara se agranda más del doble: se limpia el ruido, se agranda con Lanczos y se enfoca. El juego, solo enfoque suave.
  assert.match(f, /crop=502:284:1374:200,hqdn3d=2:1\.5:3:3,hflip,scale=1080:610:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:610,cas=0\.67,/);
  assert.match(f, /crop=784:952:568:64,hflip,scale=1080:1310:flags=lanczos,cas=0\.46,/);
  assert.match(f, /vstack=inputs=2/);
  assert.match(f, /ass=subs\.ass/);
  assert.doesNotMatch(f, /fps=30,hflip,split/, 'el espejo va después de recortar');
  assert.doesNotMatch(videoFilter('camara', false, {}), /vstack/);
});

test('subtítulos en Cámara + juego: más chicos y abajo dentro de la cámara', () => {
  const ass = buildAss([{ s: 0, e: 1, w: 'hola' }, { s: 1, e: 2, w: 'chat' }], { size: 'normal', position: 'arriba', titleBanner: { text: 'Título' } }, 2);
  const out = subsInCam(ass, 610);
  const f = out.match(/^Style: Viral,.*$/m)[0].split(',');
  assert.strictEqual(Number(f[2]), Math.round(86 * CAM_SUB_SCALE), 'más chicos que el tamaño elegido');
  assert.strictEqual(f[18], '2', 'abajo al centro (sin importar la posición elegida)');
  const desdeAbajo = Number(f[21]);
  assert.ok(desdeAbajo > 1920 - 610 && desdeAbajo < 1920 - 610 + 80, `quedan justo arriba del juego, dentro de la cámara (${desdeAbajo})`);
  const sinViral = (s) => s.replace(/^Style: Viral,.*$/m, '');
  assert.strictEqual(sinViral(out), sinViral(ass), 'el resto (título, marca, tiempos) queda igual');
});

test('cámaras marcadas a mano: se guardan por canal', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cam-')), 'camaras.json');
  const store = new CamStore(file);
  const box = { x: 0.7, y: 0.2, w: 0.25, h: 0.27 };
  store.set('Kesto', box);
  assert.deepStrictEqual(store.get('kesto '), box, 'sin importar mayúsculas ni espacios');
  assert.strictEqual(store.get('Otro'), null);
  store.set('Grande', { x: 0, y: 0, w: 1, h: 1 });
  assert.strictEqual(store.get('Grande'), null, 'no guarda una caja que no es cámara');
  store.set('Kesto', null);
  assert.strictEqual(store.get('Kesto'), null);
  assert.ok(validBox(box));
});
