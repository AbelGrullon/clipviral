// Licencias de la versión para clientes (sin servidor: todo se comprueba en la PC).
//
// - Cada PC tiene un "código de equipo" (sale de la identificación de Windows de esa PC).
// - El dueño genera la clave con su clave privada: la clave lleva el código de equipo, el día en que se hizo
//   y cuántos días da (30). Va firmada (Ed25519): la app del cliente solo tiene la parte pública, que sirve
//   para comprobar la firma pero no para inventar claves.
// - Los días cuentan desde que se activa. Para que reinstalar no regale días, una clave nunca sirve
//   más allá de (día en que se hizo + días + GRACIA).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const DAY = 86400000;
const EPOCH = Date.UTC(2026, 0, 1);
const GRACE_DAYS = 7; // tiempo para activarla (o para renovar antes de que venza sin perder días)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // sin I, L, O, U (no se confunden al copiarlas)
// Versión 2: la clave lleva el plan. (Las de versión 1, de las primeras pruebas, cuentan como plan Claude.)
const VERSION = 2;
// Planes que puede tener un cliente. El precio es solo para mostrar: lo cobras tú.
const PLANES = {
  local: { code: 1, name: 'Local', price: 20, desc: 'La IA local de su PC saca los clips. Sin Claude.' },
  claude: { code: 2, name: 'Claude', price: 30, desc: 'Además, Claude elige los clips con la clave de Claude del cliente.' },
};
const planByCode = (c) => Object.keys(PLANES).find((k) => PLANES[k].code === c);

// ---------- Base32 ----------
function b32encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('La clave tiene letras que no van.');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const group = (s, n) => s.match(new RegExp(`.{1,${n}}`, 'g')).join('-');

// ---------- Código de equipo ----------
function windowsId() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i);
    if (m) return m[1].toLowerCase();
  } catch {}
  return `${os.hostname()}|${os.cpus()[0]?.model || ''}|${os.totalmem()}`;
}
const machineBytes = (id) => crypto.createHash('sha256').update(`clipviral|${id}`).digest().subarray(0, 5);
/** "ABCD-EFGH": lo que el cliente te manda para que le hagas su clave. */
function machineCode(id = windowsId()) { return group(b32encode(machineBytes(id)), 4); }
function parseMachineCode(code) {
  const b = b32decode(code);
  if (b.length !== 5) throw new Error('El código de equipo debe tener 8 letras o números (por ejemplo ABCD-EFGH).');
  return b;
}

// ---------- Claves ----------
/** Hace una clave (solo en la PC del dueño, con su clave privada). */
function generateKey({ privateKeyPem, machine, plan, days = 30, now = Date.now(), serial = crypto.randomInt(0, 65536) }) {
  const d = Math.round(Number(days));
  if (!(d >= 1 && d <= 255)) throw new Error('Los días deben ser entre 1 y 255.');
  if (!PLANES[plan]) throw new Error('Elige el plan del cliente: Local o Claude.');
  const payload = Buffer.alloc(12);
  payload[0] = VERSION;
  parseMachineCode(machine).copy(payload, 1);
  payload.writeUInt16BE(Math.floor((now - EPOCH) / DAY), 6);
  payload[8] = d;
  payload.writeUInt16BE(serial, 9);
  payload[11] = PLANES[plan].code;
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
  return group(b32encode(Buffer.concat([payload, sig])), 5);
}

/** Lee una clave y comprueba la firma. Devuelve { machine, plan, issuedAt, days, serial, ceiling } o lanza un error claro. */
function readKey(key, publicKeyPem) {
  let raw;
  try { raw = b32decode(key); } catch (err) { throw new Error(err.message); }
  if (raw.length < 75) throw new Error('La clave está incompleta. Cópiala entera, sin cortar.');
  const version = raw[0];
  if (version !== 1 && version !== VERSION) throw new Error('Esa clave no es para esta versión de ClipViral.');
  const size = version === 1 ? 11 : 12;
  if (raw.length < size + 64) throw new Error('La clave está incompleta. Cópiala entera, sin cortar.');
  const payload = raw.subarray(0, size);
  const sig = raw.subarray(size, size + 64);
  let ok = false;
  try { ok = crypto.verify(null, payload, crypto.createPublicKey(publicKeyPem), sig); } catch {}
  if (!ok) throw new Error('Esa clave no es válida. Revisa que esté bien copiada.');
  const issuedAt = EPOCH + payload.readUInt16BE(6) * DAY;
  const days = payload[8];
  const plan = version === 1 ? 'claude' : planByCode(payload[11]);
  if (!plan) throw new Error('Esa clave es de un plan que esta versión no conoce. Actualiza ClipViral.');
  return {
    machine: group(b32encode(payload.subarray(1, 6)), 4),
    plan, issuedAt, days, serial: payload.readUInt16BE(9),
    ceiling: issuedAt + (days + GRACE_DAYS) * DAY,
  };
}

function newKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

// ---------- Licencia guardada en la PC del cliente ----------
class Licencia {
  /** file: dónde se guarda; publicKeyPem: la parte pública; machine: código de esta PC. */
  constructor({ file, publicKeyPem, machine = machineCode(), now = () => Date.now() }) {
    Object.assign(this, { file, publicKeyPem, machine, now });
  }

  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  save(s) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(s)); }

  /** { active, plan, planName, expiresAt, daysLeft, machine, reason } */
  status() {
    const s = this.load();
    const now = this.now();
    const base = { machine: this.machine, active: false, expiresAt: null, daysLeft: 0 };
    if (!s.key) return { ...base, reason: 'nueva' };
    // Si la fecha de la PC se atrasó (para estirar la licencia), no se deja seguir.
    if (s.lastSeen && now < s.lastSeen - 2 * 3600000) return { ...base, reason: 'reloj' };
    let k;
    try { k = readKey(s.key, this.publicKeyPem); } catch { return { ...base, reason: 'invalida' }; }
    if (k.machine !== this.machine) return { ...base, reason: 'otra-pc' };
    const expiresAt = Math.min((s.activatedAt || now) + k.days * DAY, k.ceiling);
    if (now >= expiresAt) return { ...base, expiresAt, reason: 'vencida' };
    // Se anota la última vez que se vio la fecha (para notar si la atrasan); no hace falta escribir en cada consulta.
    if (!s.lastSeen || now - s.lastSeen > 60000) this.save({ ...s, lastSeen: now });
    return { ...base, active: true, plan: k.plan, planName: PLANES[k.plan].name, expiresAt, daysLeft: Math.ceil((expiresAt - now) / DAY) };
  }

  /**
   * Pone una clave nueva. Si la anterior sigue activa y es del mismo plan, los días nuevos se suman al final
   * (sin perder los que quedaban). Si cambia de plan, el plan nuevo empieza ya.
   */
  activate(key) {
    const k = readKey(key, this.publicKeyPem);
    if (k.machine !== this.machine) throw new Error(`Esa clave es para otra PC (código ${k.machine}). El código de esta PC es ${this.machine}.`);
    const now = this.now();
    const s = this.load();
    if (s.lastSeen && now < s.lastSeen - 2 * 3600000) throw new Error('La fecha y hora de esta PC están atrasadas. Corrígelas y vuelve a intentar.');
    const used = s.usadas || {};
    // La misma clave otra vez (por ejemplo, después de reinstalar) no vuelve a empezar los días.
    const before = this.status();
    let activatedAt = used[k.serial] ?? (before.active && s.key && before.plan === k.plan ? before.expiresAt : now);
    if (activatedAt > k.ceiling) activatedAt = now;
    const expiresAt = Math.min(activatedAt + k.days * DAY, k.ceiling);
    if (now >= expiresAt) throw new Error('Esa clave ya venció. Pide una nueva.');
    used[k.serial] = activatedAt;
    this.save({ key: String(key).trim(), activatedAt, lastSeen: now, usadas: used });
    return this.status();
  }
}

module.exports = { Licencia, machineCode, generateKey, readKey, newKeyPair, parseMachineCode, GRACE_DAYS, PLANES };
