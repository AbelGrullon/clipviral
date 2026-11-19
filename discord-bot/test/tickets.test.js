import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { Almacen } from '../src/almacen.js';
import {
  TIPOS, MAX_ABIERTOS, PERMISOS, modalTicket, leerFormulario, nombreCanal, slug, correoValido, permisosTicket,
  panelTickets, abrirTicket, cerrarTicket, puedeCerrar, textoCuenta, leerMensajes,
} from '../src/tickets.js';
import { servidorFalso, usuarioFalso, canalFalso, escribir } from './falsos.js';

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
const ZONA = 'America/Santo_Domingo';

function listo() {
  const dir = carpeta();
  const almacen = new Almacen(dir);
  const guild = servidorFalso();
  const registro = canalFalso({ name: 'registro', guild });
  guild.channels.cache.set(registro.id, registro);
  almacen.guardarServidor(guild.id, { categoriaTickets: 'cat-1', rolEquipo: 'rol-equipo', registro: registro.id, montado: 'x' });
  return { dir, almacen, guild, registro };
}

const formulario = (correo = 'ana@clipviral.test', mensaje = 'No me deja entrar') => ({
  correo, respuestas: [{ id: 'mensaje', label: '¿En qué te ayudamos?', valor: mensaje }],
});

test('los tres tipos de ticket: soporte, reclamación y reporte de error', () => {
  assert.deepEqual(Object.keys(TIPOS), ['soporte', 'reclamacion', 'error']);
  const panel = panelTickets();
  const botones = panel.components[0].components;
  assert.deepEqual(botones.map((b) => b.custom_id), ['ticket:abrir:soporte', 'ticket:abrir:reclamacion', 'ticket:abrir:error']);
  // Discord rechaza emojis con el selector de variación en los botones.
  for (const b of botones) assert.ok(!b.emoji.name.includes('️'), b.label);
  // Nada de efectivo ni transferencias en lo que ven los clientes.
  assert.doesNotMatch(JSON.stringify(panel), /efectivo|transferencia/i);
});

test('formulario: el correo viene lleno si ya lo dio, y respeta los límites de Discord', () => {
  for (const tipo of Object.keys(TIPOS)) {
    const m = modalTicket(tipo, 'ana@clipviral.test');
    assert.equal(m.custom_id, `ticket:form:${tipo}`);
    assert.ok(m.title.length <= 45);
    assert.ok(m.components.length <= 5);
    const campos = m.components.map((f) => f.components[0]);
    assert.equal(campos[0].custom_id, 'correo');
    assert.equal(campos[0].value, 'ana@clipviral.test');
    assert.equal(campos[0].required, false);
    for (const c of campos) {
      assert.ok(c.label.length <= 45, c.label);
      assert.ok(!c.placeholder || c.placeholder.length <= 100, c.placeholder);
    }
  }
  assert.equal(modalTicket('soporte').components[0].components[0].value, undefined);
});

test('leer el formulario: correo en minúsculas y campos vacíos sin romper', () => {
  const valores = { correo: '  Ana@ClipViral.TEST ', mensaje: ' se cierra sola ', pasos: '' };
  const f = leerFormulario('error', (id) => {
    if (!(id in valores)) throw new Error('no existe');
    return valores[id];
  });
  assert.equal(f.correo, 'ana@clipviral.test');
  assert.deepEqual(f.respuestas.map((r) => [r.id, r.valor]), [['mensaje', 'se cierra sola'], ['pasos', ''], ['version', '']]);
});

test('nombre del canal: minúsculas, sin tildes ni símbolos', () => {
  assert.equal(nombreCanal('reclamacion', 7, 'José_Ñúñez!!'), 'reclamacion-0007-jose-nunez');
  assert.equal(nombreCanal('soporte', 12345, '🙂'), 'soporte-12345-cliente');
  assert.equal(slug('a'.repeat(50)).length, 30);
  assert.equal(correoValido('ana@clipviral.test'), true);
  for (const malo of ['', 'ana', 'ana@', 'ana@x', 'a b@c.com', 'x'.repeat(200) + '@a.com']) assert.equal(correoValido(malo), false, malo);
});

test('permisos: nadie ve el ticket salvo el cliente, el equipo y el bot', () => {
  const p = permisosTicket({ todosId: 'todos', clienteId: 'cli', equipoId: 'eq', botId: 'bot' });
  assert.deepEqual(p.find((x) => x.id === 'todos').deny, ['ViewChannel']);
  assert.ok(p.find((x) => x.id === 'cli').allow.includes('ViewChannel'));
  assert.ok(p.find((x) => x.id === 'eq').allow.includes('ViewChannel'));
  assert.ok(p.find((x) => x.id === 'bot').allow.includes('ManageChannels'));
  assert.equal(p.find((x) => x.id === 'cli').type, 1);
  assert.equal(p.find((x) => x.id === 'eq').type, 0);
  // Todos los nombres de permisos existen en discord.js.
  for (const lista of Object.values(PERMISOS)) for (const n of lista) assert.ok(n in PermissionFlagsBits, n);
});

test('abrir: crea el canal privado, saluda, avisa al equipo con su cuenta y recuerda el correo', async () => {
  const { almacen, guild, registro } = listo();
  const ana = usuarioFalso('ana', { globalName: 'Ana' });
  let preguntado = null;
  const clipviral = { buscarCliente: async (c) => { preguntado = c; return { encontrada: true, nombre: 'Ana Pérez', rol: 'user', plan: { nombre: 'Claude', activo: true, vence: '2026-12-18T00:00:00Z' }, pagos: 2, pagado: 60, clips: 14, creada: '2026-11-01T12:00:00Z' }; } };
  const r = await abrirTicket({ guild, usuario: ana, tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot', clipviral, zona: ZONA });
  assert.ok(r.canal);
  const creado = guild.creados.at(-1);
  assert.equal(creado.name, 'soporte-0001-ana');
  assert.equal(creado.parent, 'cat-1');
  assert.ok(creado.permissionOverwrites.some((o) => o.id === guild.id && o.deny.includes('ViewChannel')));
  assert.ok(creado.permissionOverwrites.some((o) => o.id === ana.id && o.allow.includes('SendMessages')));
  assert.ok(creado.permissionOverwrites.some((o) => o.id === 'rol-equipo'));

  const saludo = r.canal.enviados[0];
  assert.match(saludo.content, new RegExp(`<@${ana.id}>`));
  assert.match(saludo.content, /<@&rol-equipo>/);
  assert.deepEqual(saludo.allowedMentions, { users: [ana.id], roles: ['rol-equipo'] });
  assert.equal(saludo.components[0].components[0].custom_id, 'ticket:cerrar');
  assert.ok(saludo.embeds[0].fields.some((f) => f.value === 'No me deja entrar'));
  // Los datos de la cuenta van SOLO al registro del equipo, no al canal del ticket (que ve el cliente).
  assert.doesNotMatch(JSON.stringify(saludo), /Claude|60 USD/);
  assert.equal(preguntado, 'ana@clipviral.test');
  const aviso = JSON.stringify(registro.enviados[0]);
  assert.match(aviso, /Ana Pérez/);
  assert.match(aviso, /Claude/);
  assert.match(aviso, /60 USD/);
  assert.match(aviso, new RegExp(`<#${r.canal.id}>`));

  assert.equal(almacen.ticket(r.canal.id).estado, 'abierto');
  assert.equal(almacen.correoDe(ana.id), 'ana@clipviral.test');
  // El siguiente ticket lleva el número siguiente.
  const r2 = await abrirTicket({ guild, usuario: ana, tipo: 'error', formulario: formulario(''), almacen, botId: 'bot', zona: ZONA });
  assert.equal(guild.creados.at(-1).name, 'error-0002-ana');
  assert.match(JSON.stringify(registro.enviados.at(-1)), /No escribió correo/);
  assert.ok(r2.canal);
});

test('abrir: máximo de tickets abiertos por cliente, y sin configurar no abre', async () => {
  const { almacen, guild } = listo();
  const ana = usuarioFalso('ana');
  for (let i = 0; i < MAX_ABIERTOS; i++) assert.ok((await abrirTicket({ guild, usuario: ana, tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' })).canal);
  const r = await abrirTicket({ guild, usuario: ana, tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' });
  assert.match(r.error, /Ya tienes 3 tickets abiertos/);
  // Otro cliente sí puede.
  assert.ok((await abrirTicket({ guild, usuario: usuarioFalso('beto'), tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' })).canal);

  const otro = servidorFalso();
  assert.match((await abrirTicket({ guild: otro, usuario: ana, tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' })).error, /configurar/);
});

test('abrir: sin permiso para crear canales, el cliente recibe un mensaje claro', async () => {
  const { almacen } = listo();
  const guild = servidorFalso({ fallarCrear: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });
  almacen.guardarServidor(guild.id, { categoriaTickets: 'c', registro: 'r' });
  const r = await abrirTicket({ guild, usuario: usuarioFalso(), tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' });
  assert.match(r.error, /No tengo permiso/);
});

test('lo que ve el equipo de la cuenta según el caso', () => {
  assert.equal(textoCuenta({ correo: '' }), 'No escribió correo.');
  assert.match(textoCuenta({ correo: 'nada' }), /no parece un correo/);
  assert.match(textoCuenta({ correo: 'a@b.com', cuenta: { encontrada: false } }), /No hay ninguna cuenta/);
  assert.match(textoCuenta({ correo: 'a@b.com', cuenta: { sinConexion: true, motivo: 'sin-clave' } }), /VPS/);
  assert.match(textoCuenta({ correo: 'a@b.com', cuenta: { sinConexion: true, motivo: 'viejo' } }), /versión vieja/);
  assert.match(textoCuenta({ correo: 'a@b.com', cuenta: { encontrada: true, nombre: 'X', plan: { nombre: 'Local', activo: false, vencido: true } } }), /vencido/);
  assert.match(textoCuenta({ correo: 'a@b.com', cuenta: { encontrada: true, nombre: 'X', bloqueado: true, plan: {} } }), /bloqueada/);
});

test('quién puede cerrar: el cliente que lo abrió o el equipo', () => {
  const t = { estado: 'abierto', userId: 'ana' };
  assert.equal(puedeCerrar(t, 'ana', false), true);
  assert.equal(puedeCerrar(t, 'beto', false), false);
  assert.equal(puedeCerrar(t, 'beto', true), true);
  assert.equal(puedeCerrar({ ...t, estado: 'cerrando' }, 'ana', true), false);
  assert.equal(puedeCerrar(null, 'ana', true), false);
});

test('leer todos los mensajes aunque sean más de 100, en orden', async () => {
  const canal = canalFalso();
  const u = usuarioFalso();
  for (let i = 0; i < 250; i++) escribir(canal, u, `mensaje ${i}`);
  const todos = await leerMensajes(canal);
  assert.equal(todos.length, 250);
  assert.equal(todos[0].content, 'mensaje 0');
  assert.equal(todos.at(-1).content, 'mensaje 249');
});

test('cerrar: guarda la conversación (registro, disco y copia al cliente) y borra el canal', async () => {
  const { dir, almacen, guild, registro } = listo();
  const ana = usuarioFalso('ana', { globalName: 'Ana' });
  const { canal } = await abrirTicket({ guild, usuario: ana, tipo: 'reclamacion', formulario: formulario(), almacen, botId: 'bot' });
  escribir(canal, ana, 'Hola, me cobraron dos veces', ['https://cdn.discordapp.com/captura.png']);
  escribir(canal, { id: 'eq1', username: 'soporte1', displayName: 'Luis' }, 'Ya lo revisamos, te devolvemos uno');

  const dm = [];
  const r = await cerrarTicket({
    canal, guild, quien: ana, motivo: 'resuelto', almacen, zona: ZONA,
    carpetaTranscripciones: path.join(dir, 'transcripciones'), avisarCliente: async (id, m) => dm.push([id, m]), borrarEn: 0,
  });
  assert.equal(r.ok, true);
  assert.equal(canal.borrado, true);
  const t = almacen.ticket(canal.id);
  assert.equal(t.estado, 'cerrado');
  assert.equal(t.motivo, 'resuelto');
  assert.equal(t.mensajes, 3);

  const enRegistro = registro.enviados.at(-1);
  assert.match(enRegistro.embeds[0].title, /Ticket #0001 cerrado · Reclamación/);
  const archivo = enRegistro.files[0];
  assert.equal(archivo.name, 'ticket-0001-reclamacion.txt');
  const texto = archivo.attachment.toString('utf8');
  assert.match(texto, /Ticket #0001 · Reclamación/);
  assert.match(texto, /Correo de ClipViral: ana@clipviral\.test/);
  assert.match(texto, /me cobraron dos veces/);
  assert.match(texto, /📎 https:\/\/cdn\.discordapp\.com\/captura\.png/);
  assert.match(texto, /Luis \(@soporte1\):\n {4}Ya lo revisamos/);
  assert.match(texto, /Motivo del cierre: resuelto/);
  assert.ok(texto.indexOf('dos veces') < texto.indexOf('Ya lo revisamos'), 'en orden');

  assert.equal(fs.readFileSync(r.guardado, 'utf8'), texto);
  assert.equal(dm[0][0], ana.id);
  assert.equal(dm[0][1].files[0].name, 'ticket-0001-reclamacion.txt');

  // Cerrar dos veces no hace nada.
  assert.match((await cerrarTicket({ canal, guild, quien: ana, almacen, borrarEn: 0 })).error, /no es un ticket abierto/);
});

test('cerrar: si no se puede guardar la conversación en ningún lado, el canal NO se borra', async () => {
  const { almacen, guild } = listo();
  const { canal } = await abrirTicket({ guild, usuario: usuarioFalso(), tipo: 'soporte', formulario: formulario(), almacen, botId: 'bot' });
  almacen.guardarServidor(guild.id, { registro: 'ya-no-existe' });
  const r = await cerrarTicket({ canal, guild, quien: usuarioFalso('eq'), almacen, borrarEn: 0 });
  assert.match(r.error, /no borré el canal/);
  assert.equal(canal.borrado, false);
  assert.equal(almacen.ticket(canal.id).estado, 'abierto');
});

test('cerrar: el cliente con mensajes privados cerrados no impide cerrar', async () => {
  const { dir, almacen, guild } = listo();
  const { canal } = await abrirTicket({ guild, usuario: usuarioFalso(), tipo: 'error', formulario: formulario(), almacen, botId: 'bot' });
  const r = await cerrarTicket({
    canal, guild, quien: usuarioFalso('eq'), almacen, borrarEn: 0, carpetaTranscripciones: path.join(dir, 't'),
    avisarCliente: async () => { throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }); },
  });
  assert.equal(r.ok, true);
  assert.equal(canal.borrado, true);
});
