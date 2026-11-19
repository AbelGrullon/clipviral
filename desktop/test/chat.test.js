// Lectura del chat en vivo de YouTube: encontrar el chat en la página, avisos claros y leer los mensajes.
const test = require('node:test');
const assert = require('node:assert');
const { ChatWatcher, chatOptions, allChat, parseChat } = require('../engine/chat');

const reload = (c) => ({ reloadContinuationData: { continuation: c } });
const views = [
  { title: 'Top chat', selected: true, continuation: reload('DESTACADO') },
  { title: 'Chat en vivo', selected: false, continuation: reload('TODOS') },
];
const header = { liveChatHeaderRenderer: { viewSelector: { sortFilterSubMenuRenderer: { subMenuItems: views } } } };
const config = '<script>ytcfg.set({"INNERTUBE_API_KEY":"KEY","INNERTUBE_CLIENT_VERSION":"2.20261118.01.00"});</script>';
const page = (bar, extra = '') => `<html><link rel="canonical" href="undefined">${config}${extra}`
  + `<script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnWatchNextResults: { conversationBar: bar } } })};</script></html>`;
const chatBar = (more = {}) => ({ liveChatRenderer: { continuations: [reload('BASE')], header, ...more } });
const popout = `<html><script>window["ytInitialData"] = ${JSON.stringify({ contents: { liveChatRenderer: { header } } })};</script></html>`;

test('encuentra el chat aunque YouTube ya no llene el enlace del video (lo que rompía la librería)', () => {
  const o = chatOptions(page(chatBar()));
  assert.deepStrictEqual(o, { apiKey: 'KEY', clientVersion: '2.20261118.01.00', continuation: 'BASE' });
});

test('"confirma que no eres un bot / tu edad" es del video: si el chat está, se lee igual', () => {
  const bot = '<script>var x = {"playabilityStatus":{"status":"LOGIN_REQUIRED","reason":"Accede para confirmar que no eres un bot"}};</script>';
  assert.strictEqual(chatOptions(page(chatBar(), bot)).continuation, 'BASE');
  // Sin chat en la página (llegó a medias): se reintenta, no es definitivo.
  assert.throws(() => chatOptions(page(undefined, bot)), (err) => /no eres un bot/.test(err.message) && !err.final);
});

test('chat apagado, repetición o video sin chat: aviso claro y no se insiste', () => {
  const off = { conversationBarRenderer: { availabilityMessage: { messageRenderer: { text: { runs: [{ text: 'El chat está inhabilitado para esta transmisión en vivo.' }] } } } } };
  assert.throws(() => chatOptions(page(off)), (err) => err.final && /inhabilitado/.test(err.message));
  assert.throws(() => chatOptions(page(chatBar({ isReplay: true }))), (err) => err.final && /ya terminó/.test(err.message));
  assert.throws(() => chatOptions(page(undefined)), (err) => err.final && /no tiene chat/.test(err.message));
});

test('de la página del chat suelto sale "Chat en vivo" (todos los mensajes)', () => {
  assert.strictEqual(allChat(popout), 'TODOS');
  assert.strictEqual(allChat('<html>nada</html>'), null);
});

const msg = (id, runs, usec, name = 'Ana') => ({ addChatItemAction: { item: { liveChatTextMessageRenderer: { id, message: { runs }, authorName: { simpleText: name }, timestampUsec: String(usec) } } } });

test('lee mensajes con emojis y súper chats; sin código siguiente, el directo terminó', () => {
  const data = { continuationContents: { liveChatContinuation: {
    continuations: [{ invalidationContinuationData: { continuation: 'SIGUE' } }],
    actions: [
      msg('a', [{ text: 'qué jugada ' }, { emoji: { emojiId: '🔥' } }], 1763500000123456),
      msg('b', [{ emoji: { isCustomEmoji: true, emojiId: 'x', shortcuts: [':yt:'] } }], 1763500001000000, 'Beto'),
      msg('c', [{ text: '   ' }], 1763500002000000),
      { addChatItemAction: { item: { liveChatPaidMessageRenderer: { message: { runs: [{ text: 'tomen mi dinero' }] }, authorName: { simpleText: 'Rico' }, timestampUsec: '1763500003000000' } } } },
      { addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: '!clip' }] }, authorName: { simpleText: 'Moni' }, timestampUsec: '1763500004000000',
        authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'MODERATOR' }, tooltip: 'Moderador' } }] } } } },
      { addChatItemAction: { item: { liveChatTextMessageRenderer: { message: { runs: [{ text: 'gracias' }] }, authorName: { simpleText: 'Streamer' }, timestampUsec: '1763500005000000',
        authorBadges: [{ liveChatAuthorBadgeRenderer: { icon: { iconType: 'OWNER' } } }] } } } },
      { markChatItemAsDeletedAction: {} },
    ],
  } } };
  const { items, next, ended } = parseChat(data);
  assert.deepStrictEqual(items, [
    { wall: 1763500000123, text: 'qué jugada 🔥', author: 'Ana', rol: '' },
    { wall: 1763500001000, text: ':yt:', author: 'Beto', rol: '' },
    { wall: 1763500003000, text: 'tomen mi dinero', author: 'Rico', rol: '' },
    { wall: 1763500004000, text: '!clip', author: 'Moni', rol: 'mod' },
    { wall: 1763500005000, text: 'gracias', author: 'Streamer', rol: 'dueño' },
  ]);
  assert.strictEqual(next, 'SIGUE');
  assert.strictEqual(ended, false);
  assert.strictEqual(parseChat({ continuationContents: { liveChatContinuation: { actions: [] } } }).ended, true);
  assert.strictEqual(parseChat({}).ended, true);
});

test('ChatWatcher: abre el chat en vivo, pasa los mensajes y avisa cuando termina', async () => {
  const pedidos = [];
  const respuestas = [
    { continuationContents: { liveChatContinuation: { actions: [msg('a', [{ text: 'hola' }], 1763500000000000)], continuations: [{ timedContinuationData: { continuation: 'C2' } }] } } },
    { continuationContents: { liveChatContinuation: { actions: [msg('b', [{ text: 'chao' }], 1763500002000000)] } } },
  ];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('/watch?')) return { ok: true, text: async () => page(chatBar()) };
    if (url.includes('/live_chat?')) return { ok: true, text: async () => popout };
    pedidos.push(JSON.parse(opts.body).continuation);
    return { ok: true, json: async () => respuestas.shift() };
  };
  const w = new ChatWatcher('abc', { fetchImpl, interval: 5 });
  const textos = [];
  w.on('message', (m) => textos.push(m.text));
  const fin = new Promise((r) => w.on('end', r));
  assert.strictEqual(await w.start(), true);
  await fin;
  assert.deepStrictEqual(textos, ['hola', 'chao']);
  assert.deepStrictEqual(pedidos, ['TODOS', 'C2'], 'empieza por "Chat en vivo" y sigue con el código que da YouTube');
  assert.strictEqual(w.count, 2);
});

test('ChatWatcher: sin chat avisa una sola vez y la sesión sigue con el audio', async () => {
  const off = { conversationBarRenderer: { availabilityMessage: { messageRenderer: { text: { runs: [{ text: 'El chat está inhabilitado.' }] } } } } };
  let pedidos = 0;
  const w = new ChatWatcher('abc', { fetchImpl: async () => { pedidos += 1; return { ok: true, text: async () => page(off) }; } });
  const avisos = [];
  w.on('warn', (m) => avisos.push(m));
  assert.strictEqual(await w.start(), false);
  assert.strictEqual(pedidos, 1, 'no se reintenta lo que no tiene arreglo');
  assert.deepStrictEqual(avisos, ['No se pudo leer el chat (YouTube dice: "El chat está inhabilitado."). Sigo solo con el audio.']);
});
