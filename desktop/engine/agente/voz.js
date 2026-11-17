// La voz del agente: enciende el "Sintetizador de voz" del usuario (su propio Python y motor) como un servidor
// local mientras el agente trabaja, y le pide audios. El modelo se carga una vez; se apaga solo cuando no se usa.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SERVIDOR = path.join(__dirname, 'voz_servidor.py');
const CLIENTE = path.join(__dirname, 'voz_cliente.py');

/** ¿Esa carpeta tiene el Sintetizador instalado (su Python con el motor)? */
function sinteInfo(dir) {
  if (!dir) return { ok: false, motivo: 'No encontré la carpeta del Sintetizador de voz.' };
  const python = path.join(dir, 'venv-qwen', 'Scripts', 'python.exe');
  if (!fs.existsSync(path.join(dir, 'motor.py'))) return { ok: false, motivo: 'Esa carpeta no tiene el Sintetizador de voz (falta motor.py).' };
  if (!fs.existsSync(python)) return { ok: false, motivo: 'El Sintetizador no está instalado (falta venv-qwen). Ejecuta su instalar.bat.' };
  const voces = fs.existsSync(path.join(dir, 'voces')) ? fs.readdirSync(path.join(dir, 'voces')).filter((v) => fs.existsSync(path.join(dir, 'voces', v, 'normal.wav'))) : [];
  if (!voces.length) return { ok: false, motivo: 'El Sintetizador no tiene voces creadas. Ábrelo y créalas en Voces.' };
  return { ok: true, python, voces };
}

class Voz {
  constructor({ dir, log = () => {} }) {
    this.dir = dir;
    this.log = log;
    this.proc = null;
    this.port = null;
    this.clave = crypto.randomBytes(18).toString('hex');
    this.starting = null;
  }

  info() { return sinteInfo(this.dir); }

  /** Variables para otro programa (SerieAI) que use la voz por voz_cliente.py. */
  env() { return { VOZ_PUERTO: String(this.port || 0), VOZ_CLAVE: this.clave }; }

  async start() {
    if (this.proc && this.port) return;
    if (this.starting) return this.starting;
    const info = this.info();
    if (!info.ok) throw new Error(info.motivo);
    this.starting = new Promise((resolve, reject) => {
      const p = spawn(info.python, ['-u', SERVIDOR, this.dir], {
        cwd: this.dir, windowsHide: true,
        env: { ...process.env, VOZ_CLAVE: this.clave, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      let err = '';
      let done = false;
      const finish = (e) => { if (done) return; done = true; clearTimeout(t); e ? reject(e) : resolve(); };
      const t = setTimeout(() => { p.kill(); finish(new Error('El Sintetizador de voz tardó demasiado en arrancar.')); }, 180000);
      p.stdout.on('data', (d) => {
        const s = d.toString();
        const m = s.match(/LISTO (\d+)/);
        if (m) { this.port = Number(m[1]); this.proc = p; finish(); }
        if (/OCUPADO/.test(s)) finish(new Error('El programa "Sintetizador de voz" está abierto. Ciérralo: el agente lo necesita y no caben dos en la tarjeta gráfica.'));
      });
      p.stderr.on('data', (d) => { err = (err + d.toString()).slice(-3000); });
      p.on('exit', (code) => {
        if (this.proc === p) { this.proc = null; this.port = null; }
        finish(new Error(`El Sintetizador de voz se cerró (código ${code}). ${err.split('\n').filter(Boolean).slice(-2).join(' ')}`.trim()));
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async request(pathname, body, timeoutMs = 15 * 60000) {
    await this.start();
    const res = await fetch(`http://127.0.0.1:${this.port}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Clave': this.clave },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `La voz falló (error ${res.status})`);
    return data;
  }

  /** Lee el texto con esa voz y emoción y lo guarda en `salida` (.wav o .mp3). */
  hablar({ texto, voz, emocion, salida, velocidad }) {
    return this.request('/hablar', { texto, voz, emocion, salida, velocidad });
  }

  /** { sofia: { nombre, detalle, emociones: [...] }, ... } */
  voces() { return this.request('/voces', null, 180000); }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch {} }
    this.proc = null;
    this.port = null;
  }
}

module.exports = { Voz, sinteInfo, CLIENTE };
