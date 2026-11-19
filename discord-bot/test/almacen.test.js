import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../src/almacen.js';
import { transcripcion, mensajeAPlano, fecha } from '../src/transcripcion.js';

test('el almacén recuerda todo después de reiniciar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const a = new Almacen(dir);
  a.guardarServidor('g1', { anuncios: 'c1' });
  assert.equal(a.siguienteNumero('g1'), 1);
  assert.equal(a.siguienteNumero('g1'), 2);
  a.nuevoTicket({ canalId: 't1', guildId: 'g1', userId: 'u1', numero: 1 });
  a.nuevoTicket({ canalId: 't2', guildId: 'g1', userId: 'u1', numero: 2 });
  a.cambiarTicket('t2', { estado: 'cerrado' });
  a.vincular('u1', 'ana@clipviral.test');
  a.guardarUltimaVersion('1.2.3');

  const b = new Almacen(dir);
  assert.equal(b.servidor('g1').anuncios, 'c1');
  assert.equal(b.siguienteNumero('g1'), 3);
  assert.deepEqual(b.abiertosDe('g1', 'u1').map((t) => t.canalId), ['t1']);
  assert.deepEqual(b.abiertosDe('g2', 'u1'), []);
  assert.equal(b.correoDe('u1'), 'ana@clipviral.test');
  assert.equal(b.correoDe('nadie'), '');
  assert.equal(b.ultimaVersion(), '1.2.3');
  assert.deepEqual(b.servidores().map((s) => s.guildId), ['g1']);
  assert.equal(b.cambiarTicket('no-existe', { estado: 'x' }), null);
});

test('si el archivo se daña, lo guarda aparte y empieza limpio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  fs.writeFileSync(path.join(dir, 'bot.json'), '{ esto no es json');
  const a = new Almacen(dir);
  assert.equal(a.ultimaVersion(), null);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bot.json.danado-')));
});

test('transcripción legible con fecha de Santo Domingo, adjuntos y mensajes del bot', () => {
  const ticket = { numero: 7, tipoNombre: 'Reporte de error', userTag: 'ana', userId: '42', correo: '', abierto: '2026-11-18T20:00:00Z' };
  const mensajes = [
    mensajeAPlano({ author: { username: 'ClipViral', bot: true }, content: '', embeds: [{ title: 'Ticket #0007', description: 'Hola', fields: [{ name: 'Qué salió mal', value: 'Se cierra' }] }], attachments: new Map(), createdTimestamp: Date.parse('2026-11-18T20:00:00Z') }),
    mensajeAPlano({ author: { username: 'ana', globalName: 'Ana' }, content: 'Línea 1\nLínea 2', attachments: new Map([['1', { url: 'https://x/y.png' }]]), createdTimestamp: Date.parse('2026-11-18T20:05:00Z') }),
    mensajeAPlano({ author: { username: 'beto' }, content: '', attachments: new Map(), createdTimestamp: Date.parse('2026-11-18T20:06:00Z') }),
  ];
  const t = transcripcion({ ticket, mensajes, cerradoPor: 'Luis (@luis)', motivo: '', cerrado: '2026-11-18T21:00:00Z', zona: 'America/Santo_Domingo' });
  assert.match(t, /^ClipViral · Ticket #0007 · Reporte de error/);
  assert.match(t, /Correo de ClipViral: no lo puso/);
  assert.match(t, /Cerrado: .*por Luis \(@luis\)/);
  assert.match(t, /\[bot\]:\n {4}Ticket #0007\n {4}Hola\n {4}Qué salió mal: Se cierra/);
  assert.match(t, /Ana \(@ana\):\n {4}Línea 1\n {4}Línea 2\n {4}📎 https:\/\/x\/y\.png/);
  assert.match(t, /beto:\n {4}\(sin texto\)/);
  // 20:00 UTC son las 4:00 p. m. en Santo Domingo (UTC-4).
  assert.match(fecha('2026-11-18T20:00:00Z', 'America/Santo_Domingo'), /18\/11\/2026.*0?4:00/);
  assert.equal(fecha('no es fecha'), '—');
  assert.ok(fecha('2026-11-18T20:00:00Z', 'Zona/Inventada').includes('2026'), 'zona mala no rompe');
});

test('un ticket que quedó "cerrando" (el bot se apagó a mitad) vuelve a abierto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const a = new Almacen(dir);
  a.nuevoTicket({ canalId: 't1', guildId: 'g', userId: 'u' });
  a.cambiarTicket('t1', { estado: 'cerrando' });
  assert.equal(new Almacen(dir).ticket('t1').estado, 'abierto');
  a.guardarPrincipal('g');
  assert.equal(new Almacen(dir).principal(), 'g');
});

test('candado: no deja encender dos bots con la misma carpeta', async () => {
  const { tomarCandado } = await import('../src/candado.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const uno = await tomarCandado(dir);
  assert.ok(uno);
  if (process.platform === 'win32') assert.equal(await tomarCandado(dir), null);
  const otraCarpeta = await tomarCandado(fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-')));
  assert.ok(otraCarpeta, 'otra carpeta sí');
  await new Promise((r) => uno.close(r));
  const otraVez = await tomarCandado(dir);
  assert.ok(otraVez, 'al cerrarse el primero, se puede volver a encender');
  otraVez.close();
  otraCarpeta.close();
});
