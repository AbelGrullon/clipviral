// Habla con el servidor de ClipViral: qué versión es la última (para las noticias) y, con la clave del bot,
// qué cuenta tiene un correo (para que el equipo vea el plan del cliente en los tickets).

export function crearClipViral({ url, clave = '', fetch: pedirHttp = globalThis.fetch, timeoutMs = 10000 }) {
  const base = String(url || '').trim().replace(/\/+$/, '');

  async function pedir(ruta, conClave) {
    const res = await pedirHttp(base + ruta, {
      headers: conClave ? { 'x-bot-clave': clave } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }

  /** Pregunta algo que necesita la clave del bot. Nunca lanza error: devuelve { sinConexion, motivo } si no se pudo. */
  async function conClave(ruta) {
    if (!base || !clave) return { sinConexion: true, motivo: 'sin-clave' };
    try {
      const r = await pedir(ruta, true);
      if (r.status === 401) return { sinConexion: true, motivo: 'clave' };
      if (r.status === 404) return { sinConexion: true, motivo: 'viejo' };
      if (r.status !== 200) return { sinConexion: true, motivo: 'apagado' };
      return r.body;
    } catch {
      return { sinConexion: true, motivo: 'apagado' };
    }
  }

  return {
    url: base,
    puedeVerCuentas: () => !!(base && clave),

    /** La respuesta de /api/updates/latest (la misma que usa la app para actualizarse). */
    async ultimaVersion(actual = '0.0.0') {
      if (!base) throw new Error('falta la dirección del servidor de ClipViral (CLIPVIRAL_URL)');
      const r = await pedir(`/api/updates/latest?current=${encodeURIComponent(actual)}`, false);
      if (r.status !== 200) throw new Error(`el servidor de ClipViral contestó ${r.status}`);
      return r.body;
    },

    /** ¿Está bien la conexión con las cuentas? { ok: true } o { sinConexion, motivo }. */
    estado: () => conClave('/api/bot/estado'),

    buscarCliente: (correo) => conClave(`/api/bot/cliente?correo=${encodeURIComponent(correo)}`),
  };
}
