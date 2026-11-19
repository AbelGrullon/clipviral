// Noticias en el canal de anuncios: cada vez que publicas una versión en el panel (Actualizaciones), el bot la ve
// en el servidor de ClipViral (cada 2 minutos) y la anuncia. También los anuncios que escribes con /anunciar.
import { COLORES, corta } from './tickets.js';

export function compararVersiones(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Las notas que van en el anuncio. El servidor junta las de cada versión nueva así: "v1.2.3\n<notas>\n\nv1.2.2\n<notas>".
 * soloLaUltima: la primera vez que el bot anuncia algo, solo las de la última versión (no todo el historial).
 */
export function notasParaAnunciar(r, soloLaUltima = false) {
  let notas = String(r?.notes || '').replace(/\r\n/g, '\n');
  if (soloLaUltima) notas = notas.split(/\n\n(?=v\d+\.\d+\.\d+\n)/)[0];
  notas = notas.replace(new RegExp(`^v${escaparRegex(r?.version)}[ \\t]*(\\n|$)`), '');
  notas = notas.replace(/^v(\d+\.\d+\.\d+)[ \t]*$/gm, '**Versión $1**');
  return notas.trim();
}

export function anuncioVersion(r, { web = '', soloLaUltima = false } = {}) {
  const notas = notasParaAnunciar(r, soloLaUltima);
  const descripcion = [
    notas ? corta(notas, 3500) : 'Mejoras y arreglos para que ClipViral funcione mejor.',
    '',
    '**¿Cómo actualizo?** Abre ClipViral: te avisa que hay una versión nueva y la instalas con un clic.',
    ...(web ? [`¿Todavía no la tienes? Descárgala en ${web}/descargar`] : []),
  ].join('\n');
  const publicada = r?.publishedAt ? new Date(`${String(r.publishedAt).replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(r.publishedAt) ? '' : 'Z'}`) : new Date();
  return {
    allowedMentions: { parse: [] },
    embeds: [{
      color: COLORES.rojo,
      title: `🚀 ClipViral ${r.version} ya está disponible`,
      description: descripcion,
      ...(r.mandatory ? { fields: [{ name: '⚠️ Actualización importante', value: 'Instálala apenas la app te avise.' }] } : {}),
      timestamp: (Number.isNaN(publicada.getTime()) ? new Date() : publicada).toISOString(),
    }],
  };
}

export function anuncioManual({ titulo = '', mensaje, autor = '' }) {
  return {
    allowedMentions: { parse: [] },
    embeds: [{
      color: COLORES.azul,
      title: corta(titulo ? `📢 ${titulo}` : '📢 Novedades de ClipViral', 256),
      description: corta(mensaje, 4000),
      ...(autor ? { footer: { text: autor } } : {}),
      timestamp: new Date().toISOString(),
    }],
  };
}

export function modalAnuncio() {
  return {
    custom_id: 'anuncio:form',
    title: '📢 Anuncio para los clientes',
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'titulo', label: 'Título', style: 1, required: false, max_length: 200, placeholder: 'Ej.: ¡Nueva función en ClipViral!' }] },
      { type: 1, components: [{ type: 4, custom_id: 'mensaje', label: 'Mensaje', style: 2, required: true, max_length: 3500 }] },
    ],
  };
}

/**
 * Revisa cada `cada` ms si hay una versión más nueva que la última anunciada y la anuncia.
 * publicar(mensaje) → cuántos canales de anuncios lo recibieron (si fueron 0, se reintenta en la próxima vuelta).
 */
export function crearNoticias({ almacen, clipviral, publicar, yaAnunciada = async () => false, web = '', log = () => {}, cada = 2 * 60 * 1000 }) {
  let timer = null;
  let ocupado = false;
  let ultimoError = '';

  async function revisar() {
    if (ocupado) return null;
    ocupado = true;
    try {
      const ultima = almacen.ultimaVersion();
      const r = await clipviral.ultimaVersion(ultima || '0.0.0');
      if (ultimoError) log('Otra vez hay conexión con el servidor de ClipViral para las noticias.');
      ultimoError = '';
      if (!r?.available || !r.version) return null;
      if (ultima && compararVersiones(r.version, ultima) <= 0) return null;
      // Primera vez en esta carpeta (por ejemplo, recién pasado de tu PC al VPS): si ya está en el canal, no se repite.
      if (!ultima && (await yaAnunciada(r.version))) {
        almacen.guardarUltimaVersion(r.version);
        return null;
      }
      const enviados = await publicar(anuncioVersion(r, { web, soloLaUltima: !ultima }));
      if (enviados > 0) {
        almacen.guardarUltimaVersion(r.version);
        log(`Anuncié la versión ${r.version} en ${enviados} canal(es) de anuncios.`);
      }
      return { version: r.version, enviados };
    } catch (err) {
      // El mismo error no se repite en el registro cada 2 minutos.
      if (err.message !== ultimoError) log(`No pude revisar si hay versión nueva: ${err.message}`);
      ultimoError = err.message;
      return null;
    } finally {
      ocupado = false;
    }
  }

  /** /anunciar-version: vuelve a anunciar la última versión publicada. */
  async function anunciarUltima() {
    const r = await clipviral.ultimaVersion('0.0.0');
    if (!r?.available || !r.version) return { sinVersiones: true };
    const enviados = await publicar(anuncioVersion(r, { web, soloLaUltima: true }));
    if (enviados > 0 && compararVersiones(r.version, almacen.ultimaVersion() || '0.0.0') > 0) almacen.guardarUltimaVersion(r.version);
    return { version: r.version, enviados };
  }

  return {
    revisar,
    anunciarUltima,
    iniciar() {
      revisar();
      timer = setInterval(revisar, cada);
      timer.unref?.();
    },
    parar() {
      clearInterval(timer);
    },
  };
}
