# ClipViral en tu VPS (para publicar con la PC apagada)

Con el servidor de ClipViral en tu VPS, lo que programas se publica a su hora **aunque tu PC esté apagada**.
Funciona igual que con el servidor en tu PC; la única diferencia es que el VPS está siempre encendido.

- **Lo que sigue en tu PC:** hacer los clips (bajar el directo, cortar, subtítulos) y programarlos.
- **Lo que pasa al VPS:** tu cuenta, tus redes conectadas y la publicación a su hora.

Al programar, la app manda el video al VPS. Cuando la publicación dice **📡 en el servidor**, ya puedes apagar la PC.

---

## Lo que necesitas

- Tu VPS de Contabo con Windows Server. Contabo te mandó por correo su **IP**, el usuario (**Administrator**) y la contraseña.
- Unos 20 minutos.
- Recomendado: una **dirección con candado (https)**. Es gratis con DuckDNS y Caddy (paso 3). Sin candado también
  funciona, pero tu contraseña y tus conexiones viajan sin cifrar: úsalo solo para probar.

---

## Paso 1. En tu PC: arma la copia

1. Doble clic en **`Preparar copia para el VPS.bat`** (en la carpeta de ClipViral).
2. En tu escritorio aparece **`ClipViral para el VPS (PRIVADO).zip`**.

La copia lleva el servidor y **tus datos**: tu cuenta, tu Facebook conectado y tu clave de Claude. Por eso es
**privada**: no se la pases a nadie y bórrala al terminar.

## Paso 2. Entra al VPS y pasa la copia

1. En tu PC, abre **Conexión a Escritorio remoto** (búscalo en el menú Inicio).
2. Escribe la IP del VPS → **Conectar** → usuario `Administrator` y la contraseña de Contabo.
3. Copia el zip en tu PC (clic derecho → Copiar) y pégalo en el escritorio del VPS (clic derecho → Pegar).
4. En el VPS: clic derecho en el zip → **Extraer todo** → escribe `C:\` → Extraer. Queda la carpeta `C:\ClipViral`.
5. Instala **Node.js** en el VPS: [nodejs.org](https://nodejs.org/es/download), el botón **LTS** (Siguiente, Siguiente…).

> Si el navegador del VPS no te deja descargar, descarga el instalador en tu PC y pásalo al VPS igual que el zip.

## Paso 3 (recomendado). Dirección con candado

**La dirección (gratis):**

1. Entra a [duckdns.org](https://www.duckdns.org) y entra con tu cuenta de Google.
2. En **sub domain** escribe un nombre (por ejemplo `miclipviral`) → **add domain**.
3. En **current ip** pon la IP de tu VPS → **update ip**.
4. Tu dirección queda así: `miclipviral.duckdns.org`.

**El candado (Caddy):**

1. Entra a [caddyserver.com/download](https://caddyserver.com/download), elige **Windows amd64** → **Download**.
2. En el VPS, crea la carpeta `C:\ClipViral\https`.
3. Pon ahí el archivo que bajaste y cámbiale el nombre a **`caddy.exe`**.

Caddy saca y renueva solo el certificado https. Usa los puertos 80 y 443 del VPS. El instalador los abre.

## Paso 4. En el VPS: instala

1. En `C:\ClipViral`, clic derecho en **`Instalar en el VPS.bat`** → **Ejecutar como administrador**.
2. Cuando pregunte la dirección, escribe la tuya (`miclipviral.duckdns.org`). Si no hiciste el paso 3, pulsa Enter.
3. Al final te dice la dirección que vas a poner en la app, por ejemplo `https://miclipviral.duckdns.org`.

El instalador:

- trae tus datos;
- crea la tarea **ClipViral servidor**, que mantiene el servidor encendido aunque cierres el Escritorio remoto y lo
  vuelve a encender si el VPS se reinicia;
- abre el firewall de Windows;
- revisa que todo conteste.

Ya puedes cerrar el Escritorio remoto. **Borra el zip PRIVADO** del VPS y de tu PC.

## Paso 5. En tu PC: conecta la app al VPS

1. Abre ClipViral → **Ajustes** → **🖥️ Servidor de ClipViral**.
2. Pega la dirección (`https://miclipviral.duckdns.org`) → **Probar**. Debe decir que tu VPS contesta y publica solo.
3. **Usar mi VPS** → cierra y abre ClipViral.

Lo que ya tenías programado se pasa solo al VPS. En **Redes**, la tarjeta de Publicaciones dice
*"Tu servidor está en tu VPS"*.

---

## Cómo se usa

1. Programa como siempre (Crear publicación, o la publicación automática).
2. Espera a que la publicación diga **📡 en el servidor**. Si el clip es largo y tu internet lento, puede tardar un minuto.
3. Apaga la PC si quieres. A su hora, el VPS publica.
4. Cuando vuelvas a abrir ClipViral, verás **Publicado** y el botón **Ver en Facebook / Instagram**.

**Cancelar** y **Publicar ahora** también funcionan: la app se lo pide al VPS. Para eso hace falta internet.

## Preguntas

**¿Y si quiero volver a usar el servidor de mi PC?**
Ajustes → Servidor de ClipViral → **Volver al de esta PC**. Lo programado se pasa a tu PC, que lo publica
mientras esté encendida. Las redes conectadas se quedan en cada servidor: si conectaste algo nuevo en el VPS,
conéctalo también en la PC.

**¿Puedo apagar el interruptor del servidor?**
Sí: en Redes → Publicaciones, apaga **📡 Publicar desde el servidor**. Así la PC sube cada video a su hora y tiene
que estar encendida.

**Actualizar ClipViral en el VPS**

1. En tu PC: `Preparar copia para el VPS.bat`.
2. Copia el zip al VPS y descomprímelo en `C:\` encima de lo que hay (**Reemplazar**).
3. Clic derecho en `Instalar en el VPS.bat` → Ejecutar como administrador.

Tus datos del VPS **no se reemplazan** con los de la copia.

**No contesta**

- Revisa que en duckdns.org la dirección tenga la IP del VPS.
- Mira los registros en el VPS:
  - `C:\ClipViral\server\servidor.log` (el servidor);
  - `C:\ClipViral\https\caddy.log` (el candado).
- Vuelve a abrir `Instalar en el VPS.bat` como administrador: apaga lo viejo y enciende todo de nuevo.
- Si el VPS tiene IIS u otro programa en el puerto 80, Caddy no puede sacar el certificado. Ciérralo o pide ayuda.

**¿Es seguro?**

- **Usa https** (paso 3).
- **Usa una contraseña fuerte** para el VPS y para tu cuenta de ClipViral.
- Tus tokens van cifrados en el VPS, igual que en tu PC.
- El servidor solo deja entrar a tu cuenta.
