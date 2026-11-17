const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Licencia, machineCode, generateKey, readKey, newKeyPair } = require('../engine/licencia');

const DAY = 86400000;
const { publicKeyPem, privateKeyPem } = newKeyPair();
const PC = machineCode('pc-del-cliente');
const OTRA = machineCode('otra-pc');
const T0 = Date.UTC(2026, 10, 16, 12);

function lic(now, machine = PC, file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lic-')), 'licencia.json')) {
  const clock = { t: now };
  return { l: new Licencia({ file, publicKeyPem, machine, now: () => clock.t }), clock, file };
}

test('el código de equipo es fijo por PC y corto', () => {
  assert.match(PC, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(machineCode('pc-del-cliente'), PC);
  assert.notEqual(PC, OTRA);
});

test('una clave hecha para esta PC activa 30 días', () => {
  const key = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 });
  assert.equal(readKey(key, publicKeyPem).machine, PC);
  const { l, clock } = lic(T0 + 3600000);
  assert.equal(l.status().active, false);
  assert.equal(l.status().reason, 'nueva');
  const st = l.activate(key);
  assert.equal(st.active, true);
  assert.equal(st.daysLeft, 30);
  clock.t += 29 * DAY;
  assert.equal(l.status().active, true);
  clock.t += 2 * DAY;
  assert.deepEqual([l.status().active, l.status().reason], [false, 'vencida']);
});

test('claves falsas, cambiadas o de otra PC no sirven', () => {
  const { l } = lic(T0);
  assert.throws(() => l.activate('ABCDE-FGHJK'), /incompleta/);
  const otra = newKeyPair();
  assert.throws(() => l.activate(generateKey({ privateKeyPem: otra.privateKeyPem, machine: PC, plan: 'claude', now: T0 })), /no es válida/);
  assert.throws(() => l.activate(generateKey({ privateKeyPem, machine: OTRA, plan: 'claude', now: T0 })), /otra PC/);
  // Cambiar una letra de una clave buena la rompe.
  const key = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 });
  const i = key.length - 3;
  const broken = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1);
  assert.throws(() => l.activate(broken), /no es válida/);
  assert.equal(l.status().active, false);
});

test('reinstalar y poner la misma clave no regala días', () => {
  const key = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 });
  const { l, clock, file } = lic(T0);
  l.activate(key);
  clock.t += 20 * DAY;
  // Borra todo (como reinstalar) y vuelve a poner la misma clave: le quedan como mucho los días de gracia.
  fs.rmSync(file);
  const st = l.activate(key);
  assert.ok(st.daysLeft <= 17, `quedaron ${st.daysLeft} días`);
  clock.t = T0 + 40 * DAY;
  assert.throws(() => l.activate(key), /venció/);
});

test('atrasar la fecha de la PC bloquea', () => {
  const key = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 });
  const { l, clock } = lic(T0);
  l.activate(key);
  clock.t += 10 * DAY;
  l.status();
  clock.t -= 5 * DAY;
  assert.deepEqual([l.status().active, l.status().reason], [false, 'reloj']);
});

test('renovar antes de que venza suma los días al final', () => {
  const { l, clock } = lic(T0);
  l.activate(generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 }));
  clock.t = T0 + 27 * DAY;
  const nueva = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: clock.t });
  const st = l.activate(nueva);
  assert.equal(st.daysLeft, 33);
});

test('la clave dice el plan y la app lo detecta', () => {
  const { l } = lic(T0);
  const local = generateKey({ privateKeyPem, machine: PC, plan: 'local', now: T0 });
  assert.equal(readKey(local, publicKeyPem).plan, 'local');
  const st = l.activate(local);
  assert.deepEqual([st.plan, st.planName], ['local', 'Local']);
  // Pasar a Claude: el plan nuevo empieza ya (no se suma a los días de Local).
  const claude = generateKey({ privateKeyPem, machine: PC, plan: 'claude', now: T0 });
  const st2 = l.activate(claude);
  assert.deepEqual([st2.plan, st2.planName, st2.daysLeft], ['claude', 'Claude', 30]);
  assert.throws(() => generateKey({ privateKeyPem, machine: PC, now: T0 }), /Elige el plan/);
});
