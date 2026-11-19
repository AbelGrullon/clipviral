// Avisos de FFmpeg al grabar un directo: el ruido de red (YouTube cierra la conexión y FFmpeg abre otra sola)
// no se muestra; los problemas de verdad sí.
const test = require('node:test');
const assert = require('node:assert');
const { ffmpegWarnings } = require('../engine/recorder');

test('el corte de conexión que FFmpeg arregla solo no sale en "Lo que está pasando"', () => {
  const ruido = [
    '[tls @ 0000020980548100] Error in the pull function.',
    '[tls @ 0000020980548100] IO error: End of file',
    '[https @ 0000020983369180] Error reading HTTP response: End of file',
    "[hls @ 00000209805a1c40] keepalive request failed for 'https://rr3---sn.googlevideo.com/x' with error: 'End of file' when opening url, retrying with new connection",
    '[https @ 0000020983369180] Will reconnect at 1234 in 0 second(s), error=End of file.',
  ].join('\r\n');
  assert.strictEqual(ffmpegWarnings(ruido), '');
  assert.strictEqual(ffmpegWarnings(''), '');
});

test('los errores de verdad se siguen mostrando (sin el ruido de al lado)', () => {
  const t = '[tls @ 01] IO error: End of file\n[hls @ 02] Failed to open segment 1234 of playlist 0\n';
  assert.strictEqual(ffmpegWarnings(t), '[hls @ 02] Failed to open segment 1234 of playlist 0');
  assert.strictEqual(ffmpegWarnings('No space left on device'), 'No space left on device');
});
