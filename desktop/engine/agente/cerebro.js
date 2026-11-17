// El "cerebro" del agente: lo que se le pide a Claude (por el servidor de ClipViral) y cómo se limpia lo que responde.
// Todo es texto y datos: aquí no se llama a nada, así se puede probar sin gastar.

const EMOCIONES = ['normal', 'alegre', 'triste', 'enojado', 'gritando', 'susurro'];
const TIPOS = ['narrado', 'serie'];

const REGLAS = `Reglas (la página no puede arriesgarse a que Facebook la castigue o no le pague):
- Todo ORIGINAL: no copies textos, chistes ni historias de otros creadores; no uses personajes, marcas ni música con derechos.
- Nada falso presentado como verdad. Si es leyenda, ficción, creencia o rumor, dilo así. Datos prudentes y verificables.
  Nada de consejos médicos, de dinero o legales que puedan hacer daño.
- Sin cebo de interacción ("comenta SÍ", "comparte si…", "etiqueta a 3 amigos", "dale like si…"): Facebook lo castiga.
  Un buen gancho y, al final, una pregunta natural o una invitación a seguir la página sí valen.
- Nada de odio, violencia gráfica, contenido sexual, burlas a personas privadas, política partidista ni tragedias recientes.
- Público hispanohablante (el dueño es de República Dominicana). Español claro y natural.
- Facebook solo acepta Reels de 3 a 90 segundos.`;

function tiposTexto(tipos) {
  const out = [];
  if (tipos.narrado) {
    out.push('- "narrado": video vertical de 30 a 80 segundos. Una voz realista en español lee tu guion, con subtítulos grandes animados y un fondo (videos o fotos del dueño, o un degradado de colores que eliges tú). Sirve para historias, curiosidades, datos, misterios, leyendas, reflexiones, "3 cosas que…", etc. Se hace en unos minutos.');
  }
  if (tipos.serie) {
    out.push('- "serie": episodio de 45 a 60 segundos de una serie animada propia (personajes 3D con voces). La primera vez se crea la serie con tu idea; después cada episodio sigue la historia. Tarda horas en hacerse: como mucho uno al día.');
  }
  return out.join('\n');
}

/** Instrucciones fijas del agente (igual en todos los pedidos). */
function systemPrompt(tipos) {
  return `Eres el director de una página de Facebook NUEVA que manejas tú solo, sin ayuda humana.
Tu meta: hacerla crecer hasta que pueda monetizar (muchos seguidores y muchos minutos vistos), con contenido original que la app produce sola.

Lo que la app puede producir por ti:
${tiposTexto(tipos)}

${REGLAS}

Cómo se crece: un nicho claro y constante (la gente sigue páginas que sabe qué le van a dar), ganchos fuertes en los 2 primeros segundos,
guiones que se vean hasta el final (retención), formatos repetibles (series, partes, "¿sabías que…?"), y publicar con constancia.
Decide con los números reales que te paso (vistas, segundos vistos, seguidores). Si algo no funciona, cámbialo; si algo funciona, haz más de eso.`;
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['nicho', 'publico', 'tono', 'pilares', 'mezcla', 'publicacionesPorDia', 'horas', 'ideaSerie', 'lecciones', 'resumen'],
  properties: {
    nicho: { type: 'string' },
    publico: { type: 'string' },
    tono: { type: 'string' },
    pilares: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['nombre', 'descripcion'], properties: { nombre: { type: 'string' }, descripcion: { type: 'string' } } },
    },
    mezcla: { type: 'object', additionalProperties: false, required: ['narrado', 'serie'], properties: { narrado: { type: 'integer' }, serie: { type: 'integer' } } },
    publicacionesPorDia: { type: 'integer' },
    horas: { type: 'array', items: { type: 'integer' } },
    ideaSerie: { type: 'string' },
    lecciones: { type: 'array', items: { type: 'string' } },
    resumen: { type: 'string' },
  },
};

const IDEA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tipo', 'pilar', 'tema', 'titulo', 'gancho', 'guion', 'voz', 'emocion', 'colores', 'descripcion', 'hashtags', 'porque'],
  properties: {
    tipo: { type: 'string', enum: TIPOS },
    pilar: { type: 'string' },
    tema: { type: 'string' },
    titulo: { type: 'string' },
    gancho: { type: 'string' },
    guion: { type: 'string' },
    voz: { type: 'string' },
    emocion: { type: 'string', enum: EMOCIONES },
    colores: { type: 'array', items: { type: 'string' } },
    descripcion: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    porque: { type: 'string' },
  },
};

const DAY = 86400000;
const fmtInt = (n) => (n === null || n === undefined ? '?' : Math.round(n).toLocaleString('es'));
const edad = (ms, now) => {
  const h = Math.max(0, (now - ms) / 3600000);
  return h < 24 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`;
};

/** Los números de la página, en texto corto para Claude. */
function statsText({ pagina, seguidores = [], publicaciones = [], now = Date.now() }) {
  const last = seguidores[seguidores.length - 1];
  const weekAgo = [...seguidores].reverse().find((p) => now - p.at >= 6.5 * DAY);
  const lines = [`Página: ${pagina || '(sin nombre)'}.`];
  lines.push(last ? `Seguidores ahora: ${fmtInt(last.count)}${weekAgo ? ` (hace una semana: ${fmtInt(weekAgo.count)})` : ''}.` : 'Seguidores: todavía sin datos.');
  const posts = publicaciones.filter((p) => p.publicadoAt).sort((a, b) => b.publicadoAt - a.publicadoAt).slice(0, 30);
  if (!posts.length) {
    lines.push('Todavía no se ha publicado nada: es el comienzo de la página.');
  } else {
    lines.push(`Publicaciones (las más nuevas primero, ${posts.length}):`);
    for (const p of posts) {
      const s = p.stats || {};
      const watch = s.avgWatch ? ` · vista en promedio ${Math.round(s.avgWatch)} s de ${Math.round(p.duracion || 0)} s` : '';
      lines.push(`- [${edad(p.publicadoAt, now)}] ${p.tipo} · pilar "${p.pilar || '-'}" · "${p.titulo}" · ${s.views === null || s.views === undefined ? 'sin números aún' : `${fmtInt(s.views)} vistas`}${watch}`
        + `${s.likes !== null && s.likes !== undefined ? ` · ${fmtInt(s.likes)} reacciones` : ''}${s.comments ? ` · ${fmtInt(s.comments)} comentarios` : ''}${s.shares ? ` · ${fmtInt(s.shares)} compartidos` : ''}`);
    }
  }
  return lines.join('\n');
}

const vocesTexto = (voces) => Object.entries(voces || {}).map(([id, v]) => `- ${id}: ${v.nombre}${v.detalle ? ` (${v.detalle})` : ''}`).join('\n') || '- andres';

function planPrompt({ stats, plan, lecciones = [], config, voces }) {
  return `${stats}

${plan ? `Tu plan actual (de ${new Date(plan.at).toLocaleDateString('es')}):\n${JSON.stringify({ nicho: plan.nicho, publico: plan.publico, pilares: plan.pilares, mezcla: plan.mezcla, publicacionesPorDia: plan.publicacionesPorDia, horas: plan.horas })}` : 'Todavía no tienes plan: es la primera vez.'}
${lecciones.length ? `\nLo que habías aprendido:\n${lecciones.map((l) => `- ${l}`).join('\n')}` : ''}

Voces disponibles para los videos narrados:
${vocesTexto(voces)}

Arma (o corrige) el plan de la página para los próximos días:
- "nicho", "publico" y "tono": a quién le hablas y cómo. Si ya tienes un nicho y los números no son malos, no lo cambies sin motivo.
- "pilares": de 2 a 4 tipos de contenido que se repiten (nombre corto y descripción).
- "mezcla": porcentaje de cada tipo de video (${config.tipos.narrado ? 'narrado' : ''}${config.tipos.narrado && config.tipos.serie ? ' y ' : ''}${config.tipos.serie ? 'serie' : ''}; los que no están disponibles van en 0).
- "publicacionesPorDia": de 1 a ${config.maxDia}.
- "horas": las mejores horas para publicar (números de 0 a 23, hora de la PC del dueño, República Dominicana), tantas como publicaciones por día.
- "ideaSerie": ${config.tipos.serie ? 'la idea de la serie animada (de qué trata, personajes, tono), en 2-4 frases. Si ya existe la serie, repite la idea de antes.' : 'deja ""'}
- "lecciones": hasta 8 frases cortas con lo que te enseñan los números (vacío si aún no hay números).
- "resumen": 2 o 3 frases muy sencillas para el dueño explicando qué vas a hacer y por qué.`;
}

function ideaPrompt({ stats, plan, lecciones = [], recientes = [], config, voces, serie, hoy = {} }) {
  return `${stats}

Tu plan: ${JSON.stringify({ nicho: plan.nicho, publico: plan.publico, tono: plan.tono, pilares: plan.pilares, mezcla: plan.mezcla })}
${lecciones.length ? `Lo que aprendiste:\n${lecciones.map((l) => `- ${l}`).join('\n')}\n` : ''}
${recientes.length ? `Temas que ya hiciste (no los repitas):\n${recientes.map((t) => `- ${t}`).join('\n')}\n` : ''}
${serie ? `Tu serie animada: "${serie.titulo}" (${serie.episodios || 0} episodios hechos).\n` : ''}Hoy ya van: ${hoy.narrado || 0} narrados y ${hoy.serie || 0} episodios.

Tipos que puedes elegir ahora: ${TIPOS.filter((t) => config.tipos[t] && !(t === 'serie' && hoy.serieBloqueada)).join(', ')}.
Voces disponibles:
${vocesTexto(voces)}

Elige el PRÓXIMO video:
- "tipo" y "pilar" según tu plan y los números.
- "tema": de qué trata, en una frase. Para "serie" es el tema del próximo episodio.
- "titulo": máximo 60 letras; sale grande en pantalla los primeros 3 segundos.
- "gancho": la primera línea del texto de la publicación (máximo 120 letras, puede llevar un emoji).
- "guion": solo para "narrado" (para "serie" deja ""): entre 110 y 180 palabras, para leer en voz alta en 40-75 segundos.
  La primera frase engancha sin rodeos. Frases cortas. Sin emojis, sin listas, sin acotaciones; escribe los números en palabras si son cortos.
  Puedes poner [pausa 1] para un silencio. Termina con una frase que invite a seguir la página para más.
- "voz" (una de la lista) y "emocion" con la que lee.
- "colores": 3 colores (#rrggbb) para el fondo animado, que vayan con el tema.
- "descripcion": 1 o 2 frases para el texto de la publicación.
- "hashtags": de 3 a 6, cada uno empezando con #.
- "porque": una frase sencilla para el dueño: por qué este video.`;
}

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const str = (v, max = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Deja el plan en valores válidos (respeta lo que el dueño permitió). */
function normalizePlan(p = {}, config, now = Date.now()) {
  const porDia = clampInt(p.publicacionesPorDia, 1, Math.max(1, config.maxDia), 1);
  // Horas que no existen (30, -1, "x") se descartan en vez de convertirse en 0 o 23.
  let horas = [...new Set((p.horas || []).map((h) => Math.round(Number(h))).filter((h) => Number.isFinite(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
  if (!horas.length) horas = [12, 19, 21];
  let narrado = config.tipos.narrado ? clampInt(p.mezcla?.narrado, 0, 100, 70) : 0;
  let serie = config.tipos.serie ? clampInt(p.mezcla?.serie, 0, 100, 30) : 0;
  if (!narrado && !serie) { narrado = config.tipos.narrado ? 100 : 0; serie = config.tipos.serie ? 100 - narrado : 0; }
  return {
    at: now,
    nicho: str(p.nicho, 200), publico: str(p.publico, 200), tono: str(p.tono, 200),
    pilares: (p.pilares || []).slice(0, 5).map((x) => ({ nombre: str(x.nombre, 60), descripcion: str(x.descripcion, 240) })).filter((x) => x.nombre),
    mezcla: { narrado, serie },
    publicacionesPorDia: porDia,
    horas: horas.slice(0, 6),
    ideaSerie: config.tipos.serie ? str(p.ideaSerie, 800) : '',
    lecciones: (p.lecciones || []).map((l) => str(l, 240)).filter(Boolean).slice(0, 8),
    resumen: str(p.resumen, 600),
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Deja la idea en valores válidos. tiposOk: los tipos que se pueden hacer ahora. voces: { id: {...} }. */
function normalizeIdea(i = {}, { tiposOk, voces }) {
  const tipo = tiposOk.includes(i.tipo) ? i.tipo : tiposOk[0];
  const ids = Object.keys(voces || {});
  const voz = ids.includes(String(i.voz || '').toLowerCase()) ? String(i.voz).toLowerCase() : (ids.includes('andres') ? 'andres' : ids[0] || 'andres');
  const hashtags = [...new Set((i.hashtags || []).map((h) => `#${String(h).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 1))].slice(0, 6);
  return {
    tipo,
    pilar: str(i.pilar, 60),
    tema: str(i.tema, 300),
    titulo: str(i.titulo, 70) || str(i.tema, 60) || 'Nuevo video',
    gancho: str(i.gancho, 140),
    guion: tipo === 'narrado' ? String(i.guion || '').replace(/[ \t]+/g, ' ').trim().slice(0, 2400) : '',
    voz,
    emocion: EMOCIONES.includes(i.emocion) ? i.emocion : 'normal',
    colores: (i.colores || []).filter((c) => HEX.test(String(c).trim())).slice(0, 3),
    descripcion: str(i.descripcion, 500),
    hashtags,
    porque: str(i.porque, 300),
  };
}

/** El texto de la publicación en Facebook. */
function buildCaption(item, { avisoIa = true } = {}) {
  const parts = [item.gancho, item.descripcion, (item.hashtags || []).join(' ')].map((s) => String(s || '').trim()).filter(Boolean);
  if (avisoIa) parts.push(item.tipo === 'serie' ? '🤖 Animación y voces creadas con IA' : '🤖 Voz creada con IA');
  return [...new Set(parts)].join('\n\n').slice(0, 2200);
}

module.exports = {
  systemPrompt, planPrompt, ideaPrompt, statsText, normalizePlan, normalizeIdea, buildCaption,
  PLAN_SCHEMA, IDEA_SCHEMA, EMOCIONES, TIPOS,
};
