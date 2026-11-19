// Tickets privados: el cliente elige el tipo, llena un formulario corto y el bot le crea un canal que solo ven
// él y el equipo. Al cerrarlo, la conversación completa queda en el canal de registro del equipo (y en disco).
import fs from 'node:fs';
import path from 'node:path';
import { fecha, mensajeAPlano, transcripcion } from './transcripcion.js';

export const EFIMERO = 64; // el mensaje solo lo ve quien tocó el botón
export const MAX_ABIERTOS = 3;
export const COLORES = { azul: 0x3a6cff, rojo: 0xe5161d, ambar: 0xf2a900, verde: 0x2ecc71, gris: 0x5b6475 };

// Emojis sin el "selector de variación" (️): Discord los rechaza en algunos botones.
export const TIPOS = {
  soporte: {
    nombre: 'Soporte / ayuda', emoji: '💬', color: COLORES.azul, estiloBoton: 1,
    explica: 'dudas, cómo usar la app, tu cuenta o tu plan',
    preguntas: [
      { id: 'mensaje', label: '¿En qué te ayudamos?', required: true, max: 1500, placeholder: 'Cuéntanos con detalle qué necesitas.' },
    ],
  },
  reclamacion: {
    nombre: 'Reclamación', emoji: '📣', color: COLORES.rojo, estiloBoton: 2,
    explica: 'algo no salió como esperabas',
    preguntas: [
      { id: 'mensaje', label: '¿Qué pasó?', required: true, max: 1500, placeholder: 'Cuéntanos qué pasó y cuándo.' },
      { id: 'solucion', label: '¿Qué solución esperas?', required: false, max: 500 },
    ],
  },
  error: {
    nombre: 'Reporte de error', emoji: '🐞', color: COLORES.ambar, estiloBoton: 2,
    explica: 'la app falla o hace algo raro',
    preguntas: [
      { id: 'mensaje', label: '¿Qué salió mal?', required: true, max: 1500, placeholder: 'Lo que viste: un mensaje de error, se cerró sola, no hizo clips…' },
      { id: 'pasos', label: '¿Qué estabas haciendo cuando pasó?', required: false, max: 1000 },
      { id: 'version', label: 'Versión de ClipViral (si la sabes)', corto: true, required: false, max: 20, placeholder: 'Ej.: 1.4.2' },
    ],
  },
};

const CAMPO_CORREO = {
  id: 'correo', label: 'Correo de tu cuenta de ClipViral', corto: true, required: false, max: 200,
  placeholder: 'El correo con el que entras a la app (si no tienes cuenta, déjalo vacío)',
};

export const esTipo = (tipo) => Object.hasOwn(TIPOS, String(tipo));
export const numeroTicket = (n) => String(n).padStart(4, '0');
export const correoValido = (c) => typeof c === 'string' && c.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c);
export const corta = (texto, max) => {
  const s = String(texto ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Nombre del canal: tipo-0007-usuario (Discord solo acepta minúsculas, números y guiones). */
export function slug(texto) {
  return String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
}
export function nombreCanal(tipo, numero, usuario) {
  return `${tipo}-${numeroTicket(numero)}-${slug(usuario) || 'cliente'}`;
}

// ---------- Formularios y botones (en el formato de la API de Discord) ----------
const fila = (...componentes) => ({ type: 1, components: componentes });
const campoTexto = (p, valor) => ({
  type: 4,
  custom_id: p.id,
  label: p.label,
  style: p.corto ? 1 : 2,
  required: !!p.required,
  max_length: p.max,
  ...(p.placeholder ? { placeholder: p.placeholder } : {}),
  ...(valor ? { value: corta(valor, p.max) } : {}),
});

/** El formulario que sale al tocar un botón (el correo viene lleno si ya lo dio antes). */
export function modalTicket(tipo, correoGuardado = '') {
  const t = TIPOS[tipo];
  return {
    custom_id: `ticket:form:${tipo}`,
    title: `${t.emoji} ${t.nombre}`,
    components: [CAMPO_CORREO, ...t.preguntas].map((p) => fila(campoTexto(p, p.id === 'correo' ? correoGuardado : ''))),
  };
}

/** Lee lo que escribió el cliente. `obtener(id)` devuelve el texto de un campo. */
export function leerFormulario(tipo, obtener) {
  const valor = (id) => {
    try { return String(obtener(id) ?? '').trim(); } catch { return ''; }
  };
  return {
    correo: valor('correo').toLowerCase(),
    respuestas: TIPOS[tipo].preguntas.map((p) => ({ id: p.id, label: p.label, valor: valor(p.id) })),
  };
}

export const botonCerrar = () => fila({ type: 2, style: 4, custom_id: 'ticket:cerrar', label: 'Cerrar ticket', emoji: { name: '🔒' } });

export function confirmarCierre() {
  return {
    content: '¿Seguro que quieres cerrar este ticket? La conversación se guarda para el equipo y este canal se borra.',
    flags: EFIMERO,
    components: [fila(
      { type: 2, style: 4, custom_id: 'ticket:cerrar:si', label: 'Sí, cerrar', emoji: { name: '🔒' } },
      { type: 2, style: 2, custom_id: 'ticket:cerrar:no', label: 'No, seguir' },
    )],
  };
}

/** El mensaje fijo del canal "abrir-ticket", con un botón por tipo. */
export function panelTickets() {
  return {
    embeds: [{
      color: COLORES.rojo,
      title: '🎫 ¿Necesitas ayuda con ClipViral?',
      description: [
        'Toca el botón de lo que necesitas. Se abre un **canal privado** que solo ven tú y el equipo de ClipViral.',
        '',
        ...Object.values(TIPOS).map((t) => `${t.emoji} **${t.nombre}**: ${t.explica}.`),
        '',
        'Te pediremos el correo de tu cuenta de ClipViral para ayudarte más rápido.',
      ].join('\n'),
    }],
    components: [fila(...Object.entries(TIPOS).map(([id, t]) => ({
      type: 2, style: t.estiloBoton, custom_id: `ticket:abrir:${id}`, label: t.nombre, emoji: { name: t.emoji },
    })))],
  };
}

// ---------- Permisos ----------
export const PERMISOS = {
  cliente: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'AddReactions'],
  equipo: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'AddReactions', 'ManageMessages'],
  bot: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'ManageChannels'],
};
const ROL = 0;
const MIEMBRO = 1;

/** Nadie ve el canal salvo el cliente, el equipo y el bot (los administradores del servidor ven todo). */
export function permisosTicket({ todosId, clienteId, equipoId, botId }) {
  return [
    { id: todosId, type: ROL, deny: ['ViewChannel'] },
    { id: clienteId, type: MIEMBRO, allow: PERMISOS.cliente },
    ...(equipoId ? [{ id: equipoId, type: ROL, allow: PERMISOS.equipo }] : []),
    { id: botId, type: MIEMBRO, allow: PERMISOS.bot },
  ];
}

// ---------- Mensajes ----------
const sinMenciones = { parse: [] };

export function mensajeBienvenida({ ticket, equipoId }) {
  const t = TIPOS[ticket.tipo];
  return {
    content: `<@${ticket.userId}>${equipoId ? ` · <@&${equipoId}>` : ''}`,
    allowedMentions: { users: [ticket.userId], roles: equipoId ? [equipoId] : [] },
    embeds: [{
      color: t.color,
      title: `${t.emoji} ${t.nombre} · Ticket #${numeroTicket(ticket.numero)}`,
      description: [
        '¡Hola! Gracias por escribirnos. Alguien del equipo de ClipViral te responde aquí mismo.',
        'Este canal solo lo ven tú y el equipo.',
        '',
        'Puedes mandar capturas o videos cuando quieras. Cuando todo esté resuelto, toca **🔒 Cerrar ticket**.',
      ].join('\n'),
      fields: [
        { name: 'Correo de ClipViral', value: corta(ticket.correo || 'No lo puso', 1024) },
        ...(ticket.respuestas || []).filter((r) => r.valor).map((r) => ({ name: r.label, value: corta(r.valor, 1024) })),
      ],
      timestamp: new Date(ticket.abierto).toISOString(),
    }],
    components: [botonCerrar()],
  };
}

const MOTIVOS = {
  'sin-clave': 'el bot todavía no está conectado con las cuentas (se conecta al instalarlo en el VPS)',
  clave: 'la clave del bot no coincide con la del servidor (vuelve a abrir "Instalar bot de Discord en el VPS.bat")',
  viejo: 'el servidor de ClipViral es una versión vieja (actualízalo en el VPS)',
  apagado: 'el servidor de ClipViral no contestó',
};

const dinero = (n) => `${Number(n || 0).toLocaleString('es-DO', { maximumFractionDigits: 2 })} USD`;

/** Lo que el equipo ve de la cuenta de ClipViral del cliente (solo en el canal de registro, nunca en el ticket). */
export function textoCuenta({ correo, cuenta, zona }) {
  if (!correo) return 'No escribió correo.';
  if (!correoValido(correo)) return `⚠️ «${corta(correo, 200)}» no parece un correo.`;
  if (!cuenta || cuenta.sinConexion) return `No pude revisar la cuenta: ${MOTIVOS[cuenta?.motivo] || MOTIVOS.apagado}.`;
  if (!cuenta.encontrada) return '❌ No hay ninguna cuenta de ClipViral con ese correo.';
  const p = cuenta.plan || {};
  const estado = cuenta.bloqueado ? '⛔ cuenta bloqueada' : p.activo ? '✅ activo' : p.vencido ? '⌛ vencido' : '⏸️ sin plan activo';
  return [
    `**${cuenta.nombre}**${cuenta.rol === 'admin' ? ' (administrador)' : ''}`,
    `Plan: **${p.nombre || '—'}** · ${estado}${p.vence ? ` · vence ${fecha(p.vence, zona)}` : ''}`,
    `Pagado en total: ${dinero(cuenta.pagado)} (${cuenta.pagos || 0} pago${cuenta.pagos === 1 ? '' : 's'})`,
    `Clips hechos: ${cuenta.clips || 0} · Cliente desde ${fecha(cuenta.creada, zona)}`,
    ...(cuenta.ultimaEntrada ? [`Última vez que entró: ${fecha(cuenta.ultimaEntrada, zona)}`] : []),
  ].join('\n');
}

export function avisoNuevo({ ticket, cuentaTexto }) {
  const t = TIPOS[ticket.tipo];
  return {
    allowedMentions: sinMenciones,
    embeds: [{
      color: t.color,
      title: `🆕 Ticket #${numeroTicket(ticket.numero)} · ${t.nombre}`,
      description: `De <@${ticket.userId}> (@${ticket.userTag}) → <#${ticket.canalId}>`,
      fields: [
        { name: 'Correo que escribió', value: corta(ticket.correo || '—', 1024) },
        { name: 'Su cuenta de ClipViral', value: corta(cuentaTexto, 1024) },
      ],
      timestamp: new Date(ticket.abierto).toISOString(),
    }],
  };
}

export function avisoCierre({ ticket, cerradoPor, motivo, mensajes, zona }) {
  const t = TIPOS[ticket.tipo];
  return {
    allowedMentions: sinMenciones,
    embeds: [{
      color: COLORES.gris,
      title: `🔒 Ticket #${numeroTicket(ticket.numero)} cerrado · ${t.nombre}`,
      fields: [
        { name: 'Cliente', value: `<@${ticket.userId}> (@${ticket.userTag})`, inline: true },
        { name: 'Correo', value: corta(ticket.correo || '—', 1024), inline: true },
        { name: 'Cerrado por', value: corta(cerradoPor, 1024), inline: true },
        { name: 'Abierto', value: fecha(ticket.abierto, zona), inline: true },
        { name: 'Mensajes', value: String(mensajes), inline: true },
        { name: 'Motivo', value: corta(motivo || '—', 1024) },
      ],
      footer: { text: 'La conversación completa va en el archivo de abajo.' },
      timestamp: new Date().toISOString(),
    }],
  };
}

// ---------- Abrir y cerrar ----------
export async function buscarCanal(guild, id) {
  if (!id) return null;
  return guild.channels.cache?.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

const nombreDe = (u) => u.globalName || u.username;

/**
 * Crea el canal privado del ticket, saluda al cliente, avisa al equipo (con los datos de su cuenta) y lo guarda.
 * Devuelve { canal, ticket } o { error } con un mensaje para el cliente.
 */
export async function abrirTicket({ guild, usuario, tipo, formulario, almacen, botId, clipviral, zona, log = () => {} }) {
  const cfg = almacen.servidor(guild.id);
  if (!cfg?.categoriaTickets) return { error: 'El bot todavía no está listo en este servidor. Un administrador debe usar /configurar.' };
  if (!esTipo(tipo)) return { error: 'Ese tipo de ticket no existe.' };
  const abiertos = almacen.abiertosDe(guild.id, usuario.id);
  if (abiertos.length >= MAX_ABIERTOS) {
    return { error: `Ya tienes ${abiertos.length} tickets abiertos (${abiertos.map((t) => `<#${t.canalId}>`).join(', ')}). Escribe en uno de ellos o ciérralo antes de abrir otro.` };
  }
  const t = TIPOS[tipo];
  const numero = almacen.siguienteNumero(guild.id);
  let canal;
  try {
    canal = await guild.channels.create({
      name: nombreCanal(tipo, numero, usuario.username),
      type: 0,
      parent: cfg.categoriaTickets,
      topic: `Ticket #${numeroTicket(numero)} · ${t.nombre} · cliente: @${usuario.username} (${usuario.id})`,
      permissionOverwrites: permisosTicket({ todosId: guild.roles?.everyone?.id ?? guild.id, clienteId: usuario.id, equipoId: cfg.rolEquipo, botId }),
      reason: `Ticket #${numeroTicket(numero)} de @${usuario.username}`,
    });
  } catch (err) {
    log(`No pude crear el canal del ticket #${numeroTicket(numero)}: ${err.message}`);
    if (err.code === 50013) return { error: 'No tengo permiso para crear el canal del ticket. Avísale al equipo (el bot necesita "Gestionar canales" y "Gestionar roles").' };
    if (err.code === 50035 || err.code === 30013) return { error: 'No pude crear el canal (Discord tiene un límite de canales). Avísale al equipo.' };
    throw err;
  }
  const ticket = almacen.nuevoTicket({
    canalId: canal.id, guildId: guild.id, numero, tipo, tipoNombre: t.nombre,
    userId: usuario.id, userTag: usuario.username, userNombre: nombreDe(usuario),
    correo: formulario.correo, respuestas: formulario.respuestas, abierto: new Date().toISOString(),
  });
  if (correoValido(formulario.correo)) almacen.vincular(usuario.id, formulario.correo);
  await canal.send(mensajeBienvenida({ ticket, equipoId: cfg.rolEquipo }));

  try {
    const cuenta = correoValido(ticket.correo) && clipviral ? await clipviral.buscarCliente(ticket.correo) : null;
    const registro = await buscarCanal(guild, cfg.registro);
    if (registro) await registro.send(avisoNuevo({ ticket, cuentaTexto: textoCuenta({ correo: ticket.correo, cuenta, zona }) }));
  } catch (err) {
    log(`No pude avisar al equipo del ticket #${numeroTicket(numero)}: ${err.message}`);
  }
  log(`Ticket #${numeroTicket(numero)} (${t.nombre}) abierto por @${usuario.username}.`);
  return { canal, ticket };
}

export function puedeCerrar(ticket, userId, esEquipo) {
  return !!ticket && ticket.estado === 'abierto' && (ticket.userId === userId || !!esEquipo);
}

/** Todos los mensajes del canal, del más viejo al más nuevo. */
export async function leerMensajes(canal, max = 5000) {
  const todos = [];
  let antes;
  while (todos.length < max) {
    const lote = await canal.messages.fetch({ limit: 100, ...(antes ? { before: antes } : {}) });
    const lista = [...lote.values()];
    if (!lista.length) break;
    todos.push(...lista);
    antes = lista.reduce((min, m) => ((m.createdTimestamp ?? 0) < (min.createdTimestamp ?? 0) ? m : min)).id;
    if (lista.length < 100) break;
  }
  return todos.sort((a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0));
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Cierra el ticket: guarda la conversación (canal de registro del equipo + copia en disco), le manda una copia al
 * cliente por mensaje privado (si los tiene abiertos) y borra el canal.
 */
export async function cerrarTicket({ canal, guild, quien, motivo = '', almacen, zona, carpetaTranscripciones, avisarCliente, log = () => {}, borrarEn = 5000 }) {
  const ticket = almacen.ticket(canal.id);
  if (!ticket || ticket.estado !== 'abierto') return { error: 'Este canal no es un ticket abierto.' };
  almacen.cambiarTicket(canal.id, { estado: 'cerrando' });
  const n = numeroTicket(ticket.numero);
  const cerradoPor = quien.username ? `${nombreDe(quien)} (@${quien.username})` : String(quien);
  let mensajes;
  let texto;
  const cerrado = new Date().toISOString();
  try {
    mensajes = (await leerMensajes(canal)).map(mensajeAPlano);
    texto = transcripcion({ ticket, mensajes, cerradoPor, motivo, cerrado, zona });
  } catch (err) {
    almacen.cambiarTicket(canal.id, { estado: 'abierto' });
    throw err;
  }
  const nombre = `ticket-${n}-${ticket.tipo}.txt`;
  const archivo = () => ({ attachment: Buffer.from(texto, 'utf8'), name: nombre });

  let guardado = null;
  if (carpetaTranscripciones) {
    try {
      fs.mkdirSync(carpetaTranscripciones, { recursive: true });
      guardado = path.join(carpetaTranscripciones, `${guild.id}-${nombre}`);
      fs.writeFileSync(guardado, texto);
    } catch (err) {
      guardado = null;
      log(`No pude guardar en disco la conversación del ticket #${n}: ${err.message}`);
    }
  }
  const cfg = almacen.servidor(guild.id) || {};
  const registro = await buscarCanal(guild, cfg.registro);
  let enRegistro = false;
  if (registro) {
    try {
      await registro.send({ ...avisoCierre({ ticket, cerradoPor, motivo, mensajes: mensajes.length, zona }), files: [archivo()] });
      enRegistro = true;
    } catch (err) {
      log(`No pude mandar la conversación del ticket #${n} al registro: ${err.message}`);
    }
  }
  if (!enRegistro && !guardado) {
    // Sin registro ni copia en disco se perdería la conversación: el canal no se borra.
    almacen.cambiarTicket(canal.id, { estado: 'abierto' });
    return { error: 'No pude guardar la conversación, así que no borré el canal. Revisa que exista el canal de registro (usa /configurar).' };
  }
  if (avisarCliente) {
    try {
      await avisarCliente(ticket.userId, {
        content: `🔒 Tu ticket #${n} (${TIPOS[ticket.tipo].nombre}) con ClipViral se cerró. Aquí tienes una copia de la conversación. Si necesitas algo más, abre otro cuando quieras.`,
        files: [archivo()],
      });
    } catch {} // tiene los mensajes privados cerrados: no pasa nada
  }
  almacen.cambiarTicket(canal.id, { estado: 'cerrado', cerrado, cerradoPor, motivo, mensajes: mensajes.length, transcripcion: guardado });
  log(`Ticket #${n} cerrado por ${cerradoPor}.`);
  await espera(borrarEn);
  try {
    await canal.delete(`Ticket #${n} cerrado`);
  } catch (err) {
    log(`No pude borrar el canal del ticket #${n}: ${err.message}`);
  }
  return { ok: true, ticket, mensajes: mensajes.length, guardado };
}
