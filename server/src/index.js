import express from 'express';
import path from 'node:path';
import { ROOT, db } from './db.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import aiRoutes from './routes/ai.js';
import updateRoutes from './routes/updates.js';
import adminRoutes from './routes/admin.js';
import socialRoutes from './routes/social.js';
import callbackRoutes from './routes/callbacks.js';
import sitioRoutes from './routes/sitio.js';
import { serveRelay } from './relay.js';
import { postRoutes, startPublisher, canPublish } from './publicaciones.js';
import { aiEnabled } from './claude.js';
import './clave.js'; // lee la clave de Claude guardada desde el panel o la app (o, si no hay, la del .env)
import { idCopia } from './copia.js';
import { payRoutes } from './pagos.js';
import { startMailJobs } from './correo.js';
import { agenteRoutes } from './agente.js';

const COPIA = idCopia(ROOT);
// Versión para clientes: el servidor corre dentro de la app, en su PC. Solo cuenta, IA con su clave de Claude y nada más
// (sin panel de admin, sin redes, sin pagos, sin agente, sin publicar).
export const CLIENTE = process.env.EDICION === 'cliente';
// Versión para administradores/amigos (instalador): el servidor va dentro de la app; la primera cuenta es la del administrador.
export const ADMIN_APP = process.env.EDICION === 'admin';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// rawBody: TikTok firma el cuerpo tal cual llega (para verificar sus avisos).
app.use(express.json({ limit: '3mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

// api: versión de lo que ofrece el servidor (el .bat la mira para saber si quedó abierto uno viejo).
// copia: qué carpeta de ClipViral es (para no confundirse con otra copia abierta en la misma PC).
// publica: el servidor sabe publicar solo lo programado (api 3).
app.get('/api/health', (req, res) => res.json({
  ok: true, ai: aiEnabled(), api: 3, copia: COPIA, publica: !CLIENTE && canPublish(), cliente: CLIENTE,
  // La app de administradores pide crear la cuenta mientras no haya ninguna.
  ...(ADMIN_APP ? { sinCuentas: !db.prepare('SELECT 1 FROM users').get() } : {}),
}));
if (!CLIENTE) {
  // Avisos de Meta y TikTok (quitar permiso / borrar datos). Van antes que todo lo que pide sesión.
  app.use('/api', callbackRoutes);
}
if (CLIENTE) {
  // Solo la app que lo encendió conoce esta contraseña (va en el entorno del proceso, nunca en un archivo):
  // con ella le dice qué plan trae la clave de licencia (Local o Claude).
  app.post('/api/interno/plan', (req, res) => {
    const secreto = process.env.INTERNO_SECRETO;
    if (!secreto || req.get('x-interno') !== secreto) return res.status(403).json({ error: 'No permitido' });
    const plan = req.body?.plan === 'claude' ? 'pro' : 'local';
    db.prepare('UPDATE users SET plan = ?, plan_expires = NULL').run(plan);
    res.json({ ok: true, plan });
  });
}
app.use('/api/auth', authRoutes);
app.use('/api', accountRoutes);
app.use('/api/ai', aiRoutes);
if (!CLIENTE) {
  app.use('/api/updates', updateRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/social', socialRoutes);
  // Publicaciones que el servidor sube solo a su hora (el video llega como video/mp4, sin pasar por express.json).
  app.use('/api/publicaciones', postRoutes);
  // Pagos con tarjeta (PayPal): cada pago suma un mes de licencia.
  app.use('/api/pagos', payRoutes);
  // Agente de contenido (solo admin): su página de Facebook, su cerebro con Claude y su tope de gasto.
  app.use('/api/agente', agenteRoutes);
}
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

if (!CLIENTE) {
  app.use('/admin', express.static(path.join(ROOT, 'public', 'admin')));
  // Videos de paso para que Instagram los descargue (enlace difícil de adivinar, se borran en 24 h).
  app.get('/media/:name', serveRelay);
  // Sitio público: inicio, privacidad, términos y borrar datos (los piden TikTok, Meta y Google).
  app.use('/', sitioRoutes);
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Los datos enviados son demasiado grandes' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo es demasiado grande' });
  // Errores con mensaje para el usuario (por ejemplo, de PayPal).
  if (err?.status && err.status < 600 && err.message) return res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error del servidor' });
});

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const port = Number(process.env.PORT) || 4600;
  // HOST: en el VPS con Caddy (https) delante, el servidor solo escucha dentro del VPS (127.0.0.1).
  const server = app.listen(...(process.env.HOST ? [port, process.env.HOST] : [port]), () => {
    console.log(`ClipViral servidor listo en http://localhost:${port}`);
    // La app que lo encendió espera este aviso (ya escuchando) antes de usarlo.
    if (CLIENTE || ADMIN_APP) process.send?.({ listo: port });
    if (CLIENTE) return;
    console.log(`Panel de admin: http://localhost:${port}/admin/`);
    if (!aiEnabled()) console.log('Aviso: falta la clave de Claude. Ponla en la app (Ajustes → Clave de Claude) o en el panel. Mientras tanto, la IA Pro está apagada.');
    console.log(canPublish() ? 'Publicaciones programadas: el servidor las sube solo a su hora.' : 'Aviso: falta desktop/engine: el servidor no puede publicar lo programado.');
  });
  // Mandar un video al servidor puede tardar más que los 5 minutos que Node da por defecto.
  server.requestTimeout = 60 * 60 * 1000;
  if (CLIENTE || ADMIN_APP) {
    // Se cierra junto con la app. Si el puerto está ocupado, se cierra y la app lo avisa.
    process.on('disconnect', () => process.exit(0));
    server.on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `El puerto ${port} está ocupado por otro programa.` : err.message); process.exit(1); });
  }
  if (!CLIENTE) startPublisher();
  // Avisos por correo cuando un plan está por vencer o venció.
  if (!CLIENTE) startMailJobs();
}
