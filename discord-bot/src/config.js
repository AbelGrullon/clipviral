// Ajustes del bot: salen de discord-bot/.env (lo crea "Encender bot de Discord.bat" o el instalador del VPS).
import path from 'node:path';
import { PermissionsBitField } from 'discord.js';
import { PERMISOS_INVITACION } from './comandos.js';

export const RAIZ = path.resolve(import.meta.dirname, '..');
export const DOMINIO = 'https://cviral.duckdns.org';

const limpiarUrl = (u) => String(u || '').trim().replace(/\/+$/, '');

export function leerConfig(env = process.env) {
  const clipviralUrl = limpiarUrl(env.CLIPVIRAL_URL) || DOMINIO;
  const datos = env.BOT_DATOS ? path.resolve(env.BOT_DATOS) : path.join(RAIZ, 'data');
  return {
    token: String(env.DISCORD_TOKEN || '').trim(),
    clipviralUrl,
    // La dirección pública (la de la web) para el enlace "Descárgala en…". Si el bot habla con el servidor por
    // dentro del VPS (127.0.0.1), hay que decirla aparte.
    web: limpiarUrl(env.CLIPVIRAL_WEB) || (/^https:\/\//i.test(clipviralUrl) ? clipviralUrl : ''),
    claveBot: String(env.CLIPVIRAL_BOT_CLAVE || '').trim(),
    // Opcional: el id de tu servidor de Discord. Si no se pone, el bot se queda con el primero donde lo metas.
    servidorId: String(env.DISCORD_SERVIDOR_ID || '').trim(),
    zona: String(env.ZONA_HORARIA || '').trim() || 'America/Santo_Domingo',
    datos,
    transcripciones: path.join(datos, 'transcripciones'),
  };
}

export const permisosInvitacion = () => new PermissionsBitField(PERMISOS_INVITACION).bitfield;

/** Enlace para meter el bot en tu servidor de Discord. */
export function enlaceInvitacion(appId) {
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${permisosInvitacion()}`;
}
