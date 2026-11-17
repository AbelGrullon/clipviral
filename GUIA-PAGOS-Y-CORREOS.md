# Cobrar con tarjeta y enviar correos

Tus clientes pagan con tarjeta **desde la app** (en la página segura de PayPal, sin necesitar cuenta PayPal).
Cada pago suma **1 mes** de licencia. Los correos de bienvenida, recuperar contraseña, pago recibido y
"tu plan vence pronto" salen solos desde tu Gmail.

Todo se configura en tu **panel de admin** (`/admin`), pestañas **💳 Pagos** y **✉️ Correos**.

---

## Antes de empezar: el servidor tiene que verse desde internet

Después de pagar, PayPal manda al cliente de vuelta a tu servidor. Por eso el servidor debe estar en tu **VPS con
dirección https** (mira `GUIA-VPS.md`) y en **Panel → Ajustes → Dirección pública** debe estar esa dirección
(por ejemplo `https://clipviral.duckdns.org`).

Si el servidor está solo en tu PC (`localhost`), los pagos funcionan **solo para probar en tu propia PC**.

---

## 1. PayPal (cobrar con tarjeta)

1. Entra a **developer.paypal.com** con tu cuenta PayPal **Business** (si tienes una personal, PayPal te deja
   pasarla a Business gratis).
2. Ve a **Apps & Credentials**. Arriba hay un interruptor **Sandbox / Live**.
3. Primero en **Sandbox** (prueba): toca **Create App**, ponle de nombre "ClipViral" y créala.
4. Copia el **Client ID** y el **Secret** y pégalos en **Panel → 💳 Pagos**, con el modo **Prueba (Sandbox)**.
   Toca **Guardar** y luego **Probar conexión**.
5. Prueba un pago desde la app: **Mi plan → Elegir plan → 💳 Pagar con tarjeta**. En modo prueba no se cobra
   nada. Usa una tarjeta de prueba de PayPal (en developer.paypal.com → **Testing tools → Card testing**).
6. Cuando todo funcione, cambia el interruptor a **Live**, crea la app ahí también y pega las claves **Live**
   con el modo **Real (Live)**. Desde ese momento se cobra de verdad.

**Para que acepte tarjeta sin cuenta PayPal:** en tu cuenta PayPal Business revisa que esté activado
**"Pagos con tarjeta para invitados" (PayPal Guest Checkout / Account Optional)**. Suele venir encendido.

### Cómo funciona la licencia

- Cada pago suma **30 días**. Si el cliente renueva el mismo plan antes de que venza, se suma al final de lo que le queda.
- Si cambia de plan, el plan nuevo empieza ese día.
- Puede pagar 1, 3, 6 o 12 meses de una vez.
- Si alguien te paga por fuera (transferencia, efectivo), en **Panel → Usuarios → Gestionar → 💵 Registrar pago manual**.

---

## 2. Gmail (enviar correos)

Gmail no deja usar tu contraseña normal: necesitas una **contraseña de aplicación**.

1. Entra a **myaccount.google.com → Seguridad**.
2. Activa la **Verificación en 2 pasos** (si ya está activa, sigue).
3. Busca **Contraseñas de aplicaciones**, crea una con el nombre "ClipViral" y copia las 16 letras.
4. En **Panel → ✉️ Correos** pon tu Gmail, pega esas 16 letras, toca **Guardar** y luego **Enviarme una prueba**.

Gmail permite unos **500 correos por día**. Para muchos más clientes, más adelante conviene un servicio como Brevo
(en "Otro proveedor (avanzado)" se cambian servidor y puerto).

### Qué correos salen solos

| Correo | Cuándo |
|---|---|
| Bienvenida | Al crear la cuenta |
| Código para cambiar la contraseña | Al tocar "¿Olvidaste tu contraseña?" (vence en 30 min) |
| Contraseña cambiada | Después de cambiarla |
| Pago recibido | Al confirmarse un pago, con la fecha hasta la que está activo |
| Tu plan vence pronto | 3 días antes de vencer |
| Tu plan venció | El día que vence |
| Tu plan se actualizó | Cuando tú cambias su plan o fecha en el panel (con la casilla "Avisarle por correo") |

Además, en **✉️ Correos → Enviar un aviso** puedes escribir a todos, solo a los activos, a los vencidos, a un
plan o a una sola persona.
