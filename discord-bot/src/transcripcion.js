// La conversación de un ticket en texto simple, para que el equipo la guarde al cerrarlo.

/** Fecha y hora legibles en la zona horaria del equipo (si la zona no existe, la del sistema). */
export function fecha(valor, zona) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '—';
  const opciones = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
  try {
    return d.toLocaleString('es-DO', { ...opciones, timeZone: zona || undefined });
  } catch {
    return d.toLocaleString('es-DO', opciones);
  }
}

/** Un mensaje de Discord → datos simples (quién, cuándo, qué dijo, qué adjuntó). */
export function mensajeAPlano(m) {
  const adjuntos = m.attachments ? [...(m.attachments.values?.() ?? m.attachments)].map((a) => a.url) : [];
  const embeds = (m.embeds || []).map((e) => [
    e.title,
    e.description,
    ...(e.fields || []).map((f) => `${f.name}: ${f.value}`),
  ].filter(Boolean).join('\n'));
  return {
    autor: m.member?.displayName || m.author?.globalName || m.author?.username || 'Desconocido',
    usuario: m.author?.username || '',
    bot: !!m.author?.bot,
    fecha: m.createdTimestamp ?? m.createdAt ?? Date.now(),
    texto: m.content || '',
    adjuntos,
    embeds,
  };
}

const sangria = (texto) => String(texto).split('\n').map((l) => `    ${l}`).join('\n');

/**
 * Transcripción completa.
 * ticket: { numero, tipoNombre, userTag, userId, correo, abierto }; mensajes: de mensajeAPlano, del más viejo al más nuevo.
 */
export function transcripcion({ ticket, mensajes, cerradoPor, motivo, cerrado = Date.now(), zona }) {
  const linea = '─'.repeat(60);
  const cabeza = [
    `ClipViral · Ticket #${String(ticket.numero).padStart(4, '0')} · ${ticket.tipoNombre}`,
    `Cliente: ${ticket.userTag} (id ${ticket.userId})`,
    `Correo de ClipViral: ${ticket.correo || 'no lo puso'}`,
    `Abierto: ${fecha(ticket.abierto, zona)}`,
    `Cerrado: ${fecha(cerrado, zona)}${cerradoPor ? ` por ${cerradoPor}` : ''}`,
    `Motivo del cierre: ${motivo || '—'}`,
    `Mensajes: ${mensajes.length}`,
    linea,
  ];
  const cuerpo = mensajes.map((m) => {
    const partes = [`[${fecha(m.fecha, zona)}] ${m.autor}${m.usuario && m.usuario !== m.autor ? ` (@${m.usuario})` : ''}${m.bot ? ' [bot]' : ''}:`];
    if (m.texto) partes.push(sangria(m.texto));
    for (const e of m.embeds) if (e) partes.push(sangria(e));
    for (const a of m.adjuntos) partes.push(`    📎 ${a}`);
    if (partes.length === 1) partes.push('    (sin texto)');
    return partes.join('\n');
  });
  return `${[...cabeza, '', ...cuerpo.flatMap((c) => [c, ''])].join('\n').trimEnd()}\n`;
}
