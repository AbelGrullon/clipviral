# Bot de Discord de ClipViral

El bot atiende a tus clientes en tu servidor de Discord:

- **Tickets privados.** El cliente toca un botón y elige:
  - 💬 **Soporte / ayuda**
  - 📣 **Reclamación**
  - 🐞 **Reporte de error**

  Se le abre un canal que **solo ven él y tu equipo**.
- **Su cuenta de ClipViral.** El cliente escribe su correo al abrir el ticket. Tu equipo ve su plan, cuándo vence,
  lo que ha pagado y cuántos clips ha hecho. Eso sale **solo en el canal del equipo**: el cliente no lo ve.
- **Cerrar el ticket.** Lo cierra el cliente o el equipo. Se guarda la conversación completa en el canal del equipo y
  el canal se borra. Al cliente también le llega una copia por mensaje privado.
- **Noticias.** Cada vez que publicas una versión nueva, sale sola en el canal de anuncios en menos de 2 minutos.
  Da igual si la publicas con `Publicar versión de ClipViral.bat` o en el panel → **Actualizaciones**.
  También puedes escribir anuncios tú con `/anunciar`.

Para probarlo, primero lo enciendes en tu PC (pasos 1 a 4). Para que quede encendido siempre, lo instalas en el VPS
(paso 6).

---

## Paso 1. Crea tu servidor de Discord

1. Abre Discord (la app o discord.com en el navegador) con tu cuenta.
2. En la barra de la izquierda, toca el **+** (Añadir un servidor).
3. Elige **Crear el mío** → **Para un club o una comunidad**.
4. Ponle de nombre **ClipViral**, sube el logo si quieres y toca **Crear**.

## Paso 2. Crea el bot (en el portal de desarrolladores)

1. Entra a **https://discord.com/developers/applications** con tu misma cuenta de Discord.
2. Toca **New Application**, ponle **ClipViral**, acepta las condiciones y toca **Create**.
3. En el menú de la izquierda, entra a **Bot**:
   - Si quieres, ponle el logo de ClipViral como foto.
   - Baja hasta **Privileged Gateway Intents** y enciende **Message Content Intent**.
     Hace falta para guardar la conversación de cada ticket. Los otros dos no hacen falta.
   - Toca **Save Changes**.
   - Arriba, toca **Reset Token** → **Yes, do it!** → **Copy**. Ese es el **token**.
4. Recomendado, para que nadie más pueda meter tu bot en otros servidores:
   - En **Installation**, cambia **Install Link** a **None** y guarda.
   - En **Bot**, apaga **Public Bot** y guarda.

> 🔒 **El token es como la contraseña del bot.** No se lo pases a nadie, no lo mandes por WhatsApp y no lo pegues en
> ningún chat (tampoco aquí con Claude). Solo lo pegas en la ventana negra del paso 3.
> Si alguien lo ve, entra a **Bot → Reset Token** y vuelve a hacer el paso 3 con el nuevo.

## Paso 3. Enciéndelo en tu PC

1. En la carpeta de ClipViral, doble clic en **`Encender bot de Discord.bat`**.
2. Cuando diga *"Pega el token"*, pégalo con **clic derecho** o **Ctrl+V** (se ven asteriscos) y pulsa **Enter**.
   - Si te pide encender **Message Content Intent**, hazlo (paso 2) y pulsa Enter.
3. Cuando pregunte la dirección del servidor de ClipViral, pulsa **Enter** (queda `https://cviral.duckdns.org`).
4. Te muestra un **enlace para invitar el bot**. Ábrelo en el navegador:
   - elige tu servidor **ClipViral**;
   - toca **Continuar** y luego **Autorizar**.
5. Deja la ventana negra abierta (puedes minimizarla). Si la cierras, el bot se apaga.

La próxima vez que abras el `.bat` se enciende solo. Si quieres cambiar el token o la dirección, pulsa **C** al abrirlo.

## Paso 4. Lo que el bot arma solo en tu servidor

Al entrar, el bot crea lo que falta:

| Qué | Para qué | Quién lo ve |
|---|---|---|
| Rol **Equipo ClipViral** | La gente que te ayuda con los tickets | — |
| **📢・anuncios** | Versiones nuevas y tus anuncios | Todos lo leen; solo el equipo escribe |
| **📩・abrir-ticket** | Los botones para abrir un ticket | Todos lo leen; nadie escribe |
| **📋・registro-tickets** | Tickets nuevos con la cuenta del cliente y la conversación de cada ticket cerrado | Solo el equipo |
| Un canal por ticket (`soporte-0001-ana`) | La conversación con el cliente | El cliente y el equipo |

**Si alguien te ayuda**, dale el rol: clic derecho sobre su nombre → **Roles** → marca **Equipo ClipViral**.
Tú, como dueño del servidor, ya ves todo.

Puedes cambiar el nombre o el orden de los canales; el bot los sigue reconociendo.
Si borras alguno sin querer, escribe **`/configurar`** y lo vuelve a crear.

El bot trabaja **solo en tu servidor** (el primero donde lo invitaste). Si otra persona lo mete en el suyo, ahí no
hace nada: así nadie puede ver las cuentas de tus clientes desde otro lado.

## Paso 5. Pruébalo

Para ver lo mismo que ve un cliente, usa otra cuenta de Discord (o pídele a un amigo que entre a tu servidor).
También funciona con tu cuenta; solo que tú, como dueño, ves todos los canales.

1. En **📩・abrir-ticket**, toca **💬 Soporte / ayuda**, escribe un correo de una cuenta de ClipViral y un mensaje, y envía.
   - El cliente ve *"Listo, tu ticket está aquí"* con el enlace al canal nuevo.
   - En **📋・registro-tickets** sale el aviso del ticket nuevo.
2. Escribe algo en el ticket, manda una captura y toca **🔒 Cerrar ticket** → **Sí, cerrar**.
   - En **📋・registro-tickets** sale el resumen con el archivo de la conversación.
   - El canal se borra a los pocos segundos.
3. Repite con **📣 Reclamación** y **🐞 Reporte de error**.
4. Noticias: escribe **`/anunciar-version`**. En **📢・anuncios** sale la última versión publicada en tu panel.
   Prueba también **`/anunciar`** con un mensaje tuyo.

> Mientras el bot esté en tu PC, el aviso del registro dice *"No pude revisar la cuenta: el bot todavía no está
> conectado con las cuentas"*. Es normal: eso se conecta en el VPS (paso 6).

## Paso 6. Déjalo siempre encendido en el VPS

1. **En tu PC**:
   - cierra los tickets de prueba que sigan abiertos (el bot del VPS empieza su propia lista);
   - cierra la ventana de `Encender bot de Discord.bat`. Si quedan dos bots encendidos, se estorban.
2. Actualiza el servidor del VPS como siempre. Así el servidor aprende a contestarle al bot, y la copia ya trae el bot:
   - En tu PC: **`Preparar copia para el VPS.bat`**.
   - Copia el zip al VPS y descomprímelo en `C:\` encima de lo que hay (**Reemplazar**).
   - En el VPS: clic derecho en **`Instalar en el VPS.bat`** → **Ejecutar como administrador** → Enter, Enter.
3. **En el VPS**: clic derecho en **`Instalar bot de Discord en el VPS.bat`** → **Ejecutar como administrador**:
   - pega el token (el mismo de antes);
   - en la dirección de tu web, pulsa **Enter** (`https://cviral.duckdns.org`).

   El instalador conecta el bot con las cuentas de tus clientes. Crea la tarea **"ClipViral bot de Discord"**: el bot
   se enciende solo con el VPS, aunque nadie esté conectado, y si se cae vuelve.
4. Abre un ticket de prueba con tu correo de ClipViral. En **📋・registro-tickets** tienen que salir tu plan y tus pagos.

Para actualizar el bot o cambiar el token, vuelve a abrir el mismo `.bat` como administrador.

---

## Comandos

| Comando | Quién | Qué hace |
|---|---|---|
| `/ticket` | Cualquiera | Abre un ticket (igual que los botones) |
| `/cerrar` | El cliente del ticket o el equipo | Cierra el ticket; puedes poner el motivo |
| `/anunciar` | Tú (y los administradores) | Publica un anuncio tuyo en 📢・anuncios |
| `/anunciar-version` | Tú (y los administradores) | Vuelve a anunciar la última versión publicada |
| `/configurar` | Tú (y los administradores) | Crea o repara los canales y los botones |

Un cliente puede tener hasta **3 tickets abiertos** a la vez.

Para que alguien del equipo pueda usar `/anunciar` sin ser administrador:
**Ajustes del servidor → Integraciones → ClipViral** → permítele ese comando.

## Si algo no funciona

- **"Falta encender MESSAGE CONTENT INTENT"**: haz el paso 2.3 y vuelve a encender el bot.
- **"El token no es válido"**: entra a Bot → **Reset Token** → copia el nuevo y vuelve a abrir el `.bat`.
  - En la PC, al abrirlo pulsa **C**.
  - En el VPS, ábrelo como administrador.
- **"No tengo permisos suficientes"**: vuelve a invitar el bot con el enlace del paso 3 (abre otra vez el `.bat` y
  pulsa C para verlo). Después escribe `/configurar`.
- **No aparecen los comandos con /**: cierra y abre Discord (o pulsa Ctrl+R).
- **No sale el anuncio de una versión**:
  - revisa que la versión esté en el panel → **Actualizaciones**;
  - espera 2 minutos;
  - o usa `/anunciar-version`.
- **"No pude revisar la cuenta"** en el registro:
  - *versión vieja*: actualiza el servidor del VPS (paso 6.2);
  - *la clave no coincide*: vuelve a abrir `Instalar bot de Discord en el VPS.bat`.
- **Registro del bot**:
  - en la PC: lo que dice la ventana negra;
  - en el VPS: `C:\ClipViral\discord-bot\bot.log`.
- **Copia de cada conversación**, aunque se borre el canal: `discord-bot\data\transcripciones`.
