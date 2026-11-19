// Lee el chat en vivo de YouTube.
// La página del directo trae el código del chat ("continuation"); con él se piden los mensajes nuevos cada 2 s.
// Antes se usaba la librería youtube-chat, pero se rompía: buscaba el enlace del video en la página y YouTube dejó
// de llenarlo (<link rel="canonical" href="undefined">), así que fallaba con "Live Stream was not found" aunque el
// chat estuviera ahí. Además leía el "Chat destacado" (filtrado); aquí se lee el "Chat en vivo" (todos los mensajes).
const { EventEmitter } = require('node:events');

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
};
const INTERVAL = 2000;

/** Error que no se arregla reintentando (el directo no tiene chat que leer): se avisa una vez y listo. */
const noChat = (msg) => Object.assign(new Error(msg), { final: true });

function initialData(html) {
  const raw = html.match(/(?:window\["ytInitialData"\]|ytInitialData)\s*=\s*(\{.+?\});\s*<\/script>/s)?.[1];
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

const code = (c) => c?.reloadContinuationData?.continuation || c?.invalidationContinuationData?.continuation || c?.timedContinuationData?.continuation;

/**
 * De la página del directo saca lo necesario para leer el chat: { apiKey, clientVersion, continuation }.
 * Ese código es el del "Chat destacado"; el de "Chat en vivo" sale de la página del chat suelto (allChat).
 */
function chatOptions(html) {
  const apiKey = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/)?.[1] || html.match(/"clientVersion":\s*"([\d.]+)"/)?.[1];
  const bar = initialData(html)?.contents?.twoColumnWatchNextResults?.conversationBar;
  const chat = bar?.liveChatRenderer;
  if (!chat) {
    // Chat desactivado, video privado o que no es directo: YouTube pone un aviso en lugar del chat.
    // (Ojo: "Accede para confirmar que no eres un bot / tu edad" es del video, no del chat; con chat se lee igual.)
    const aviso = (bar?.conversationBarRenderer?.availabilityMessage?.messageRenderer?.text?.runs || []).map((r) => r.text).join('').trim();
    const motivo = html.match(/"playabilityStatus":\s*\{\s*"status":\s*"(?:ERROR|UNPLAYABLE|LOGIN_REQUIRED)"\s*,\s*"reason":\s*"([^"]+)"/)?.[1];
    // A veces YouTube manda una página a medias ("confirma que no eres un bot"): esa se reintenta.
    if (!aviso && /bot/i.test(motivo || '')) throw new Error(`YouTube dice: "${motivo}"`);
    throw noChat(aviso ? `YouTube dice: "${aviso}"` : motivo ? `YouTube dice: "${motivo}"` : 'este video no tiene chat en vivo (no es un directo o el chat está apagado)');
  }
  if (chat.isReplay) throw noChat('el directo ya terminó: YouTube solo da la repetición del chat');
  // Ojo: las vistas del menú de esta página traen códigos que YouTube rechaza ("invalid argument"); este sí sirve.
  const continuation = code(chat.continuations?.[0]);
  if (!apiKey || !clientVersion || !continuation) throw new Error('no se encontró el chat en la página de YouTube');
  return { apiKey, clientVersion, continuation };
}

/**
 * De la página del chat suelto (youtube.com/live_chat?v=…) saca el código de "Chat en vivo" (todos los mensajes,
 * no solo los destacados). null si no está.
 */
function allChat(html) {
  const views = initialData(html)?.contents?.liveChatRenderer?.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems || [];
  const all = views.find((v) => /en vivo|en directo|live chat|todos/i.test(v.title || '')) || (views.length > 1 ? views.find((v) => !v.selected) : null);
  return code(all?.continuation) || null;
}

/** 'dueño' si el mensaje es del dueño del canal, 'mod' si es de un moderador, '' si no (para el "!clip" del chat). */
function authorRole(r) {
  const icons = (r?.authorBadges || []).map((b) => b?.liveChatAuthorBadgeRenderer?.icon?.iconType);
  if (icons.includes('OWNER')) return 'dueño';
  if (icons.includes('MODERATOR')) return 'mod';
  return '';
}

/** Un mensaje del chat → { wall, text, author, rol } (texto con los emojis como :atajo: o el emoji mismo). */
function chatItem(action) {
  const item = action?.addChatItemAction?.item;
  const r = item?.liveChatTextMessageRenderer || item?.liveChatPaidMessageRenderer || item?.liveChatMembershipItemRenderer || item?.liveChatPaidStickerRenderer;
  if (!r) return null;
  const runs = r.message?.runs || r.headerSubtext?.runs || [];
  const text = runs.map((run) => run.text ?? (run.emoji ? (run.emoji.isCustomEmoji ? run.emoji.shortcuts?.[0] : run.emoji.emojiId) : '') ?? '').join('').trim();
  if (!text) return null;
  const usec = Number(r.timestampUsec);
  return { wall: usec > 0 ? Math.round(usec / 1000) : Date.now(), text, author: r.authorName?.simpleText || '', rol: authorRole(r) };
}

/** Respuesta de get_live_chat → { items, next, ended }. */
function parseChat(data) {
  const live = data?.continuationContents?.liveChatContinuation;
  if (!live) return { items: [], next: null, ended: true };
  const items = (live.actions || []).map((a) => { try { return chatItem(a); } catch { return null; } }).filter(Boolean);
  const c = live.continuations?.[0];
  const next = c?.invalidationContinuationData?.continuation || c?.timedContinuationData?.continuation || c?.reloadContinuationData?.continuation || null;
  return { items, next, ended: !next };
}

class ChatWatcher extends EventEmitter {
  constructor(videoId, { fetchImpl = (...a) => fetch(...a), interval = INTERVAL } = {}) {
    super();
    this.videoId = videoId;
    this.fetch = fetchImpl;
    this.interval = interval;
    this.count = 0;
    this.running = false;
    this.fails = 0;
    this.timer = null;
  }

  /** Empieza a leer. Devuelve true si encontró el chat. */
  async start() {
    let opts = null;
    let last = null;
    for (let i = 0; i < 3 && !opts; i++) {
      try {
        const res = await this.fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(this.videoId)}&hl=es`, { headers: UA, signal: AbortSignal.timeout(20000) });
        opts = chatOptions(await res.text());
      } catch (err) {
        last = err;
        if (err.final) break;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    if (!opts) {
      this.emit('warn', `No se pudo leer el chat (${last?.message || 'sin respuesta de YouTube'}). Sigo solo con el audio.`);
      return false;
    }
    // Mejor "Chat en vivo" (todos los mensajes); si no se consigue, el destacado sirve igual.
    try {
      const res = await this.fetch(`https://www.youtube.com/live_chat?v=${encodeURIComponent(this.videoId)}&is_popout=1&hl=es`, { headers: UA, signal: AbortSignal.timeout(20000) });
      const all = allChat(await res.text());
      if (all) Object.assign(opts, { continuation: all, todos: true });
    } catch {}
    this.opts = opts;
    this.running = true;
    await this.#tick();
    return this.running || this.count > 0;
  }

  async #tick() {
    if (!this.running) return;
    try {
      const res = await this.fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.opts.apiKey}&prettyPrint=false`, {
        method: 'POST',
        headers: { ...UA, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: this.opts.clientVersion, hl: 'es' } }, continuation: this.opts.continuation }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
      const { items, next, ended } = parseChat(await res.json());
      for (const m of items) { this.count += 1; this.emit('message', m); }
      if (this.fails >= 3) this.emit('warn', 'El chat volvió a responder.');
      this.fails = 0;
      if (ended) { this.running = false; this.emit('end'); return; }
      this.opts.continuation = next;
    } catch (err) {
      this.fails += 1;
      // Un corte suelto no se avisa; si sigue, sí (una vez), y se espera cada vez más entre intentos.
      if (this.fails === 3) this.emit('warn', `Chat: YouTube no responde (${err.message}). Sigo intentando.`);
      if (this.fails >= 40) { this.running = false; this.emit('warn', 'Se dejó de leer el chat (YouTube no respondió por varios minutos). Sigo solo con el audio.'); return; }
    }
    if (this.running) this.timer = setTimeout(() => this.#tick(), this.fails ? Math.min(15000, this.interval * 2 ** Math.min(this.fails, 3)) : this.interval);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }
}

module.exports = { ChatWatcher, chatOptions, allChat, parseChat, chatItem };
