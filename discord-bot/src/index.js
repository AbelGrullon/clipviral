// Bot de Discord de ClipViral. Se enciende con "Encender bot de Discord.bat" (en tu PC) o solo, con la tarea
// "ClipViral bot de Discord" (en el VPS). Los pasos para crearlo en Discord están en GUIA-DISCORD.md.
import fs from 'node:fs';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { leerConfig, enlaceInvitacion } from './config.js';
import { Almacen } from './almacen.js';
import { tomarCandado } from './candado.js';
import { crearClipViral } from './clipviral.js';
import { crearNoticias } from './noticias.js';
import { manejarInteraccion, prepararServidor, servidorPermitido } from './bot.js';

const cfg = leerConfig();
const log = (s) => console.log(`[${new Date().toLocaleString('es-DO', { hour12: false })}] ${s}`);

if (!cfg.token) {
  log('Falta el token del bot. Abre "Encender bot de Discord.bat" (o, en el VPS, "Instalar bot de Discord en el VPS.bat") y pégalo cuando te lo pida.');
  process.exit(2);
}

// Un solo bot encendido por carpeta (si hubiera dos, cada botón se atendería dos veces).
fs.mkdirSync(cfg.datos, { recursive: true });
if (!(await tomarCandado(cfg.datos))) {
  log('Ya hay un bot de Discord de ClipViral encendido en esta computadora. No enciendo otro.');
  process.exit(4);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(s, () => process.exit(0));

const almacen = new Almacen(cfg.datos);
const clipviral = crearClipViral({ url: cfg.clipviralUrl, clave: cfg.claveBot });
// MessageContent: para poder guardar la conversación de cada ticket al cerrarlo.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });

async function enviarA(canalId, mensaje) {
  if (!canalId) return false;
  try {
    const canal = await client.channels.fetch(canalId);
    if (!canal?.isTextBased?.()) return false;
    await canal.send(mensaje);
    return true;
  } catch (err) {
    log(`No pude publicar en el canal de anuncios: ${err.message}`);
    return false;
  }
}

/** Manda el mensaje al canal de anuncios de tu servidor de Discord. Devuelve a cuántos canales llegó (0 o 1). */
async function publicar(mensaje) {
  let n = 0;
  for (const s of almacen.servidores()) {
    if (client.guilds.cache.has(s.guildId) && servidorPermitido(s.guildId, ctx) && (await enviarA(s.anuncios, mensaje))) n++;
  }
  return n;
}

/** ¿Esa versión ya está anunciada en el canal? (por si el bot se pasó de carpeta, por ejemplo de tu PC al VPS) */
async function yaAnunciada(version) {
  for (const s of almacen.servidores()) {
    if (!servidorPermitido(s.guildId, ctx) || !s.anuncios) continue;
    try {
      const canal = await client.channels.fetch(s.anuncios);
      const recientes = await canal.messages.fetch({ limit: 30 });
      if (recientes.some((m) => m.author?.id === client.user.id && m.embeds?.some((e) => e.title === `🚀 ClipViral ${version} ya está disponible`))) return true;
    } catch {}
  }
  return false;
}

const noticias = crearNoticias({ almacen, clipviral, publicar, yaAnunciada, web: cfg.web, log });
const ctx = {
  almacen, clipviral, noticias, cfg, log, botId: null,
  publicarEn: (guildId, mensaje) => enviarA(almacen.servidor(guildId)?.anuncios, mensaje),
};

client.once(Events.ClientReady, async (c) => {
  ctx.botId = c.user.id;
  log(`Bot encendido como ${c.user.tag}. LISTO.`);
  if (!c.guilds.cache.size) {
    log('Todavía no está en ningún servidor de Discord. Invítalo con este enlace:');
    log(enlaceInvitacion(c.user.id));
  }
  for (const guild of c.guilds.cache.values()) await prepararServidor(guild, ctx);

  const estado = await clipviral.estado();
  if (estado.ok) log(`Conectado con las cuentas de ClipViral (${cfg.clipviralUrl}).`);
  else if (estado.motivo === 'sin-clave') log('Sin conexión con las cuentas de ClipViral: el equipo no verá el plan de cada cliente (eso se activa al instalar el bot en el VPS).');
  else log(`No pude conectar con las cuentas de ClipViral (${cfg.clipviralUrl}): ${{ clave: 'la clave del bot no coincide', viejo: 'el servidor es una versión vieja, actualízalo', apagado: 'no contesta' }[estado.motivo] || estado.motivo}.`);
  noticias.iniciar();
});

client.on(Events.GuildCreate, (guild) => {
  log(`Me agregaron al servidor "${guild.name}".`);
  prepararServidor(guild, ctx);
});

// Si alguien borra a mano el canal de un ticket, se marca como cerrado (sin conversación guardada).
client.on(Events.ChannelDelete, (canal) => {
  const t = almacen.ticket(canal.id);
  if (t && t.estado === 'abierto') {
    almacen.cambiarTicket(canal.id, { estado: 'borrado', cerrado: new Date().toISOString() });
    log(`El canal del ticket #${String(t.numero).padStart(4, '0')} se borró a mano.`);
  }
});

client.on(Events.InteractionCreate, (i) => manejarInteraccion(i, ctx));

client.on(Events.ShardDisconnect, (ev) => {
  if (ev?.code === 4014) {
    log('Discord no deja entrar al bot: falta encender "MESSAGE CONTENT INTENT". Entra a discord.com/developers/applications → tu aplicación → Bot → Privileged Gateway Intents, enciéndelo, guarda, y vuelve a encender el bot.');
    process.exit(3);
  }
  if (ev?.code === 4004) {
    log('Discord dice que el token del bot no es válido. Copia uno nuevo (Bot → Reset Token) y vuelve a configurar el bot.');
    process.exit(3);
  }
});
client.on(Events.Error, (err) => log(`Error de Discord: ${err.message}`));
process.on('unhandledRejection', (err) => log(`Error inesperado: ${err?.stack || err}`));

client.login(cfg.token).catch((err) => {
  if (err.code === 'TokenInvalid') log('Discord dice que el token del bot no es válido. Copia uno nuevo (Bot → Reset Token) y vuelve a configurar el bot.');
  else if (err.code === 'DisallowedIntents' || /disallowed intents/i.test(err.message)) log('Falta encender "MESSAGE CONTENT INTENT" en discord.com/developers/applications → tu aplicación → Bot.');
  else log(`No pude conectar con Discord: ${err.message}`);
  process.exit(3);
});
