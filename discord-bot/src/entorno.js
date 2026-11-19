// Piezas del instalador del bot (scripts/configurar.js) que se prueban sin tocar Windows ni Discord.
import path from 'node:path';

export const TAREA = 'ClipViral bot de Discord';

export const PLANTILLA_ENV = `# Bot de Discord de ClipViral. Lo llena "Encender bot de Discord.bat" (o el instalador del VPS).
# NUNCA compartas este archivo: con el token cualquiera podría manejar tu bot.
DISCORD_TOKEN=
# Dónde está el servidor de ClipViral (para las noticias de versiones y las cuentas de los clientes)
CLIPVIRAL_URL=
# Dirección pública de la web (para el enlace "Descárgala en…" de los anuncios)
CLIPVIRAL_WEB=
# Clave para ver las cuentas de los clientes en los tickets (la pone el instalador del VPS)
CLIPVIRAL_BOT_CLAVE=
# Zona horaria de las fechas (transcripciones y avisos)
ZONA_HORARIA=America/Santo_Domingo
`;

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lee CLAVE=valor de un .env (sin comillas). */
export function valorEnv(texto, clave) {
  const m = String(texto || '').match(new RegExp(`^[ \\t]*${escapar(clave)}[ \\t]*=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}

/** Pone CLAVE=valor en el texto de un .env (cambia la línea si ya está, aunque esté comentada; si no, la agrega). */
export function ponerEnEnv(texto, clave, valor) {
  const linea = `${clave}=${valor}`;
  const re = new RegExp(`^[ \\t]*#?[ \\t]*${escapar(clave)}[ \\t]*=.*$`, 'm');
  const base = String(texto || '');
  if (re.test(base)) return base.replace(re, () => linea);
  return `${base}${base && !base.endsWith('\n') ? '\n' : ''}${linea}\n`;
}

/** El puerto del servidor de ClipViral (de server/.env; 4600 si no dice). */
export function puertoDelServidor(envServidor) {
  const p = Number(valorEnv(envServidor, 'PORT'));
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 4600;
}

/** Dónde guarda sus datos el servidor de ClipViral (DATA_DIR de server/.env, o server/data). */
export function datosDelServidor(serverDir, envServidor) {
  const d = valorEnv(envServidor, 'DATA_DIR');
  return d ? path.resolve(serverDir, d) : path.join(serverDir, 'data');
}

/** Un token de bot tiene tres partes separadas por puntos. */
export const tokenParece = (t) => /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(String(t || '').trim());

/** La aplicación tiene encendido "Message Content Intent" (bit 18; el 19 es la versión limitada, igual sirve). */
export const tieneMessageContent = (flags) => ((Number(flags) || 0) & ((1 << 18) | (1 << 19))) !== 0;

export const esLocal = (url) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(String(url || ''));

const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** PowerShell que crea (o cambia) la tarea que mantiene el bot encendido en el VPS, y la enciende. */
export function tareaScript({ node, botDir, tarea = TAREA }) {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$a = New-ScheduledTaskAction -Execute ${psq(node)} -Argument ${psq(`"${path.join(botDir, 'scripts', 'servicio.js')}"`)} -WorkingDirectory ${psq(botDir)}`,
    '$t = New-ScheduledTaskTrigger -AtStartup',
    '$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew',
    "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest",
    `Register-ScheduledTask -TaskName ${psq(tarea)} -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${psq(tarea)}`,
  ].join('\r\n');
}

/**
 * PowerShell que apaga el bot que estuviera encendido: la tarea, el que la mantiene encendida (servicio.js) y el bot
 * que este encendió (corre con la ruta completa de src\index.js de ESTA carpeta). Busca por la ruta completa: nunca
 * toca el servidor de ClipViral (que también corre un src\index.js, pero de otra carpeta) ni el proceso `excepto`.
 */
export function pararScript({ botDir, tarea = TAREA, excepto = 0 }) {
  const servicio = path.join(botDir, 'scripts', 'servicio.js');
  const bot = path.join(botDir, 'src', 'index.js');
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Stop-ScheduledTask -TaskName ${psq(tarea)}`,
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ProcessId -ne ${Number(excepto) || 0} -and $_.CommandLine -and ($_.CommandLine.Contains(${psq(servicio)}) -or $_.CommandLine.Contains(${psq(bot)})) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ].join('\r\n');
}
