// Después de empaquetar (versión para clientes o para administradores): copia el servidor (con sus módulos) dentro de la app.
// electron-builder deja afuera las carpetas node_modules de "extraResources", por eso se hace aquí.
// Solo va el código y sus módulos: nunca server/data (tu base de datos), server/.env ni tu clave privada.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function copiarServidor(context) {
  const edicion = context.packager.config.extraMetadata?.edicion;
  const from = path.join(__dirname, '..', '..', 'server');
  const resources = path.join(context.appOutDir, 'resources');
  const to = path.join(resources, 'servidor');
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(from, 'package.json'), path.join(to, 'package.json'));
  fs.cpSync(path.join(from, 'src'), path.join(to, 'src'), { recursive: true });
  fs.cpSync(path.join(from, 'node_modules'), path.join(to, 'node_modules'), { recursive: true });
  if (edicion === 'admin') {
    // El panel de admin y lo que usa el servidor para publicar lo programado (el mismo código de la app).
    fs.cpSync(path.join(from, 'public'), path.join(to, 'public'), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', 'engine'), path.join(resources, 'desktop', 'engine'), { recursive: true });
  }
  console.log(`  • servidor copiado  edicion=${edicion} to=${to}`);
};
