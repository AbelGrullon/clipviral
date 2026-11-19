// Calidad de la cámara en vertical: agrandar con nitidez, bajar en 1440p cuando hay zoom y elegir el mejor formato.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { videoFilter, nitidez } = require('../engine/clipper');
const { VIDEO_FORMAT } = require('../engine/vod');

test('nitidez: nada si casi no se agranda; más enfoque cuanto más se agranda (con tope)', () => {
  assert.deepEqual(nitidez(1), { antes: '', despues: '' });
  assert.deepEqual(nitidez(1.05), { antes: '', despues: '' });
  assert.deepEqual(nitidez(1.3), { antes: '', despues: ',cas=0.43' });
  // Solo la cámara se limpia antes de agrandar, y solo si se agranda bastante.
  assert.equal(nitidez(1.3, { limpiar: true }).antes, '');
  assert.equal(nitidez(2.2, { limpiar: true }).antes, 'hqdn3d=2:1.5:3:3,');
  assert.equal(nitidez(2.2).antes, '');
  assert.equal(nitidez(5).despues, ',cas=0.75');
});

test('cámara grande (directo en 1440p): casi no se agranda y no se toca', () => {
  const split = { camCrop: { x: 0, y: 0, w: 1080, h: 610 }, camH: 610, gameH: 1310, gameCrop: { x: 0, y: 0, w: 1080, h: 1310 } };
  const f = videoFilter('camara', false, { split });
  assert.match(f, /crop=1080:610:0:0,scale=1080:610:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:610,setsar=1\[top\]/);
  assert.doesNotMatch(f, /cas=|hqdn3d/);
});

test('vertical recortado: se agranda con Lanczos y enfoque suave; los demás formatos no cambian', () => {
  assert.match(videoFilter('recorte', false), /force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,cas=0\.57,setsar=1/);
  assert.doesNotMatch(videoFilter('blur', false), /cas=/);
  assert.doesNotMatch(videoFilter('horizontal', false), /cas=/);
});

test('videos subidos: primero VP9 normal (no HDR) hasta la altura pedida; si no hay, H.264 como antes', () => {
  const f = VIDEO_FORMAT(1440).split('/');
  assert.equal(f[0], "bv*[height<=1440][vcodec~='^(vp9|vp09\\.00)']+ba[ext=m4a]");
  assert.equal(f[1], 'bv*[height<=1440][vcodec^=avc1]+ba[ext=m4a]');
  assert.equal(f[f.length - 1], 'b');
});
