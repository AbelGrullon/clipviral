// SerieAI manejada por el agente: corre serie_agente.py con el Python donde está instalado SerieAI.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run } = require('../util');

const LANZADOR = path.join(__dirname, 'serie_agente.py');

/** Busca un Python que pueda abrir SerieAI (el lanzador "py" de Windows o "python"). */
async function findPython(serieDir) {
  const check = `import sys; sys.path.insert(0, r'''${serieDir}'''); import serie.guionista, serie.render; print(sys.executable)`;
  for (const [cmd, pre] of [['py', ['-3']], ['python', []], ['python3', []]]) {
    try {
      const { out } = await run(cmd, [...pre, '-c', check], { timeoutMs: 60000 });
      const exe = out.trim().split(/\r?\n/).pop();
      if (exe && fs.existsSync(exe)) return exe;
    } catch {}
  }
  return null;
}

/** ¿La carpeta tiene SerieAI? */
function serieInfo(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'main.py')) || !fs.existsSync(path.join(dir, 'serie', 'guionista.py'))) {
    return { ok: false, motivo: 'No encontré SerieAI (falta main.py o la carpeta serie).' };
  }
  if (!fs.existsSync(path.join(dir, 'config.json'))) return { ok: false, motivo: 'SerieAI no tiene config.json. Ábrelo una vez para crearlo.' };
  return { ok: true };
}

/**
 * Corre una orden de SerieAI en la carpeta del agente. Devuelve lo que el lanzador escribe en "RESULTADO".
 * orden: 'nueva' (args.idea) o 'episodio' (args.tema). env: servidor de ClipViral y servidor de voz.
 */
function runSerie({ python, serieDir, workDir, orden, idea = '', tema = '', ajustes = {}, env = {}, onLine = () => {}, signal, timeoutMs = 6 * 3600000 }) {
  const args = ['-u', LANZADOR, '--serieai', serieDir, '--carpeta', workDir, orden, ...(orden === 'nueva' ? ['--idea', idea] : ['--tema', tema])];
  return new Promise((resolve, reject) => {
    const p = spawn(python, args, {
      cwd: workDir, windowsHide: true,
      env: { ...process.env, ...env, AGENTE_AJUSTES: JSON.stringify(ajustes), PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let result = null;
    let tail = '';
    let buf = '';
    const t = setTimeout(() => p.kill(), timeoutMs);
    const onAbort = () => p.kill();
    signal?.addEventListener('abort', onAbort);
    const line = (l) => {
      if (l.startsWith('RESULTADO ')) { try { result = JSON.parse(l.slice(10)); } catch {} return; }
      if (l.trim()) onLine(l.trim());
    };
    p.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach(line);
    });
    p.stderr.on('data', (d) => { tail = (tail + d.toString()).slice(-4000); });
    p.on('error', (err) => { clearTimeout(t); reject(err); });
    p.on('exit', (code) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      if (buf) line(buf);
      if (code === 0 && result) return resolve(result);
      if (signal?.aborted) return reject(new Error('Detenido'));
      // SystemExit("mensaje") deja el mensaje en la última línea de stderr.
      const last = tail.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || `SerieAI terminó con error (código ${code})`;
      reject(new Error(`SerieAI: ${last.replace(/^SystemExit:\s*/, '').slice(0, 400)}`));
    });
  });
}

module.exports = { findPython, serieInfo, runSerie };
