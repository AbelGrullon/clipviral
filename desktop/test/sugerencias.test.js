// Pruebas de Clips sugeridos: texto de cada red, horas sin repetir y "Ya la subí" / "Descartar".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Sugerencias, buildSnapshot, textosPara, normTags, porQue } = require('../engine/sugerencias');

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime(); // 4 nov 2026, 10:00 hora local
const at = (d, h, m = 0) => new Date(2026, 10, 4 + d, h, m, 0).getTime();
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cv-sug-')), 'sugerencias.json');
const PLANTILLA = '{gancho}\n\n{descripcion}\n\n{hashtags}\n\n🎥 Créditos: {canal}';

const clipLocal = (id, score, extra = {}) => ({
  id, score, title: `Clip ${id}`, description: '', hashtags: ['#clips', '#viral', '#stream', '#ibai'], reason: 'Explosión en el chat',
  file: `C:/clips/${id}.mp4`, thumb: `C:/clips/${id}.jpg`, start: 125, duration: 40, stream: { channel: 'Ibai', title: 'Directo', url: 'https://yt/x' }, ...extra,
});

test('sugeridos: sin IA arma el texto de cada red con la plantilla', () => {
  const { textos, de } = textosPara(clipLocal('a', 8));
  assert.equal(de, 'plantilla');
  assert.equal(textos.tiktok.titulo, 'Clip a');
  assert.match(textos.tiktok.gancho, /chat/, 'el gancho sale de por qué se eligió el momento');
  assert.equal(textos.tiktok.descripcion, 'Lo mejor de Ibai 🎬');
  assert.deepEqual(textos.tiktok.hashtags.slice(-2), ['#parati', '#fyp']);
  assert.ok(textos.tiktok.hashtags.length <= 6);
  assert.ok(textos.youtube.hashtags.includes('#Shorts'), 'YouTube lleva #Shorts');
  assert.ok(!textosPara(clipLocal('a', 8), { shortsTag: false }).textos.youtube.hashtags.includes('#Shorts'));
  assert.ok(textos.facebook.hashtags.length <= 4, 'Facebook: pocos hashtags');
  assert.equal(textos.instagram.hashtags.filter((h) => h.toLowerCase() === '#viral').length, 1, 'sin repetidos');
  assert.deepEqual(normTags(['futbol', '#Futbol', '# gol azo', '', '#']), ['#futbol', '#golazo']);
  assert.equal(porQue({ reason: 'Subida fuerte de volumen' }), 'Hubo una reacción fuerte: el volumen subió de golpe.');
  assert.equal(porQue({ reason: 'Claude: una reacción épica' }), 'Claude: una reacción épica');
});

test('sugeridos: con IA Pro usa el texto que Claude escribió para cada red', () => {
  const clip = clipLocal('b', 9, {
    redes: {
      tiktok: { titulo: 'NO LO PUEDE CREER', gancho: 'Espera al final 😳', descripcion: 'Ibai pierde la apuesta.', hashtags: ['ibai', '#apuesta'] },
      youtube: { titulo: 'Ibai pierde la apuesta más loca', gancho: 'Nadie lo vio venir', descripcion: 'El momento del directo.', hashtags: ['#ibai'] },
      instagram: { titulo: '', gancho: '', descripcion: '', hashtags: [] }, // vino vacío
    },
  });
  const { textos, de } = textosPara(clip);
  assert.equal(de, 'ia');
  assert.equal(textos.tiktok.titulo, 'NO LO PUEDE CREER');
  assert.deepEqual(textos.tiktok.hashtags, ['#ibai', '#apuesta', '#parati', '#fyp']);
  assert.deepEqual(textos.youtube.hashtags, ['#ibai', '#Shorts']);
  assert.equal(textos.instagram.titulo, 'Clip b', 'si una red vino vacía, se completa con la plantilla');
  assert.equal(textos.facebook.titulo, 'Clip b', 'y si no vino, también');
});

test('sugeridos: los mejores clips reciben las horas más cercanas, sin repetir', () => {
  const clips = [clipLocal('a', 6), clipLocal('b', 9), clipLocal('c', 7)];
  const store = clips.map((c, i) => ({ id: c.id, clipId: c.id, status: 'nueva', addedAt: NOW - i, hechas: {} }));
  const learnedHours = { tiktok: [12, 19], instagram: [14] };
  const snap = buildSnapshot({ store, clips, plantilla: PLANTILLA, learnedHours, redes: ['tiktok', 'instagram'], now: NOW });
  assert.deepEqual(snap.items.map((i) => i.id), ['b', 'c', 'a'], 'primero el de nota más alta');
  assert.deepEqual(snap.redes, ['tiktok', 'instagram']);
  assert.equal(snap.horasDe, 'aprendidas');
  const [b, c, a] = snap.items;
  assert.equal(b.horas.tiktok, at(0, 12));
  assert.equal(c.horas.tiktok, at(0, 19));
  assert.equal(a.horas.tiktok, at(1, 12), 'hoy ya no quedan horas libres: mañana');
  assert.equal(b.horas.instagram, at(0, 14));
  assert.equal(c.horas.instagram, at(1, 14));
  assert.ok(!('youtube' in b.horas), 'solo las redes donde publica');
  assert.equal(b.textos.tiktok.texto, `${b.textos.tiktok.gancho}\n\nLo mejor de Ibai 🎬\n\n${b.textos.tiktok.hashtags.join(' ')}\n\n🎥 Créditos: Ibai`);
  assert.deepEqual(snap.counts, { nueva: 3, subida: 0, descartada: 0 });
});

test('sugeridos: lo que ya subiste ocupa su hora y cuenta como subido', () => {
  const clips = [clipLocal('a', 9), clipLocal('b', 8), clipLocal('borrado', 10)];
  const store = [
    { id: 'a', clipId: 'a', status: 'nueva', addedAt: 1, hechas: { tiktok: at(0, 12, 5) } }, // lo subió a mano a las 12:05
    { id: 'b', clipId: 'b', status: 'nueva', addedAt: 2, hechas: {} },
    { id: 'borrado', clipId: 'ya-no-existe', status: 'nueva', addedAt: 3, hechas: {} },
  ];
  // Y el clip b lo subió a Instagram con ClipViral
  const jobs = [{ clipId: 'b', platform: 'instagram', status: 'publicado', publishedAt: at(0, 11) }];
  const snap = buildSnapshot({ store, clips, jobs, plantilla: PLANTILLA, learnedHours: { tiktok: [12, 19], instagram: [11, 14] }, redes: ['tiktok', 'instagram'], now: NOW });
  assert.equal(snap.items.length, 2, 'si el clip ya no existe, no se muestra');
  const [a, b] = snap.items;
  assert.ok(!('tiktok' in a.horas), 'a TikTok ya lo subió');
  assert.equal(a.horas.instagram, at(0, 14), 'las 11:00 de Instagram ya están ocupadas');
  assert.equal(b.hechas.instagram, at(0, 11), 'lo subido con ClipViral se marca solo');
  assert.equal(b.horas.tiktok, at(0, 19), 'las 12:00 de TikTok las ocupó el clip a');
  const all = buildSnapshot({ store, clips, jobs, plantilla: PLANTILLA, redes: ['instagram'], now: NOW });
  assert.equal(all.items.find((i) => i.id === 'b').status, 'subida', 'si ya está en todas sus redes, pasa a "Ya subidos"');
  assert.equal(all.horasDe, 'recomendadas');
});

test('sugeridos: "Ya lo subí", "Ya la subí", "Descartar" y "Volver" se guardan', () => {
  const file = tmpFile();
  let now = NOW;
  const s = new Sugerencias({ file, now: () => now });
  let updates = 0;
  s.on('update', () => { updates += 1; });
  assert.ok(s.add('a'));
  assert.equal(s.add('a'), null, 'no se repite');
  s.add('b');
  s.add('c');
  const redes = ['tiktok', 'youtube'];
  s.mark('a', 'red', { red: 'tiktok', redes });
  assert.equal(s.get('a').hechas.tiktok, NOW);
  assert.equal(s.get('a').status, 'nueva', 'falta YouTube');
  now += 60000;
  s.mark('a', 'red', { red: 'youtube', redes });
  assert.equal(s.get('a').status, 'subida', 'ya está en todas: pasa a subida');
  s.mark('a', 'red', { red: 'youtube', redes });
  assert.equal(s.get('a').status, 'nueva', 'si desmarca una, vuelve a por subir');
  s.mark('b', 'subida', { redes });
  assert.deepEqual(Object.keys(s.get('b').hechas).sort(), redes, '"Ya la subí" marca todas sus redes');
  s.mark('c', 'descartar');
  assert.equal(s.get('c').status, 'descartada');
  s.mark('b', 'volver');
  assert.equal(s.get('b').status, 'nueva');
  assert.deepEqual(s.get('b').hechas, {});
  assert.equal(s.mark('zzz', 'subida'), null);
  assert.equal(s.mark('a', 'publicar-solo'), null, 'no hay otras acciones');
  // Al reabrir la app sigue igual
  const again = new Sugerencias({ file });
  assert.equal(again.list().length, 3);
  assert.equal(again.get('c').status, 'descartada');
  again.clearDone();
  assert.deepEqual(again.list().map((i) => i.id), ['a', 'b'], 'limpiar quita lo descartado y lo subido');
  again.remove('a');
  assert.deepEqual(again.list().map((i) => i.id), ['b'], 'si se borra el clip, se va su sugerencia');
  assert.ok(updates >= 8);
});

test('la publicación automática vieja no vuelve: la nueva empieza apagada y TikTok siempre pide aprobación', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = read('main.js');
  for (const bad of ['autoUpload', 'cfg?.auto', 'calendar:state']) assert.ok(!main.includes(bad), `main.js todavía tiene ${bad}`);
  assert.match(main, /sugerencias\.add\(c\.id\)/, 'cada clip nuevo va a Clips sugeridos');
  for (const red of ['tiktok', 'instagram', 'facebook']) assert.match(main, new RegExp(`${red}: \\{[^}]*publicarSola: false`), `${red} empieza apagado`);
  assert.match(main, /platforms\.includes\('tiktok'\)\) throw/, 'a TikTok no se sube sin su pantalla de aprobación');
  for (const f of ['renderer/extras.js', 'renderer/crecer.js', 'renderer/app.js']) {
    const src = read(f);
    for (const bad of ['Subir solo', 'data-cfg="auto"', 'minScore', 'calendarState', 'publica solo.', 'se suben solos']) assert.ok(!src.includes(bad), `${f} todavía tiene "${bad}"`);
  }
  assert.ok(!read('preload.js').includes('calendarState'));
});
