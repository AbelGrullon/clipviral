// Le dice a "Iniciar ClipViral.bat" qué hay en un puerto. Imprime una sola palabra:
//   libre    nada escucha ahí
//   nuevo    el servidor de ESTA carpeta, al día
//   viejo    un servidor de ClipViral de antes de esta versión (el .bat lo cierra y abre el nuevo)
//   otra     el servidor de OTRA copia de ClipViral (el .bat usa otro puerto)
//   ocupado  otro programa
// Uso: node scripts/estado-servidor.js 4600
import net from 'node:net';
import path from 'node:path';
import { idCopia } from '../src/copia.js';

const port = Number(process.argv[2]) || 4600;
const mine = idCopia(path.resolve(import.meta.dirname, '..'));

async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2500) });
    return await res.json();
  } catch {
    return null;
  }
}

function listening() {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(1500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

export async function estado() {
  const h = await health();
  if (h?.ok === true) {
    // api 3: publica solo lo programado. Uno anterior se cierra para abrir el nuevo.
    if (!(Number(h.api) >= 3)) return 'viejo';
    return !h.copia || h.copia === mine ? 'nuevo' : 'otra';
  }
  return (await listening()) ? 'ocupado' : 'libre';
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  console.log(await estado());
}
