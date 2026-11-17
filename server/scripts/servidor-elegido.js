// Le dice a "Iniciar ClipViral.bat" si en la app elegiste tu VPS (Ajustes → Servidor de ClipViral).
//   node scripts/servidor-elegido.js <carpeta-de-datos-de-la-app>            imprime la dirección del VPS (nada si usas el de esta PC)
//   node scripts/servidor-elegido.js <carpeta-de-datos-de-la-app> --probar   sale con 0 si el VPS contesta, 1 si no
import fs from 'node:fs';
import path from 'node:path';

const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(String(u || '').trim());

/** La dirección del VPS elegido en la app, o '' si usa el servidor de esta PC. */
export function servidorElegido(perfil) {
  let url = '';
  try {
    const raw = fs.readFileSync(path.join(perfil, 'ajustes.json'), 'utf8').replace(/^﻿/, '');
    url = String(JSON.parse(raw).serverUrl || '').trim().replace(/\/+$/, '');
  } catch { /* sin ajustes: el de esta PC */ }
  return /^https?:\/\//i.test(url) && !isLocalUrl(url) ? url : '';
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const perfil = process.argv[2] || path.join(process.env.APPDATA || '', 'ClipViral');
  const url = servidorElegido(perfil);
  if (!process.argv.includes('--probar')) {
    if (url) console.log(url);
  } else {
    let ok = !url;
    if (url) {
      try {
        const h = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());
        ok = h?.ok === true;
      } catch { ok = false; }
    }
    process.exit(ok ? 0 : 1);
  }
}
