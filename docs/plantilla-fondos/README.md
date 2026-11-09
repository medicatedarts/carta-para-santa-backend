# Plantilla para diseñar los fondos de las cartas

Cada carta que imprime Lob tiene **2 hojas tamaño carta**:

| Página | Archivo | Qué lleva |
|---|---|---|
| 1 | `santa.jpg` | Respuesta personalizada de Santa + zona de dirección de Lob |
| 2 | `papel-<id>.jpg` | Copia de la carta del niño en el papel que eligió (página completa) |

Los papeles actuales son `papel-clasica`, `papel-taller`, `papel-estrellas`, `papel-polonorte` y `papel-juguetes`. Las versiones en uso están en `papeles/fondos/`: puedes abrirlas como punto de partida.

## Especificaciones del archivo

- **Tamaño:** 8.5 × 11 pulgadas, vertical.
- **Resolución:** 2550 × 3300 px (300 ppp).
- **Color:** RGB (sRGB). Lob convierte a CMYK al imprimir. Los neones y los azules eléctricos salen más apagados.
- **Formato final:** JPG, calidad 85–90 y menos de 1.5 MB por archivo. PNG también sirve.
- **Sin sangrado (bleed):** el archivo mide exactamente 8.5 × 11". El color puede llegar al borde, pero la impresora deja un filo blanco irregular de hasta ~1/8".
- **Sin texto dinámico:** no escribas nombres, fechas ni líneas de cuaderno. El sistema escribe el texto y dibuja las líneas encima. Sí puedes poner texto fijo decorativo, como "¡Feliz Navidad!" o "Taller de Santa Claus".

## Cómo usar las guías

1. Crea un documento de 2550 × 3300 px a 300 ppp.
2. Coloca la guía PNG correspondiente como **capa superior** con opacidad al 100 %. Es transparente.
3. Diseña debajo de la guía.
4. **Oculta la capa de la guía antes de exportar.**

| Guía | Para |
|---|---|
| `guia-pagina1-santa.png` | El fondo de la respuesta de Santa |
| `guia-pagina2-carta.png` | Un papel nuevo (caja de texto recomendada) |
| `guia-pagina2-<id>.png` | Rediseñar un papel existente con su caja actual |

## Qué significa cada color de la guía

- **Rojo punteado: margen de seguridad de 0.125".** Nada importante (texto, caras, logos) fuera de esta línea.
- **Gris: zona de dirección (solo en la página 1).** Ocupa de 0 a 4.25" de ancho y de 0 a 2.95" de alto desde la esquina superior izquierda.
  - Lob imprime ahí un recuadro blanco con el remitente, el destinatario y el código de barras de USPS.
  - Es lo que se ve por la ventana del sobre doble de Lob.
  - Déjala de color liso y claro. Cualquier dibujo quedaría tapado o haría que Lob rechace la carta.
- **Naranja: marcas de control de Lob.** Están en el margen izquierdo, de 8.7" a 10.85" de alto y en los primeros 0.5". Lob puede imprimir ahí unos códigos pequeños; no pongas nada importante.
- **Azul punteado: dobleces del sobre**, a 3.67" y 7.33". La hoja se dobla en tres. Evita poner ahí caras o textos pequeños.
- **Verde: caja de texto.** Aquí el sistema escribe el texto.
  - Dentro de la caja va color liso o una textura muy suave, sin líneas dibujadas.
  - La letra se ajusta sola: una carta corta sale grande y una larga sale más pequeña.
- **Morado: zona libre** para tu diseño.

## Si mueves o cambias el tamaño de la caja de texto

Mide la nueva caja en pulgadas desde la esquina superior izquierda: **x, y, ancho y alto**. Se cambia en `papeles/layout.json`:

```json
"clasica": { "image": "papel-clasica.jpg", "textBox": { "x": 0.938, "y": 2.75, "w": 6.625, "h": 6.344 }, ... }
```

Para pasar de píxeles a pulgadas, divide entre 300. Por ejemplo, 600 px equivalen a 2".

- **Tamaño mínimo** de la caja de la página 2: 5.5" × 6". Si es más pequeña, las cartas largas quedan con letra diminuta.
- **Página 1 (Santa):** la caja no puede empezar antes de y = 2.95" en la mitad izquierda, para no chocar con la zona de dirección.

En `layout.json` también se cambian los colores de tinta de cada papel: `ink` es el texto, `line` las líneas del cuaderno, y `greetColor`/`signColor` el saludo y la firma.

## Cómo entregar los fondos

1. Exporta con los nombres exactos (`santa.jpg`, `papel-clasica.jpg`, …).
2. Pásamelos, o reemplázalos en `papeles/fondos/`.
3. Haz commit y push. Render los publica solo.
4. Corre `node scripts/send-test-letter.js --design todos` para ver el resultado en Lob.

El frontend usa los mismos papeles para la vista previa. Cuando cambies uno, avisa para copiarlo también a `carta-para-santa-frontend/assets/papeles/`.
