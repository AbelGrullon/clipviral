import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../src/almacen.js';
import { compararVersiones, notasParaAnunciar, anuncioVersion, anuncioManual, modalAnuncio, crearNoticias } from '../src/noticias.js';
import { crearClipViral } from '../src/clipviral.js';

const almacenNuevo = () => new Almacen(fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-')));

/** Imita /api/updates/latest del servidor de ClipViral con una lista de versiones publicadas en el panel. */
function servidorConVersiones(versiones) {
  return {
    versiones,
    async ultimaVersion(actual) {
      const nuevas = this.versiones.filter((v) => compararVersiones(v.version, actual) > 0).sort((a, b) => compararVersiones(b.version, a.version));
      if (!nuevas.length) return { available: false, current: actual };
      return {
        available: true, current: actual, version: nuevas[0].version,
        notes: nuevas.map((r) => `v${r.version}\n${r.notes}`).join('\n\n'),
        mandatory: nuevas.some((r) => r.mandatory), publishedAt: '2026-11-18 20:00:00',
      };
    },
  };
}

test('comparar versiones', () => {
  assert.equal(compararVersiones('1.10.0', '1.9.9'), 1);
  assert.equal(compararVersiones('1.0.0', '1.0'), 0);
  assert.equal(compararVersiones('0.9.1', '1.0.0'), -1);
});

test('las notas del anuncio: sin repetir la versión del título y con las anteriores en negrita', () => {
  const r = { version: '1.2.0', notes: 'v1.2.0\n- Subtítulos más finos\n\nv1.1.0\n- Arreglo del audio' };
  assert.equal(notasParaAnunciar(r), '- Subtítulos más finos\n\n**Versión 1.1.0**\n- Arreglo del audio');
  assert.equal(notasParaAnunciar(r, true), '- Subtítulos más finos');
  assert.equal(notasParaAnunciar({ version: '2.0.0', notes: 'v2.0.0\n' }), '');
});

test('anuncio de versión: título, cómo actualizar y enlace de descarga; nada de efectivo ni transferencias', () => {
  const a = anuncioVersion({ version: '1.2.0', notes: 'v1.2.0\nMás rápido', mandatory: true, publishedAt: '2026-11-18 20:00:00' }, { web: 'https://cviral.duckdns.org' });
  const e = a.embeds[0];
  assert.equal(e.title, '🚀 ClipViral 1.2.0 ya está disponible');
  assert.match(e.description, /Más rápido/);
  assert.match(e.description, /https:\/\/cviral\.duckdns\.org\/descargar/);
  assert.equal(e.timestamp, '2026-11-18T20:00:00.000Z');
  assert.match(e.fields[0].name, /importante/);
  assert.deepEqual(a.allowedMentions, { parse: [] });
  assert.doesNotMatch(JSON.stringify(a), /efectivo|transferencia/i);
  // Sin notas ni web.
  const b = anuncioVersion({ version: '1.3.0', notes: '' });
  assert.match(b.embeds[0].description, /Mejoras y arreglos/);
  assert.doesNotMatch(b.embeds[0].description, /descargar/);
  assert.equal(b.embeds[0].fields, undefined);
});

test('anuncio escrito a mano y su formulario', () => {
  const a = anuncioManual({ titulo: 'Mantenimiento', mensaje: 'Hoy a las 10 pm', autor: 'Equipo de ClipViral' });
  assert.equal(a.embeds[0].title, '📢 Mantenimiento');
  assert.equal(a.embeds[0].footer.text, 'Equipo de ClipViral');
  assert.equal(anuncioManual({ mensaje: 'x' }).embeds[0].title, '📢 Novedades de ClipViral');
  const m = modalAnuncio();
  assert.equal(m.custom_id, 'anuncio:form');
  assert.deepEqual(m.components.map((f) => f.components[0].custom_id), ['titulo', 'mensaje']);
});

test('noticias: anuncia la versión publicada una sola vez, y luego solo las nuevas', async () => {
  const almacen = almacenNuevo();
  const servidor = servidorConVersiones([
    { version: '1.0.0', notes: 'Primera' },
    { version: '1.1.0', notes: 'Segunda' },
  ]);
  const publicados = [];
  const noticias = crearNoticias({ almacen, clipviral: servidor, publicar: async (m) => { publicados.push(m); return 1; }, web: 'https://cviral.duckdns.org' });

  // Primera vez: solo la última (no todo el historial).
  assert.equal((await noticias.revisar()).version, '1.1.0');
  assert.equal(publicados.length, 1);
  assert.match(publicados[0].embeds[0].description, /Segunda/);
  assert.doesNotMatch(publicados[0].embeds[0].description, /Primera/);
  assert.equal(almacen.ultimaVersion(), '1.1.0');

  // Sin cambios: no repite.
  assert.equal(await noticias.revisar(), null);
  assert.equal(publicados.length, 1);

  // Publicas dos versiones en el panel mientras el bot estaba apagado: un anuncio con las notas de ambas.
  servidor.versiones.push({ version: '1.2.0', notes: 'Tercera' }, { version: '1.3.0', notes: 'Cuarta', mandatory: true });
  assert.equal((await noticias.revisar()).version, '1.3.0');
  assert.equal(publicados.length, 2);
  assert.match(publicados[1].embeds[0].description, /Cuarta[\s\S]*\*\*Versión 1\.2\.0\*\*[\s\S]*Tercera/);
  assert.equal(almacen.ultimaVersion(), '1.3.0');

  // El anunciado se recuerda aunque el bot se reinicie.
  assert.equal(new Almacen(almacen.carpeta).ultimaVersion(), '1.3.0');
});

test('noticias: sin canal de anuncios no la da por anunciada; servidor apagado no rompe ni llena el registro', async () => {
  const almacen = almacenNuevo();
  const servidor = servidorConVersiones([{ version: '2.0.0', notes: 'Nueva' }]);
  let canales = 0;
  const noticias = crearNoticias({ almacen, clipviral: servidor, publicar: async () => canales });
  await noticias.revisar();
  assert.equal(almacen.ultimaVersion(), null, 'se reintenta cuando haya canal');
  canales = 1;
  await noticias.revisar();
  assert.equal(almacen.ultimaVersion(), '2.0.0');

  const registro = [];
  const caido = crearNoticias({ almacen: almacenNuevo(), clipviral: { ultimaVersion: async () => { throw new Error('connect ECONNREFUSED'); } }, publicar: async () => 1, log: (s) => registro.push(s) });
  assert.equal(await caido.revisar(), null);
  assert.equal(await caido.revisar(), null);
  assert.equal(registro.length, 1, 'el mismo error no se repite');
});

test('/anunciar-version vuelve a anunciar la última', async () => {
  const almacen = almacenNuevo();
  almacen.guardarUltimaVersion('1.1.0');
  const publicados = [];
  const noticias = crearNoticias({ almacen, clipviral: servidorConVersiones([{ version: '1.1.0', notes: 'Hola' }]), publicar: async (m) => { publicados.push(m); return 1; } });
  assert.deepEqual(await noticias.anunciarUltima(), { version: '1.1.0', enviados: 1 });
  assert.match(publicados[0].embeds[0].title, /1\.1\.0/);
  const vacio = crearNoticias({ almacen, clipviral: servidorConVersiones([]), publicar: async () => 1 });
  assert.deepEqual(await vacio.anunciarUltima(), { sinVersiones: true });
});

test('cliente HTTP del servidor de ClipViral', async () => {
  const pedidos = [];
  const respuestas = {
    '/api/updates/latest?current=1.0.0': [200, { available: false }],
    '/api/bot/estado': [200, { ok: true }],
    '/api/bot/cliente?correo=ana%40clipviral.test': [200, { encontrada: true }],
  };
  const fetch = async (url, opciones) => {
    const ruta = url.replace('http://127.0.0.1:4600', '');
    pedidos.push({ ruta, clave: opciones.headers['x-bot-clave'] });
    const [status, body] = respuestas[ruta] || [404, {}];
    return { status, ok: status < 300, json: async () => body };
  };
  const cv = crearClipViral({ url: 'http://127.0.0.1:4600/', clave: 'secreta', fetch });
  assert.deepEqual(await cv.ultimaVersion('1.0.0'), { available: false });
  assert.equal(pedidos[0].clave, undefined, 'las versiones no llevan la clave');
  assert.deepEqual(await cv.estado(), { ok: true });
  assert.deepEqual(await cv.buscarCliente('ana@clipviral.test'), { encontrada: true });
  assert.equal(pedidos.at(-1).clave, 'secreta');

  // Sin clave, clave mala, servidor viejo o apagado: nunca lanza error.
  assert.deepEqual(await crearClipViral({ url: 'http://x', fetch }).buscarCliente('a@b.com'), { sinConexion: true, motivo: 'sin-clave' });
  const con = (status) => crearClipViral({ url: 'http://x', clave: 'k', fetch: async () => ({ status, json: async () => ({}) }) });
  assert.equal((await con(401).estado()).motivo, 'clave');
  assert.equal((await con(404).estado()).motivo, 'viejo');
  assert.equal((await con(500).estado()).motivo, 'apagado');
  const apagado = crearClipViral({ url: 'http://x', clave: 'k', fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await apagado.buscarCliente('a@b.com')).motivo, 'apagado');
  await assert.rejects(con(500).ultimaVersion(), /contestó 500/);
});

test('noticias: recién pasado al VPS, no repite una versión que ya está en el canal', async () => {
  const almacen = almacenNuevo();
  const publicados = [];
  const noticias = crearNoticias({
    almacen, clipviral: servidorConVersiones([{ version: '1.4.0', notes: 'x' }]),
    publicar: async (m) => { publicados.push(m); return 1; },
    yaAnunciada: async (v) => v === '1.4.0',
  });
  assert.equal(await noticias.revisar(), null);
  assert.equal(publicados.length, 0);
  assert.equal(almacen.ultimaVersion(), '1.4.0');
});
