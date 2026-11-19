// Botones, formularios y comandos de punta a punta, con un Discord de mentira.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../src/almacen.js';
import { montar } from '../src/montaje.js';
import { manejarInteraccion, prepararServidor, esEquipo, servidorPermitido } from '../src/bot.js';
import { COMANDOS } from '../src/comandos.js';
import { EFIMERO } from '../src/tickets.js';
import { servidorFalso, usuarioFalso, escribir } from './falsos.js';

async function preparar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const almacen = new Almacen(dir);
  const guild = servidorFalso();
  const { cfg } = await montar(guild, { almacen, botId: 'bot' });
  almacen.guardarPrincipal(guild.id);
  const dms = [];
  const publicados = [];
  const registro = [];
  const ctx = {
    almacen, botId: 'bot', borrarEn: 0, log: (s) => registro.push(s),
    cfg: { zona: 'America/Santo_Domingo', transcripciones: path.join(dir, 'transcripciones'), clipviralUrl: 'http://127.0.0.1:4600' },
    clipviral: { buscarCliente: async () => ({ encontrada: true, nombre: 'Ana', plan: { nombre: 'Local', activo: true }, pagos: 1, pagado: 20, clips: 3 }) },
    noticias: { anunciarUltima: async () => ({ version: '1.2.0', enviados: 1 }) },
    publicarEn: async (guildId, m) => { publicados.push([guildId, m]); return true; },
  };
  return { almacen, guild, cfg, ctx, dms, publicados, registro };
}

function interaccion(base, { tipo, customId, commandName, opciones = {}, campos = {}, usuario, canal = null, permisos = [], roles = [], dms = [] }) {
  const i = {
    customId, commandName, guild: base.guild, guildId: base.guild.id, user: usuario,
    channel: canal, channelId: canal?.id ?? 'otro-canal',
    member: { roles: { cache: new Set(roles) } },
    memberPermissions: { has: (p) => permisos.includes(p) },
    respuestas: [], modal: null, deferred: false, replied: false,
    client: {
      user: { id: 'bot' },
      users: { fetch: async (id) => ({ send: async (m) => dms.push([id, m]) }) },
      channels: { fetch: async (id) => base.guild.channels.cache.get(id) },
    },
    inGuild: () => true,
    isRepliable: () => true,
    isChatInputCommand: () => tipo === 'comando',
    isButton: () => tipo === 'boton',
    isModalSubmit: () => tipo === 'form',
    options: { getString: (n) => opciones[n] ?? null },
    fields: { getTextInputValue: (id) => { if (!(id in campos)) throw new Error(`no hay campo ${id}`); return campos[id]; } },
    async reply(m) { i.replied = true; i.respuestas.push(['reply', m]); },
    async deferReply(m) { i.deferred = true; i.respuestas.push(['defer', m]); },
    async editReply(m) { i.respuestas.push(['edit', m]); },
    async followUp(m) { i.respuestas.push(['followUp', m]); },
    async update(m) { i.respuestas.push(['update', m]); },
    async showModal(m) { i.modal = m; },
  };
  return i;
}

const texto = (r) => (typeof r[1] === 'string' ? r[1] : r[1]?.content);

test('cliente: botón → formulario → ticket creado (respuesta solo para él)', async () => {
  const b = await preparar();
  const ana = usuarioFalso('ana');
  b.almacen.vincular(ana.id, 'ana@clipviral.test');

  const clic = interaccion(b, { tipo: 'boton', customId: 'ticket:abrir:reclamacion', usuario: ana });
  await manejarInteraccion(clic, b.ctx);
  assert.equal(clic.modal.custom_id, 'ticket:form:reclamacion');
  assert.equal(clic.modal.components[0].components[0].value, 'ana@clipviral.test');

  const envio = interaccion(b, { tipo: 'form', customId: 'ticket:form:reclamacion', usuario: ana, campos: { correo: 'ana@clipviral.test', mensaje: 'Me cobraron doble', solucion: 'Que me devuelvan' } });
  await manejarInteraccion(envio, b.ctx);
  assert.equal(envio.respuestas[0][1].flags, EFIMERO);
  const [, final] = envio.respuestas.at(-1);
  assert.match(final, /^✅ Listo, tu ticket está aquí: <#\d+>$/);
  const canal = b.guild.channels.cache.find((c) => c.name === 'reclamacion-0001-ana');
  assert.ok(canal);
  assert.ok(canal.enviados[0].embeds[0].fields.some((f) => f.value === 'Que me devuelvan'));
});

test('cerrar con el botón: pide confirmar, y "Sí, cerrar" guarda la conversación y borra el canal', async () => {
  const b = await preparar();
  const ana = usuarioFalso('ana');
  const envio = interaccion(b, { tipo: 'form', customId: 'ticket:form:soporte', usuario: ana, campos: { correo: '', mensaje: '¿Cómo cambio el estilo?' } });
  await manejarInteraccion(envio, b.ctx);
  const canal = b.guild.channels.cache.find((c) => c.name === 'soporte-0001-ana');
  escribir(canal, ana, 'Ya lo encontré, gracias');

  // Otro cliente que no es del equipo no puede cerrarlo.
  const intruso = interaccion(b, { tipo: 'boton', customId: 'ticket:cerrar', usuario: usuarioFalso('beto'), canal });
  await manejarInteraccion(intruso, b.ctx);
  assert.match(texto(intruso.respuestas[0]), /Solo quien abrió el ticket o el equipo/);

  const clic = interaccion(b, { tipo: 'boton', customId: 'ticket:cerrar', usuario: ana, canal });
  await manejarInteraccion(clic, b.ctx);
  const confirmar = clic.respuestas[0][1];
  assert.equal(confirmar.flags, EFIMERO);
  assert.deepEqual(confirmar.components[0].components.map((x) => x.custom_id), ['ticket:cerrar:si', 'ticket:cerrar:no']);

  const no = interaccion(b, { tipo: 'boton', customId: 'ticket:cerrar:no', usuario: ana, canal });
  await manejarInteraccion(no, b.ctx);
  assert.equal(b.almacen.ticket(canal.id).estado, 'abierto');

  const dms = [];
  const si = interaccion(b, { tipo: 'boton', customId: 'ticket:cerrar:si', usuario: ana, canal, dms });
  await manejarInteraccion(si, b.ctx);
  assert.equal(b.almacen.ticket(canal.id).estado, 'cerrado');
  assert.equal(canal.borrado, true);
  const registro = b.guild.channels.cache.get(b.cfg.registro);
  const txt = registro.enviados.at(-1).files[0].attachment.toString('utf8');
  assert.match(txt, /¿Cómo cambio el estilo\?/);
  assert.match(txt, /Ya lo encontré, gracias/);
  assert.match(txt, /cerró el ticket/);
  assert.equal(dms[0][0], ana.id);
});

test('/cerrar del equipo con motivo; fuera de un ticket explica dónde usarlo', async () => {
  const b = await preparar();
  const ana = usuarioFalso('ana');
  await manejarInteraccion(interaccion(b, { tipo: 'form', customId: 'ticket:form:error', usuario: ana, campos: { correo: 'ana@clipviral.test', mensaje: 'Se cierra sola' } }), b.ctx);
  const canal = b.guild.channels.cache.find((c) => c.name === 'error-0001-ana');

  const fuera = interaccion(b, { tipo: 'comando', commandName: 'cerrar', usuario: ana });
  await manejarInteraccion(fuera, b.ctx);
  assert.match(texto(fuera.respuestas[0]), /dentro del canal de un ticket/);

  const luis = usuarioFalso('luis');
  const cmd = interaccion(b, { tipo: 'comando', commandName: 'cerrar', opciones: { motivo: 'Arreglado en la 1.2.1' }, usuario: luis, canal, roles: [b.cfg.rolEquipo] });
  await manejarInteraccion(cmd, b.ctx);
  assert.match(texto(cmd.respuestas[0]), /cerró el ticket · Motivo: Arreglado en la 1\.2\.1/);
  assert.equal(b.almacen.ticket(canal.id).cerradoPor, 'luis (@luis)');
  const aviso = b.guild.channels.cache.get(b.cfg.registro).enviados.at(-1);
  assert.ok(aviso.embeds[0].fields.some((f) => f.name === 'Motivo' && f.value === 'Arreglado en la 1.2.1'));
});

test('/ticket abre el mismo formulario; un tipo inventado no', async () => {
  const b = await preparar();
  const i = interaccion(b, { tipo: 'comando', commandName: 'ticket', opciones: { tipo: 'error' }, usuario: usuarioFalso() });
  await manejarInteraccion(i, b.ctx);
  assert.equal(i.modal.custom_id, 'ticket:form:error');
  const malo = interaccion(b, { tipo: 'boton', customId: 'ticket:abrir:hackeo', usuario: usuarioFalso() });
  await manejarInteraccion(malo, b.ctx);
  assert.equal(malo.modal, null);
  assert.match(texto(malo.respuestas[0]), /no existe/);
});

test('anuncios y /configurar: solo el equipo o los administradores', async () => {
  const b = await preparar();
  const cliente = interaccion(b, { tipo: 'comando', commandName: 'anunciar', usuario: usuarioFalso() });
  await manejarInteraccion(cliente, b.ctx);
  assert.equal(cliente.modal, null);
  assert.match(texto(cliente.respuestas[0]), /Solo el equipo/);

  const admin = interaccion(b, { tipo: 'comando', commandName: 'anunciar', usuario: usuarioFalso('abel'), permisos: ['ManageGuild'] });
  await manejarInteraccion(admin, b.ctx);
  assert.equal(admin.modal.custom_id, 'anuncio:form');

  const envio = interaccion(b, { tipo: 'form', customId: 'anuncio:form', usuario: usuarioFalso('abel'), permisos: ['ManageGuild'], campos: { titulo: 'Mantenimiento', mensaje: 'Esta noche a las 10' } });
  await manejarInteraccion(envio, b.ctx);
  assert.equal(b.publicados[0][1].embeds[0].title, '📢 Mantenimiento');
  assert.match(envio.respuestas.at(-1)[1], /Publicado en <#/);

  const version = interaccion(b, { tipo: 'comando', commandName: 'anunciar-version', usuario: usuarioFalso(), roles: [b.cfg.rolEquipo] });
  await manejarInteraccion(version, b.ctx);
  assert.match(version.respuestas.at(-1)[1], /Anuncié la versión 1\.2\.0/);

  const conf = interaccion(b, { tipo: 'comando', commandName: 'configurar', usuario: usuarioFalso(), roles: [b.cfg.rolEquipo] });
  await manejarInteraccion(conf, b.ctx);
  assert.match(texto(conf.respuestas[0]), /Solo un administrador/);
  const conf2 = interaccion(b, { tipo: 'comando', commandName: 'configurar', usuario: usuarioFalso(), permisos: ['ManageGuild'] });
  await manejarInteraccion(conf2, b.ctx);
  assert.match(conf2.respuestas.at(-1)[1], /Todo estaba en su sitio/);
});

test('si algo falla, la persona recibe un aviso y queda en el registro', async () => {
  const b = await preparar();
  b.ctx.noticias.anunciarUltima = async () => { throw new Error('ECONNREFUSED'); };
  const i = interaccion(b, { tipo: 'comando', commandName: 'anunciar-version', usuario: usuarioFalso(), permisos: ['ManageGuild'] });
  await manejarInteraccion(i, b.ctx);
  assert.match(i.respuestas.at(-1)[1], /No pude preguntarle al servidor de ClipViral/);

  b.almacen.ticket = () => { throw new Error('disco lleno'); };
  const j = interaccion(b, { tipo: 'boton', customId: 'ticket:cerrar', usuario: usuarioFalso(), canal: { id: 'x' } });
  await manejarInteraccion(j, b.ctx);
  assert.match(j.respuestas[0][1].content, /Algo salió mal/);
  assert.equal(j.respuestas[0][1].flags, EFIMERO);
  assert.ok(b.registro.some((l) => l.includes('disco lleno')));
});

test('al entrar a un servidor nuevo: pone los comandos y arma los canales una sola vez', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const almacen = new Almacen(dir);
  const guild = servidorFalso();
  const ctx = { almacen, botId: 'bot', log: () => {} };
  await prepararServidor(guild, ctx);
  assert.deepEqual(guild.commands.puestos, COMANDOS);
  const creados = guild.creados.length;
  assert.ok(creados >= 5);
  await prepararServidor(guild, ctx);
  assert.equal(guild.creados.length, creados);
});

test('quién es del equipo', () => {
  assert.equal(esEquipo({ memberPermissions: { has: () => true } }, null), true);
  assert.equal(esEquipo({ member: { roles: ['r1'] } }, { rolEquipo: 'r1' }), true);
  assert.equal(esEquipo({ member: { roles: { cache: new Set(['r2']) } } }, { rolEquipo: 'r1' }), false);
  assert.equal(esEquipo({ member: { roles: ['r1'] } }, null), false);
});

test('el bot trabaja solo en TU servidor de Discord: en otros no arma nada ni contesta', async () => {
  const b = await preparar();
  const ctx = { ...b.ctx, log: () => {} };
  // Con un almacén nuevo, el primer servidor donde se prepara queda como el principal.
  const nuevo = new Almacen(fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-')));
  const mio = servidorFalso({ name: 'ClipViral' });
  await prepararServidor(mio, { ...ctx, almacen: nuevo });
  assert.equal(nuevo.principal(), mio.id);
  assert.equal(b.almacen.principal(), b.guild.id);

  const ajeno = servidorFalso({ name: 'Otro servidor' });
  await prepararServidor(ajeno, ctx);
  assert.equal(ajeno.commands.puestos, null);
  assert.equal(ajeno.creados.length, 0);

  const i = interaccion({ guild: ajeno }, { tipo: 'form', customId: 'ticket:form:soporte', usuario: usuarioFalso(), campos: { correo: 'victima@clipviral.test', mensaje: 'x' } });
  let preguntado = false;
  await manejarInteraccion(i, { ...ctx, clipviral: { buscarCliente: async () => { preguntado = true; return {}; } } });
  assert.equal(preguntado, false, 'nunca consulta cuentas desde otro servidor');
  assert.match(texto(i.respuestas[0]), /solo para el servidor de Discord de ClipViral/);
  assert.equal(servidorPermitido('cualquiera', { almacen: b.almacen, cfg: { servidorId: 'cualquiera' } }), true, 'DISCORD_SERVIDOR_ID manda');
  assert.equal(servidorPermitido(b.guild.id, { almacen: b.almacen, cfg: { servidorId: 'otro' } }), false);
});
