# Guía para pedir los permisos de TikTok, Instagram y Facebook

Esta guía explica, paso a paso, cómo pedir a TikTok y a Meta (Instagram y Facebook) que dejen a ClipViral
**publicar en público**. Mientras no aprueben, todo funciona solo en modo de prueba:
TikTok publica como "Solo yo" y Meta solo deja conectar a las personas que agregaste a la app.

> Revisado con la documentación oficial de TikTok y Meta en noviembre de 2026. Las redes cambian sus formularios
> seguido: si un nombre de botón no coincide, busca el más parecido.

---

## 0. Antes de empezar (sirve para las tres redes)

1. **Pon el servidor en tu VPS con https** y un dominio propio (por ejemplo `https://api.tudominio.com`).
   Para usar las redes con todos y para enviar las revisiones hace falta https. Solo para **probar y grabar el video** con la app de
   Meta en modo desarrollo, Facebook acepta `http://localhost` (Instagram pide https: usa un túnel). Ver [GUION-VIDEO-META.md](GUION-VIDEO-META.md).
2. En el **panel de admin → Ajustes**:
   - "Dirección pública del servidor": tu dirección con https.
   - "Datos para las páginas legales": tu nombre o el de tu negocio, un correo para privacidad y tu país.
3. Abre estas páginas en el navegador y revisa que se vean bien y **sin nada marcado en amarillo**:
   - Inicio: `https://api.tudominio.com/en` (en español: `/`)
   - Política de privacidad: `/privacy` (en español: `/privacidad`)
   - Términos del servicio: `/terms` (en español: `/terminos`)
   - Cómo borrar los datos: `/data-deletion` (en español: `/borrar-datos`)
4. En el **panel de admin → Permisos de redes** está la lista de lo que falta en cada red, con todas las direcciones
   listas para copiar (un clic las copia). Esta guía te dice dónde pegar cada una.
5. Ten a mano **cuentas de prueba tuyas**: una cuenta de TikTok, una cuenta de Instagram **profesional**
   (de empresa o de creador) y una **página de Facebook** que administres.
6. Ten un **clip hecho con contenido tuyo** (un directo o video de tu propio canal). Lo vas a usar en los videos de demostración.

> ⚠️ **Importante para TikTok:** sus reglas dicen que no aprueban "apps que copian contenido de otras plataformas a TikTok".
> Presenta ClipViral como lo que es: **una herramienta para que cada creador saque clips de sus propios directos y videos**
> (o de creadores que le dieron permiso). En los videos de demostración usa contenido tuyo, no de otro canal.

**Para los videos de demostración:** la app está en español y quienes revisan leen inglés. Enciende **🌐 English** en Redes
(pantallas del recorrido en inglés) y graba con **`Grabar video para Meta.bat`**, que pone **subtítulos en inglés** en cada paso.
Graba la pantalla completa, en 1080p, sin cortes. Guion de Meta: [GUION-VIDEO-META.md](GUION-VIDEO-META.md).

---

## 1. TikTok

### 1.1 Crear la app
1. Entra a **developers.tiktok.com** con tu cuenta y ve a **Manage apps → Connect an app**.
2. Completa:
   - **App name:** `ClipViral` (no uses "TikTok" en el nombre).
   - **App icon:** el logo de ClipViral, cuadrado (por ejemplo 1024 × 1024).
   - **Category:** Video / Entertainment (o la más parecida).
   - **Description:** pega el texto en inglés de abajo.
   - **Terms of Service URL:** `https://api.tudominio.com/terms`
   - **Privacy Policy URL:** `https://api.tudominio.com/privacy`
   - **Platforms:** marca **Web** y en *Website URL* pega `https://api.tudominio.com/en`.
3. En **Products** agrega:
   - **Login Kit** → *Redirect URI*: pega la dirección "Redirect URI" del panel (termina en `/api/social/tiktok/callback`).
   - **Content Posting API** → activa **Direct Post**.
   - **Webhooks** → *Callback URL*: pega la dirección "Webhook callback URL" del panel (termina en `/api/tiktok/webhook`).
     Sirve para que, si alguien le quita el permiso a ClipViral desde TikTok, se borre su conexión sola.
4. En **Scopes** deja **solo** estos cuatro: `user.info.basic`, `user.info.stats`, `video.list`, `video.publish`.
   Si aparece marcado `video.upload`, **quítalo** (ClipViral ya no lo usa y TikTok rechaza permisos que sobran).
5. Copia **Client key** y **Client secret** al panel de admin → Ajustes → Conexión con redes → TikTok, y guarda.

**Descripción de la app (pegar en inglés):**
```
ClipViral is a Windows app for content creators. It finds the best moments of the creator's own YouTube live streams and videos, adds animated captions and prepares vertical clips for TikTok, Instagram Reels, YouTube Shorts and Facebook Reels. Creators connect their own TikTok account to publish the clips they review and approve, and to see how their posts perform.
```

### 1.2 Probar antes de pedir la revisión
- Mientras TikTok no apruebe la app, solo se puede publicar como **"Solo yo"** y **en cuentas privadas**:
  pon tu cuenta de TikTok de prueba en privado (TikTok → Configuración → Privacidad → Cuenta privada).
- Si TikTok te ofrece un **Sandbox**, agrega tu cuenta como *target user* y prueba ahí.
- En la app: **Redes → Conectar TikTok**, después **Clips sugeridos → pestaña TikTok → Aprobar y publicar ahora**,
  elige "Solo yo" y publica. Revisa que el video aparezca en tu perfil.

### 1.3 Qué grabar en el video de demostración (TikTok)
Puedes subir hasta 5 videos de 50 MB cada uno. Graba **todo el recorrido sin cortes**:

1. **El sitio web**: abre `https://api.tudominio.com/en` en el navegador (que se vea la dirección: tiene que ser el mismo dominio que pusiste en la app).
2. **Conectar (Login Kit, user.info.basic):** en ClipViral → **Redes → Conectar TikTok** → se abre la página de TikTok con el nombre
   "ClipViral" y los permisos → **Autorizar** → aparece "TikTok conectado" en tu dominio → vuelve a la app y muestra el nombre de la cuenta.
3. **Publicar (video.publish), mostrando cada regla de la pantalla de TikTok:**
   - En **Clips sugeridos**, abre la pestaña TikTok de un clip y toca **Aprobar y programar** (o **Aprobar y publicar ahora**).
   - Muestra el **apodo y la foto** de la cuenta arriba ("Se publicará en tu cuenta").
   - Reproduce la **vista previa** del video.
   - **Edita el texto** de la publicación.
   - Abre **"¿Quién puede ver este video?"**: se ve que **no hay nada elegido** y que las opciones son las de la cuenta. Elige una.
   - Muestra **Comentar / Hacer Duo / Hacer Stitch** sin marcar; marca alguno. Si alguno está gris, explica que está apagado en la cuenta.
   - Enciende **Revelar contenido comercial**: muestra que el botón se desactiva hasta elegir, marca **Tu marca** (aparece
     «Contenido promocional»), después **Contenido de marca** (aparece «Colaboración pagada», "Solo yo" queda deshabilitado y
     el aviso cambia a "Política de contenido de marca y Confirmación de uso de música").
   - Muestra el texto **"Al publicar, aceptas la Confirmación de uso de música de TikTok"** antes del botón y toca el enlace.
   - Apaga el contenido comercial y toca **Publicar ahora**.
   - Muestra el aviso "TikTok puede tardar unos minutos", el avance en la tarjeta y en **Redes → Subidas**, y que termina en **Publicado**.
   - Abre TikTok y muestra el video en el perfil.
4. **Programado:** aprueba otro clip con **Aprobar y programar · Hoy 19:00**: se ve "Aprobado: se publica hoy 19:00" y el botón
   **Cancelar**. Explica que el video **no se envía a TikTok antes de esa hora** y que cada video lo aprueba la persona.
5. **Estadísticas (user.info.stats, video.list):** abre **Estadísticas → Actualizar** y muestra las vistas del video y los seguidores.
6. **Desconectar:** **Redes → Desconectar TikTok**.

### 1.4 Textos para justificar cada permiso (pegar en inglés)

**Login Kit / `user.info.basic`**
```
Creators connect their own TikTok account to ClipViral with Login Kit. We use user.info.basic to show the connected account's display name and avatar in the app, so the creator always knows which account their videos will be posted to. We store the open_id only to identify the connection, and we delete it when the creator disconnects or removes access.
```

**Content Posting API (Direct Post) / `video.publish`**
```
ClipViral turns a creator's own live streams and long videos into short vertical clips with captions. With video.publish the creator can publish a clip directly to their own TikTok account. Every post goes through our "Post to TikTok" screen, which loads the latest creator info each time: it shows the creator's nickname and avatar, a preview of the video and an editable caption. The privacy level must be selected manually from the options returned by creator_info (no default value). Comment, Duet and Stitch are off by default and disabled when the creator has turned them off in TikTok. The creator can disclose commercial content (Your brand / Branded content) with the required labels, branded content cannot be private, and the Music Usage Confirmation (plus the Branded Content Policy when applicable) is shown before the publish button. No content is sent to TikTok until the creator approves the post. If the creator picks a time ("Approve and schedule"), the approved video is uploaded at that time; they can cancel it before then. We check the duration against max_video_post_duration_sec, stop if the creator cannot post right now, poll the post status endpoint and tell the creator that processing can take a few minutes. We do not add watermarks or logos.
```

**`user.info.stats`**
```
We read the follower count of the connected account so creators can see how their account grows in ClipViral's Statistics section.
```

**`video.list`**
```
We read the view, like, comment and share counts of the videos the creator published with ClipViral, to show how each clip performed and to suggest the best posting times. We only access the connected creator's own videos.
```

**Webhooks**
```
We subscribe to the authorization.removed event to delete the creator's stored tokens as soon as they remove ClipViral's access from TikTok.
```

### 1.5 Las dos revisiones de TikTok
1. **App review** (revisión de la app): se envía desde *Manage apps → tu app → Submit for review*. Con esto la app queda "Live".
2. **Auditoría de Direct Post** (Content Posting API audit): es **otro formulario**, que se llena después, para quitar el límite de
   "Solo yo" y de 5 personas por día. Pregunta cuántas personas y cuántos videos por día esperas, y revisa la pantalla de publicación.
   Si pregunta si la app publica sola, responde:
   ```
   ClipViral never posts to TikTok without the creator's consent. Each video is reviewed and approved by the creator on our posting screen (privacy, interactions and commercial content disclosure are chosen per video). An approved video can be scheduled for a time the creator picks, and it can be cancelled before it is uploaded.
   ```

**¿Puede TikTok publicar sin que el usuario confirme cada video?** No. Sus reglas dicen que la app solo puede enviar contenido
**después de que la persona da su consentimiento**, que la privacidad se elige a mano **sin valor por defecto** y que hay que mostrar
la vista previa y el aviso de música antes de publicar. Por eso en ClipViral el interruptor de TikTok funciona así:
**la persona aprueba cada clip una vez** (en la pantalla de TikTok) **y ClipViral lo publica solo a la hora sugerida**.
No se puede aprobar varios de golpe ni recordar la privacidad de la vez anterior.

**Tiempos aproximados:** la revisión de la app, de unos días a 2 semanas. La auditoría de Direct Post, según quienes ya la hicieron,
de 2 a 6 semanas, y es común que pidan cambios y haya que reenviar. Hasta entonces: "Solo yo" y máximo 5 personas publicando por día.

---

## 2. Meta: Instagram y Facebook (una sola app)

### 2.1 Crear la app
1. Entra a **developers.facebook.com** → **Mis apps → Crear app**. Elige el tipo **Empresa** (Business).
   Si te pide un "caso de uso", elige el de Instagram (publicar contenido) y después agrega el de páginas de Facebook.
2. **Configuración de la app → Básica:**
   - **Nombre visible:** ClipViral. **Correo de contacto**: tu correo.
   - **Dominios de la app:** `tudominio.com`.
   - **URL de la política de privacidad:** `https://api.tudominio.com/privacy`
   - **URL de las condiciones del servicio:** `https://api.tudominio.com/terms`
   - **Eliminación de datos de usuario → URL de devolución de llamada:** la dirección "Data deletion" de **Facebook** del panel
     (termina en `/api/meta/facebook/data-deletion`).
   - **Ícono** de 1024 × 1024 y **categoría**.
   - Copia el **identificador de la app** y la **clave secreta** al panel de admin → Facebook.

### 2.2 Instagram (API con inicio de sesión de Instagram)
1. Agrega el producto **Instagram** → **Configuración de la API con inicio de sesión de Instagram**.
2. Copia el **identificador de la app de Instagram** y su **clave secreta** al panel de admin → Instagram (son distintas a las de Facebook).
3. En **Configurar el inicio de sesión para empresas** pega (todas están en el panel, sección Instagram):
   - **URI de redireccionamiento de OAuth:** termina en `/api/social/instagram/callback`
   - **Deauthorize callback URL** (cancelar autorización): termina en `/api/meta/instagram/deauthorize`
   - **Data deletion request URL** (eliminación de datos): termina en `/api/meta/instagram/data-deletion`
4. Para probar antes de la aprobación: **Roles de la app → Evaluadores de Instagram** → agrega tu cuenta y acepta la invitación
   en Instagram (Configuración → Apps y sitios web → Invitaciones de evaluador).

### 2.3 Facebook (Inicio de sesión con Facebook para empresas)
1. Agrega el producto **Inicio de sesión con Facebook para empresas**.
2. En **Configuración** pega:
   - **URI de redireccionamiento de OAuth válidos:** termina en `/api/social/facebook/callback`
   - **Cancelar autorización (Deauthorize callback URL):** termina en `/api/meta/facebook/deauthorize`
3. (Recomendado) **Configuraciones → Crear configuración**: tipo "token de acceso de usuario", con los permisos de abajo.
   Copia el **ID de configuración** al panel de admin → Facebook → "ID de configuración". Si no lo pones, ClipViral pide los permisos con la lista.

### 2.4 Permisos que pide ClipViral (y nada más)
| Red | Permiso | Para qué |
|---|---|---|
| Instagram | `instagram_business_basic` | Ver usuario y foto de la cuenta conectada |
| Instagram | `instagram_business_content_publish` | Publicar Reels |
| Instagram | `instagram_business_manage_insights` | Ver las vistas de cada Reel (Estadísticas) |
| Facebook | `pages_show_list` | Listar tus páginas para elegir en cuál publicar |
| Facebook | `pages_read_engagement` | Leer datos de la página (lo exige `pages_manage_posts`) |
| Facebook | `pages_manage_posts` | Publicar Reels en la página |
| Facebook | `read_insights` | Ver las vistas de cada Reel (Estadísticas) |
| Facebook | `instagram_basic` | Solo para la sección **Competencia** en Instagram |

Ya **no** se pide `business_management` (ClipViral no administra portafolios comerciales).
Si quieres una revisión más rápida de Facebook, puedes **no pedir `instagram_basic`**: lo único que deja de funcionar es ver la competencia en Instagram.

### 2.5 Llamadas de prueba (obligatorias antes de pedir la revisión)
Meta exige que cada permiso se haya usado al menos una vez antes de pedir el acceso avanzado.
Con tu cuenta de prueba, en la app:
1. **Redes → Conectar Instagram**, y **Conectar Facebook** (después de aceptar, el navegador te deja elegir la página).
2. En **Redes → Crear publicación** (o en **Clips sugeridos**), publica un clip en Instagram y en Facebook con **Publicar ahora**.
3. Abre **Estadísticas → Actualizar** (y **Competencia**, si vas a pedir `instagram_basic`).
En *Revisión de la app → Permisos y funciones* el contador de cada permiso debe pasar a "1 llamada" o más (puede tardar hasta 24 h).

### 2.6 Verificación del negocio
Meta pide **verificar tu negocio** para dar acceso avanzado (que es lo que permite que cualquier cliente conecte su cuenta):
1. **business.facebook.com → Configuración del negocio → Centro de seguridad → Verificación del negocio**.
2. Datos: nombre legal (igual al de tus documentos), dirección, teléfono y sitio web (`https://api.tudominio.com` o tu web principal).
3. Documentos: registro del negocio, documento de impuestos o una factura de servicios a nombre del negocio.
4. Conecta la app a ese portafolio (Configuración de la app → Básica → "Portafolio comercial").
5. Como otros negocios (tus clientes) van a usar tu app, Meta puede pedir además la **verificación de acceso** ("proveedor de tecnología"):
   es un formulario corto en el mismo lugar.

**Tiempos aproximados:** la verificación del negocio tarda de unos días a 2 semanas (a veces más si piden otro documento).
**Haz la verificación primero:** sin ella no se puede pedir el acceso avanzado.

### 2.7 Qué grabar en los videos de demostración
Todo está en **[GUION-VIDEO-META.md](GUION-VIDEO-META.md)**: qué preparar, qué hacer en cada paso y qué permiso demuestra.
En corto: **dos videos** (Facebook e Instagram) grabados con **`Grabar video para Meta.bat`**, que pone subtítulos en inglés con el
paso y el permiso. Se sube el mismo video en cada permiso que muestra.

- **Facebook** (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic`):
  entrar a ClipViral → **Redes → Connect Facebook** → inicio de sesión → permisos (marca la página) → **"Choose your Facebook Page"**
  → la app muestra la página y su Instagram → **Create post** → texto → **Schedule** → **Publish now** → **View on Facebook**
  → **Statistics → Refresh** → (si lo pides) **Competitors** con una cuenta de Instagram.
- **Instagram** (`instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`):
  entrar → **Connect Instagram** → inicio de sesión → **Permitir** → la app muestra `@cuenta` y tipo → **Create post** → **Publish now**
  → **View on Instagram** → **Statistics → Refresh**.

### 2.8 Textos para justificar cada permiso (pegar en inglés)

**`instagram_business_basic`**
```
ClipViral uses instagram_business_basic to identify the creator's Instagram professional account after they log in with Instagram. We show the account's username and profile picture in the app so the creator knows which account their Reels will be published to, and we use the account ID to publish and to read the insights of their own Reels.
```

**`instagram_business_content_publish`**
```
ClipViral creates short vertical clips with captions from the creator's own live streams and videos. With instagram_business_content_publish the creator publishes a clip as a Reel to their own Instagram professional account, either right away ("Publish now") or at a suggested time if they turned on automatic posting for Instagram. The caption is prepared by the app and shown to the creator before publishing. Automatic posting is off by default; the creator can turn it off and cancel any scheduled Reel at any time.
```

**`instagram_business_manage_insights`**
```
We read the views, likes, comments and shares of the Reels the creator published with ClipViral, to show performance in the Statistics section and to suggest the best posting times for their audience. We only read insights of the creator's own media.
```

**`pages_show_list`**
```
After Facebook Login, ClipViral lists the Pages the person manages so they can choose which Page their Reels are published to (Networks > Page to publish to). We use the Page ID and name only for that.
```

**`pages_read_engagement`**
```
Required to read the selected Page's basic information and the engagement (likes and comments) of the Reels published with ClipViral, shown in the Statistics section. It is also a dependency of pages_manage_posts.
```

**`pages_manage_posts`**
```
ClipViral publishes Reels to the Page the person selected, using the Reels Publishing API (video_reels), either right away ("Publish now") or at a suggested time if they turned on automatic posting for Facebook. Automatic posting is off by default, and the person can cancel scheduled Reels or disconnect at any time.
```

**`read_insights`**
```
We read the video insights (plays) of the Reels published with ClipViral to show how each one performed and to suggest the best posting times.
```

**`instagram_basic`**
```
Used only in the optional Competitors section: with the Instagram professional account linked to the person's Page, ClipViral uses Business Discovery to show public metrics (likes and comments) of public business or creator accounts that the person chooses to follow. We do not store personal data of those accounts.
```

**Preguntas sobre el manejo de datos** (Meta las hace en la revisión). Respuestas de base:
- *¿Quién procesa los datos?* Tu proveedor de servidores (el VPS) y, solo para el análisis con IA, Anthropic (no recibe datos de Meta).
- *¿Cómo se borran?* Al desconectar en la app, al quitar el permiso desde Instagram/Facebook (avisos automáticos) o escribiendo al correo de privacidad.
- *¿Se comparten con terceros para publicidad?* No.

### 2.9 Después de la aprobación
- Pon la app en **modo Activo** (arriba en el panel de Meta).
- Meta pide una **revisión anual de uso de datos** (Data Use Checkup): te llega un aviso; responde a tiempo para no perder los permisos.

**Tiempos aproximados (Meta):** verificación del negocio, de días a 2 semanas; revisión de la app, normalmente de unos días a 2 semanas
por envío. Es común que rechacen la primera vez por un video poco claro: lee el motivo, corrige y reenvía.

---

## 3. Qué hace ClipViral con la publicación automática (para explicarlo si preguntan)
- **Empieza apagada** en cada red. Se enciende en **Clips sugeridos → Publicación automática**.
- **Instagram y Facebook:** cada clip sugerido se programa a su **hora sugerida** con el **texto armado para esa red**
  (como mucho 4 por día en cada red). Se puede cancelar cualquiera antes de que salga.
- **TikTok:** la persona **aprueba cada clip** en la pantalla de TikTok y se publica solo a su hora.
- **YouTube:** sigue con subida manual.
- Si la PC estaba apagada a la hora elegida, la publicación pasa a la **próxima hora buena** en vez de salir a deshora.
- Los videos se suben **directo desde la PC**. Solo si Instagram no acepta la subida directa, el clip pasa un momento por el servidor
  (se borra al publicarse o a las 24 h).
- Al desconectar una red se borra su permiso del servidor (en TikTok además se anula). Si la persona quita el permiso desde la red,
  la red avisa al servidor y se borra solo.

## 4. Lista rápida
- [ ] Servidor con https y dominio; dirección puesta en el panel.
- [ ] Datos legales completos; páginas `/privacy`, `/terms`, `/data-deletion` sin nada en amarillo.
- [ ] Panel de admin → Permisos de redes: todo en verde.
- [ ] TikTok: app creada, productos y scopes, claves en el panel, prueba con "Solo yo", video de demo, revisión de la app, auditoría de Direct Post.
- [ ] Meta: app creada, Instagram y Facebook configurados, claves en el panel, llamadas de prueba, verificación del negocio, videos de demo, revisión, modo Activo.

> Nota: las páginas legales son una base razonable, pero no reemplazan a un abogado. Si vendes en varios países, pide que las revise.
