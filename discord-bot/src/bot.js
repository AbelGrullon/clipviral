// Qué hace el bot con cada botón, formulario y comando que toca alguien en Discord.
import { EFIMERO, MAX_ABIERTOS, esTipo, modalTicket, leerFormulario, abrirTicket, cerrarTicket, puedeCerrar, confirmarCierre } from './tickets.js';
import { modalAnuncio, anuncioManual } from './noticias.js';
import { montar } from './montaje.js';
import { COMANDOS } from './comandos.js';

const efimero = (content) => ({ content, flags: EFIMERO, allowedMentions: { parse: [] } });
export const SIN_PERMISOS = 'No tengo permisos suficientes. Vuelve a invitar el bot con el enlace de la guía (pide "Gestionar canales" y "Gestionar roles") y prueba otra vez con /configurar.';

/** ¿Es del equipo? (rol "Equipo ClipViral" o puede gestionar el servidor). */
export function esEquipo(i, servidor) {
  if (i.memberPermissions?.has?.('ManageGuild')) return true;
  const roles = i.member?.roles;
  if (!servidor?.rolEquipo || !roles) return false;
  return Array.isArray(roles) ? roles.includes(servidor.rolEquipo) : !!roles.cache?.has(servidor.rolEquipo);
}

/**
 * El bot trabaja en UN solo servidor de Discord: el tuyo (DISCORD_SERVIDOR_ID, o el primero donde lo metiste).
 * Si otra persona lo agrega a su servidor, ahí no hace nada: así nadie puede ver las cuentas de tus clientes.
 */
export function servidorPermitido(guildId, ctx, { adoptar = false } = {}) {
  const fijo = ctx.cfg?.servidorId;
  if (fijo) return guildId === fijo;
  const principal = ctx.almacen.principal();
  if (principal) return guildId === principal;
  if (adoptar) ctx.almacen.guardarPrincipal(guildId);
  return adoptar;
}

/** Al entrar a un servidor (o al encender): pone los comandos / y, si es la primera vez, arma los canales. */
export async function prepararServidor(guild, ctx) {
  if (!servidorPermitido(guild.id, ctx, { adoptar: true })) {
    ctx.log(`Estoy en el servidor "${guild.name}", pero este bot es solo para tu servidor de ClipViral: ahí no hago nada.`);
    return;
  }
  try {
    await guild.commands.set(COMANDOS);
  } catch (err) {
    ctx.log(`No pude poner los comandos / en "${guild.name}": ${err.message}`);
  }
  if (ctx.almacen.servidor(guild.id)?.montado) return;
  try {
    await montar(guild, { almacen: ctx.almacen, botId: ctx.botId, log: ctx.log });
  } catch (err) {
    ctx.log(err.code === 50013 ? `En "${guild.name}": ${SIN_PERMISOS}` : `No pude armar los canales en "${guild.name}": ${err.message}`);
  }
}

export async function manejarInteraccion(i, ctx) {
  if (!i.inGuild?.() || !i.guild) {
    if (i.isRepliable?.()) await i.reply(efimero('Este bot funciona dentro del servidor de Discord de ClipViral.')).catch(() => {});
    return;
  }
  if (!servidorPermitido(i.guildId, ctx)) {
    if (i.isRepliable?.()) await i.reply(efimero('Este bot es solo para el servidor de Discord de ClipViral.')).catch(() => {});
    return;
  }
  try {
    if (i.isChatInputCommand?.()) return await comando(i, ctx);
    if (i.isButton?.()) return await boton(i, ctx);
    if (i.isModalSubmit?.()) return await formulario(i, ctx);
  } catch (err) {
    ctx.log(`Error con "${i.customId || `/${i.commandName}`}": ${err.stack || err.message}`);
    const msg = efimero(err.code === 50013 ? SIN_PERMISOS : '😕 Algo salió mal. Inténtalo otra vez en un momento; si sigue pasando, avísale al equipo.');
    try {
      if (i.deferred || i.replied) await i.followUp(msg);
      else await i.reply(msg);
    } catch {}
  }
}

async function pedirTicket(i, ctx, tipo) {
  if (!esTipo(tipo)) return i.reply(efimero('Ese tipo de ticket no existe.'));
  const servidor = ctx.almacen.servidor(i.guildId);
  if (!servidor?.categoriaTickets) return i.reply(efimero('El bot todavía no está listo en este servidor. Un administrador debe usar /configurar.'));
  // Se revisa antes de mostrar el formulario, para que no escriba todo para nada.
  const abiertos = ctx.almacen.abiertosDe(i.guildId, i.user.id);
  if (abiertos.length >= MAX_ABIERTOS) {
    return i.reply(efimero(`Ya tienes ${abiertos.length} tickets abiertos (${abiertos.map((t) => `<#${t.canalId}>`).join(', ')}). Escribe en uno de ellos o ciérralo antes de abrir otro.`));
  }
  return i.showModal(modalTicket(tipo, ctx.almacen.correoDe(i.user.id)));
}

const nombre = (u) => u.globalName || u.username;
const textoCerrando = (u, motivo) => `🔒 **${nombre(u)}** cerró el ticket${motivo ? ` · Motivo: ${motivo}` : ''}. Guardo la conversación y este canal se borra en unos segundos.`;

async function pedirCierre(i, ctx, { directo, motivo = '' }) {
  const ticket = ctx.almacen.ticket(i.channelId);
  if (!ticket) return i.reply(efimero('Esto solo funciona dentro del canal de un ticket.'));
  if (ticket.estado !== 'abierto') return i.reply(efimero('Este ticket ya se está cerrando.'));
  if (!puedeCerrar(ticket, i.user.id, esEquipo(i, ctx.almacen.servidor(i.guildId)))) {
    return i.reply(efimero('Solo quien abrió el ticket o el equipo pueden cerrarlo.'));
  }
  if (!directo) return i.reply(confirmarCierre());
  await i.reply({ content: textoCerrando(i.user, motivo), allowedMentions: { parse: [] } });
  return cerrar(i, ctx, motivo);
}

async function cerrar(i, ctx, motivo) {
  const canal = i.channel ?? (await i.client.channels.fetch(i.channelId));
  const r = await cerrarTicket({
    canal,
    guild: i.guild,
    quien: i.user,
    motivo,
    almacen: ctx.almacen,
    zona: ctx.cfg.zona,
    carpetaTranscripciones: ctx.cfg.transcripciones,
    log: ctx.log,
    borrarEn: ctx.borrarEn ?? 5000,
    avisarCliente: async (userId, mensaje) => {
      const u = await i.client.users.fetch(userId);
      await u.send(mensaje);
    },
  });
  if (r.error) await i.followUp(efimero(`⚠️ ${r.error}`)).catch(() => {});
  return r;
}

async function comando(i, ctx) {
  const servidor = ctx.almacen.servidor(i.guildId);
  switch (i.commandName) {
    case 'ticket':
      return pedirTicket(i, ctx, i.options.getString('tipo'));
    case 'cerrar':
      return pedirCierre(i, ctx, { directo: true, motivo: i.options.getString('motivo') || '' });
    case 'configurar': {
      if (!i.memberPermissions?.has?.('ManageGuild')) return i.reply(efimero('Solo un administrador del servidor puede usar /configurar.'));
      await i.deferReply({ flags: EFIMERO });
      try {
        const { hecho } = await montar(i.guild, { almacen: ctx.almacen, botId: ctx.botId, log: ctx.log });
        return i.editReply(hecho.length ? `✅ Listo:\n• ${hecho.join('\n• ')}` : '✅ Todo estaba en su sitio. Actualicé los botones de los tickets.');
      } catch (err) {
        if (err.code === 50013) return i.editReply(SIN_PERMISOS);
        throw err;
      }
    }
    case 'anunciar':
      if (!esEquipo(i, servidor)) return i.reply(efimero('Solo el equipo puede publicar anuncios.'));
      if (!servidor?.anuncios) return i.reply(efimero('Falta el canal de anuncios: usa /configurar primero.'));
      return i.showModal(modalAnuncio());
    case 'anunciar-version': {
      if (!esEquipo(i, servidor)) return i.reply(efimero('Solo el equipo puede anunciar versiones.'));
      await i.deferReply({ flags: EFIMERO });
      let r;
      try {
        r = await ctx.noticias.anunciarUltima();
      } catch (err) {
        return i.editReply(`No pude preguntarle al servidor de ClipViral (${ctx.cfg.clipviralUrl}): ${err.message}.`);
      }
      if (r.sinVersiones) return i.editReply('Todavía no hay ninguna versión publicada en el panel de ClipViral (Actualizaciones).');
      return i.editReply(r.enviados ? `✅ Anuncié la versión ${r.version}.` : 'No encontré el canal de anuncios: usa /configurar.');
    }
    default:
      return i.reply(efimero('Ese comando ya no existe.'));
  }
}

async function boton(i, ctx) {
  const id = i.customId;
  if (id.startsWith('ticket:abrir:')) return pedirTicket(i, ctx, id.slice('ticket:abrir:'.length));
  if (id === 'ticket:cerrar') return pedirCierre(i, ctx, { directo: false });
  if (id === 'ticket:cerrar:no') return i.update({ content: 'Listo, el ticket sigue abierto.', components: [] });
  if (id === 'ticket:cerrar:si') {
    const ticket = ctx.almacen.ticket(i.channelId);
    if (!puedeCerrar(ticket, i.user.id, esEquipo(i, ctx.almacen.servidor(i.guildId)))) {
      return i.update({ content: 'Este ticket ya se cerró o no puedes cerrarlo.', components: [] });
    }
    await i.update({ content: '🔒 Cerrando el ticket…', components: [] });
    const canal = i.channel ?? (await i.client.channels.fetch(i.channelId));
    await canal.send({ content: textoCerrando(i.user, ''), allowedMentions: { parse: [] } });
    return cerrar(i, ctx, '');
  }
  return i.reply(efimero('Ese botón ya no funciona. Usa los botones del canal de abrir tickets.'));
}

async function formulario(i, ctx) {
  const id = i.customId;
  if (id.startsWith('ticket:form:')) {
    const tipo = id.slice('ticket:form:'.length);
    if (!esTipo(tipo)) return i.reply(efimero('Ese tipo de ticket no existe.'));
    await i.deferReply({ flags: EFIMERO });
    const form = leerFormulario(tipo, (campo) => i.fields.getTextInputValue(campo));
    const r = await abrirTicket({
      guild: i.guild, usuario: i.user, tipo, formulario: form, almacen: ctx.almacen, botId: ctx.botId,
      clipviral: ctx.clipviral, zona: ctx.cfg.zona, log: ctx.log,
    });
    return i.editReply(r.error ? `⚠️ ${r.error}` : `✅ Listo, tu ticket está aquí: <#${r.canal.id}>`);
  }
  if (id === 'anuncio:form') {
    const servidor = ctx.almacen.servidor(i.guildId);
    if (!esEquipo(i, servidor)) return i.reply(efimero('Solo el equipo puede publicar anuncios.'));
    await i.deferReply({ flags: EFIMERO });
    const campo = (c) => {
      try { return String(i.fields.getTextInputValue(c) || '').trim(); } catch { return ''; }
    };
    const ok = await ctx.publicarEn(i.guildId, anuncioManual({ titulo: campo('titulo'), mensaje: campo('mensaje'), autor: 'Equipo de ClipViral' }));
    return i.editReply(ok ? `✅ Publicado en <#${servidor.anuncios}>.` : 'No pude publicar: revisa que exista el canal de anuncios (usa /configurar).');
  }
  return i.reply(efimero('Ese formulario ya no funciona.'));
}
