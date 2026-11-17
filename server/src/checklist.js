// Lista de lo que falta para pedir los permisos de cada red, con las direcciones listas para copiar (panel de admin).
import { getSetting } from './db.js';
import { publicUrl, publicLinks, redirectUri, SCOPES } from './social.js';

const has = (key) => !!String(getSetting(key) || '').trim();

/**
 * Cada red: { name, ready, total, items: [{ label, ok, copy?, where?, optional? }] }.
 * ok: true (listo), false (falta) o null (solo hay que copiarlo en la red).
 */
export function socialChecklist() {
  const base = publicUrl();
  const https = /^https:\/\//.test(base) && !/localhost|127\.0\.0\.1/.test(base);
  const L = publicLinks();
  // Las direcciones solo sirven si el servidor es público con https.
  const url = (label, copy, where) => ({ label, copy, where, ok: https ? null : false });

  const common = [
    { label: 'Dirección pública del servidor con https', ok: https, copy: base, where: 'Panel de admin → Ajustes → Conexión con redes', help: https ? '' : 'Para usar las redes con todos (y para pedir la revisión) hace falta una dirección https pública. Mientras la app de Meta está en modo desarrollo, Facebook acepta http://localhost; Instagram pide https (ver GUION-VIDEO-META.md).' },
    { label: 'Nombre del responsable (persona o negocio)', ok: has('legal_name'), where: 'Panel de admin → Ajustes → Datos para las páginas legales' },
    { label: 'Correo de contacto para privacidad', ok: /@/.test(getSetting('legal_email') || ''), where: 'Panel de admin → Ajustes → Datos para las páginas legales' },
    { label: 'País (ley que aplica a los términos)', ok: has('legal_country'), where: 'Panel de admin → Ajustes → Datos para las páginas legales' },
    url('Página de inicio (sitio web de la app)', L.homeEn, 'Sitio web de la app en TikTok, Meta y Google'),
    url('Política de privacidad (inglés, con botón a español)', L.privacyEn, 'Privacy Policy URL de cada red'),
    url('Términos del servicio (inglés, con botón a español)', L.termsEn, 'Terms of Service URL de cada red'),
    url('Instrucciones para borrar datos', L.deletionEn, 'Data deletion instructions URL'),
  ];

  const networks = {
    tiktok: {
      name: 'TikTok',
      items: [
        { label: 'Client key', ok: has('tiktok_client_key'), where: 'developers.tiktok.com → tu app → App details' },
        { label: 'Client secret', ok: has('tiktok_client_secret'), where: 'developers.tiktok.com → tu app → App details' },
        url('Redirect URI (Login Kit → Web)', redirectUri('tiktok'), 'Products → Login Kit → Redirect URI'),
        url('Web/Desktop URL', L.homeEn, 'App details → Platforms → Web'),
        url('Terms of Service URL', L.termsEn, 'App details → Terms of Service URL'),
        url('Privacy Policy URL', L.privacyEn, 'App details → Privacy Policy URL'),
        url('Webhook callback URL', L.tiktokWebhook, 'Products → Webhooks → Callback URL'),
        { label: 'Permisos (scopes) a pedir', ok: null, copy: SCOPES.tiktok.join(', '), where: 'Scopes: marca solo estos (quita video.upload si está marcado)' },
        { label: 'Content Posting API con "Direct Post" activado', ok: null, where: 'Products → Content Posting API → Direct Post: ON' },
      ],
    },
    instagram: {
      name: 'Instagram',
      items: [
        { label: 'ID de la app de Instagram', ok: has('instagram_app_id'), where: 'developers.facebook.com → tu app → Instagram → Configuración de la API con inicio de sesión de Instagram' },
        { label: 'Clave secreta de la app de Instagram', ok: has('instagram_app_secret'), where: 'El mismo lugar (botón "Mostrar")' },
        url('URI de redireccionamiento de OAuth', redirectUri('instagram'), 'Instagram → Configurar el inicio de sesión para empresas → URI de redireccionamiento de OAuth'),
        url('URL de devolución de llamada para cancelar autorización (Deauthorize)', L.igDeauthorize, 'Instagram → Configurar el inicio de sesión para empresas → Deauthorize callback URL'),
        url('URL de solicitud de eliminación de datos (Data deletion)', L.igDataDeletion, 'Instagram → Configurar el inicio de sesión para empresas → Data deletion request URL'),
        url('URL de la política de privacidad', L.privacyEn, 'Configuración de la app → Básica → URL de la política de privacidad'),
        url('URL de las condiciones del servicio', L.termsEn, 'Configuración de la app → Básica → URL de las condiciones del servicio'),
        { label: 'Permisos a pedir en la revisión', ok: null, copy: SCOPES.instagram.join(', '), where: 'Revisión de la app → Permisos y funciones' },
      ],
    },
    facebook: {
      name: 'Facebook',
      items: [
        { label: 'ID de la app', ok: has('facebook_app_id'), where: 'developers.facebook.com → tu app → Configuración de la app → Básica' },
        { label: 'Clave secreta de la app', ok: has('facebook_app_secret'), where: 'Configuración de la app → Básica (botón "Mostrar")' },
        { label: 'ID de configuración (Inicio de sesión con Facebook para empresas)', ok: has('facebook_config_id') || null, optional: true, where: 'Inicio de sesión con Facebook para empresas → Configuraciones → Crear (token de usuario, con los permisos de abajo)' },
        url('URI de redireccionamiento de OAuth válido', redirectUri('facebook'), 'Inicio de sesión con Facebook para empresas → Configuración → URI de redireccionamiento de OAuth válidos'),
        url('URL de devolución de llamada para cancelar autorización (Deauthorize)', L.fbDeauthorize, 'Inicio de sesión con Facebook para empresas → Configuración → Cancelar autorización'),
        url('URL de solicitud de eliminación de datos (Data deletion)', L.fbDataDeletion, 'Configuración de la app → Básica → Eliminación de datos de usuario → URL de devolución de llamada'),
        url('URL de la política de privacidad', L.privacyEn, 'Configuración de la app → Básica'),
        url('URL de las condiciones del servicio', L.termsEn, 'Configuración de la app → Básica'),
        { label: 'Permisos a pedir en la revisión', ok: null, copy: SCOPES.facebook.join(', '), where: 'Revisión de la app → Permisos y funciones (y en la configuración de inicio de sesión)' },
      ],
    },
    youtube: {
      name: 'YouTube (subida manual)',
      items: [
        { label: 'ID de cliente', ok: has('google_client_id'), where: 'console.cloud.google.com → Credenciales' },
        { label: 'Secreto de cliente', ok: has('google_client_secret'), where: 'console.cloud.google.com → Credenciales' },
        url('URI de redireccionamiento autorizado', redirectUri('youtube'), 'Credenciales → ID de cliente OAuth → URI de redireccionamiento autorizados'),
        url('Página principal de la aplicación', L.homeEn, 'Pantalla de consentimiento de OAuth → Página principal'),
        url('Vínculo a la política de privacidad', L.privacyEn, 'Pantalla de consentimiento de OAuth'),
        url('Vínculo a las condiciones del servicio', L.termsEn, 'Pantalla de consentimiento de OAuth'),
      ],
    },
  };

  for (const n of Object.values(networks)) {
    const counted = n.items.filter((i) => i.ok !== null && !i.optional);
    n.total = counted.length;
    n.ready = counted.filter((i) => i.ok).length;
  }
  const commonCounted = common.filter((i) => i.ok !== null);
  return { https, base, common, commonReady: commonCounted.filter((i) => i.ok).length, commonTotal: commonCounted.length, networks };
}
