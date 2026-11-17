// Paso 1 de "Iniciar ClipViral.bat": revisa lo básico de la PC y lo muestra con colores.
// Sale con 3 si Node.js es muy viejo (el .bat explica cómo actualizarlo).
import fs from 'node:fs';
import os from 'node:os';

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const pinta = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const verde = pinta('92');
const amarillo = pinta('93');
const say = (s) => process.stdout.write(`${s}\n`);

const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major > 22 || (major === 22 && minor >= 13))) process.exit(3);
say(`    ${verde('✔')} Node.js ${process.version}`);

const gb = (n) => Math.round(n / 1024 ** 3);
say(`    ${verde('✔')} Memoria: ${gb(os.totalmem())} GB · Procesador: ${os.cpus().length} hilos`);

try {
  const s = fs.statfsSync(process.cwd());
  const free = (s.bavail * s.bsize) / 1024 ** 3;
  if (free < 3) say(`    ${amarillo('!')} Solo quedan ${free.toFixed(1)} GB libres en este disco. Las herramientas y los clips ocupan espacio: libera un poco si puedes.`);
  else say(`    ${verde('✔')} Espacio libre: ${Math.floor(free)} GB`);
} catch { /* no es importante */ }
