// Detector local de momentos virales: mezcla volumen, actividad del chat y palabras clave.

const HYPE_SPEECH = /\b(ja(ja)+|je(je)+|no puede ser|qu[eé] (fue|pas[oó])|dios m[ií]o|incre[ií]ble|wow|omg|what|no manches|no mames|mira(lo)?|ayuda|corre|vamos+|goo+l|let'?s go|oh my god|oh no|ostia|madre m[ií]a|bro)\b/i;
const HYPE_CHAT = /(ja(ja)+|je(je)+|xd+|lol+|lmao|kek|clip|😂|🤣|💀|😱|🔥|wtf|omg|gg+|no puede ser|que fue|qu[eé] pas[oó]|(^|\s)f+(\s|$))/i;
const LAUGH_CHAT = /(ja(ja)+|je(je)+|xd+|lol+|lmao|kek|😂|🤣|💀)/i;

const SENSITIVITY = { baja: 3.0, media: 2.2, alta: 1.6 };
const CHAT_LAG = 8; // el chat reacciona unos segundos después

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

class Timeline {
  constructor() {
    this.words = [];      // {s, e, w}
    this.loud = [];       // dB por segundo (índice = segundo)
    this.chat = [];       // {t, text}
    this.sound = [];      // {t, cats, score}: lo que oyó el detector de sonidos (cada 10 s)
    this.until = 0;       // segundos ya procesados
  }

  addSegment(offset, duration, words, loudness) {
    for (const w of words) this.words.push({ s: w.s + offset, e: w.e + offset, w: w.w });
    loudness.forEach((db, i) => { this.loud[Math.floor(offset) + i] = db; });
    this.until = Math.max(this.until, offset + duration);
  }

  /** Lo que oyó el detector de sonidos en un pedazo (t relativo al pedazo). */
  addSound(offset, windows) {
    for (const w of windows) this.sound.push({ t: w.t + offset, cats: w.cats, score: w.score });
    this.sound.sort((a, b) => a.t - b.t);
  }

  /** Ventanas de sonido que tocan el tramo a-b. */
  soundBetween(a, b) {
    return this.sound.filter((w) => w.t + 10 > a && w.t < b);
  }

  /** Puntaje de sonido para un segundo (la ventana de 10 s que lo contiene). */
  soundAt(t) {
    let best = 0;
    for (const w of this.sound) {
      if (w.t > t) break;
      if (t < w.t + 10) best = Math.max(best, w.score);
    }
    return best;
  }

  addChat(t, text) {
    if (t >= 0) this.chat.push({ t, text });
  }

  wordsBetween(a, b) {
    return this.words.filter((w) => w.e > a && w.s < b);
  }

  chatBetween(a, b) {
    return this.chat.filter((c) => c.t >= a && c.t < b);
  }

  /** Líneas de transcripción (frases cortas con su segundo de inicio). */
  lines(a, b) {
    const out = [];
    let cur = null;
    for (const w of this.wordsBetween(a, b)) {
      if (!cur || w.s - cur.end > 0.8 || cur.count >= 14) {
        if (cur) out.push({ t: Math.round(cur.t), text: cur.text.trim() });
        cur = { t: w.s, end: w.e, text: '', count: 0 };
      }
      cur.text += ` ${w.w}`;
      cur.end = w.e;
      cur.count += 1;
    }
    if (cur) out.push({ t: Math.round(cur.t), text: cur.text.trim() });
    return out;
  }

  /** Resumen del chat cada 10 s (para la IA). */
  chatBins(a, b) {
    const bins = [];
    for (let t = Math.floor(a / 10) * 10; t < b; t += 10) {
      const msgs = this.chatBetween(t, t + 10);
      if (!msgs.length) continue;
      const samples = [...new Set(msgs.map((m) => m.text.trim()).filter(Boolean))]
        .sort((x, y) => (HYPE_CHAT.test(y) ? 1 : 0) - (HYPE_CHAT.test(x) ? 1 : 0)).slice(0, 4);
      bins.push({ t, count: msgs.length, laughs: msgs.filter((m) => LAUGH_CHAT.test(m.text)).length, samples });
    }
    return bins;
  }

  chatSummary(a, b) {
    const msgs = this.chatBetween(a, b + CHAT_LAG);
    if (!msgs.length) return '';
    const laughs = msgs.filter((m) => LAUGH_CHAT.test(m.text)).length;
    const examples = msgs.filter((m) => HYPE_CHAT.test(m.text)).slice(0, 5).map((m) => `"${m.text.slice(0, 60)}"`).join(', ');
    return `${msgs.length} mensajes, ${laughs} risas. ${examples}`;
  }

  /** Puntaje por segundo entre a y b. */
  scores(a, b) {
    const from = Math.max(0, Math.floor(a));
    const to = Math.floor(Math.min(b, this.until));
    const histStart = Math.max(0, from - 300);

    const loudHist = this.loud.slice(histStart, to).filter((v) => Number.isFinite(v));
    const loudMed = median(loudHist);
    const loudMad = median(loudHist.map((v) => Math.abs(v - loudMed))) * 1.4826 + 1;

    const chatCount = new Map();
    for (const c of this.chat) {
      if (c.t < histStart || c.t > to + CHAT_LAG + 5) continue;
      const k = Math.floor(c.t);
      chatCount.set(k, (chatCount.get(k) || 0) + (HYPE_CHAT.test(c.text) ? 2 : 1));
    }
    const rate5 = (t) => { let n = 0; for (let i = 0; i < 5; i++) n += chatCount.get(t + i) || 0; return n; };
    const rates = [];
    for (let t = histStart; t < to; t += 5) rates.push(rate5(t));
    const chatMean = rates.reduce((x, y) => x + y, 0) / (rates.length || 1);
    const chatStd = Math.sqrt(rates.reduce((x, y) => x + (y - chatMean) ** 2, 0) / (rates.length || 1)) + 1;

    const hypeWords = new Map();
    for (const w of this.words) {
      if (w.s < from - 3 || w.s > to + 3) continue;
      if (HYPE_SPEECH.test(w.w)) hypeWords.set(Math.floor(w.s), (hypeWords.get(Math.floor(w.s)) || 0) + 1);
    }

    const noChat = rates.every((r) => r === 0);
    const hasSound = this.sound.length > 0;
    const raw = [];
    for (let t = from; t < to; t++) {
      const loud = Number.isFinite(this.loud[t]) ? Math.max(0, (this.loud[t] - loudMed) / loudMad) : 0;
      const chat = Math.max(0, (rate5(t + CHAT_LAG) - chatMean) / chatStd);
      let hype = 0;
      for (let k = -2; k <= 2; k++) hype += hypeWords.get(t + k) || 0;
      // Sin chat (videos subidos o chat apagado) el volumen y las risas pesan más.
      // Risas, gritos, aplausos… que oyó el detector de sonidos (si está encendido).
      const snd = hasSound ? this.soundAt(t) : 0;
      let score = noChat
        ? 1.5 * Math.min(loud, 4) + 1.0 * Math.min(hype, 3)
        : 0.9 * Math.min(loud, 4) + 1.3 * Math.min(chat, 5) + 0.6 * Math.min(hype, 3);
      if (hasSound) score = score * 0.8 + 1.2 * snd;
      raw.push({ t, score, loud, chat, sound: snd });
    }
    // Suavizado de 5 s
    return raw.map((r, i) => {
      let sum = 0; let n = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(raw.length - 1, i + 2); k++) { sum += raw[k].score; n++; }
      return { ...r, score: sum / n };
    });
  }

  /** Busca picos (momentos fuertes) ya listos para cortar. */
  findPeaks(a, b, { clipSeconds, sensitivity = 'media', minGap }) {
    const threshold = SENSITIVITY[sensitivity] ?? SENSITIVITY.media;
    const s = this.scores(a, b);
    const half = Math.max(5, Math.floor(clipSeconds / 2));
    const gap = minGap ?? clipSeconds;
    const peaks = [];
    for (let i = 0; i < s.length; i++) {
      const cur = s[i];
      if (cur.score < threshold) continue;
      let isMax = true;
      for (let k = Math.max(0, i - half); k <= Math.min(s.length - 1, i + half); k++) {
        if (s[k].score > cur.score) { isMax = false; break; }
      }
      if (!isMax) continue;
      if (peaks.length && cur.t - peaks[peaks.length - 1].t < gap) continue;
      const kind = (cur.sound || 0) >= Math.max(cur.chat, cur.loud) * 0.6 && cur.sound >= 1 ? 'sonido' : cur.chat > cur.loud ? 'chat' : 'volumen';
      peaks.push({ t: cur.t, score: cur.score, kind, strength: Math.max(cur.chat, cur.loud), chat: cur.chat, loud: cur.loud, sound: cur.sound || 0 });
    }
    return peaks;
  }

  /** Ajusta inicio y fin para no cortar palabras a la mitad. */
  snap(start, end) {
    const ws = this.wordsBetween(start - 6, end + 6);
    let s = start;
    let e = end;
    const startCandidates = ws.filter((w, i) => w.s >= start - 4 && w.s <= start + 2 && (i === 0 || w.s - ws[i - 1].e >= 0.35));
    if (startCandidates.length) s = startCandidates.reduce((x, y) => (Math.abs(y.s - start) < Math.abs(x.s - start) ? y : x)).s - 0.15;
    const endCandidates = ws.filter((w, i) => w.e >= end - 4 && w.e <= end + 4 && (i === ws.length - 1 || ws[i + 1].s - w.e >= 0.35));
    if (endCandidates.length) e = endCandidates.reduce((x, y) => (Math.abs(y.e - end) < Math.abs(x.e - end) ? y : x)).e + 0.3;
    s = Math.max(0, s);
    e = Math.min(this.until, e);
    return { start: s, end: Math.max(e, s + 5) };
  }

  /** Borra datos viejos para no llenar la memoria en directos de muchas horas. */
  trim(before) {
    this.words = this.words.filter((w) => w.e >= before);
    this.chat = this.chat.filter((c) => c.t >= before - 30);
    this.sound = this.sound.filter((w) => w.t + 10 >= before);
    for (let i = 0; i < Math.floor(before) - 400; i++) delete this.loud[i];
  }
}

module.exports = { Timeline, SENSITIVITY, HYPE_CHAT, LAUGH_CHAT };
