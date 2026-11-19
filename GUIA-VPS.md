# ClipViral en tu VPS (cviral.duckdns.org)

Con ClipViral en tu VPS de Contabo tienes, en un solo lugar y siempre encendido:

- **La web** `https://cviral.duckdns.org`: información, planes, compra con tarjeta y el botón **Descargar**.
- **El panel de administración** `https://cviral.duckdns.org/admin/`:
  - usuarios y membresías (dar días, cambiar plan, suspender, **hacer administrador**);
  - pagos, correos, planes y precios;
  - **Actualizaciones**: aquí subes el `.exe` de la actualización y el `.zip` de la web.
- **El servidor de la app**: todas las cuentas viven aquí.
  - Cada persona instala ClipViral, crea su cuenta y compra su plan.
  - La app avisa sola cuando hay versión nueva y se actualiza desde la misma app.
  - Si la cuenta es de administrador, la app muestra lo de administrador: **Agente**, **Claves de clientes**,
    **Panel de administración** y, en Ajustes, la tarjeta **Servidor**.
- **Lo programado se publica a su hora** aunque tu PC esté apagada.

Tu VPS ya tiene **Caddy** con otras páginas. ClipViral **no abre otro Caddy**: se agrega al tuyo.
Tus otras páginas no se tocan, y antes de cambiar nada se guarda una copia de tu Caddyfile.

---

## Lo que necesitas

- Tu VPS de Contabo con Windows Server. Entras por Escritorio remoto, con el usuario **Administrator**.
- La dirección **cviral.duckdns.org** apuntando a la IP del VPS:
  - entra a [duckdns.org](https://www.duckdns.org);
  - en `cviral` pon la IP del VPS en **current ip** → **update ip**.
- Tu Caddy funcionando en el VPS, como ya lo tienes.
- **Node.js** en el VPS: [nodejs.org](https://nodejs.org/es/download), el botón **LTS** (Siguiente, Siguiente…).

## Paso 1. En tu PC: arma la copia del servidor

1. Doble clic en **`Preparar copia para el VPS.bat`**.
2. En tu escritorio aparece **`ClipViral para el VPS (PRIVADO).zip`**.

Lleva el servidor y **tus datos**: tu cuenta de administrador, tus redes conectadas y tu clave de Claude.
Es **privada**: no se la pases a nadie y bórrala al terminar.

## Paso 2. Pásala al VPS

1. Abre **Conexión a Escritorio remoto** → la IP del VPS → usuario `Administrator`.
2. Copia el zip de tu PC y pégalo en el escritorio del VPS.
3. En el VPS: clic derecho en el zip → **Extraer todo** → escribe `C:\` → Extraer. Queda `C:\ClipViral`.

## Paso 3. En el VPS: instala

1. En `C:\ClipViral`, clic derecho en **`Instalar en el VPS.bat`** → **Ejecutar como administrador**.
2. Cuando pregunte la dirección, pulsa **Enter** (usa `cviral.duckdns.org`).
3. Dice **"Encontré tu Caddy funcionando"** y pregunta si agrega ClipViral a tu Caddyfile: responde **S**.
   - Agrega este bloque, marcado con `# ClipViral (inicio)` y `# ClipViral (fin)`:
     ```
     cviral.duckdns.org {
         encode gzip
         reverse_proxy 127.0.0.1:4600
     }
     ```
   - Recarga tu Caddy (`caddy reload`). Si Caddy no acepta el cambio, deja tu Caddyfile como estaba.
   - Si no encuentra tu Caddyfile, te pregunta dónde está. Si prefieres hacerlo tú, responde **n** y te muestra
     el bloque para pegarlo a mano.
4. Crea la tarea **ClipViral servidor**. Esa tarea:
   - mantiene ClipViral encendido aunque cierres el Escritorio remoto;
   - lo vuelve a encender si el VPS se reinicia.
5. El servidor solo escucha dentro del VPS (`127.0.0.1:4600`): desde internet se entra por tu Caddy, con candado.

> **¿El puerto 4600 ya lo usa otra de tus páginas?** El instalador no la toca y te avisa.
> Abre `C:\ClipViral\server\.env`, cambia `PORT=4600` por `PORT=4610` y vuelve a abrir el instalador.

Al final te muestra la dirección de la web y la del panel. **Borra el zip PRIVADO** del VPS y de tu PC.

## Paso 4. En el panel: deja todo listo para vender

Entra a `https://cviral.duckdns.org/admin/` con tu correo y contraseña de siempre.

- **Pagos → PayPal**:
  - pega tus claves de PayPal;
  - prueba primero con **sandbox** (no cobra de verdad) y después cambia a **live**.
  - La dirección de vuelta de PayPal (`https://cviral.duckdns.org`) ya la dejó puesta el instalador.
- **Ajustes**:
  - **Días de prueba gratis** para cuentas nuevas. Pon **0** si quieres que paguen antes de usarla.
  - Tu contacto de **soporte**, que sale en la web, en la app y en los correos. Déjalo **vacío** para que lleve al Discord de ClipViral (`https://discord.gg/2k4Q3bBMh`).
- **Planes y precios**: revisa los precios que salen en la web y en la app.
- **Correos** (opcional): la bienvenida, los avisos de vencimiento y los pagos.

## Paso 5. En tu PC: publica la app

1. Doble clic en **`Publicar versión de ClipViral.bat`**. Lo primero que pide es la dirección: escribe
   `cviral.duckdns.org` (la guarda para las próximas veces).
2. Pulsa **Enter** para la versión que propone (por ejemplo 1.0.1). Cada vez que publicas, sube un número.
3. Arma el instalador `ClipViral-Setup-1.0.1.exe` y lo deja en `desktop\dist-instalador`.
   - Ese instalador ya viene conectado a tu VPS.
4. Pregunta si lo sube. Responde **S**, escribe qué trae la versión, tu correo y tu contraseña de administrador.
   - La contraseña no se ve al escribirla y no se guarda.
5. Lo sube **una sola vez** y sirve para las dos cosas:
   - la **actualización**: las apps instaladas avisan **"Nueva versión disponible"** y se actualizan con un clic;
   - la **descarga de la web**: el VPS arma solo el `.zip`, y el botón **Descargar** de `https://cviral.duckdns.org` baja la versión nueva.

También puedes subirlo a mano en el panel → **Actualizaciones**: suelta el `.exe` y deja marcada
**"Usar este mismo instalador para la descarga de la web"**. Si alguna vez quieres un `.zip` distinto para la web,
suéltalo en el otro cuadro.

> La subida depende de la velocidad de **subida** de tu internet, que casi siempre es mucho menor que la de bajada.

---

## El día a día

**Una persona nueva:**

1. Descarga ClipViral desde tu web.
2. Abre la app y crea su cuenta.
3. Compra su plan con tarjeta, en la web (**Comprar**) o en la app (**Mi plan**). Se activa solo.

**Alguien te paga directo a ti:**

1. Entra al panel → **Usuarios**.
2. Busca a esa persona → **Gestionar**.
3. Usa **Registrar pago manual** o los botones **+1 mes**, **+90 días** y **+1 año**.

En la web y en la app no aparece nada sobre pagos a mano.

**Dar acceso de administrador:**

1. En el panel → **Usuarios** → **Gestionar** → **Hacer admin**.
2. En menos de 3 minutos, su app muestra lo de administrador sin cerrar nada.
3. **Quitar admin** lo quita igual.

**Tu clave de Claude y los otros administradores:**

- Un administrador nuevo **no usa tu clave** de Claude. Puede poner la suya en la app (**Ajustes → Clave de Claude**),
  y lo que gaste se cobra en su cuenta.
- Si quieres que use la tuya: panel → **Usuarios** → **Gestionar** → marca **"Puede usar tu clave de Claude"**.
  Si tiene su propia clave puesta, igual usa la suya.
- Tu clave (la del servidor) se cambia en el panel → **Ajustes**.

**Membresías:** en **Usuarios** ves el plan de cada persona y hasta cuándo dura. Desde ahí puedes:

- sumar días;
- cambiar el plan;
- suspender o reactivar.

**Tu propia app:** instala el mismo `ClipViral-Setup` y entra con tu correo de administrador.

- Tus amigos con la versión "Administrador" vieja deben hacer dos cosas:
  - instalar el nuevo;
  - crear su cuenta, y tú los haces admin en el panel.
- Los `.bat` viejos `Empaquetar app para clientes/administradores` ya no hacen falta.

## Actualizar el servidor del VPS

1. En tu PC: `Preparar copia para el VPS.bat`.
2. Copia el zip al VPS y descomprímelo en `C:\` encima de lo que hay (**Reemplazar**).
3. Clic derecho en `Instalar en el VPS.bat` → Ejecutar como administrador → Enter, Enter.

Tus datos del VPS no se reemplazan: usuarios, pagos, versiones y la descarga de la web. Tu Caddyfile
tampoco se duplica: el bloque de ClipViral se cambia en su lugar.

## Si algo no funciona

- **La web no abre:**
  - revisa que en duckdns.org `cviral` tenga la IP del VPS;
  - abre tu Caddyfile y revisa que esté el bloque de ClipViral.
- **Registros en el VPS:**
  - `C:\ClipViral\server\servidor.log`: ClipViral;
  - el log de tu Caddy: el certificado.
- **Volver a tu Caddyfile de antes:** está guardado como `Caddyfile.antes-de-clipviral.bak`, al lado del tuyo.
- **Reiniciar todo:** vuelve a abrir `Instalar en el VPS.bat` como administrador. Apaga solo lo de ClipViral y lo
  vuelve a encender.
