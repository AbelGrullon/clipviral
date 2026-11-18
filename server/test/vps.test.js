// Kit del VPS: la copia privada (programa + tus datos), el instalador y lo que mantiene encendido el servidor.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validHost, cleanHost, caddyfile, importarDatos, taskScript, stopScript, firewallScript, portFrom, TASK } from '../scripts/vps.js';
import { keep } from '../scripts/vps-servicio.js';
import { copiaDeDatos, INCLUIR_VPS } from '../scripts/preparar-vps.js';
import { archivosDeLaCopia, crearZip, INCLUIR, ROOT } from '../scripts/preparar-copia.js';
import { servidorElegido } from '../scripts/servidor-elegido.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-vps-'));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test('la dirección del VPS', () => {
  assert.equal(cleanHost(' https://QueJuidero.duckdns.org/ '), 'quejuidero.duckdns.org');
  assert.equal(validHost('quejuidero.duckdns.org'), true);
  assert.equal(validHost('mi-clip.viral.com'), true);
  for (const bad of ['', 'localhost', 'quejuidero', 'qué.com', 'a b.com', '-x.com', '185.10.20.30']) assert.equal(validHost(bad), false, bad);
  const cf = caddyfile('quejuidero.duckdns.org', 4600);
  assert.match(cf, /^quejuidero\.duckdns\.org \{$/m);
  assert.match(cf, /reverse_proxy 127\.0\.0\.1:4600/);
});

test('la copia para el VPS: el servidor y el código de subida, sin datos sueltos ni la app de escritorio', () => {
  const files = archivosDeLaCopia(ROOT, INCLUIR_VPS);
  for (const must of ['Instalar en el VPS.bat', 'GUIA-VPS.md', 'server/src/publicaciones.js', 'server/scripts/vps.js', 'server/scripts/vps-servicio.js',
    'desktop/engine/redes.js', 'desktop/engine/util.js', 'desktop/engine/publicar.js', 'server/package-lock.json']) {
    assert.ok(files.includes(must), `falta ${must}`);
  }
  assert.ok(!files.some((f) => /(^|\/)(\.env|data|node_modules|test|https)(\/|$)/.test(f) || f.endsWith('.db') || f.endsWith('secret.key')), 'sin datos sueltos');
  assert.ok(!files.includes('desktop/main.js'), 'el VPS no necesita la app');
  // La copia para un amigo también trae el kit del VPS (por si quiere el suyo).
  for (const f of ['Preparar copia para el VPS.bat', 'Instalar en el VPS.bat', 'GUIA-VPS.md']) assert.ok(INCLUIR.includes(f), f);
});

test('tus datos van en la copia sin lo programado, y en el VPS solo se traen la primera vez', () => {
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data, { recursive: true });
  const db = new DatabaseSync(path.join(data, 'clipviral.db'));
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); INSERT INTO users (email) VALUES ('ana@clipviral.test');
    CREATE TABLE posts (id TEXT); INSERT INTO posts VALUES ('p1'); CREATE TABLE post_files (hash TEXT); INSERT INTO post_files VALUES ('h');`);
  // Abierta (como con el servidor encendido): igual se puede copiar.
  fs.writeFileSync(path.join(data, 'secret.key'), 'ab'.repeat(32));
  const env = path.join(tmp, '.env');
  fs.writeFileSync(env, 'PORT=4655\n');
  const out = path.join(tmp, 'foto');
  const extras = copiaDeDatos({ dataDir: data, envFile: env, outDir: out });
  db.close();
  assert.deepEqual(extras.map((x) => x.rel).sort(), ['traer-datos/.env', 'traer-datos/clipviral.db', 'traer-datos/secret.key']);
  const snap = new DatabaseSync(path.join(out, 'clipviral.db'), { readOnly: true });
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 0, 'lo programado se manda de nuevo desde la app');
  assert.equal(snap.prepare('SELECT COUNT(*) AS n FROM post_files').get().n, 0);
  snap.close();

  // El zip.
  const zip = path.join(tmp, 'copia.zip');
  crearZip(ROOT, ['GUIA-VPS.md'], zip, extras);
  assert.ok(fs.statSync(zip).size > 1000);

  // En el VPS: la primera vez trae los datos y borra la carpeta traer-datos.
  const vps = path.join(tmp, 'vps');
  const traer = path.join(vps, 'traer-datos');
  const copyIn = () => { fs.mkdirSync(traer, { recursive: true }); for (const x of extras) fs.copyFileSync(x.abs, path.join(vps, x.rel)); };
  copyIn();
  const vpsData = path.join(vps, 'server', 'data');
  fs.mkdirSync(path.join(vps, 'server'), { recursive: true });
  assert.equal(importarDatos({ traer, dataDir: vpsData, serverDir: path.join(vps, 'server') }), 'traidos');
  assert.ok(fs.existsSync(path.join(vpsData, 'clipviral.db')));
  assert.equal(fs.readFileSync(path.join(vpsData, 'secret.key'), 'utf8'), 'ab'.repeat(32), 'la misma llave: los tokens se pueden leer');
  assert.equal(portFrom(path.join(vps, 'server', '.env')), 4655);
  assert.ok(!fs.existsSync(traer), 'la copia con tus tokens se borra');
  // Al actualizar: los datos del VPS no se reemplazan.
  fs.writeFileSync(path.join(vpsData, 'secret.key'), 'del-vps');
  copyIn();
  assert.equal(importarDatos({ traer, dataDir: vpsData, serverDir: path.join(vps, 'server') }), 'ya-tenia');
  assert.equal(fs.readFileSync(path.join(vpsData, 'secret.key'), 'utf8'), 'del-vps');
  assert.ok(!fs.existsSync(traer));
  assert.equal(importarDatos({ traer, dataDir: vpsData }), 'sin-copia');
});

test('el instalador: tarea de Windows como SYSTEM, apagar lo viejo y firewall', () => {
  const ps = taskScript({ node: "C:\\Program Files\\nodejs\\node.exe", serverDir: "C:\\Clip'Viral\\server" });
  assert.match(ps, new RegExp(`-TaskName '${TASK}'`));
  assert.match(ps, /-AtStartup/);
  assert.match(ps, /-UserId 'SYSTEM'/);
  assert.match(ps, /-Execute 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(ps, /C:\\Clip''Viral\\server/, 'las comillas simples se escapan');
  assert.match(ps, /vps-servicio\.js/);
  assert.match(stopScript(4600), /-LocalPort 4600/);
  assert.match(firewallScript([80, 443]), /-LocalPort 80,443/);
  assert.equal(portFrom(path.join(tmp, 'no-existe.env')), 4600);
});

test('el servicio vuelve a encender el servidor si se apaga', async () => {
  const log = path.join(tmp, 'servicio.log');
  const k = keep('prueba', process.execPath, ['-e', 'console.log("hola"); process.exit(3)'], {}, log, { firstWait: 50 });
  try {
    const until = Date.now() + 10000;
    while (Date.now() < until && (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').match(/Encendiendo prueba/g)?.length || 0 : 0) < 2) await new Promise((r) => setTimeout(r, 50));
  } finally { k.stop(); }
  const text = fs.readFileSync(log, 'utf8');
  assert.ok(text.match(/Encendiendo prueba/g).length >= 2, text);
  assert.match(text, /hola/);
  assert.match(text, /se apagó \(código 3\)/);
});

test('Iniciar ClipViral.bat sabe si elegiste tu VPS en la app', () => {
  const perfil = path.join(tmp, 'perfil');
  fs.mkdirSync(perfil, { recursive: true });
  assert.equal(servidorElegido(perfil), '', 'sin ajustes: el de esta PC');
  fs.writeFileSync(path.join(perfil, 'ajustes.json'), JSON.stringify({ serverUrl: 'http://localhost:4600' }));
  assert.equal(servidorElegido(perfil), '');
  fs.writeFileSync(path.join(perfil, 'ajustes.json'), JSON.stringify({ serverUrl: 'https://quejuidero.duckdns.org/' }));
  assert.equal(servidorElegido(perfil), 'https://quejuidero.duckdns.org');
  fs.writeFileSync(path.join(perfil, 'ajustes.json'), '{roto');
  assert.equal(servidorElegido(perfil), '');
});

test('VPS con tu Caddy: ClipViral se agrega a tu Caddyfile sin tocar tus otras páginas', async () => {
  const { ponerEnCaddyfile, hostEnOtroBloque, configDeLinea, ponerEnEnv, caddyBlock } = await import('../scripts/vps.js');
  const tuyo = 'mipagina.com {\r\n\treverse_proxy 127.0.0.1:3000\r\n}\r\n';
  const con = ponerEnCaddyfile(tuyo, 'cviral.duckdns.org', 4600);
  assert.ok(con.startsWith(tuyo.trimEnd()), 'tu página queda igual');
  assert.match(con, /cviral\.duckdns\.org \{\r\n\tencode gzip\r\n\treverse_proxy 127\.0\.0\.1:4600\r\n\}/);
  assert.equal(ponerEnCaddyfile(con, 'cviral.duckdns.org', 4600), con, 'volver a instalar no lo duplica');
  assert.equal(ponerEnCaddyfile(con, 'cviral.duckdns.org', 4610), con.replace('4600', '4610'));
  assert.equal(hostEnOtroBloque(con, 'cviral.duckdns.org'), false);
  assert.equal(hostEnOtroBloque(`${tuyo}https://cviral.duckdns.org {\n}\n`, 'cviral.duckdns.org'), true);
  assert.equal(ponerEnCaddyfile('', 'cviral.duckdns.org', 4600), `${caddyBlock('cviral.duckdns.org', 4600)}\n`);
  assert.equal(configDeLinea('"C:\caddy\caddy.exe" run --config "C:\mis sitios\Caddyfile" --adapter caddyfile'), 'C:\mis sitios\Caddyfile');
  assert.equal(configDeLinea('caddy.exe run'), '');
  assert.equal(ponerEnEnv('PORT=4600\n# HOST=\n', 'HOST', '127.0.0.1'), 'PORT=4600\nHOST=127.0.0.1\n');
  assert.doesNotMatch(firewallScript([]), /New-NetFirewallRule/, 'con tu Caddy no se abre ningún puerto');
  assert.match(stopScript(4600), /CommandLine -like/, 'solo apaga el servidor de ClipViral');
});
