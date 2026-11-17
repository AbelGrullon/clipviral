// Sitio público de ClipViral: inicio, política de privacidad, términos y cómo borrar los datos.
// TikTok, Meta y Google piden estas páginas para aprobar la app. Van en español (/privacidad) y en inglés (/privacy),
// porque quienes revisan la app leen inglés. Los datos del responsable salen del panel de admin (Ajustes).
import { Router } from 'express';
import { db, getSetting } from '../db.js';
import { publicUrl } from '../social.js';
import { findDeletion } from '../privacidad.js';

export const LEGAL_UPDATED = { es: '5 de noviembre de 2026', en: 'November 5, 2026' };

const router = Router();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PATHS = {
  es: { home: '/', privacy: '/privacidad', terms: '/terminos', deletion: '/borrar-datos' },
  en: { home: '/en', privacy: '/privacy', terms: '/terms', deletion: '/data-deletion' },
};

const LINKS = {
  musicUsage: 'https://www.tiktok.com/legal/page/global/music-usage-confirmation/en',
  brandedContent: 'https://www.tiktok.com/legal/page/global/bc-policy/en',
  tiktokTerms: 'https://www.tiktok.com/legal/terms-of-service',
  metaTerms: 'https://www.facebook.com/terms.php',
  instagramTerms: 'https://help.instagram.com/581066165581870',
  youtubeTerms: 'https://www.youtube.com/t/terms',
  googlePrivacy: 'https://policies.google.com/privacy',
  googleUserData: 'https://developers.google.com/terms/api-services-user-data-policy',
  googlePermissions: 'https://myaccount.google.com/permissions',
};

/** Datos del responsable. Si falta alguno, se ve marcado para que el admin lo complete. */
function owner(lang) {
  const miss = (es, en) => `<mark>${lang === 'en' ? en : es}</mark>`;
  const email = getSetting('legal_email') || getSetting('support_contact');
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  return {
    name: getSetting('legal_name') ? esc(getSetting('legal_name')) : miss('[nombre del responsable]', '[business name]'),
    country: getSetting('legal_country') ? esc(getSetting('legal_country')) : miss('[país]', '[country]'),
    email: validEmail ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : miss('[correo de contacto]', '[contact email]'),
    web: esc(publicUrl()),
  };
}

const a = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;
const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const section = (title, ...body) => `<section><h2>${title}</h2>${body.join('')}</section>`;
const p = (t) => `<p>${t}</p>`;

function layout(lang, key, title, body) {
  const P = PATHS[lang];
  const other = lang === 'es' ? 'en' : 'es';
  const t = lang === 'es'
    ? { home: 'Inicio', privacy: 'Privacidad', terms: 'Términos', deletion: 'Borrar datos', switch: 'English' }
    : { home: 'Home', privacy: 'Privacy', terms: 'Terms', deletion: 'Data deletion', switch: 'Español' };
  const nav = ['home', 'privacy', 'terms', 'deletion'].map((k) => `<a href="${P[k]}" class="${k === key ? 'on' : ''}">${t[k]}</a>`).join('');
  const o = owner(lang);
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ClipViral</title>
<style>
  :root{--bg:#0b0b14;--card:#141424;--text:#f1f1f7;--muted:#a5a5c0;--line:rgba(255,255,255,.1);--brand:#ec4899;--brand2:#7c3aed}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif}
  a{color:#f9a8d4}
  header{position:sticky;top:0;z-index:2;background:rgba(11,11,20,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .bar{max-width:980px;margin:auto;display:flex;align-items:center;gap:18px;padding:14px 20px;flex-wrap:wrap}
  .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;color:var(--text);text-decoration:none}
  .logo span{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--brand2),var(--brand));font-size:14px}
  nav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
  nav a{color:var(--muted);text-decoration:none;padding:6px 12px;border-radius:8px;font-size:15px}
  nav a.on,nav a:hover{color:var(--text);background:rgba(255,255,255,.07)}
  nav a.lang{border:1px solid var(--line)}
  main{max-width:860px;margin:auto;padding:36px 20px 60px}
  h1{font-size:34px;line-height:1.2;margin:0 0 6px}
  h2{font-size:21px;margin:34px 0 8px}
  .upd{color:var(--muted);margin:0 0 24px}
  li{margin:4px 0}
  mark{background:#facc15;color:#111;padding:0 4px;border-radius:4px}
  .box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:18px 0}
  .box.ok{border-color:rgba(34,197,94,.5)}
  .box.bad{border-color:rgba(248,113,113,.5)}
  .hero{text-align:center;padding:30px 0 10px}
  .hero h1{font-size:44px}
  .hero p{color:var(--muted);font-size:19px;max-width:640px;margin:10px auto 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:26px 0}
  .grid .box{margin:0}
  .grid h3{margin:0 0 6px;font-size:17px}
  .grid p{margin:0;color:var(--muted);font-size:15px}
  .price{font-size:28px;font-weight:800}
  footer{border-top:1px solid var(--line);color:var(--muted);font-size:14px}
  footer .bar{justify-content:space-between}
  footer a{color:var(--muted)}
</style>
</head>
<body>
<header><div class="bar"><a class="logo" href="${P.home}"><span>▶</span>ClipViral</a>
  <nav>${nav}<a class="lang" href="${PATHS[other][key]}" hreflang="${other}">${t.switch}</a></nav></div></header>
<main>${body}</main>
<footer><div class="bar"><span>© ${new Date().getFullYear()} ${o.name} · ClipViral</span>
  <span><a href="${P.privacy}">${t.privacy}</a> · <a href="${P.terms}">${t.terms}</a> · <a href="${P.deletion}">${t.deletion}</a> · ${o.email}</span></div></footer>
</body>
</html>`;
}

// ---------- Inicio ----------
function homeBody(lang) {
  const o = owner(lang);
  const P = PATHS[lang];
  const plans = db.prepare('SELECT name, price_usd, description FROM plans WHERE public = 1 ORDER BY sort').all();
  const es = lang === 'es';
  const features = es ? [
    ['🎯 Encuentra los mejores momentos', 'Mira tu directo o video de YouTube y detecta dónde reaccionó tu audiencia: el chat, el volumen y lo que se dice.'],
    ['💬 Subtítulos animados', 'Cada clip sale en vertical, con subtítulos palabra por palabra y tu marca. Todo se crea en tu propia PC.'],
    ['🕒 Hora y texto para cada red', 'Te dice cuándo conviene subir cada clip y escribe el título, gancho, descripción y hashtags para TikTok, Instagram, YouTube y Facebook.'],
    ['🚀 Publica en tus cuentas', 'Si conectas tus redes, publica en tus propias cuentas a la hora sugerida. En TikTok apruebas cada video antes de que se envíe.'],
    ['📈 Aprende de tus números', 'Lee las vistas de lo que publicaste y ajusta las horas y el largo de los clips a lo que mejor te funciona.'],
    ['🔒 Tú tienes el control', 'Eliges qué se publica y dónde. Puedes apagar la publicación automática, cancelar lo programado o desconectar una red cuando quieras.'],
  ] : [
    ['🎯 Finds the best moments', 'Watches your YouTube live stream or video and detects where your audience reacted: chat activity, volume and what was said.'],
    ['💬 Animated captions', 'Every clip is rendered vertically with word-by-word captions and your own branding. Everything is created on your own PC.'],
    ['🕒 Timing and copy for each network', 'Suggests when to post each clip and writes the title, hook, description and hashtags for TikTok, Instagram, YouTube and Facebook.'],
    ['🚀 Posts to your accounts', 'If you connect your accounts, ClipViral posts to your own profiles at the suggested time. On TikTok you review and approve every video before it is sent.'],
    ['📈 Learns from your results', 'Reads the views of what you posted and adapts posting times and clip length to what works best for you.'],
    ['🔒 You stay in control', 'You choose what is posted and where. Turn automatic posting off, cancel scheduled posts or disconnect an account at any time.'],
  ];
  const steps = es
    ? ['Pega el enlace de tu directo o video (o deja que el Piloto vigile tus canales).', 'ClipViral crea los clips con subtítulos y los deja en <b>Clips sugeridos</b> con la hora y el texto de cada red.', 'Publícalos tú, o enciende la publicación automática en las redes que conectaste.']
    : ['Paste the link to your live stream or video (or let the Autopilot watch your channels).', 'ClipViral creates captioned clips and lists them in <b>Suggested clips</b> with the posting time and copy for each network.', 'Post them yourself, or turn on automatic posting for the accounts you connected.'];
  return `
  <div class="hero"><h1>${es ? 'Convierte tus directos en clips virales' : 'Turn your live streams into viral clips'}</h1>
    <p>${es ? 'ClipViral es un programa para Windows que saca los mejores momentos de tus directos y videos de YouTube, les pone subtítulos y los deja listos para TikTok, Instagram Reels, YouTube Shorts y Facebook Reels.'
    : 'ClipViral is a Windows app for creators. It finds the best moments of your YouTube live streams and videos, adds captions and gets them ready for TikTok, Instagram Reels, YouTube Shorts and Facebook Reels.'}</p></div>
  <div class="grid">${features.map(([t, d]) => `<div class="box"><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
  ${section(es ? 'Cómo funciona' : 'How it works', `<ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`)}
  ${section(es ? 'Para quién es' : 'Who it is for',
    p(es ? 'Para creadores que quieren sacar clips de <b>su propio contenido</b>, y para editores y agencias que trabajan con permiso de los creadores. ClipViral no está hecho para copiar contenido de otras personas: cada usuario acepta que solo publica lo que es suyo o lo que tiene permiso de usar.'
      : 'For creators who want to clip <b>their own content</b>, and for editors and agencies working with the creators\' permission. ClipViral is not meant for re-posting other people\'s content: every user agrees to only publish content they own or are authorized to use.'))}
  ${plans.length ? section(es ? 'Planes' : 'Plans', `<div class="grid">${plans.map((pl) => `<div class="box"><h3>${esc(pl.name)}</h3><div class="price">US$ ${Number(pl.price_usd).toFixed(0)}<small style="font-size:14px;color:var(--muted)">${es ? '/mes' : '/month'}</small></div><p>${esc(pl.description)}</p></div>`).join('')}</div>`) : ''}
  ${section(es ? 'Contacto' : 'Contact', p(`${o.name} · ${o.country} · ${o.email}`),
    p(`<a href="${P.privacy}">${es ? 'Política de privacidad' : 'Privacy Policy'}</a> · <a href="${P.terms}">${es ? 'Términos del servicio' : 'Terms of Service'}</a> · <a href="${P.deletion}">${es ? 'Cómo borrar tus datos' : 'How to delete your data'}</a>`))}`;
}

// ---------- Política de privacidad ----------
function privacyBody(lang) {
  const o = owner(lang);
  const del = `${o.web}${PATHS[lang].deletion}`;
  if (lang === 'en') {
    return `<h1>ClipViral Privacy Policy</h1><p class="upd">Last updated: ${LEGAL_UPDATED.en}</p>
    ${section('1. Who we are', p(`ClipViral is a Windows app that helps content creators turn their live streams and long videos into short captioned clips and publish them to their own TikTok, Instagram, Facebook and YouTube accounts. The data controller is ${o.name} (${o.country}). Contact: ${o.email}.`))}
    ${section('2. Data we collect', list([
      '<b>Your ClipViral account:</b> name, email address, password (stored only as a scrypt hash), plan, sign-in dates and the name of the computer you sign in from.',
      '<b>AI usage:</b> how many minutes of video were analyzed with AI and the cost, to enforce your plan limits.',
      '<b>Accounts you connect</b> (only if you connect them): your account or Page ID, name and profile picture, and the access tokens the platform gives us. Tokens are stored encrypted (AES-256-GCM) on our server.'
      + list([
        '<b>TikTok:</b> your open_id, display name and avatar (<code>user.info.basic</code>); follower count and the view, like, comment and share counts of the videos you posted with ClipViral (<code>user.info.stats</code>, <code>video.list</code>); permission to publish the videos you approve (<code>video.publish</code>). Before each TikTok post we read your nickname, avatar, available privacy options and interaction settings (creator info) to show them on the posting screen.',
        '<b>Instagram:</b> ID, username and profile picture of your professional account, permission to publish Reels, and the insights of the Reels you posted with ClipViral.',
        '<b>Facebook:</b> your app-scoped user ID, the Pages you manage (ID, name, picture and Page token), the Instagram account linked to the Page, and the insights of the Reels you posted with ClipViral.',
        '<b>YouTube:</b> your channel ID, name and picture, permission to upload videos and read their statistics.',
      ]),
      '<b>Publishing log:</b> which network you posted to and whether it succeeded (not the content itself).',
    ]))}
    ${section('3. What we do NOT store on our server', p('Your videos, clips, transcripts and statistics are processed and stored on your own PC. Clips are uploaded directly from your PC to each platform. The only exception: if Instagram does not accept the direct upload, the clip is temporarily stored on our server only so Instagram can fetch it, and it is deleted as soon as it is published (or after 24 hours at most).'))}
    ${section('4. How we use your data', list([
      'To give you access to ClipViral and manage your plan.',
      'To publish to your accounts only the clips you choose, at the time you choose or that we suggest. On TikTok you review and approve every video (privacy, interactions and commercial content disclosure) before anything is sent.',
      'To show you how your posts perform and suggest the best posting times.',
      'To provide support and notify you about important changes.',
    ]), p('We do not sell your data, we do not use it for advertising, and we do not share it with anyone for any other purpose.'))}
    ${section('5. Who we share data with', list([
      '<b>The platforms you connect</b> (TikTok, Meta, Google/YouTube): they receive the videos and text you publish, under their own policies.',
      '<b>Anthropic (Claude)</b>, only if your plan uses AI: it receives transcripts of the analyzed segments, titles and the public competitor data you add, to pick the best moments and write post copy. It never receives your tokens or account data.',
      '<b>Our hosting provider</b>, which stores the database.',
      '<b>Authorities</b>, only when required by law.',
    ]))}
    ${section('6. Google and YouTube data', p(`ClipViral uses YouTube API Services. By connecting YouTube you also agree to the ${a(LINKS.youtubeTerms, 'YouTube Terms of Service')}, and Google's handling of your data is described in the ${a(LINKS.googlePrivacy, 'Google Privacy Policy')}. ClipViral's use and transfer to any other app of information received from Google APIs will adhere to the ${a(LINKS.googleUserData, 'Google API Services User Data Policy')}, including the Limited Use requirements. You can revoke ClipViral's access at any time from ${a(LINKS.googlePermissions, 'your Google account permissions page')}.`))}
    ${section('7. How long we keep it', list([
      '<b>Account:</b> while you have it.',
      '<b>Connected accounts:</b> until you disconnect them, remove ClipViral\'s access from the platform, or delete your account. Disconnecting deletes the tokens immediately (on TikTok they are also revoked).',
      '<b>Temporary Instagram videos:</b> until published, 24 hours at most.',
      '<b>Deletion requests:</b> we keep only the confirmation code and date, with no personal data.',
    ]))}
    ${section('8. How to delete your data', list([
      'Disconnect any network in the app (Networks section): its tokens are deleted immediately.',
      'Remove ClipViral\'s access from the platform (TikTok: Settings → Security → Apps; Instagram: Settings → Website permissions → Apps and websites; Facebook: Settings → Business integrations / Apps and websites). The platform notifies us and we delete that connection automatically.',
      `To delete your whole ClipViral account, email ${o.email} from your registered address. We do it within 30 days.`,
    ]), p(`More details: ${a(del, del)}`))}
    ${section('9. Security', p('Encrypted connections (HTTPS), scrypt password hashing, AES-256-GCM encrypted tokens and restricted server access.'))}
    ${section('10. Your rights', p(`You can ask to access, correct, export or delete your data, or object to its use, by writing to ${o.email}. We reply within 30 days.`))}
    ${section('11. Children', p('ClipViral is not intended for people under 18.'))}
    ${section('12. Changes', p('If we change this policy we will update the date above and, for important changes, notify you in the app.'))}`;
  }
  return `<h1>Política de privacidad de ClipViral</h1><p class="upd">Última actualización: ${LEGAL_UPDATED.es}</p>
  ${section('1. Quiénes somos', p(`ClipViral es un programa para Windows que ayuda a creadores de contenido a convertir sus directos y videos largos en clips cortos con subtítulos, y a publicarlos en sus propias cuentas de TikTok, Instagram, Facebook y YouTube. El responsable de tus datos es ${o.name} (${o.country}). Contacto: ${o.email}.`))}
  ${section('2. Qué datos recogemos', list([
    '<b>Tu cuenta de ClipViral:</b> nombre, correo, contraseña (guardada solo como hash scrypt; nunca la vemos), plan, fechas de acceso y el nombre de la PC desde la que entras.',
    '<b>Uso de la IA:</b> cuántos minutos de video se analizaron con IA y su costo, para controlar el límite de tu plan.',
    '<b>Redes que conectas</b> (solo si las conectas): el ID, nombre y foto de tu cuenta o página, y los permisos de acceso (tokens) que nos da la red. Los tokens se guardan cifrados (AES-256-GCM) en nuestro servidor.'
    + list([
      '<b>TikTok:</b> tu open_id, apodo y foto (<code>user.info.basic</code>); seguidores y las vistas, "me gusta", comentarios y compartidos de los videos que publicaste con ClipViral (<code>user.info.stats</code>, <code>video.list</code>); permiso para publicar los videos que apruebas (<code>video.publish</code>). Antes de cada publicación leemos tu apodo, foto, opciones de privacidad y ajustes de interacción (creator info) para mostrarlos en la pantalla de publicación.',
      '<b>Instagram:</b> ID, usuario y foto de tu cuenta profesional, permiso para publicar Reels y las estadísticas de los Reels que publicaste con ClipViral.',
      '<b>Facebook:</b> tu ID de usuario en la app, las páginas que administras (ID, nombre, foto y token de la página), el Instagram unido a la página y las estadísticas de los Reels que publicaste con ClipViral.',
      '<b>YouTube:</b> ID, nombre y foto de tu canal, permiso para subir videos y leer sus estadísticas.',
    ]),
    '<b>Registro de publicaciones:</b> en qué red publicaste y si salió bien (no el contenido).',
  ]))}
  ${section('3. Qué NO guardamos en el servidor', p('Tus videos, clips, transcripciones y estadísticas se procesan y se guardan en tu propia PC. Los clips se suben directo desde tu PC a cada red. La única excepción: si Instagram no acepta la subida directa, el clip pasa por nuestro servidor solo para que Instagram lo descargue, y se borra apenas se publica (o a las 24 horas como máximo).'))}
  ${section('4. Para qué usamos tus datos', list([
    'Darte acceso a ClipViral y controlar tu plan.',
    'Publicar en tus cuentas solo los clips que tú eliges, a la hora que eliges o que te sugerimos. En TikTok revisas y apruebas cada video (privacidad, interacciones y aviso de contenido comercial) antes de que se envíe.',
    'Mostrarte cómo les va a tus publicaciones y sugerirte las mejores horas.',
    'Darte soporte y avisarte de cambios importantes.',
  ]), p('No vendemos tus datos, no los usamos para publicidad y no los compartimos con nadie para otros fines.'))}
  ${section('5. Con quién compartimos datos', list([
    '<b>Las redes que conectas</b> (TikTok, Meta, Google/YouTube): reciben los videos y textos que publicas, según sus propias políticas.',
    '<b>Anthropic (Claude)</b>, solo si tu plan usa IA: recibe la transcripción de los fragmentos que se analizan, los títulos y los datos públicos de la competencia que agregas, para elegir los mejores momentos y escribir los textos. Nunca recibe tus tokens ni tus datos de cuenta.',
    '<b>Nuestro proveedor de servidores</b>, que guarda la base de datos.',
    '<b>Autoridades</b>, solo si la ley lo exige.',
  ]))}
  ${section('6. Datos de Google y YouTube', p(`ClipViral usa los servicios de API de YouTube. Al conectar YouTube también aceptas las ${a(LINKS.youtubeTerms, 'Condiciones de servicio de YouTube')}, y Google trata tus datos según la ${a(LINKS.googlePrivacy, 'Política de privacidad de Google')}. El uso y la transferencia a cualquier otra app de la información recibida de las API de Google se ajustará a la ${a(LINKS.googleUserData, 'Política de datos de usuario de los servicios de API de Google')}, incluidos los requisitos de uso limitado. Puedes quitarle el acceso a ClipViral cuando quieras desde ${a(LINKS.googlePermissions, 'los permisos de tu cuenta de Google')}.`))}
  ${section('7. Cuánto tiempo los guardamos', list([
    '<b>Cuenta:</b> mientras la tengas.',
    '<b>Redes conectadas:</b> hasta que las desconectes, le quites el permiso a ClipViral desde la red o borres tu cuenta. Al desconectar se borran los tokens al instante (en TikTok además se anulan).',
    '<b>Videos de paso para Instagram:</b> hasta que se publican, 24 horas como máximo.',
    '<b>Pedidos de borrado:</b> solo guardamos el código y la fecha, sin datos personales.',
  ]))}
  ${section('8. Cómo borrar tus datos', list([
    'Desconecta cualquier red en la app (sección Redes): sus tokens se borran al instante.',
    'Quítale el permiso a ClipViral desde la red (TikTok: Configuración → Seguridad → Apps; Instagram: Configuración → Permisos de sitios web → Apps y sitios web; Facebook: Configuración → Integraciones comerciales / Apps y sitios web). La red nos avisa y borramos esa conexión automáticamente.',
    `Para borrar toda tu cuenta de ClipViral, escribe a ${o.email} desde tu correo registrado. Lo hacemos en 30 días como máximo.`,
  ]), p(`Más detalles: ${a(del, del)}`))}
  ${section('9. Seguridad', p('Conexión cifrada (HTTPS), contraseñas con hash scrypt, tokens cifrados con AES-256-GCM y acceso restringido al servidor.'))}
  ${section('10. Tus derechos', p(`Puedes pedir ver, corregir, llevarte o borrar tus datos, u oponerte a su uso, escribiendo a ${o.email}. Respondemos en 30 días como máximo.`))}
  ${section('11. Menores', p('ClipViral no está dirigido a menores de 18 años.'))}
  ${section('12. Cambios', p('Si cambiamos esta política, actualizaremos la fecha de arriba y, si el cambio es importante, te avisaremos en la app.'))}`;
}

// ---------- Términos del servicio ----------
function termsBody(lang) {
  const o = owner(lang);
  if (lang === 'en') {
    return `<h1>ClipViral Terms of Service</h1><p class="upd">Last updated: ${LEGAL_UPDATED.en}</p>
    ${section('1. Acceptance', p(`By creating an account or using ClipViral you agree to these terms. ClipViral is provided by ${o.name} (${o.country}).`))}
    ${section('2. The service', p('ClipViral is a Windows app that finds the best moments of live streams and videos, creates captioned clips, suggests posting times and copy, and, if you connect your accounts, publishes the clips to them. Some features use artificial intelligence.'))}
    ${section('3. Your account', p('You must provide accurate information, keep your password safe and be at least 18 years old. You are responsible for activity on your account.'))}
    ${section('4. Plans and payments', p('Prices are shown in the app and on this website. A plan is active for the period you paid for; you can stop renewing at any time. Free trials may be limited in time and features.'))}
    ${section('5. Your content and rights', p('You may only clip and publish content that you own or are authorized to use. You are solely responsible for what you publish and for respecting copyright, other people\'s privacy and the rules of each platform. ClipViral claims no rights over your clips.'))}
    ${section('6. Publishing to your accounts', p(`ClipViral only publishes to accounts you connect and only what you choose. With automatic posting turned on, Instagram and Facebook post your suggested clips at the suggested time using the copy prepared for that network. On TikTok you review and approve every video (privacy, interactions and commercial content disclosure) before it is sent, and it is then posted at the time you chose. You can turn automatic posting off, cancel scheduled posts and disconnect your accounts at any time. By posting to TikTok you agree to TikTok's ${a(LINKS.musicUsage, 'Music Usage Confirmation')} and, for branded content, its ${a(LINKS.brandedContent, 'Branded Content Policy')}. The terms of each platform also apply: ${a(LINKS.tiktokTerms, 'TikTok')}, ${a(LINKS.metaTerms, 'Facebook')}, ${a(LINKS.instagramTerms, 'Instagram')} and ${a(LINKS.youtubeTerms, 'YouTube')}.`))}
    ${section('7. Prohibited use', list([
      'Publishing illegal, misleading or infringing content, or content you have no rights to.',
      'Spam, or using ClipViral to break the rules of any platform.',
      'Trying to access other users\' data, attack or reverse engineer the service.',
      'Reselling or sharing your account without permission.',
    ]))}
    ${section('8. Artificial intelligence', p('Titles, captions, scores and suggested times are suggestions. Review them before publishing.'))}
    ${section('9. Availability', p('We work to keep ClipViral available, but there may be interruptions. Platforms may change their APIs, limit posting or reject content at any time.'))}
    ${section('10. Liability', p('ClipViral is provided "as is". We do not guarantee views or results. To the extent permitted by law, our total liability is limited to the amount you paid in the last three months.'))}
    ${section('11. Suspension and cancellation', p('We may suspend accounts that break these terms. You can stop using ClipViral and ask us to delete your account at any time.'))}
    ${section('12. Changes', p('We may update these terms; we will update the date above and notify you in the app of important changes.'))}
    ${section('13. Governing law', p(`These terms are governed by the laws of ${o.country}.`))}
    ${section('14. Contact', p(o.email))}`;
  }
  return `<h1>Términos del servicio de ClipViral</h1><p class="upd">Última actualización: ${LEGAL_UPDATED.es}</p>
  ${section('1. Aceptación', p(`Al crear una cuenta o usar ClipViral aceptas estos términos. ClipViral lo ofrece ${o.name} (${o.country}).`))}
  ${section('2. El servicio', p('ClipViral es un programa para Windows que encuentra los mejores momentos de directos y videos, crea clips con subtítulos, sugiere horas y textos para publicar y, si conectas tus cuentas, los publica en ellas. Algunas funciones usan inteligencia artificial.'))}
  ${section('3. Tu cuenta', p('Debes dar datos reales, cuidar tu contraseña y tener al menos 18 años. Eres responsable de lo que se haga con tu cuenta.'))}
  ${section('4. Planes y pagos', p('Los precios se muestran en la app y en este sitio. El plan queda activo por el tiempo que pagaste; puedes dejar de renovarlo cuando quieras. La prueba gratis puede tener límites de tiempo y funciones.'))}
  ${section('5. Tu contenido y tus derechos', p('Solo puedes clipear y publicar contenido que sea tuyo o que tengas permiso de usar. Tú eres el único responsable de lo que publicas y de respetar los derechos de autor, la privacidad de otras personas y las reglas de cada red. ClipViral no reclama ningún derecho sobre tus clips.'))}
  ${section('6. Publicación en tus cuentas', p(`ClipViral publica solo en las cuentas que conectas y solo lo que eliges. Con la publicación automática encendida, Instagram y Facebook publican tus clips sugeridos a la hora sugerida con el texto preparado para esa red. En TikTok revisas y apruebas cada video (privacidad, interacciones y aviso de contenido comercial) antes de que se envíe, y luego se publica a la hora que elegiste. Puedes apagar la publicación automática, cancelar lo programado y desconectar tus cuentas cuando quieras. Al publicar en TikTok aceptas la ${a(LINKS.musicUsage, 'Confirmación de uso de música')} de TikTok y, si es contenido de marca, su ${a(LINKS.brandedContent, 'Política de contenido de marca')}. También aplican los términos de cada red: ${a(LINKS.tiktokTerms, 'TikTok')}, ${a(LINKS.metaTerms, 'Facebook')}, ${a(LINKS.instagramTerms, 'Instagram')} y ${a(LINKS.youtubeTerms, 'YouTube')}.`))}
  ${section('7. Usos prohibidos', list([
    'Publicar contenido ilegal, engañoso, que infrinja derechos o que no tengas permiso de usar.',
    'Hacer spam o usar ClipViral para romper las reglas de cualquier red.',
    'Intentar entrar a datos de otros usuarios, atacar o desarmar el servicio.',
    'Revender o compartir tu cuenta sin permiso.',
  ]))}
  ${section('8. Inteligencia artificial', p('Los títulos, textos, notas y horas sugeridas son sugerencias. Revísalos antes de publicar.'))}
  ${section('9. Disponibilidad', p('Hacemos lo posible para que ClipViral funcione siempre, pero puede haber cortes. Las redes pueden cambiar sus API, limitar publicaciones o rechazar contenido en cualquier momento.'))}
  ${section('10. Responsabilidad', p('ClipViral se ofrece "tal cual". No garantizamos vistas ni resultados. En la medida que permita la ley, nuestra responsabilidad total se limita a lo que pagaste en los últimos tres meses.'))}
  ${section('11. Suspensión y baja', p('Podemos suspender cuentas que no cumplan estos términos. Puedes dejar de usar ClipViral y pedirnos que borremos tu cuenta cuando quieras.'))}
  ${section('12. Cambios', p('Podemos actualizar estos términos; cambiaremos la fecha de arriba y te avisaremos en la app de los cambios importantes.'))}
  ${section('13. Ley aplicable', p(`Estos términos se rigen por las leyes de ${o.country}.`))}
  ${section('14. Contacto', p(o.email))}`;
}

// ---------- Borrar datos ----------
const NET_NAME = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

function deletionBody(lang, code) {
  const o = owner(lang);
  const es = lang === 'es';
  let status = '';
  if (code) {
    const r = findDeletion(code);
    if (r) {
      const when = new Date(`${r.created_at.replace(' ', 'T')}Z`).toLocaleString(es ? 'es' : 'en', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });
      status = `<div class="box ok"><b>${es ? 'Pedido' : 'Request'} ${esc(r.code)}: ${es ? 'completado' : 'completed'}</b><br>
        ${es ? `El ${when} (UTC) borramos ${r.accounts} conexión(es) de ${NET_NAME[r.platform] || esc(r.platform)} con sus tokens. No queda ningún dato de esa cuenta en nuestro servidor.`
    : `On ${when} (UTC) we deleted ${r.accounts} ${NET_NAME[r.platform] || esc(r.platform)} connection(s) and their tokens. No data from that account remains on our server.`}</div>`;
    } else {
      status = `<div class="box bad">${es ? 'No encontramos ese código de confirmación. Revísalo o escríbenos a' : 'We could not find that confirmation code. Please check it or write to'} ${o.email}.</div>`;
    }
  }
  if (!es) {
    return `<h1>How to delete your data</h1><p class="upd">Last updated: ${LEGAL_UPDATED.en}</p>${status}
    ${section('Option 1: from the ClipViral app', p('Open ClipViral → <b>Networks</b> → <b>Disconnect</b> on the account. Its access tokens are deleted from our server immediately (on TikTok they are also revoked).'))}
    ${section('Option 2: from the social network', list([
      '<b>TikTok:</b> Profile → Menu → Settings and privacy → Security → Apps and services → ClipViral → Remove access.',
      '<b>Instagram:</b> Settings → Website permissions → Apps and websites → ClipViral → Remove.',
      '<b>Facebook:</b> Settings and privacy → Settings → Business integrations (or Apps and websites) → ClipViral → Remove. You can also choose "Send request" to ask for your data to be deleted.',
    ]), p('The network notifies us automatically and we delete that connection and its tokens. For Facebook and Instagram you get a confirmation code you can check on this page.'))}
    ${section('Option 3: delete your whole ClipViral account', p(`Email ${o.email} from the address you registered with, subject "Delete my account". Within 30 days we delete your account, connected networks, AI usage history and publishing log.`))}
    ${section('Data on your PC', p('Clips, transcripts and statistics live on your own computer. Delete clips from <b>My clips</b> or delete the <code>Videos\\ClipViral</code> folder. Uninstalling the app and deleting the <code>%APPDATA%\\ClipViral</code> folder removes the rest.'))}
    ${section('Check a request', `<form method="get" action="${PATHS.en.deletion}"><input name="code" placeholder="Confirmation code" style="padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)"> <button style="padding:9px 14px;border-radius:8px;border:0;background:var(--brand);color:#fff;font-weight:700">Check</button></form>`)}`;
  }
  return `<h1>Cómo borrar tus datos</h1><p class="upd">Última actualización: ${LEGAL_UPDATED.es}</p>${status}
  ${section('Opción 1: desde la app ClipViral', p('Abre ClipViral → <b>Redes</b> → <b>Desconectar</b> en la cuenta. Sus tokens de acceso se borran de nuestro servidor al instante (en TikTok además se anulan).'))}
  ${section('Opción 2: desde la red social', list([
    '<b>TikTok:</b> Perfil → Menú → Configuración y privacidad → Seguridad → Apps y servicios → ClipViral → Quitar acceso.',
    '<b>Instagram:</b> Configuración → Permisos de sitios web → Apps y sitios web → ClipViral → Eliminar.',
    '<b>Facebook:</b> Configuración y privacidad → Configuración → Integraciones comerciales (o Apps y sitios web) → ClipViral → Eliminar. También puedes tocar "Enviar solicitud" para pedir que borremos tus datos.',
  ]), p('La red nos avisa sola y borramos esa conexión con sus tokens. En Facebook e Instagram recibes un código de confirmación que puedes revisar en esta página.'))}
  ${section('Opción 3: borrar toda tu cuenta de ClipViral', p(`Escribe a ${o.email} desde el correo con el que te registraste, con el asunto "Borrar mi cuenta". En 30 días como máximo borramos tu cuenta, tus redes conectadas, tu historial de uso de IA y tu registro de publicaciones.`))}
  ${section('Lo que está en tu PC', p('Los clips, transcripciones y estadísticas están en tu propia computadora. Borra clips desde <b>Mis clips</b> o borra la carpeta <code>Videos\\ClipViral</code>. Al desinstalar la app y borrar la carpeta <code>%APPDATA%\\ClipViral</code> se va el resto.'))}
  ${section('Revisar un pedido', `<form method="get" action="${PATHS.es.deletion}"><input name="codigo" placeholder="Código de confirmación" style="padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text)"> <button style="padding:9px 14px;border-radius:8px;border:0;background:var(--brand);color:#fff;font-weight:700">Revisar</button></form>`)}`;
}

const PAGES = {
  home: { title: { es: 'Clips virales de tus directos', en: 'Viral clips from your live streams' }, body: (lang) => homeBody(lang) },
  privacy: { title: { es: 'Política de privacidad', en: 'Privacy Policy' }, body: (lang) => privacyBody(lang) },
  terms: { title: { es: 'Términos del servicio', en: 'Terms of Service' }, body: (lang) => termsBody(lang) },
  deletion: { title: { es: 'Borrar tus datos', en: 'Data deletion' }, body: (lang, req) => deletionBody(lang, req.query.codigo || req.query.code) },
};

for (const lang of ['es', 'en']) {
  for (const [key, pg] of Object.entries(PAGES)) {
    router.get(PATHS[lang][key], (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(layout(lang, key, pg.title[lang], pg.body(lang, req)));
    });
  }
}

export default router;
