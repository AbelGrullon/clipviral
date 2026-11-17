import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Identifica una carpeta de ClipViral sin decir cuál es (un resumen corto de la ruta).
 * El .bat lo compara para no usar por error el servidor de otra copia que esté abierto en la misma PC.
 */
export function idCopia(carpetaServidor) {
  return crypto.createHash('sha256').update(path.resolve(carpetaServidor).toLowerCase()).digest('hex').slice(0, 12);
}
