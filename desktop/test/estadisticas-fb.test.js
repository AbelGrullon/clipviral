const test = require('node:test');
const assert = require('node:assert');
const { FETCHERS } = require('../engine/estadisticas');

const gone = () => Response.json({ error: { message: "Unsupported get request. Object with ID 'X' does not exist", code: 100, error_subcode: 33 } }, { status: 400 });

test('Facebook: un video que ya no existe se salta y los demás se leen', async () => {
  const real = global.fetch;
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/MALO')) return gone();
    if (u.includes('/BUENO/video_insights')) return Response.json({ data: [{ name: 'blue_reels_play_count', values: [{ value: 120 }] }] });
    throw new Error(`inesperado ${u}`);
  };
  try {
    const out = await FETCHERS.facebook(['MALO', 'BUENO'], { accessToken: 't' });
    assert.deepEqual(Object.keys(out), ['BUENO']);
    assert.equal(out.BUENO.views, 120);
  } finally { global.fetch = real; }
});

test('Facebook: un token vencido sí avisa', async () => {
  const real = global.fetch;
  global.fetch = async () => Response.json({ error: { message: 'Session has expired', code: 190 } }, { status: 401 });
  try {
    await assert.rejects(FETCHERS.facebook(['A'], { accessToken: 't' }), /expired/);
  } finally { global.fetch = real; }
});
