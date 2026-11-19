// Pruebas del texto por red que escribe Claude al elegir clips (/ai/pick).
import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.ANTHROPIC_API_KEY;
const { PICK_SCHEMA, TRIM_SCHEMA, NETWORKS, cut } = await import('../src/claude.js');
const { cleanPickedClip, cleanRedes, cleanTags } = await import('../src/textos.js');

test('el formato que se le pide a Claude incluye el texto de las 4 redes y es válido', () => {
  const clip = PICK_SCHEMA.properties.clips.items;
  assert.ok(clip.required.includes('redes') && clip.required.includes('reason'));
  assert.deepEqual(Object.keys(clip.properties.redes.properties), NETWORKS);
  assert.deepEqual(NETWORKS, ['tiktok', 'instagram', 'youtube', 'facebook']);
  // Las salidas estructuradas piden que cada objeto cierre sus campos y los pida todos.
  const walk = (node, where) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${where}: falta additionalProperties: false`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${where}: required incompleto`);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${where}.${k}`);
    }
    if (node.type === 'array') walk(node.items, `${where}[]`);
    for (const bad of ['maxLength', 'minLength', 'minimum', 'maximum']) assert.ok(!(bad in node), `${where}: ${bad} no está permitido`);
  };
  walk(PICK_SCHEMA, 'PICK_SCHEMA');
  // El del recorte para Instagram / Facebook (qué partes del clip se quedan) cumple lo mismo.
  walk(TRIM_SCHEMA, 'TRIM_SCHEMA');
  assert.deepEqual(Object.keys(TRIM_SCHEMA.properties.partes.items.properties), ['inicio', 'fin']);
});

test('limpia lo que devuelve Claude antes de mandarlo a la app', () => {
  const c = cleanPickedClip({
    id: '2', start: 30, end: 75, title: '  ¡No puede ser!  ', hashtags: ['futbol', '#Futbol', '# gol'], description: 'x', score: 14, reason: 'Reacción fuerte y graciosa',
    redes: {
      tiktok: { titulo: 'T'.repeat(300), gancho: 'Espera al final 😳', descripcion: 'D', hashtags: ['ibai', '#fyp', 'ibai'] },
      youtube: { titulo: '', gancho: '', descripcion: '', hashtags: [] },
      otra: { titulo: 'no es una red' },
    },
  });
  assert.equal(c.title, '¡No puede ser!');
  assert.deepEqual(c.hashtags, ['#futbol', '#gol']);
  assert.equal(c.score, 10);
  assert.equal(c.reason, 'Reacción fuerte y graciosa');
  assert.equal(c.redes.tiktok.titulo.length, 100);
  assert.deepEqual(c.redes.tiktok.hashtags, ['#ibai', '#fyp']);
  assert.ok(!c.redes.youtube, 'una red vacía no se manda (la app usa su plantilla)');
  assert.ok(!c.redes.otra);
  assert.equal(cleanPickedClip({ start: 50, end: 40 }), null, 'segundos al revés: se descarta');
  assert.equal(cleanRedes(null), null);
  assert.equal(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length, 8);
});

test('un emoji partido al recortar no rompe la consulta a Claude', () => {
  const chat = 'jajaja 😂😂 qué locura';
  // Recortar en 8 caería justo en medio del primer 😂 (cada emoji ocupa 2 "letras" en JavaScript).
  assert.equal(chat.slice(0, 8).isWellFormed(), false, 'así fallaba antes');
  assert.equal(cut(chat, 8), 'jajaja ');
  assert.equal(cut(chat, 9), 'jajaja 😂');
  assert.equal(cut(chat, 200), chat);
  // Medio emoji que ya venía roto del chat o de la transcripción se reemplaza.
  const roto = `hola ${'😂'[0]} chau`;
  assert.equal(cut(roto).isWellFormed(), true);
  assert.doesNotMatch(JSON.stringify({ content: cut(roto) }), /\ud[89ab]/i, 'en el JSON que va a Claude no queda medio emoji');
  assert.equal(cut(null, 10), '');
});
