# Guion del video para la revisión de Meta

Meta pide un video (screencast) que muestre cómo ClipViral usa cada permiso. Esta guía te dice qué preparar,
cómo grabar con **"Grabar video para Meta.bat"** y qué hacer en cada paso.

> Revisado con la documentación oficial de Meta en noviembre de 2026
> ([grabaciones de pantalla](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings),
> [modos de la app](https://developers.facebook.com/docs/development/build-and-test/app-modes),
> [HTTPS en el inicio de sesión de Facebook](https://developers.facebook.com/blog/post/2018/06/08/enforce-https-facebook-login/)).

---

## En corto

- Graba **dos videos**: uno de **Facebook** y otro de **Instagram**. Cada uno tiene su propio inicio de sesión.
- **No hace falta hablar.** Meta no escucha el audio. El kit pone **subtítulos en inglés** en cada paso, con el permiso que se está usando.
- Un panel pequeño te dice qué hacer. **El panel no sale en el video.** Al terminar cada paso tocas **✓ Listo** (o **F9**).
- **Sin cortes.** Si algo sale mal, toca **Cancelar** y empieza de nuevo.
- Los videos quedan en la carpeta **`Videos para Meta`**, dentro de la carpeta de ClipViral.

### ¿Uno solo o uno por permiso?
**Dos videos** (Facebook e Instagram) es lo mejor. Meta pide un video en cada permiso, pero **se puede subir el mismo video
en varios permisos**. Uno por permiso serían 8 videos repitiendo el inicio de sesión (más trabajo y más chances de error).
Uno solo con todo serían unos 10 minutos y a quien revisa le cuesta encontrar cada parte. Igual, el kit tiene la opción
"Los dos en un solo video" si lo prefieres.

### ¿Por qué en inglés? (lo que decidí)
Quienes revisan en Meta leen inglés. Meta dice: *pon la app en inglés si puedes y, si no, agrega subtítulos*.
Por eso hice **las dos cosas**:
1. **Pantallas en inglés**: un botón **"🌐 English"** en **Redes** (también en **Ajustes**) pone en inglés el menú, la entrada,
   Redes, Crear publicación, las publicaciones y Estadísticas. Lo demás de la app sigue en español. Se apaga con el mismo botón.
2. **Subtítulos en inglés** dentro del video: hacen falta igual, porque las ventanas de Facebook e Instagram salen en el
   idioma de tu cuenta (español), y porque explican qué permiso se usa en cada paso (Meta lo recomienda).

Las páginas que ClipViral muestra en el navegador después de autorizar (elegir la página, "conectado") ya salen en inglés con el español debajo.

---

## 1. Antes de grabar

### En Meta (developers.facebook.com)
- [ ] **La app en modo desarrollo** (*Development*, arriba en el panel). Así la puedes usar tú sin la revisión.
- [ ] **Tú como administrador** de la app. Si la creaste tú, ya lo eres. En modo desarrollo solo funciona con las personas que tienen un rol en la app.
- [ ] **Una página de Facebook de prueba** que administres (puede llamarse, por ejemplo, "ClipViral Prueba").
- [ ] **Un Instagram profesional** (de empresa o de creador) **unido a esa página**.
      En Facebook: tu página → Configuración → Cuentas vinculadas → Instagram.
- [ ] **Instagram como evaluador**: Roles de la app → Evaluadores de Instagram → agrega tu cuenta, y acepta la invitación en
      Instagram → Configuración → Apps y sitios web → Invitaciones de evaluador.
- [ ] **Los permisos agregados** en la app (casos de uso): los de la tabla de abajo.
- [ ] **Las claves en el panel de admin de ClipViral** (http://localhost:4600/admin/ → Ajustes → Conexión con redes):
      Facebook (identificador de la app y clave secreta) e Instagram (identificador de la app de Instagram y su clave secreta).
      Las pegas tú; nunca se las pases a nadie.
- [ ] **La URL de regreso** (ver abajo, es lo más delicado).

### La URL de regreso: ¿sirve `http://localhost`?
- **Facebook: sí, mientras la app esté en modo desarrollo.** Meta lo dice en su anuncio oficial de HTTPS:
  *"You will still be able to use HTTP with "localhost" addresses, but only while your app is still in development mode."*
  Qué hacer:
  1. En el panel de admin de ClipViral deja **vacía** la "Dirección pública del servidor" (usa `http://localhost:4600`).
  2. En Meta → **Inicio de sesión con Facebook para empresas → Configuración → URI de redireccionamiento de OAuth válidos**,
     pega `http://localhost:4600/api/social/facebook/callback`. Si Meta responde que *localhost se permite solo en modo desarrollo*
     y no hace falta agregarlo, está bien: déjalo así.
  3. Si al conectar aparece **"URL bloqueada"**, usa el plan B (túnel https).
- **Instagram: la documentación de Meta no dice que acepte `localhost`**, y otros desarrolladores cuentan que pide **https**.
  Prueba primero con `http://localhost:4600/api/social/instagram/callback`. Si el panel de Meta no lo acepta, usa el plan B.

**Plan B: túnel https (gratis, solo mientras grabas).** Un túnel le da a tu servidor local una dirección `https://` temporal.
Cloudflare tiene uno gratis sin cuenta (`cloudflared`, se baja de la página oficial de Cloudflare en GitHub):
1. Con ClipViral encendido, en una ventana de comandos: `cloudflared tunnel --url http://localhost:4600`.
   Te da una dirección como `https://algo-raro.trycloudflare.com`.
2. Pega esa dirección en el panel de admin de ClipViral → **Dirección pública del servidor**.
3. En Meta pega `https://algo-raro.trycloudflare.com/api/social/instagram/callback` (y la de Facebook si la necesitas).
4. Graba. Esa dirección cambia cada vez que abres el túnel: si lo vuelves a abrir, repite 2 y 3.
5. Al terminar, cierra el túnel y deja vacía otra vez la "Dirección pública".

Si quieres, te acompaño en vivo con el túnel; descargar y abrir `cloudflared` lo haces tú (o me das permiso en el chat).

> Para **enviar** la revisión (no para grabar), Meta revisa tu política de privacidad y la página de borrado de datos en una
> dirección https pública. Eso está en `GUIA-PERMISOS-REDES.md`, sección 0.

### En tu PC
- [ ] ClipViral abierto con **"Iniciar ClipViral.bat"**, actualizado a esta versión.
- [ ] **"🌐 English"** encendido (Redes → botón arriba a la derecha).
- [ ] **Sesión de ClipViral cerrada** (Ajustes → Cerrar sesión), para que se vea cómo se entra. Ten a mano tu correo y contraseña.
- [ ] **Facebook e Instagram desconectados** en ClipViral (Redes → Disconnect) y **sesión de Facebook e Instagram cerrada en el
      navegador**, para que se vea el inicio de sesión. Meta pide grabar "desde que no hay sesión hasta que la hay".
- [ ] **Un clip hecho con contenido tuyo**, de **3 a 90 segundos** (Facebook no acepta Reels más largos).
      Para Instagram conviene un segundo clip si vas a mostrar "Schedule".
- [ ] **Nada privado en pantalla** y las notificaciones en silencio (Windows: "No molestar"). Cierra lo que no uses.
- [ ] Pantalla de 1080p o más. Si el texto se ve chico, sube el zoom de Windows a 125 % (Meta recomienda que se lea bien).

---

## 2. Cómo grabar

1. Abre **`Iniciar ClipViral.bat`** (si no está abierto). Deja ClipViral en la pantalla de entrada.
2. Abre **`Grabar video para Meta.bat`**. Se abre una ventana:
   - Elige **Facebook** (primero) o **Instagram**.
   - Marca la lista "Antes de grabar".
   - Toca **● Empezar a grabar**. Hay una cuenta regresiva de 3 segundos.
3. La ventana se achica a un panel abajo a la derecha (lo puedes arrastrar). **No sale en el video.**
   Haz lo que dice el panel y toca **✓ Listo** (o **F9**) al terminar cada paso. **F8** vuelve un paso atrás.
   Los pasos opcionales tienen el botón **Saltar** (ese paso no sale en el video).
4. En el último paso toca **■ Terminar**. El kit arma el video con los subtítulos (tarda más o menos lo que duró la grabación).
5. Toca **▶ Ver el video** y míralo completo: que se lean los subtítulos y se vea cada paso.

Junto al video quedan:
- `… - subtitulos (en).srt`: los mismos subtítulos aparte.
- `… - pasos.txt`: en qué minuto va cada paso (te sirve para el formulario de Meta).

Mueve el mouse con calma. Meta recomienda usar el mouse más que el teclado. Las contraseñas las escribes tú.

---

## 3. Video 1: Facebook (páginas y Reels)

Permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic`.
Dura unos 5 a 7 minutos.

| # | Qué haces | Subtítulo en inglés (lo pone el kit) | Permiso que demuestra |
|---|---|---|---|
| 1 | Abre ClipViral (doble clic en su ícono) y entra con tu correo y tu contraseña de ClipViral. | Opening ClipViral, a Windows app for creators, and signing in with a ClipViral account. | Acceso a la app |
| 2 | Ve a Redes (Networks). Muestra que Facebook dice "Not connected" y toca "Connect Facebook". | Networks screen: Facebook is not connected yet. Clicking "Connect Facebook" opens Facebook Login for Business in the browser. | Inicio de sesión con Facebook |
| 3 | En el navegador, inicia sesión en Facebook con tu cuenta (escribe tú la contraseña). | Logging in to Facebook with the test account (an administrator of the app). | Inicio de sesión con Facebook |
| 4 | Acepta los permisos: marca tu página de prueba (y su Instagram si lo pide) y toca Continuar / Guardar. | Granting the permissions: selecting the test Page (and its Instagram account) and confirming. | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `instagram_basic` |
| 5 | Sale la página de ClipViral "Choose your Facebook Page". Elige tu página de prueba y toca "Publish to this Page". | ClipViral lists the Pages this person manages. The person chooses the Page where the Reels will be published. | `pages_show_list` |
| 6 | Vuelve a ClipViral. Muestra la tarjeta de Facebook: la página elegida, su foto y el Instagram unido. Abre un momento la lista "Page to publish to". | Back in ClipViral: the connected Page, its picture and its linked Instagram account. The Page can be changed here at any time. | `pages_show_list`, `pages_read_engagement` |
| 7 | En la tarjeta de Facebook toca "Create post" y elige un clip (de 3 a 90 segundos). | Creating a post: choosing the clip to publish as a Reel on the Page. | `pages_manage_posts` |
| 8 | Cambia un poco el texto (Caption). Toca "Schedule", elige una hora y toca el botón "Schedule". Muestra que queda "Scheduled" en Posts. | Editing the caption and scheduling the Reel for later. It shows as "Scheduled" in the Posts list and can be cancelled. | `pages_manage_posts` |
| 9 | En Posts, toca "Publish now" en esa publicación. Espera a que diga "Published" (1 o 2 minutos). | Publishing it now: ClipViral uploads the video to the Page with the Reels Publishing API. Status: "Published". | `pages_manage_posts` |
| 10 | Toca "View on Facebook". Se abre el Reel en tu página: muéstralo unos segundos (el nombre de la página y el texto). | Opening the post on Facebook: the Reel is live on the Page with the caption written in ClipViral. | `pages_manage_posts` |
| 11 | Vuelve a ClipViral → Statistics → Refresh. Muestra las vistas y los "me gusta" del Reel (si es nuevo, puede salir 0). | Statistics: ClipViral reads the plays and reactions of the published Reel from the Page. | `read_insights`, `pages_read_engagement` |
| 12 | *(Opcional)* Solo si pides `instagram_basic`: Competitors → agrega una cuenta pública de empresa de Instagram (por ejemplo @instagram) y revisa. Si no, toca "Saltar". | Competitors: with the Instagram account linked to the Page, ClipViral shows public likes and comments of a public business account (Business Discovery). | `instagram_basic` |
| 13 | Vuelve a Redes y muestra el botón "Disconnect" (no hace falta tocarlo). Toca "Terminar". | End of the demo. The person can disconnect the account at any time in Networks; ClipViral then deletes its access. | — |

> Si no vas a pedir `instagram_basic`, sáltate el paso 12 y quítalo también de los permisos de la app en Meta
> (lo único que deja de funcionar es ver la competencia en Instagram). Así la revisión es más simple.

## 4. Video 2: Instagram (Reels)

Permisos: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights`.
Dura unos 4 a 6 minutos. Antes, cierra la sesión de ClipViral otra vez y desconecta Instagram.

| # | Qué haces | Subtítulo en inglés (lo pone el kit) | Permiso que demuestra |
|---|---|---|---|
| 1 | Abre ClipViral y entra con tu correo y tu contraseña de ClipViral. | Opening ClipViral, a Windows app for creators, and signing in with a ClipViral account. | Acceso a la app |
| 2 | Ve a Redes (Networks). Muestra que Instagram dice "Not connected" y toca "Connect Instagram". | Networks screen: Instagram is not connected yet. Clicking "Connect Instagram" opens Instagram Business Login in the browser. | Inicio de sesión de Instagram |
| 3 | En el navegador, inicia sesión en Instagram con tu cuenta profesional de prueba (escribe tú la contraseña). | Logging in to Instagram with the test professional account. | Inicio de sesión de Instagram |
| 4 | Muestra la pantalla de permisos y toca "Permitir" (Allow). | Granting the permissions requested by ClipViral. | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` |
| 5 | Sale "Instagram connected" con tu @usuario. Vuelve a ClipViral y muestra la tarjeta de Instagram: @usuario, foto y tipo de cuenta. Toca "Open profile on Instagram" y vuelve. | Back in ClipViral: the connected account's username, profile picture and account type are shown, so the person knows where Reels will be published. | `instagram_business_basic` |
| 6 | En la tarjeta de Instagram toca "Create post" y elige un clip. | Creating a post: choosing the clip to publish as a Reel. | `instagram_business_content_publish` |
| 7 | Cambia un poco el texto (Caption) y toca "Publish now". Espera a que diga "Published" (1 a 3 minutos). | Editing the caption and publishing now. ClipViral uploads the video and Instagram processes it. Status: "Published". | `instagram_business_content_publish` |
| 8 | Toca "View on Instagram". Se abre el Reel: muéstralo unos segundos (tu @usuario y el texto). | Opening the post on Instagram: the Reel is live on the account with the caption written in ClipViral. | `instagram_business_content_publish` |
| 9 | *(Opcional)* "Create post" con otro clip → "Schedule" → elige una hora → "Schedule". Muestra que queda "Scheduled" y toca "Cancel". | Scheduling another Reel for later: it stays "Scheduled" in ClipViral and can be cancelled before it is posted. | `instagram_business_content_publish` |
| 10 | Ve a Statistics → Refresh. Muestra las vistas, "me gusta" y comentarios del Reel (si es nuevo, puede salir 0). | Statistics: views, likes and comments of the published Reel, read from the account's insights. | `instagram_business_manage_insights` |
| 11 | Vuelve a Redes y muestra el botón "Disconnect". Toca "Terminar". | End of the demo. The person can disconnect the account at any time in Networks; ClipViral then deletes its access. | — |

---

## 5. Subirlo a Meta

En **developers.facebook.com → tu app → Revisión de la app → Permisos y funciones**, pide **acceso avanzado** a cada permiso.
En cada uno, en "Screencast", sube el video que lo muestra:

| Permiso | Video |
|---|---|
| `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `read_insights` | Facebook |
| `instagram_basic` (si lo pides) | Facebook |
| `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | Instagram |

El texto de "cómo usa la app este permiso" está en `GUIA-PERMISOS-REDES.md`, sección 2.8 (ya en inglés).

**Nota para quien revisa** (pégala en el campo de notas o instrucciones, en inglés):
```
ClipViral is a Windows desktop app for content creators. The screencast was recorded on the creator's own PC with the
app's screens switched to English. English captions at the bottom of the video describe each step and name the permission
it uses ("STEP n · permission"). Facebook and Instagram login windows appear in the account's language (Spanish).
Flow shown: sign in to ClipViral, connect the account with Facebook Login for Business / Instagram Business Login,
grant the permissions, choose the Facebook Page, create a post from a clip, schedule it or publish it now, and open the
published Reel on Facebook / Instagram. Then the Statistics screen reads the insights of that Reel.
```

Meta también exige que cada permiso **se haya usado al menos una vez** antes de pedirlo: al grabar los videos ya quedan esas llamadas
(el contador puede tardar hasta 24 h en actualizarse).

---

## 6. Si algo sale mal

| Pasa esto | Haz esto |
|---|---|
| Facebook dice "URL bloqueada" o "redirect_uri" | Revisa la URL de regreso (sección 1). Si sigue, usa el plan B (túnel). |
| La página "Choose your Facebook Page" no sale y dice que no administras páginas | En la ventana de Facebook no marcaste tu página. Conecta otra vez y márcala. |
| "Facebook: los Reels deben durar entre 3 y 90 segundos" | Elige un clip más corto (en "Create post" los largos salen en gris). |
| Instagram se queda "Uploading" mucho rato | Es normal hasta 3 minutos. Si da error, usa el plan B (túnel): Instagram a veces necesita bajar el video desde una dirección pública. |
| Te equivocaste en un paso | **F8** vuelve atrás solo el subtítulo. Si lo que se ve en pantalla quedó mal, toca **Cancelar** y graba de nuevo. |
| El panel de pasos sale en el video | Pasa en Windows muy viejos (antes de la versión 2004). Actualiza Windows o mueve el panel a una esquina vacía. |
| El video pesa mucho (más de 100 MB) | Graba de nuevo sin programas que se muevan en pantalla, o divide en dos videos. |
| Falta FFmpeg | Abre ClipViral una vez con "Iniciar ClipViral.bat" e instala lo que pide. |

Cuando termines de grabar, apaga **"🌐 English"** en Redes para volver a ver la app en español.
