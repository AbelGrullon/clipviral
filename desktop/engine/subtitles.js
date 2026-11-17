// Subtítulos estilo TikTok + título arriba + marca de agua de texto, todo en un archivo .ass.

const HIGHLIGHT = {
  amarillo: '&H0000FFFF&',
  verde: '&H007FFF00&',
  rosa: '&H009948EC&',
  celeste: '&H00FFD24A&',
  rojo: '&H003C3CFF&',
  naranja: '&H000A8CFF&',
};
const TEXT = { blanco: '&H00FFFFFF', amarillo: '&H0000FFFF', negro: '&H00101010' };
const BOX = { rosa: '&H009948EC', morado: '&H00ED3A7C', rojo: '&H003C3CFF', negro: '&H00101010', blanco: '&H00FFFFFF' };
const SIZES = { 'pequeño': 64, normal: 86, grande: 104, enorme: 124 };
const FONTS = ['Arial Black', 'Impact', 'Segoe UI Black', 'Verdana', 'Comic Sans MS', 'Georgia'];

const DEFAULTS = {
  layout: 'vertical',
  color: 'amarillo',
  textColor: 'blanco',
  size: 'normal',
  position: 'abajo',
  font: 'Arial Black',
  wordsPerLine: 3,
  uppercase: true,
  animation: 'pop',
  titleBanner: null,   // { text, seconds (0 = todo el clip), color }
  watermark: null,     // { text, position: 'arriba-izq'|'arriba-der'|'abajo-izq'|'abajo-der' }
};

function assTime(seconds) {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const safe = (w) => String(w ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

/** Agrupa palabras en bloques cortos (máx. N palabras o 1.4 s). */
function chunkWords(words, maxWords = 3) {
  const chunks = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const tooLong = cur.length && (w.e - cur[0].s > 1.4 || cur.length >= maxWords);
    const pause = prev && w.s - prev.e > 0.6;
    if (cur.length && (tooLong || pause)) { chunks.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * words: [{s, e, w}] en segundos relativos al inicio del clip.
 * duration: duración del clip (para el título y la marca de agua).
 */
function buildAss(words, options = {}, duration = 0) {
  const o = { ...DEFAULTS, ...options };
  const vertical = o.layout !== 'horizontal';
  const W = vertical ? 1080 : 1920;
  const H = vertical ? 1920 : 1080;
  const k = vertical ? 1 : 0.72;
  const highlight = HIGHLIGHT[o.color] || HIGHLIGHT.amarillo;
  const font = FONTS.includes(o.font) ? o.font : DEFAULTS.font;
  const size = Math.round((SIZES[o.size] || SIZES.normal) * k);
  const align = { arriba: 8, centro: 5, abajo: 2 }[o.position] || 2;
  const marginV = { arriba: vertical ? 300 : 70, centro: 0, abajo: vertical ? 560 : 90 }[o.position] ?? 560;
  const outline = Math.max(3, Math.round(size / 12));

  const clean = words.map((w) => ({ ...w, w: o.uppercase ? safe(w.w).toUpperCase() : safe(w.w) })).filter((w) => w.w && w.e > w.s);
  const chunks = chunkWords(clean, Math.max(1, Math.min(5, Number(o.wordsPerLine) || 3)));
  const pop = o.animation === 'pop' ? '\\fscx100\\fscy100\\t(0,90,\\fscx116\\fscy116)\\t(90,180,\\fscx108\\fscy108)' : '';
  const lines = [];

  chunks.forEach((chunk, ci) => {
    const nextStart = chunks[ci + 1]?.[0].s ?? Infinity;
    chunk.forEach((word, wi) => {
      const start = word.s;
      const end = wi < chunk.length - 1 ? chunk[wi + 1].s : Math.min(word.e + 0.35, nextStart);
      if (end - start < 0.02) return;
      const text = chunk.map((w, j) => (j === wi ? `{\\c${highlight}${pop}}${w.w}{\\r}` : w.w)).join(' ');
      lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Viral,,0,0,0,,${text}`);
    });
  });

  const banner = o.titleBanner?.text ? safe(o.titleBanner.text) : '';
  if (banner) {
    const until = Number(o.titleBanner.seconds) > 0 ? Math.min(duration || 9999, Number(o.titleBanner.seconds)) : (duration || 9999);
    lines.push(`Dialogue: 2,${assTime(0)},${assTime(until)},Titulo,,0,0,0,,{\\fad(250,250)}${banner}`);
  }
  const mark = o.watermark?.text ? safe(o.watermark.text) : '';
  if (mark) {
    const pos = { 'arriba-izq': 7, 'arriba-der': 9, 'abajo-izq': 1, 'abajo-der': 3 }[o.watermark.position] || 3;
    lines.push(`Dialogue: 0,${assTime(0)},${assTime(duration || 9999)},Marca,,0,0,0,,{\\an${pos}}${mark}`);
  }

  const boxColor = BOX[o.titleBanner?.color] || BOX.rosa;
  const bannerText = o.titleBanner?.color === 'blanco' ? TEXT.negro : TEXT.blanco;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Viral,${font},${size},${TEXT[o.textColor] || TEXT.blanco},&H00FFFFFF,&H00000000,&H78000000,-1,0,0,0,100,100,1,0,1,${outline},3,${align},60,60,${marginV},1
Style: Titulo,${font},${Math.round(62 * k)},${bannerText},&H00FFFFFF,${boxColor},${boxColor},-1,0,0,0,100,100,0,0,3,${Math.round(18 * k)},0,8,90,90,${vertical ? 170 : 40},1
Style: Marca,Segoe UI Semibold,${Math.round(40 * k)},&H50FFFFFF,&H00FFFFFF,&H90000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,3,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

module.exports = { buildAss, chunkWords, assTime, HIGHLIGHT, FONTS, SIZES, DEFAULTS };
