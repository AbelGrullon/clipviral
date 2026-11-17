// El juez de la IA local: junta lo que dicen la voz y el chat, el oído (detector de sonidos)
// y los ojos (modelo de visión), y solo deja pasar el momento si coinciden.
const { describe } = require('./sonido');

// Cuántas señales tienen que estar de acuerdo, según la sensibilidad elegida.
const NEED = { baja: 3, media: 2, alta: 2 };
// Nota mínima de la IA (si la hay) para que el clip salga.
const MIN_VIRAL = { baja: 6, media: 5, alta: 4 };

/**
 * peak: { score, chat, loud } del detector · sound: categorías {risas, gritos, …} (0-1) y su score · vision: respuesta del modelo
 * Devuelve { keep, votes, needed, available, score (1-10), reason, why (lista de lo que coincidió) }.
 */
function judge({ peak = {}, sound = null, vision = null, threshold = 2.2, sensitivity = 'media' }) {
  const signals = [];
  // 1) Voz, volumen y chat (lo que ya medía el detector).
  const chatStrong = (peak.chat || 0) >= 2;
  const loudStrong = (peak.loud || 0) >= 2.5;
  // Sin oído ni ojos el pico ya pasó el umbral del detector: vale como antes.
  const alone = !sound && !vision;
  const voice = alone || (peak.score || 0) >= threshold * 1.15 || chatStrong || loudStrong;
  signals.push({ id: 'voz', ok: voice, text: chatStrong ? 'explosión en el chat' : loudStrong ? 'subida fuerte de volumen' : 'lo que se dice' });
  // 2) Oído.
  if (sound) {
    const heard = describe(sound.cats);
    signals.push({ id: 'sonido', ok: !!heard || (sound.score || 0) >= 1, text: heard ? `se oyen ${heard}` : 'sonido intenso' });
  }
  // 3) Ojos.
  if (vision) {
    signals.push({ id: 'imagen', ok: vision.imagen >= 6, text: vision.que_pasa ? `se ve: ${vision.que_pasa}` : 'la imagen engancha' });
    // Si la IA lo ve clarísimo (8+ en todo), cuenta como un voto más.
    if (vision.viral >= 8 && vision.imagen >= 8) signals.push({ id: 'ia', ok: true, extra: true, text: '' });
  }

  const available = signals.filter((x) => !x.extra).length;
  const needed = Math.min(NEED[sensitivity] ?? 2, Math.max(1, available));
  const votes = signals.filter((s) => s.ok).length;
  const minViral = MIN_VIRAL[sensitivity] ?? 5;
  const aiOk = !vision || vision.viral >= minViral;
  const keep = votes >= needed && aiOk;

  // Nota final: la de la IA si miró el video; si no, una mezcla de las señales.
  const base = Math.min(10, 3 + (peak.score || 0) * 1.2 + (sound?.score || 0) * 0.8);
  const score = Math.max(1, Math.min(10, Math.round(vision ? 0.6 * vision.viral + 0.25 * vision.imagen + 0.15 * base + (votes - 1) * 0.3 : base)));
  const why = signals.filter((x) => x.ok && x.text).map((x) => x.text);
  const reason = why.length ? capitalize(why.join(' + ')) : 'Momento con actividad';
  return { keep, votes, needed, available, score, reason, why, aiOk };
}

const capitalize = (t) => t.charAt(0).toUpperCase() + t.slice(1);

module.exports = { judge, NEED, MIN_VIRAL };
