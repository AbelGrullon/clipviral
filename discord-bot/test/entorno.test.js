import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PLANTILLA_ENV, valorEnv, ponerEnEnv, puertoDelServidor, datosDelServidor, tokenParece, tieneMessageContent, esLocal,
  tareaScript, pararScript, TAREA,
} from '../src/entorno.js';
import { leerConfig, RAIZ } from '../src/config.js';
import { mantener } from '../scripts/servicio.js';

test('leer y cambiar el .env sin perder lo demás', () => {
  let env = PLANTILLA_ENV;
  assert.equal(valorEnv(env, 'ZONA_HORARIA'), 'America/Santo_Domingo');
  assert.equal(valorEnv(env, 'DISCORD_TOKEN'), '');
  env = ponerEnEnv(env, 'DISCORD_TOKEN', 'abc.def.ghi');
  env = ponerEnEnv(env, 'CLIPVIRAL_URL', 'http://127.0.0.1:4600');
  env = ponerEnEnv(env, 'NUEVA', 'x');
  assert.equal(valorEnv(env, 'DISCORD_TOKEN'), 'abc.def.ghi');
  assert.equal(valorEnv(env, 'CLIPVIRAL_URL'), 'http://127.0.0.1:4600');
  assert.match(env, /\nNUEVA=x\n$/);
  assert.match(env, /^# Bot de Discord de ClipViral/);
  assert.equal(env.match(/DISCORD_TOKEN=/g).length, 1);
  // Un valor con $ no se rompe al reemplazar.
  assert.equal(valorEnv(ponerEnEnv(env, 'DISCORD_TOKEN', 'a$&b'), 'DISCORD_TOKEN'), 'a$&b');
  // Comentada: se activa.
  assert.equal(valorEnv(ponerEnEnv('# PORT=1\n', 'PORT', '2'), 'PORT'), '2');
  assert.equal(valorEnv('X="con comillas"', 'X'), 'con comillas');
});

test('puerto y carpeta de datos del servidor de ClipViral', () => {
  assert.equal(puertoDelServidor('PORT=4700\n'), 4700);
  assert.equal(puertoDelServidor(''), 4600);
  assert.equal(puertoDelServidor('PORT=abc'), 4600);
  const server = path.join(os.tmpdir(), 'cv', 'server');
  assert.equal(datosDelServidor(server, ''), path.join(server, 'data'));
  assert.equal(datosDelServidor(server, 'DATA_DIR=D:\\datos'), path.resolve(server, 'D:\\datos'));
  assert.equal(datosDelServidor(server, 'DATA_DIR=otra'), path.join(server, 'otra'));
});

test('revisar el token y lo que dice Discord de la aplicación', () => {
  const falso = `${'A'.repeat(24)}.${'B'.repeat(6)}.${'C'.repeat(27)}`;
  assert.equal(tokenParece(falso), true);
  assert.equal(tokenParece(` ${falso} `), true);
  for (const malo of ['', 'hola', 'a.b.c', `${'A'.repeat(24)}.${'B'.repeat(6)}`]) assert.equal(tokenParece(malo), false, malo);
  assert.equal(tieneMessageContent(1 << 18), true);
  assert.equal(tieneMessageContent(1 << 19), true);
  assert.equal(tieneMessageContent((1 << 14) | (1 << 23)), false);
  assert.equal(tieneMessageContent(undefined), false);
  assert.equal(esLocal('http://127.0.0.1:4600'), true);
  assert.equal(esLocal('http://localhost'), true);
  assert.equal(esLocal('https://cviral.duckdns.org'), false);
});

test('la tarea del VPS enciende servicio.js como SYSTEM al arrancar; parar no toca el servidor de ClipViral', () => {
  const t = tareaScript({ node: 'C:\\Program Files\\nodejs\\node.exe', botDir: 'C:\\ClipViral\\discord-bot' });
  assert.match(t, /-Execute 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(t, /-Argument '"C:\\ClipViral\\discord-bot\\scripts\\servicio\.js"'/);
  assert.match(t, /-AtStartup/);
  assert.match(t, /-UserId 'SYSTEM'/);
  assert.match(t, new RegExp(`Start-ScheduledTask -TaskName '${TAREA}'`));
  const p = pararScript({ botDir: "C:\\Clip'Viral\\discord-bot", excepto: 99 });
  assert.match(p, /Stop-ScheduledTask -TaskName 'ClipViral bot de Discord'/);
  assert.match(p, /\.Contains\('C:\\Clip''Viral\\discord-bot\\scripts\\servicio\.js'\)/);
  assert.match(p, /\.Contains\('C:\\Clip''Viral\\discord-bot\\src\\index\.js'\)/);
  assert.match(p, /ProcessId -ne 99/);
  assert.doesNotMatch(p, /ClipViral servidor|vps-servicio/);
});

test('config: por defecto habla con cviral.duckdns.org y usa la hora de Santo Domingo', () => {
  const c = leerConfig({});
  assert.equal(c.clipviralUrl, 'https://cviral.duckdns.org');
  assert.equal(c.web, 'https://cviral.duckdns.org');
  assert.equal(c.zona, 'America/Santo_Domingo');
  assert.equal(c.datos, path.join(RAIZ, 'data'));
  const vps = leerConfig({ DISCORD_TOKEN: ' t ', CLIPVIRAL_URL: 'http://127.0.0.1:4600/', CLIPVIRAL_WEB: 'https://cviral.duckdns.org/', CLIPVIRAL_BOT_CLAVE: 'k' });
  assert.equal(vps.token, 't');
  assert.equal(vps.clipviralUrl, 'http://127.0.0.1:4600');
  assert.equal(vps.web, 'https://cviral.duckdns.org');
  assert.equal(leerConfig({ CLIPVIRAL_URL: 'http://127.0.0.1:4600' }).web, '', 'sin web pública no inventa un enlace local');
});

test('sin token, el bot avisa qué hacer y se apaga', () => {
  const datos = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'src', 'index.js')], { env: { ...process.env, DISCORD_TOKEN: '', BOT_DATOS: datos }, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Falta el token del bot/);
});

test('el servicio del VPS vuelve a encender el bot si se cae', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipviral-bot-'));
  const log = path.join(dir, 'bot.log');
  const s = mantener({ args: ['-e', 'console.log("hola"); process.exit(1)'], cwd: dir, log, primeraEspera: 50 });
  try {
    for (let i = 0; i < 100 && (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').match(/Encendiendo/g)?.length ?? 0 : 0) < 2; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    s.parar();
  }
  const texto = fs.readFileSync(log, 'utf8');
  assert.ok(texto.match(/Encendiendo el bot de Discord/g).length >= 2, texto);
  assert.match(texto, /hola/);
  assert.match(texto, /se apagó \(código 1\)\. Lo vuelvo a encender\./);
});
