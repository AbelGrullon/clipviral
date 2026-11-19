import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { Almacen } from '../src/almacen.js';
import { montar, NOMBRES, soloLeer, privado } from '../src/montaje.js';
import { COMANDOS, PERMISOS_INVITACION } from '../src/comandos.js';
import { enlaceInvitacion, permisosInvitacion } from '../src/config.js';
import { PERMISOS } from '../src/tickets.js';
import { servidorFalso } from './falsos.js';

const almacenNuevo = () => new Almacen(fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-')));

test('primera vez: crea el rol, las categorías, los canales y el panel de tickets', async () => {
  const almacen = almacenNuevo();
  const guild = servidorFalso();
  const { hecho, cfg } = await montar(guild, { almacen, botId: 'bot' });
  assert.equal(guild.rolesCreados.length, 1);
  assert.equal(guild.rolesCreados[0].name, NOMBRES.rol);
  assert.deepEqual(guild.creados.map((c) => c.name), [NOMBRES.categoriaInfo, NOMBRES.anuncios, NOMBRES.abrir, NOMBRES.categoriaTickets, NOMBRES.registro]);
  assert.equal(hecho.length, 7);

  const porNombre = (n) => guild.channels.cache.find((c) => c.name === n);
  const anuncios = porNombre(NOMBRES.anuncios);
  const abrir = porNombre(NOMBRES.abrir);
  const registro = porNombre(NOMBRES.registro);
  assert.equal(anuncios.parentId, porNombre(NOMBRES.categoriaInfo).id);
  assert.equal(registro.parentId, porNombre(NOMBRES.categoriaTickets).id);
  // Los clientes leen anuncios pero no escriben; el registro es solo del equipo.
  const todosAnuncios = anuncios.opciones.permissionOverwrites.find((o) => o.id === guild.id);
  assert.deepEqual(todosAnuncios.deny, ['SendMessages']);
  assert.ok(todosAnuncios.allow.includes('ViewChannel'));
  assert.deepEqual(registro.opciones.permissionOverwrites.find((o) => o.id === guild.id).deny, ['ViewChannel']);
  assert.ok(registro.opciones.permissionOverwrites.find((o) => o.id === cfg.rolEquipo).allow.includes('ViewChannel'));
  assert.equal(abrir.enviados[0].components[0].components.length, 3);

  assert.equal(cfg.anuncios, anuncios.id);
  assert.equal(cfg.registro, registro.id);
  assert.equal(cfg.panelMensaje, abrir.mensajes[0].id);
  assert.ok(cfg.montado);
  assert.deepEqual(almacen.servidor(guild.id), cfg);
});

test('otra vez: no duplica nada, solo actualiza el panel; si borraron un canal, lo vuelve a crear', async () => {
  const almacen = almacenNuevo();
  const guild = servidorFalso();
  const primero = await montar(guild, { almacen, botId: 'bot' });
  const creados = guild.creados.length;
  const segundo = await montar(guild, { almacen, botId: 'bot' });
  assert.deepEqual(segundo.hecho, []);
  assert.equal(guild.creados.length, creados);
  const abrir = guild.channels.cache.get(primero.cfg.abrir);
  assert.equal(abrir.enviados.length, 1);
  assert.ok(abrir.mensajes[0].editado, 'el panel se actualiza');

  guild.channels.cache.delete(primero.cfg.registro);
  const tercero = await montar(guild, { almacen, botId: 'bot' });
  assert.deepEqual(guild.creados.slice(creados).map((c) => c.name), [NOMBRES.registro]);
  assert.notEqual(tercero.cfg.registro, primero.cfg.registro);
  assert.equal(guild.rolesCreados.length, 1);
});

test('al pasar el bot de la PC al VPS (sin lo guardado): reusa canales y panel, no duplica nada', async () => {
  const guild = servidorFalso();
  const { cfg } = await montar(guild, { almacen: almacenNuevo(), botId: 'bot' });
  const antes = guild.creados.length;
  const { hecho, cfg: nuevo } = await montar(guild, { almacen: almacenNuevo(), botId: 'bot' });
  assert.equal(guild.creados.length, antes);
  assert.deepEqual(hecho, []);
  const abrir = guild.channels.cache.get(cfg.abrir);
  assert.equal(abrir.enviados.length, 1, 'un solo panel');
  assert.equal(nuevo.panelMensaje, cfg.panelMensaje);
  assert.equal(nuevo.anuncios, cfg.anuncios);
  // Un mensaje de otra persona con botones no se confunde con el panel del bot.
  const g2 = servidorFalso();
  await montar(g2, { almacen: almacenNuevo(), botId: 'bot' });
  const abrir2 = g2.channels.cache.find((c) => c.name === NOMBRES.abrir);
  abrir2.mensajes[0].author = { id: 'otra-persona' };
  await montar(g2, { almacen: almacenNuevo(), botId: 'bot' });
  assert.equal(abrir2.enviados.length, 2);
});

test('permisos que pide el enlace de invitación: alcanzan para todo lo que hace el bot', () => {
  const pedidos = new Set(PERMISOS_INVITACION);
  for (const n of PERMISOS_INVITACION) assert.ok(n in PermissionFlagsBits, n);
  // Al crear un canal, el bot solo puede dar o quitar permisos que él tiene.
  const usados = [
    ...Object.values(PERMISOS).flat(),
    ...soloLeer({ todosId: 1, equipoId: 2, botId: 3 }).flatMap((o) => [...(o.allow || []), ...(o.deny || [])]),
    ...privado({ todosId: 1, equipoId: 2, botId: 3 }).flatMap((o) => [...(o.allow || []), ...(o.deny || [])]),
  ];
  for (const n of usados) assert.ok(pedidos.has(n), `falta pedir ${n}`);
  assert.ok(!pedidos.has('Administrator'), 'no pide ser administrador');
  assert.equal(enlaceInvitacion('123'), `https://discord.com/oauth2/authorize?client_id=123&scope=bot+applications.commands&permissions=${permisosInvitacion()}`);
});

test('comandos con barra', () => {
  assert.deepEqual(COMANDOS.map((c) => c.name), ['ticket', 'cerrar', 'anunciar', 'anunciar-version', 'configurar']);
  for (const c of COMANDOS) {
    assert.match(c.name, /^[a-z-]{1,32}$/);
    assert.ok(c.description.length <= 100, c.name);
  }
  assert.deepEqual(COMANDOS[0].options[0].choices.map((x) => x.value), ['soporte', 'reclamacion', 'error']);
  for (const n of ['anunciar', 'anunciar-version', 'configurar']) assert.equal(COMANDOS.find((c) => c.name === n).default_member_permissions, '32');
});
