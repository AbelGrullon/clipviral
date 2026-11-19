// Un solo bot encendido por carpeta: si hubiera dos, cada botón se atendería dos veces. El candado es una "tubería"
// de Windows con nombre: Windows la suelta sola si el bot se cierra o se cae (no queda trabado después de un reinicio).
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';

export function nombreCandado(carpeta) {
  const id = crypto.createHash('sha1').update(path.resolve(carpeta).toLowerCase()).digest('hex').slice(0, 12);
  return String.raw`\\.\pipe\clipviral-bot-discord-` + id;
}

/** Devuelve la tubería (para soltarla con .close()) o null si ya hay otro bot encendido con esa carpeta. */
export function tomarCandado(carpeta) {
  if (process.platform !== 'win32') return Promise.resolve({ close() {} });
  return new Promise((resolve) => {
    const tuberia = net.createServer();
    tuberia.once('error', () => resolve(null));
    tuberia.listen(nombreCandado(carpeta), () => {
      tuberia.unref();
      resolve(tuberia);
    });
  });
}
