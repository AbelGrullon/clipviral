// Revisiones de las pantallas (renderer) que se pueden hacer sin abrir la app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const code = Object.fromEntries(scripts.map((s) => [s, fs.readFileSync(path.join(dir, s), 'utf8')]));

test('pantallas: los archivos no repiten nombres globales (si se repiten, la app queda en la pantalla de carga)', () => {
  const seen = {};
  for (const [file, src] of Object.entries(code)) {
    for (const m of src.matchAll(/^(?:const|let|var|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      assert.ok(!seen[m[1]], `"${m[1]}" está en ${seen[m[1]]} y en ${file}`);
      seen[m[1]] = file;
    }
  }
  assert.ok(seen.L && seen.EN && seen.openCreatePost && seen.showJobs && seen.openManualConnect, 'están las funciones nuevas');
});

test('pantallas: la app arranca una sola vez, después de cargar todo lo que usa', () => {
  const calls = Object.entries(code).filter(([, src]) => /^boot\(\);\s*$/m.test(src)).map(([f]) => f);
  assert.deepEqual(calls, ['extras.js']);
  for (const s of scripts) assert.doesNotThrow(() => new Function(code[s]), `${s} tiene un error de sintaxis`);
});

test('pantallas en inglés: textos de la entrada y ajuste apagado por defecto', () => {
  const en = [...html.matchAll(/data-en="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(en.length >= 10);
  assert.ok(en.every((t) => t.trim().length > 1), 'ningún texto en inglés vacío');
  assert.ok(en.includes('Sign in') && en.includes('Password'));
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /pantallasEnIngles: false/);
  // Redes y Crear publicación tienen su versión en inglés.
  for (const t of ['Create post', 'Page to publish to', 'Instagram linked to this Page', 'Publish now', 'Schedule', 'View on ${net.short}', 'Connected as']) {
    assert.ok(code['extras.js'].includes(t), `falta "${t}" en extras.js`);
  }
});
