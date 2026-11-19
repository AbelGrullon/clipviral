// Arma solo lo que el bot necesita en el servidor de Discord (y lo repara si alguien lo borró):
//   rol "Equipo ClipViral" · categoría "📌 ClipViral" con #anuncios y #abrir-ticket (los clientes leen, no escriben)
//   categoría "🎫 Tickets" (privada: solo el equipo) con #registro-tickets, donde caen los tickets nuevos y cerrados.
// Lo que ya existe no se toca (por si le cambiaste permisos o nombres); solo se crea lo que falta.
import { COLORES, PERMISOS, panelTickets } from './tickets.js';

export const NOMBRES = {
  rol: 'Equipo ClipViral',
  categoriaInfo: '📌 ClipViral',
  anuncios: '📢・anuncios',
  abrir: '📩・abrir-ticket',
  categoriaTickets: '🎫 Tickets',
  registro: '📋・registro-tickets',
};
const TEXTO = 0;
const CATEGORIA = 4;
const ROL = 0;
const MIEMBRO = 1;

/** Canales donde los clientes leen pero no escriben (el equipo sí). */
export function soloLeer({ todosId, equipoId, botId }) {
  return [
    { id: todosId, type: ROL, allow: ['ViewChannel', 'ReadMessageHistory'], deny: ['SendMessages'] },
    { id: equipoId, type: ROL, allow: ['SendMessages'] },
    { id: botId, type: MIEMBRO, allow: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'] },
  ];
}

/** Solo el equipo (y el bot). */
export function privado({ todosId, equipoId, botId }) {
  return [
    { id: todosId, type: ROL, deny: ['ViewChannel'] },
    { id: equipoId, type: ROL, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'] },
    { id: botId, type: MIEMBRO, allow: PERMISOS.bot },
  ];
}

export async function montar(guild, { almacen, botId, log = () => {} }) {
  const antes = almacen.servidor(guild.id) || {};
  const hecho = [];
  const motivo = 'Bot de ClipViral: tickets y anuncios';
  await guild.channels.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});
  const todosId = guild.roles.everyone?.id ?? guild.id;

  let rol = (antes.rolEquipo && guild.roles.cache.get(antes.rolEquipo)) || guild.roles.cache.find((r) => r.name === NOMBRES.rol);
  if (!rol) {
    rol = await guild.roles.create({ name: NOMBRES.rol, colors: { primaryColor: COLORES.azul }, mentionable: false, reason: motivo });
    hecho.push(`Creé el rol **${NOMBRES.rol}** (dáselo a quien te ayude con los tickets).`);
  }
  const ids = { todosId, equipoId: rol.id, botId };

  const canal = async (clave, tipo, crear) => {
    const viejo = (antes[clave] && guild.channels.cache.get(antes[clave])) || guild.channels.cache.find((c) => c.type === tipo && c.name === NOMBRES[clave]);
    if (viejo) return viejo;
    const nuevo = await guild.channels.create({ name: NOMBRES[clave], type: tipo, reason: motivo, ...crear });
    hecho.push(`Creé ${tipo === CATEGORIA ? 'la categoría' : 'el canal'} **${NOMBRES[clave]}**.`);
    return nuevo;
  };

  const info = await canal('categoriaInfo', CATEGORIA, {});
  const anuncios = await canal('anuncios', TEXTO, { parent: info.id, topic: 'Novedades y versiones nuevas de ClipViral.', permissionOverwrites: soloLeer(ids) });
  const abrir = await canal('abrir', TEXTO, { parent: info.id, topic: 'Toca un botón para abrir un ticket privado con el equipo de ClipViral.', permissionOverwrites: soloLeer(ids) });
  const tickets = await canal('categoriaTickets', CATEGORIA, { permissionOverwrites: privado(ids) });
  const registro = await canal('registro', TEXTO, { parent: tickets.id, topic: 'Solo el equipo: tickets nuevos con los datos de la cuenta del cliente y la conversación de cada ticket cerrado.', permissionOverwrites: privado(ids) });

  // El panel con los botones: si ya está, se actualiza; si lo borraron, se pone otro. Si el bot no lo tiene anotado
  // (por ejemplo, al pasarlo de tu PC al VPS), busca el que puso antes en el canal para no dejar dos.
  let panel = antes.panelMensaje && abrir.id === antes.abrir ? await abrir.messages.fetch(antes.panelMensaje).catch(() => null) : null;
  if (!panel) {
    const recientes = await abrir.messages.fetch({ limit: 50 }).catch(() => null);
    panel = [...(recientes?.values() ?? [])].find((m) => m.author?.id === botId && JSON.stringify(m.components ?? []).includes('ticket:abrir:')) || null;
  }
  if (panel) {
    await panel.edit(panelTickets());
  } else {
    panel = await abrir.send(panelTickets());
    hecho.push(`Puse los botones para abrir tickets en **${NOMBRES.abrir}**.`);
  }

  const cfg = almacen.guardarServidor(guild.id, {
    nombre: guild.name,
    rolEquipo: rol.id,
    categoriaInfo: info.id,
    anuncios: anuncios.id,
    abrir: abrir.id,
    categoriaTickets: tickets.id,
    registro: registro.id,
    panelMensaje: panel.id,
    montado: new Date().toISOString(),
  });
  log(`Servidor "${guild.name}" listo${hecho.length ? `: ${hecho.length} cosa(s) nueva(s)` : ' (ya estaba todo)'}.`);
  return { hecho, cfg };
}
