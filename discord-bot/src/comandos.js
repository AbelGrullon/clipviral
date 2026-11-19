// Los comandos con barra (/) del bot, en el formato de la API de Discord.
import { TIPOS } from './tickets.js';

const SOLO_ADMIN = '32'; // "Gestionar servidor": el dueño y los administradores (se puede ampliar en Ajustes → Integraciones)
const TEXTO = 3;

export const COMANDOS = [
  {
    name: 'ticket',
    description: 'Abre un ticket privado con el equipo de ClipViral',
    options: [{
      type: TEXTO, name: 'tipo', description: '¿Qué necesitas?', required: true,
      choices: Object.entries(TIPOS).map(([value, t]) => ({ name: t.nombre, value })),
    }],
  },
  {
    name: 'cerrar',
    description: 'Cierra este ticket (la conversación se guarda para el equipo)',
    options: [{ type: TEXTO, name: 'motivo', description: 'Por qué se cierra (opcional)', required: false, max_length: 300 }],
  },
  {
    name: 'anunciar',
    description: 'Publica un anuncio en el canal de anuncios',
    default_member_permissions: SOLO_ADMIN,
  },
  {
    name: 'anunciar-version',
    description: 'Vuelve a anunciar la última versión publicada en el panel de ClipViral',
    default_member_permissions: SOLO_ADMIN,
  },
  {
    name: 'configurar',
    description: 'Crea (o repara) los canales del bot: anuncios, abrir-ticket y registro de tickets',
    default_member_permissions: SOLO_ADMIN,
  },
];

/** Permisos que pide el enlace para invitar al bot (los nombres son los de discord.js). */
export const PERMISOS_INVITACION = [
  'ViewChannel', 'ManageChannels', 'ManageRoles', 'SendMessages', 'EmbedLinks', 'AttachFiles',
  'ReadMessageHistory', 'MentionEveryone', 'ManageMessages', 'AddReactions',
];
