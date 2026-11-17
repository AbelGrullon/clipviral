// Lee el chat en vivo de YouTube.
const { EventEmitter } = require('node:events');

class ChatWatcher extends EventEmitter {
  constructor(videoId) {
    super();
    this.videoId = videoId;
    this.count = 0;
    this.live = null;
  }

  async start() {
    try {
      const { LiveChat } = require('youtube-chat');
      this.live = new LiveChat({ liveId: this.videoId }, 2000);
      this.live.on('chat', (item) => {
        const text = (item.message || []).map((m) => m.text ?? m.emojiText ?? m.alt ?? '').join('').trim();
        if (!text) return;
        this.count += 1;
        this.emit('message', { wall: new Date(item.timestamp).getTime() || Date.now(), text, author: item.author?.name || '' });
      });
      this.live.on('error', (err) => this.emit('warn', `Chat: ${err?.message || err}`));
      this.live.on('end', () => this.emit('end'));
      const ok = await this.live.start();
      if (!ok) this.emit('warn', 'No se pudo leer el chat. Sigo solo con el audio.');
      return ok;
    } catch (err) {
      this.emit('warn', `Chat no disponible: ${err.message}`);
      return false;
    }
  }

  stop() {
    try { this.live?.stop(); } catch {}
  }
}

module.exports = { ChatWatcher };
