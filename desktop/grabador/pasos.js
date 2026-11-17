// Pasos del video para la revisión de Meta y cómo se arman sus subtítulos en inglés.
// Cada paso: es = qué hace la persona (lo lee en el panel), en = subtítulo en inglés (lo lee Meta), perm = permiso que demuestra.
// Los permisos son los que pide ClipViral hoy (server/src/social.js → SCOPES.facebook y SCOPES.instagram).
const { assTime } = require('../engine/subtitles');

const ENTRAR = {
  id: 'entrar',
  es: 'Abre ClipViral (doble clic en su ícono) y entra con tu correo y tu contraseña de ClipViral.',
  en: 'Opening ClipViral, a Windows app for creators, and signing in with a ClipViral account.',
  perm: 'App access',
};

const FACEBOOK = [
  {
    id: 'fb-conectar',
    es: 'Ve a Redes (Networks). Muestra que Facebook dice "Not connected" y toca "Connect Facebook".',
    en: 'Networks screen: Facebook is not connected yet. Clicking "Connect Facebook" opens Facebook Login for Business in the browser.',
    perm: 'Facebook Login for Business',
  },
  {
    id: 'fb-login',
    es: 'En el navegador, inicia sesión en Facebook con tu cuenta (escribe tú la contraseña). Si ya estabas dentro, solo sigue.',
    en: 'Logging in to Facebook with the test account (an administrator of the app).',
    perm: 'Facebook Login for Business',
  },
  {
    id: 'fb-permisos',
    es: 'Acepta los permisos: marca tu página de prueba (y su Instagram si lo pide) y toca Continuar / Guardar.',
    en: 'Granting the permissions: selecting the test Page (and its Instagram account) and confirming.',
    perm: 'pages_show_list, pages_read_engagement, pages_manage_posts, read_insights, instagram_basic',
  },
  {
    id: 'fb-pagina',
    es: 'Sale la página de ClipViral "Choose your Facebook Page". Elige tu página de prueba y toca "Publish to this Page".',
    en: 'ClipViral lists the Pages this person manages. The person chooses the Page where the Reels will be published.',
    perm: 'pages_show_list',
  },
  {
    id: 'fb-conectado',
    es: 'Vuelve a ClipViral. Muestra la tarjeta de Facebook: la página elegida, su foto y el Instagram unido. Abre un momento la lista "Page to publish to".',
    en: 'Back in ClipViral: the connected Page, its picture and its linked Instagram account. The Page can be changed here at any time.',
    perm: 'pages_show_list, pages_read_engagement',
  },
  {
    id: 'fb-crear',
    es: 'En la tarjeta de Facebook toca "Create post" y elige un clip (de 3 a 90 segundos).',
    en: 'Creating a post: choosing the clip to publish as a Reel on the Page.',
    perm: 'pages_manage_posts',
  },
  {
    id: 'fb-programar',
    es: 'Cambia un poco el texto (Caption). Toca "Schedule", elige una hora y toca el botón "Schedule". Muestra que queda "Scheduled" en Posts.',
    en: 'Editing the caption and scheduling the Reel for later. It shows as "Scheduled" in the Posts list and can be cancelled.',
    perm: 'pages_manage_posts',
  },
  {
    id: 'fb-publicar',
    es: 'En Posts, toca "Publish now" en esa publicación. Espera a que diga "Published" (puede tardar 1 o 2 minutos).',
    en: 'Publishing it now: ClipViral uploads the video to the Page with the Reels Publishing API. Status: "Published".',
    perm: 'pages_manage_posts',
  },
  {
    id: 'fb-ver',
    es: 'Toca "View on Facebook". Se abre el Reel en tu página: muéstralo unos segundos (el nombre de la página y el texto).',
    en: 'Opening the post on Facebook: the Reel is live on the Page with the caption written in ClipViral.',
    perm: 'pages_manage_posts',
  },
  {
    id: 'fb-estadisticas',
    es: 'Vuelve a ClipViral → Statistics → Refresh. Muestra las vistas y los "me gusta" del Reel (si es nuevo, puede salir 0).',
    en: 'Statistics: ClipViral reads the plays and reactions of the published Reel from the Page.',
    perm: 'read_insights, pages_read_engagement',
  },
  {
    id: 'fb-competencia',
    es: 'Solo si pediste instagram_basic: ve a Competitors, agrega una cuenta pública de empresa de Instagram (por ejemplo @instagram) y revisa. Si no, toca "Saltar".',
    en: 'Competitors: with the Instagram account linked to the Page, ClipViral shows public likes and comments of a public business account (Business Discovery).',
    perm: 'instagram_basic',
    optional: true,
  },
];

const INSTAGRAM = [
  {
    id: 'ig-conectar',
    es: 'Ve a Redes (Networks). Muestra que Instagram dice "Not connected" y toca "Connect Instagram".',
    en: 'Networks screen: Instagram is not connected yet. Clicking "Connect Instagram" opens Instagram Business Login in the browser.',
    perm: 'Instagram Business Login',
  },
  {
    id: 'ig-login',
    es: 'En el navegador, inicia sesión en Instagram con tu cuenta profesional de prueba (escribe tú la contraseña).',
    en: 'Logging in to Instagram with the test professional account.',
    perm: 'Instagram Business Login',
  },
  {
    id: 'ig-permisos',
    es: 'Muestra la pantalla de permisos y toca "Permitir" (Allow).',
    en: 'Granting the permissions requested by ClipViral.',
    perm: 'instagram_business_basic, instagram_business_content_publish, instagram_business_manage_insights',
  },
  {
    id: 'ig-conectado',
    es: 'Sale "Instagram connected" con tu @usuario. Vuelve a ClipViral y muestra la tarjeta de Instagram: @usuario, foto y tipo de cuenta. Toca "Open profile on Instagram" y vuelve.',
    en: 'Back in ClipViral: the connected account\'s username, profile picture and account type are shown, so the person knows where Reels will be published.',
    perm: 'instagram_business_basic',
  },
  {
    id: 'ig-crear',
    es: 'En la tarjeta de Instagram toca "Create post" y elige un clip.',
    en: 'Creating a post: choosing the clip to publish as a Reel.',
    perm: 'instagram_business_content_publish',
  },
  {
    id: 'ig-publicar',
    es: 'Cambia un poco el texto (Caption) y toca "Publish now". Espera a que diga "Published" (Instagram tarda 1 a 3 minutos).',
    en: 'Editing the caption and publishing now. ClipViral uploads the video and Instagram processes it. Status: "Published".',
    perm: 'instagram_business_content_publish',
  },
  {
    id: 'ig-ver',
    es: 'Toca "View on Instagram". Se abre el Reel: muéstralo unos segundos (tu @usuario y el texto).',
    en: 'Opening the post on Instagram: the Reel is live on the account with the caption written in ClipViral.',
    perm: 'instagram_business_content_publish',
  },
  {
    id: 'ig-programar',
    es: 'Opcional: "Create post" con otro clip → "Schedule" → elige una hora → "Schedule". Muestra que queda "Scheduled" y toca "Cancel". Si no, toca "Saltar".',
    en: 'Scheduling another Reel for later: it stays "Scheduled" in ClipViral and can be cancelled before it is posted.',
    perm: 'instagram_business_content_publish',
    optional: true,
  },
  {
    id: 'ig-estadisticas',
    es: 'Ve a Statistics → Refresh. Muestra las vistas, "me gusta" y comentarios del Reel (si es nuevo, puede salir 0).',
    en: 'Statistics: views, likes and comments of the published Reel, read from the account\'s insights.',
    perm: 'instagram_business_manage_insights',
  },
];

const FIN = {
  id: 'fin',
  es: 'Último paso: vuelve a Redes y muestra el botón "Disconnect" (no hace falta tocarlo). Luego toca "Terminar".',
  en: 'End of the demo. The person can disconnect the account at any time in Networks; ClipViral then deletes its access.',
  perm: null,
};

const VIDEOS = {
  facebook: {
    nombre: 'Facebook',
    titulo: 'Facebook Pages · Reels publishing',
    archivo: 'Facebook',
    pasos: [ENTRAR, ...FACEBOOK, FIN],
  },
  instagram: {
    nombre: 'Instagram',
    titulo: 'Instagram · Reels publishing',
    archivo: 'Instagram',
    pasos: [ENTRAR, ...INSTAGRAM, FIN],
  },
  todo: {
    nombre: 'Facebook e Instagram (uno solo)',
    titulo: 'Facebook Pages and Instagram · Reels publishing',
    archivo: 'Facebook e Instagram',
    pasos: [ENTRAR, ...FACEBOOK, ...INSTAGRAM, FIN],
  },
};

// Para la prueba del kit: 3 pasos cortos que avanzan solos.
const PRUEBA = {
  nombre: 'Prueba',
  titulo: 'Recording kit test',
  archivo: 'Prueba',
  pasos: [ENTRAR, FACEBOOK[0], FACEBOOK[3]],
};

/** Medidas del video final: ancho de hasta 1920 y una franja abajo para los subtítulos (no tapa la pantalla). */
function layout(width, height) {
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const scale = Math.min(1, 1920 / width);
  const W = even(width * scale);
  const H = even(height * scale);
  const bar = even(W * 0.085);
  return { W, H, bar, total: H + bar, font: Math.round(W / 46), small: Math.round(W / 80), gap: Math.round(W * 0.008) };
}

const assText = (t) => String(t ?? '').replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Tramos del video: el paso i va desde que se tocó "Listo" en el paso anterior hasta que se toca en este.
 * marks: segundos en que se tocó "Listo" (o "Saltar") en cada paso. duration: largo del video.
 * Los pasos saltados (o de menos de medio segundo) no salen.
 */
function segments(steps, marks, duration) {
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    const start = i === 0 ? 0 : marks[i - 1];
    if (start === undefined) break;
    // El último paso sigue hasta el final del video (lo que se grabó después de tocar "Terminar").
    const end = Math.min(i === steps.length - 1 ? duration : marks[i] ?? duration, duration);
    if (end - start < 0.5) continue;
    out.push({ n: i + 1, step: steps[i], start, end });
  }
  return out;
}

const stepLabel = (seg, total) => `STEP ${seg.n} OF ${total}${seg.step.perm ? ` · ${seg.step.perm}` : ''}`;
// El primer paso dice además qué video es.
const firstLabel = (video, seg, total) => (seg.n === 1 ? `CLIPVIRAL · ${video.titulo.toUpperCase()} · ${stepLabel(seg, total)}` : stepLabel(seg, total));

/** Subtítulos en inglés (.ass) para la franja de abajo: arriba el paso y el permiso, abajo qué pasa en pantalla. */
function buildAss({ video, marks, duration, width, height }) {
  const { W, H, total, font, small, gap } = layout(width, height);
  const steps = video.pasos;
  const lines = [];
  for (const seg of segments(steps, marks, duration)) {
    const t0 = assTime(seg.start);
    const t1 = assTime(seg.end);
    lines.push(`Dialogue: 1,${t0},${t1},Paso,,0,0,0,,${assText(firstLabel(video, seg, steps.length))}`);
    lines.push(`Dialogue: 1,${t0},${t1},Texto,,0,0,0,,${assText(seg.step.en)}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${total}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Paso,Segoe UI Semibold,${small},&H00FDB5C4,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,${Math.round(W * 0.025)},${Math.round(W * 0.025)},${H + gap + 4},1
Style: Texto,Segoe UI,${font},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,${Math.round(W * 0.025)},${Math.round(W * 0.025)},${H + gap * 2 + small + 6},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

/** Los mismos subtítulos en .srt (por si alguien los quiere aparte). */
function buildSrt({ video, marks, duration }) {
  const t = (s) => {
    const ms = Math.round(Math.max(0, s) * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return segments(video.pasos, marks, duration)
    .map((seg, i) => `${i + 1}\n${t(seg.start)} --> ${t(seg.end)}\n${stepLabel(seg, video.pasos.length)}\n${seg.step.en}\n`)
    .join('\n');
}

/** Lista en español de qué paso va en qué minuto (para revisar el video). */
function buildResumen({ video, marks, duration }) {
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return [`Video para Meta: ${video.nombre}`, '',
    ...segments(video.pasos, marks, duration).map((seg) => `${mmss(seg.start)}–${mmss(seg.end)}  Paso ${seg.n}${seg.step.perm ? ` (${seg.step.perm})` : ''}: ${seg.step.es}`)].join('\r\n');
}

/** FFmpeg: grabar la pantalla principal (sin sonido: Meta no lo escucha). */
function recordArgs({ x, y, width, height, fps = 30, out }) {
  return ['-hide_banner', '-loglevel', 'error', '-stats', '-y',
    '-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1',
    '-offset_x', String(x), '-offset_y', String(y), '-video_size', `${width}x${height}`, '-i', 'desktop',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', String(fps * 2), out];
}

/** FFmpeg: video final con la franja de subtítulos abajo. Se corre en la carpeta de trabajo (subs.ass sin ruta). */
function finalArgs({ input, width, height, out, ass = 'subs.ass' }) {
  const { W, H, total } = layout(width, height);
  const vf = [`scale=${W}:${H}:flags=lanczos`, `pad=${W}:${total}:0:0:color=0x111118`,
    `drawbox=x=0:y=${H}:w=${W}:h=4:color=0x8b5cf6@1:t=fill`, `ass=${ass}`].join(',');
  return ['-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-y', '-i', input,
    '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '26', '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out];
}

module.exports = { VIDEOS, PRUEBA, layout, segments, buildAss, buildSrt, buildResumen, recordArgs, finalArgs };
