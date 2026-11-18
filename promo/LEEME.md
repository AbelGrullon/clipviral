# Video promocional · versión para clientes

- `ClipViral-promo-clientes.mp4`: el video horizontal (16:9), para YouTube, la web o WhatsApp.
- `ClipViral-promo-clientes-vertical.mp4`: el video vertical (9:16), para TikTok, Reels y Shorts.
- `version-anterior/`: la primera versión, la de fondo oscuro y clips de juegos.

## Cómo se hizo (estilo "pop")
- **Estilo nuevo:**
  - Fondo de papel con cuadrícula, stickers con borde negro grueso y sombra dura.
  - Garabatos que se dibujan solos, sellos que golpean la pantalla y barras de color para pasar de escena.
  - Colores de la app: rojo, azul y amarillo. Letra Bahnschrift, la misma de los títulos de la app.
- **Clips reales:** son clips que sacó ClipViral (carpeta `Videos\ClipViral`), con sus subtítulos.
  - Se usaron solo partes sin groserías ni temas delicados.
  - En la escena "Qué es", un directo horizontal se convierte en el clip vertical. Después se oye 2 segundos el clip real ("Tres, ¿quién será la reina del masmelo?").
  - En el plan Claude se ve el título y los hashtags reales que hizo la app para ese clip.
- **Voz:** la hace tu Sintetizador de voz (Diego, emoción "alegre"). El texto de cada frase está en `guion.json`.
  - `sub` es lo que sale en los subtítulos.
  - `voz` es como se pronuncia. Por ejemplo, "Clod" en lugar de "Claude".
- **Subtítulos del locutor:** salen en trozos cortos, palabra por palabra, como los de la app.
  - Whisper mide cuándo dice cada palabra y lo guarda en `voz/palabras.json`.
- **Video:** se armó en VideoLab con los proyectos `promo-clipviral-pop` y `promo-clipviral-pop-vertical`.
  - El script `promo-pop.js` arma las 12 escenas y le pasa a VideoLab la voz del Sintetizador.
- **Capturas:** son de la versión para clientes (`app-*.png`) y se sacaron con datos de prueba.
  - El código de PC que se ve (7KQM-2XRA) es inventado.
  - La clave se muestra tapada con puntos.
- `descartadas/` guarda capturas que no se usaron:
  - una tiene el precio viejo;
  - otra muestra el Agente;
  - otra es de PayPal;
  - otra muestra una clave completa.

## Cambiar algo
1. Edita el texto en `guion.json`.
2. Genera de nuevo la voz de esa frase con el Sintetizador.
3. Ejecuta `node promo-pop.js` para el horizontal, o `node promo-pop.js vertical` para el vertical.
4. Renderiza en VideoLab.

## Ojo
Los clips son de otros creadores (Carlos Montesquieu, Alofoke, Esto No Es Radio). Si pagas anuncios con este video, YouTube o Meta podrían reclamar por derechos de autor.
