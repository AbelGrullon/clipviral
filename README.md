# ClipViral

App de Windows que se conecta a un directo (o video) de YouTube, encuentra los momentos virales,
les pone subtítulos animados y guarda los clips en la PC listos para subir.
Con el **piloto automático** vigila canales y temas y saca los mejores clips. Cada clip queda en **Clips sugeridos**
con la hora sugerida para subirlo y el texto listo (título, gancho, descripción y hashtags) para TikTok, Instagram,
YouTube Shorts y Facebook. El usuario lo publica a mano, con un botón, o enciende la **publicación automática** por red
(apagada al empezar; en TikTok aprueba cada clip). También mide cómo le va y analiza a la competencia.

Para pedir a TikTok y Meta los permisos de publicar en público, sigue **[GUIA-PERMISOS-REDES.md](GUIA-PERMISOS-REDES.md)**.

```
ClipViral/
  server/    Servidor: cuentas, planes, IA con Claude, actualizaciones y panel de admin
  desktop/   App de escritorio (Electron) con el motor de clips
```

## Planes y precios (se cambian desde el panel de admin)

| Plan | Precio | Qué incluye | Tu costo de IA |
|---|---|---|---|
| Prueba gratis | $0 | 3 días + 2 h de IA Pro | hasta $0.20 |
| Local | $10/mes | Todo en la PC del cliente (chat, volumen, Whisper, Ollama) | $0 |
| Pro IA | $29/mes | Local + 150 h/mes con Claude (Haiku revisa, Sonnet elige) | $6 – $15 |
| Pro 24/7 | $99/mes | Local + 750 h/mes con Claude | $30 – $75 |

El costo real de cada mes sale en el panel de admin (Resumen → "Costo IA del mes" y "Ganancia estimada").
El filtro de temas del piloto y el informe de competencia también se cuentan ahí (son centavos por cliente al mes).
Con IA Pro, Sonnet además escribe el texto de las 4 redes para cada clip que elige (unos US$ 0,005 más por clip).

## Cómo funciona

1. **yt-dlp** baja el directo y **FFmpeg** lo corta en pedazos de 2 minutos.
2. **Whisper** (whisper.cpp) pasa cada pedazo a texto con el tiempo de cada palabra.
3. Se lee el **chat en vivo** y se mide el **volumen**.
4. Se eligen los momentos:
   - **Local:** picos de chat + volumen + palabras como "jajaja"; si hay **Ollama**, la IA local le pone nota, título y hashtags.
   - **IA Pro:** cada 10 minutos, **Claude Haiku** lee todo el tramo y marca candidatos; **Claude Sonnet** elige los mejores, explica por qué funcionarían
     y escribe título, gancho, descripción y hashtags distintos para TikTok, Instagram, YouTube y Facebook.
5. **FFmpeg** corta el clip, lo pasa a vertical (con fondo desenfocado, recortado u horizontal) y le quema los subtítulos.
6. Se guarda en `Videos/ClipViral/<fecha>/<canal_directo>/` el `.mp4`, una miniatura `.jpg` y un `.txt` con título y hashtags.
7. El clip aparece en **Clips sugeridos** con la hora para subirlo y el texto de cada red. El cliente lo publica
   (o se publica solo en las redes donde encendió la publicación automática).

## Personalizar los clips (Directo → Estilo del clip)

- **Subtítulos:** letra, tamaño, posición (arriba / centro / abajo), palabras a la vez, color del resaltado y del texto, animación y mayúsculas.
- **Título arriba:** pone el título del clip como gancho los primeros 3 o 5 segundos, o todo el clip.
- **Marca y logo:** texto tipo `@tucanal` y un logo PNG con posición, tamaño y transparencia.
- **Video:** 1080p o 720p, 30 o 60 fps y zoom.
- La vista previa muestra los cambios al momento.

## Revisión del sistema

Al entrar, y antes de empezar cada directo, la app revisa: conexión con el servidor, yt-dlp, Deno, FFmpeg, Whisper, modelo de voz,
Ollama (si se usa IA local), espacio en disco, memoria RAM y tarjeta de video. Si falta algo, muestra **"Antes de empezar"**
con un botón para arreglar cada cosa (instalar, abrir Ollama, descargar el modelo) o **Arreglar todo**.
yt-dlp se actualiza solo cada 2 días porque YouTube cambia seguido.

En **Ajustes → Herramientas**, "Falta" es lo que la app necesita y "Opcional" lo que solo sirve si lo quieres usar
(otros modelos de voz, Whisper para NVIDIA). Las descargas siguen solas si se traban o se corta el internet, y continúan
desde donde iban si cierras la app.

## Análisis de tu PC

Al abrir la app se mide la PC en menos de un segundo: procesador, memoria, tarjeta de video, una prueba corta de creación
de video con FFmpeg (NVIDIA y procesador) y el espacio libre. Con eso le da una nota (Potente / Buena / Básica) y sugiere:

- **Modelo de voz:** Preciso si hay Whisper para NVIDIA, Equilibrado si el procesador da, Rápido en PCs sencillas.
- **Crear clips con la NVIDIA:** solo si la prueba funcionó.
- **Calidad y fps:** baja a 720p / 30 fps solo si la PC no da para más.
- **IA local:** el mejor modelo de Ollama que quepa en la tarjeta de video (primero los que ya tienes instalados).
- **Mejoras opcionales** con su botón: Whisper para NVIDIA, bajar un modelo de IA, cambiar la carpeta si falta espacio.

La primera vez se muestra la ventana **"Análisis de tu PC"**; después solo aparece si hay algo nuevo que mejorar.
También está en **Ajustes → Rendimiento de tu PC** con el botón "Analizar de nuevo".

Los modelos de IA local salen con nombre claro (por ejemplo `qwen3-vl:8b-instruct` → "Qwen 3 VL · 8B") y una nota
de si corre rápido en tu PC. A los modelos que "piensan" (como Qwen 3) se les apaga ese modo para que respondan en segundos.

## Clips sugeridos (sección Clips sugeridos)

Cada clip nuevo (del piloto o de Directo) llega aquí listo para publicar. Un clip viejo se trae desde **Mis clips** con el botón ✨.

- **Vista previa** (se reproduce al pasar el mouse), **nota viral** y **por qué funcionaría**.
- **Cuándo subirlo en cada red:** la próxima hora buena que no esté ocupada. Usa las horas que más vistas le dan al cliente
  (sección Estadísticas); mientras no hay datos, horarios recomendados para Latinoamérica y España. Nunca propone dos clips
  a la misma hora en la misma red, como mucho 4 por día en cada una, y el clip con mejor nota recibe la hora más cercana.
- **Texto de cada red** (TikTok, Instagram, YouTube Shorts, Facebook): título, gancho, descripción, hashtags y el texto
  completo para pegar, cada uno con su botón **Copiar**. Con IA Pro lo escribe Claude para cada red; en modo Local se arma
  con la plantilla de **Redes → Texto de cada publicación** (que ahora acepta `{gancho}`).
- Botones para **abrir el video** o **la carpeta**, **"Ya lo subí a TikTok"** (por red), **"Ya la subí"** y **"Descartar"**.
  Arriba se eligen las redes donde publica el cliente.
- Con la red conectada, cada clip tiene sus botones de publicar (con el texto de esa red):
  - **Instagram y Facebook:** **Programar a la hora sugerida** o **Publicar ahora**.
  - **TikTok:** **Aprobar y programar** o **Aprobar y publicar ahora**: abren la pantalla de TikTok (ver abajo).
  - **YouTube:** **Subir con ClipViral** abre la ventana de subida con ese texto (como siempre, a mano).
  - Lo programado muestra la hora y los botones **Publicar ahora** y **Cancelar**; lo que se está subiendo muestra el avance;
    si algo falla, el motivo y **Reintentar**. Lo publicado se marca solo, con **Ver en TikTok/Instagram/Facebook**.
- Descartar un clip, marcarlo como "Ya la subí" o borrarlo cancela lo que tenía programado.

### Publicación automática (opcional, por red)

Arriba en Clips sugeridos hay un interruptor por red. **Empiezan apagados.**

- **Instagram y Facebook:** al encenderlo, cada clip por subir (y cada clip nuevo) se programa solo a su **hora sugerida**
  con el **texto armado para esa red**, como mucho 4 por día en cada red. Antes de encender, la app dice cuántos clips va a programar.
  Al apagarlo se quitan las publicaciones automáticas que todavía no salieron. Si el usuario cancela una, ese clip no se vuelve a programar solo.
- **TikTok:** su auditoría no deja publicar sin que la persona confirme cada video. Con el interruptor encendido, el usuario
  **aprueba cada clip una vez** y ClipViral lo publica solo a su hora sugerida (y le avisa cuando hay clips nuevos para aprobar).
- **YouTube:** se queda con subida manual.
- Si la PC estaba apagada a la hora elegida (más de 2 horas tarde), la publicación pasa a la próxima hora buena en vez de salir a deshora.
- La app tiene que estar abierta (puede estar minimizada) para publicar a la hora.
- Las publicaciones automáticas de una versión anterior (con otros ajustes) se cancelan al abrir la app y se avisa.

### Pantalla de TikTok (la que pide su auditoría)

Se abre cada vez que se publica en TikTok (desde Clips sugeridos o desde "Subir a redes"):
- Lee la cuenta en ese momento: **apodo y foto**, opciones de privacidad, si tiene apagados comentarios/Duo/Stitch y la duración máxima.
  Si TikTok dice que la cuenta no puede publicar ahora, no deja seguir.
- **Vista previa** del video y **texto editable** (hasta 2200 caracteres).
- **"¿Quién puede ver este video?"** sin opción elegida; las opciones son las de la cuenta.
- **Comentar, Duo y Stitch** sin marcar (y en gris si la cuenta los tiene apagados).
- **Revelar contenido comercial** (apagado): **Tu marca** → «Contenido promocional»; **Contenido de marca** → «Colaboración pagada»
  (no puede ser "Solo yo"). El botón no se activa hasta elegir una opción.
- Antes del botón: "Al publicar, aceptas la Confirmación de uso de música de TikTok" (y la Política de contenido de marca si corresponde).
- Aviso de que TikTok tarda unos minutos y avance de la publicación. Nada se envía a TikTok antes de que el usuario apruebe;
  si eligió una hora, se envía a esa hora. Justo antes de enviar se vuelve a revisar la cuenta: si algo cambió, no publica y avisa.

## Conectar redes (opcional, lo configuras una sola vez)

Sirve para publicar con un clic o solo (publicación automática) desde **Clips sugeridos**, subir desde **Mis clips** y leer las estadísticas.

Las claves de cada red se ponen en el panel de admin → **Ajustes → Conexión con redes**. En el panel → **Permisos de redes**
está la lista de lo que falta por red (claves, dirección de regreso, privacidad, términos, borrado de datos) con todas las
direcciones listas para copiar. Los clientes solo tocan **Conectar** en la app. **Paso a paso: [GUIA-PERMISOS-REDES.md](GUIA-PERMISOS-REDES.md).**

| Red | Dónde registrarla | Permisos que se piden | Antes de poder publicar en público |
|---|---|---|---|
| YouTube | console.cloud.google.com → YouTube Data API v3 → ID de cliente OAuth (aplicación web) | `youtube.upload`, `youtube.readonly` | Google debe revisar la app. Mientras tanto los videos quedan privados y el límite es de unas 6 subidas al día para todos los clientes juntos. |
| TikTok | developers.tiktok.com → Login Kit + Content Posting API (Direct Post) + Webhooks | `user.info.basic`, `user.info.stats`, `video.list`, `video.publish` (ya no `video.upload`) | Revisión de la app y auditoría de Direct Post. Mientras tanto: "Solo yo", cuentas privadas y 5 personas por día. |
| Instagram | developers.facebook.com → app tipo Empresa → Instagram API con inicio de sesión de Instagram | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | Verificación del negocio y revisión de Meta. Las cuentas deben ser profesionales. |
| Facebook | La misma app de Meta → "Inicio de sesión con Facebook para empresas" (opcional: ID de configuración) | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic` (ya no `business_management`) | Verificación del negocio y revisión de Meta. Se publica en la **página** que el cliente elige en el navegador al conectar (y puede cambiar en Redes). |

Para usarlas con todos, piden que el servidor tenga **https** y páginas públicas de privacidad, términos y borrado de datos (ver abajo).
Mientras la app de Meta está en modo desarrollo, Facebook acepta `http://localhost`; Instagram pide https (túnel). Detalles en
[GUION-VIDEO-META.md](GUION-VIDEO-META.md).

### Redes: conectar, elegir página y crear publicaciones
- **Facebook:** después de aceptar los permisos, el navegador muestra **"Choose your Facebook Page"** con las páginas que administra
  la persona (foto, nombre y el Instagram unido a cada una). Recién al elegir queda conectado (la app espera ese paso).
  En Redes se ve la página elegida, su Instagram unido (`@usuario`), una lista para cambiar de página y **"Ver página en Facebook"**.
- **Instagram:** la tarjeta muestra `@usuario`, foto, tipo de cuenta (empresa o creador) y **"Ver perfil en Instagram"**.
- **Crear publicación** (arriba en Redes o en cada red conectada): eliges el clip (Facebook solo acepta de 3 a 90 s), revisas el título
  y el texto, y tocas **Publicar ahora** o **Programar**. En **Publicaciones** se ve el avance, **Publicar ahora** para lo programado,
  **Cancelar** y, al terminar, **"Ver en Facebook / Instagram"** con el enlace real de la publicación (`permalink_url` / `permalink`).
- **🌐 English** (en Redes o Ajustes): el menú, la entrada, Redes, Crear publicación y Estadísticas se ven en inglés, para grabar el
  video de la revisión de Meta. Lo demás sigue en español.

### Uso personal: conectar con un token (sin verificar el negocio)
En apps de Meta nuevas, el botón "Conectar Facebook" (Inicio de sesión con Facebook para empresas) pide acceso avanzado a
`public_profile`, y eso pide política de privacidad pública y verificar el negocio. Para usar ClipViral **solo con tus cuentas**
no hace falta: en Redes, **"🔑 Conectar con un token (uso personal)"**.
- **Facebook:** en el Explorador de la API Graph eliges tu app, "Token de usuario", los permisos `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic` y `business_management`, y pegas el token.
  El servidor lo cambia por uno largo (con la clave secreta del panel), revisa los permisos y guarda tus páginas: el token de página
  no vence. Si administras varias, eliges una. Si la página está dentro de un portfolio comercial (Meta Business Suite), `/me/accounts`
  viene vacío: se buscan en `/me/businesses` → `owned_pages`/`client_pages` (por eso hace falta `business_management`).
- **Instagram:** en tu app → Instagram → Configuración de la API → "Generar token" (dura 60 días; ClipViral lo renueva).
  En apps nuevas esa opción pide un portfolio comercial ("inicio de sesión unificado"). **No hace falta:** si el Instagram está
  unido a la página de Facebook conectada y el token de Facebook trae `instagram_content_publish` (y `instagram_manage_insights`
  para las vistas), ClipViral publica en ese Instagram **a través de la página** (API de Instagram con inicio de sesión con Facebook,
  `graph.facebook.com/{ig-id}/media`). En Redes sale "Conectado como @usuario · a través de tu página"; se quita al desconectar Facebook.
- Ruta: `POST /api/social/{facebook|instagram}/manual` (`fromToken` en `server/src/social.js`). Solo sirve con cuentas de quien tiene
  un rol en la app de Meta (acceso estándar).

### Instagram: recorte a 39 s
Por la API, Instagram rechaza a algunas cuentas (sobre todo nuevas) los Reels de más de ~40 s, con un error genérico
("ProcessingFailedError / Request processing failed"). Con **"✂️ Recortar a 39 s para Instagram"** (Redes → Instagram, encendido por
defecto), si el clip dura más de 40 s se sube a Instagram una copia de los primeros 39 s: el video se copia sin volver a codificar
(tarda 1 o 2 segundos) y el sonido se apaga al final. La copia va a la carpeta temporal y se borra al terminar; el clip original y las
otras redes no cambian. Código: `igTrimNeeded`/`igTrimArgs` en `engine/publicar.js`, `prepare` en `UploadQueue`, `igTrimCopy` en `main.js`.

### Publicar desde el servidor (en tu PC o en tu VPS)
Lo programado (a mano, automático o TikTok aprobado) se manda al **servidor de ClipViral** apenas se programa, y el servidor lo
publica a su hora. Con el servidor en un **VPS**, se publica aunque la PC esté apagada; con el de la PC, mientras esté encendida.
Funciona igual en los dos: el servidor sube con el mismo código de la app (`desktop/engine/redes.js`).
- **App:** interruptor **📡 Publicar desde el servidor** en Redes → Publicaciones (encendido; ajuste `redes.servidorPublica`).
  La copia recortada de Instagram se hace en la PC antes de mandarla. Cada publicación muestra **📡 en el servidor**; la app
  pregunta cada 30 s cómo va (cada 5 s si alguna está por salir) y muestra Publicado / Error / Ver en…
  Cancelar y Publicar ahora se piden al servidor (sin conexión, Cancelar avisa y no cancela).
  Código: `remote` y `sync()` en `engine/subidas.js`, cliente en `engine/servidor.js`.
- **Servidor:** `server/src/publicaciones.js` (tablas `posts` y `post_files`, rutas `/api/publicaciones`, revisa cada 20 s).
  El video llega tal cual (`video/mp4`) y se guarda una vez por su huella sha256, aunque vaya a varias redes; se borra al publicarse
  (si falló, a los 7 días). Reintenta los cortes de internet (3 veces). Automáticas cuya hora pasó con el servidor apagado quedan
  en `tarde` y la app les busca la próxima hora buena. Con https, Instagram puede descargar el video del propio servidor (`relayLocal`).
  `/api/health` → `api: 3, publica: true` (el .bat cierra y abre de nuevo un servidor anterior).
- **Elegir servidor:** Ajustes → **🖥️ Servidor de ClipViral** (Probar / Usar mi VPS / Volver al de esta PC). Al cambiar, lo
  programado se cancela en el viejo y se manda al nuevo. Con el VPS elegido, `Iniciar ClipViral.bat` no enciende el servidor
  de la PC (`server/scripts/servidor-elegido.js`).
- **VPS con Windows:** ver **GUIA-VPS.md**. `Preparar copia para el VPS.bat` (`scripts/preparar-vps.js`: programa + tus datos,
  sin lo programado) → en el VPS, `Instalar en el VPS.bat` como administrador (`scripts/vps.js`: trae los datos solo la primera vez,
  crea la tarea "ClipViral servidor" como SYSTEM al arrancar, firewall, Caddy para https con DuckDNS). `scripts/vps-servicio.js`
  mantiene encendidos el servidor y Caddy.

### Video para la revisión de Meta
Doble clic en **`Grabar video para Meta.bat`**: graba la pantalla con el FFmpeg de ClipViral mientras un panel (que no sale en el
video) dice cada paso; tocas **Listo** o **F9** al terminar cada uno. Al final arma un `.mp4` con una franja de subtítulos en inglés
(paso, permiso y qué pasa en pantalla) en la carpeta `Videos para Meta`, más un `.srt` y la lista de minutos. Código en `desktop/grabador/`
(los pasos y los subtítulos, en `pasos.js`). Guion y lo que hay que preparar: [GUION-VIDEO-META.md](GUION-VIDEO-META.md).
Para probarlo sin tocar nada: `desktop\node_modules\electron\dist\electron.exe desktop\grabador --prueba --salida=<carpeta>` (graba 8 s).
Los tokens se guardan cifrados en el servidor y los videos se suben directo desde la PC del cliente (no gastan internet de tu servidor).
La excepción es Instagram: con su inicio de sesión, Meta solo garantiza recibir el video desde un enlace público, así que si la
subida directa falla, el clip pasa un momento por el servidor (`/media/<código>.mp4`, difícil de adivinar) y se borra al publicarse o a las 24 h.
Para leer estadísticas se pidieron permisos nuevos a TikTok (`video.list`, `user.info.stats`) e Instagram: las cuentas conectadas
antes siguen subiendo, pero la app les pide **Reconectar** para ver sus números.

### Páginas públicas y avisos de las redes (servidor)

- **Sitio público** (lo piden TikTok, Meta y Google): inicio `/` (inglés `/en`), privacidad `/privacidad` (`/privacy`),
  términos `/terminos` (`/terms`) y cómo borrar los datos `/borrar-datos` (`/data-deletion`). El nombre del responsable,
  el correo y el país salen del panel → Ajustes → Datos para las páginas legales (lo que falta se ve en amarillo).
  El panel de admin sigue en `/admin/`.
- **Meta** (verifica el `signed_request` con la clave secreta de la app):
  `/api/meta/instagram/deauthorize`, `/api/meta/instagram/data-deletion`, `/api/meta/facebook/deauthorize`, `/api/meta/facebook/data-deletion`.
  Borran la conexión de esa persona con sus tokens. El de borrado de datos responde con un código y la dirección
  `/borrar-datos?codigo=…` para ver el estado.
- **TikTok:** `/api/tiktok/webhook` (verifica la firma `TikTok-Signature` con el client secret). Con `authorization.removed` borra la conexión.
- Al **desconectar** en la app se borra la conexión; en TikTok además se anula el permiso. Facebook guarda todas las páginas
  del cliente para que elija en cuál publicar (`/api/social/facebook/pick` recibe la elección del navegador).

## Piloto automático (sección Piloto)

- **Canales:** si empiezan un directo lo graba; si suben un video nuevo lo analiza (pestañas Videos y Directos).
- **Temas:** busca en YouTube lo más visto de hoy sobre cada tema. Con IA Pro, Claude Haiku descarta lo que no tiene que ver (cuesta ~US$ 0,0002 por revisión).
- **Derechos:** saca clips sin preguntar solo de los canales marcados **"Tengo permiso"**. Lo demás (y todo lo que salga de los temas) queda como
  **sugerencia** y el cliente decide. Se puede apagar en "Reglas", pero no se recomienda.
- Los directos van primero. Hay un máximo de videos por día y un máximo de duración. Usa yt-dlp, así que **no gasta cupo de la API de YouTube**.
- Cada clip que saca queda en **Clips sugeridos**. Solo sale sin que lo toques en las redes donde encendiste la publicación automática.
- Con el piloto encendido la PC no se duerme. La app tiene que quedar abierta (puede estar minimizada).

## Estadísticas y aprendizaje (sección Estadísticas)

Cada 3 horas lee vistas, "me gusta", comentarios y seguidores de lo subido con ClipViral en los últimos 30 días
(lo que el cliente sube a mano desde las apps de cada red no se puede leer).
Con 5 publicaciones de más de un día ya saca conclusiones: mejores horas, largo de clip, canal o tema que más rinde,
qué estilo de título funciona y si la nota de la IA acierta. Eso se usa solo: Clips sugeridos propone esas horas,
el piloto usa ese largo de clip y Claude recibe lo que funciona al elegir y titular.

## Competencia (sección Competencia)

- **YouTube:** cualquier canal, gratis (videos y Shorts recientes con vistas).
- **Instagram:** cuentas profesionales, usando el Instagram unido a la página de Facebook conectada ("me gusta" y comentarios; Instagram no da las vistas de otros).
- **TikTok:** no deja que las apps vean otras cuentas.
- **Informe con IA** (plan Pro IA): Claude Opus 5.5 escribe qué le funciona a cada uno e ideas para la semana. Uno por día como máximo, automático cada semana (~US$ 0,02–0,05 cada uno).

## Probar en tu PC

### La forma rápida
Doble clic en **`Iniciar ClipViral.bat`**. Muestra 4 pasos con colores:

1. **Revisando tu PC:** Node.js 22.13 o más nuevo, memoria y espacio libre. Si falta Node, explica qué hacer y ofrece abrir nodejs.org.
2. **Preparando ClipViral:** crea `server/.env` desde `.env.example` y, solo la primera vez, instala lo necesario y descarga Electron.
3. **Tu cuenta:**
   - **Primera vez** (no hay ningún admin en la base): un asistente pide nombre, correo y contraseña (no se ve al escribir y se pide
     dos veces) y crea el administrador. Después ofrece pegar la **clave de Claude** (la prueba gratis; escribir `A` abre la página de
     claves) o dejarla para después, deja la app con la **sesión ya iniciada** y ofrece un acceso directo en el escritorio.
   - **Las demás veces:** saluda por el nombre, dice cuándo fue tu última visita y avisa si falta la clave de Claude.
4. **Encendiendo ClipViral:** enciende el servidor (o reinicia uno viejo), abre la app y, al cerrarla, apaga el servidor.
   Si el puerto lo usa otro programa u **otra copia** de ClipViral, prueba el siguiente (4601, 4602…).

Funciona aunque la carpeta tenga espacios, tildes o paréntesis. Si copias el `.bat` a otro lugar (por ejemplo al escritorio),
encuentra la carpeta de ClipViral por la última vez que se abrió. Lo que escribe el servidor queda en `server/servidor.log`.
Para forzar otro puerto: `"Iniciar ClipViral.bat" 4601`. Para pruebas, `CLIPVIRAL_PERFIL` usa otra carpeta de datos de la app
(en vez de `%APPDATA%\ClipViral`) y `CLIPVIRAL_APP_ARGS` agrega argumentos a la app.

Las piezas del asistente están en `server/scripts/`: `revisar-pc.js`, `asistente.js` (usa `crear-admin.js`) y `estado-servidor.js`.

### Clave de Claude (IA Pro)
Cada persona usa **su propia** clave de Claude en su propio servidor, y lo que gaste se cobra en su cuenta de Claude.
Se pone en cualquiera de estos lugares (solo administradores):
- La app: **Ajustes → Clave de Claude → Probar y guardar** (en Directo, si eliges IA Pro sin clave, sale un aviso con el botón **Poner clave**).
- El panel de admin: **Ajustes → Clave de Claude**.
- El asistente de primera vez del `.bat`.

Antes de guardarla, el servidor la prueba pidiendo la lista de modelos (no cuesta nada) y explica en español si no sirve
(clave mal copiada, sin permiso, sin internet). Se guarda **cifrada** en la base (`settings.anthropic_api_key`, con la misma llave
que los tokens de redes: `data/secret.key` o `SECRET_KEY`) y nunca se devuelve completa. La IA se activa al momento, sin reiniciar:
`/api/health` lo refleja (`ai: true`). Si la cuenta de Claude se queda sin saldo o la clave deja de servir, la app lo dice.
`ANTHROPIC_API_KEY` en `server/.env` sigue funcionando **de respaldo** (se usa si no hay ninguna guardada).
Rutas: `GET/PUT/DELETE /api/admin/claude`.

### Pasarle la app a un amigo
Doble clic en **`Preparar copia para un amigo.bat`**: deja **`ClipViral para un amigo.zip`** en tu escritorio (unos 0,3 MB).
- **Dentro:** solo el programa (`Iniciar ClipViral.bat`, `LEEME - EMPIEZA AQUI.txt`, los README y el código de `server` y `desktop`).
- **Fuera:** `server/data` (tu base, cuentas, clave de Claude, tokens de redes), `server/.env`, registros, clips, pruebas y `node_modules`.
- Antes de armar el zip revisa cada archivo: si encuentra una clave de Claude o algún valor de tu `.env` o correo de tus cuentas, no la arma.

Tu amigo descomprime, abre `Iniciar ClipViral.bat`, crea su admin, pega su clave y listo. Necesita Windows 10 u 11,
internet la primera vez y Node.js 22.13 o más nuevo.

### Servidor
```bash
cd server
npm install
copy .env.example .env      # opcional: el .bat lo hace solo
npm run crear-admin -- tu@correo.com "TuContraseña" "Tu Nombre"
npm start                   # panel: http://localhost:4600/admin/  · sitio público: http://localhost:4600/
```
La clave de Claude se pone desde la app o el panel (ver arriba); `ANTHROPIC_API_KEY` en `.env` es opcional.

### App de escritorio
```bash
cd desktop
npm install
node node_modules/electron/install.js   # solo si Electron no bajó su programa
npm start
```
La primera vez, en **Ajustes → Instalar todo lo necesario** se descargan yt-dlp, Deno, FFmpeg, Whisper y el modelo de voz (unos 360 MB). La versión de Whisper para NVIDIA es opcional (650 MB).
Deno lo usa yt-dlp para resolver unas pruebas que YouTube pone en JavaScript; sin él faltan formatos y algún día dejaría de leer los videos.

### Pruebas
```bash
cd server && npm test
cd desktop && npm test
```
`server/test/clave.test.js` prueba la clave de Claude con Claude simulado (no gasta) y `server/test/arranque.test.js` el asistente,
el estado del puerto y la copia para un amigo, en carpetas temporales. `desktop/test/grabador.test.js` revisa que cada permiso
que pide la app salga en algún paso del video para Meta, y `desktop/test/pantallas.test.js` que las pantallas carguen.
`server/test/publicaciones.test.js` y `desktop/test/servidor.test.js` prueban la publicación desde el servidor (este último, la
cola de la app contra el servidor de verdad); `server/test/vps.test.js`, la copia y el instalador del VPS.

## Publicar una actualización

1. Sube el número en `desktop/package.json` (`"version": "1.0.1"`).
2. `cd desktop && npm run instalador` → crea `dist/ClipViral-Setup-1.0.1.exe`.
3. En el panel de admin → **Actualizaciones**, arrastra el `.exe`, escribe las novedades y publica.
4. Las apps abiertas lo detectan (al abrir y cada 30 min) y muestran el botón **Actualizar ahora**.

## Antes de vender

- Pon el servidor en tu VPS con HTTPS (ej. `https://api.tudominio.com`) y cambia `desktop/app-config.json` → `serverUrl`.
- Completa en el panel de admin los datos para las páginas legales y sigue **GUIA-PERMISOS-REDES.md** para pedir los permisos de cada red.
- Configura en el panel de admin el **enlace de pago** y el **contacto de soporte**. Hoy el admin activa los planes a mano
  desde **Usuarios → Gestionar** después de cobrar; el cobro automático (Stripe/PayPal) es el siguiente paso.
- Los clientes deben tener permiso de los creadores para usar su contenido (se acepta al registrarse).
  Consulta con un abogado por las normas de YouTube antes de lanzar.
