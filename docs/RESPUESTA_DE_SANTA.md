# Texto de la respuesta de Santa

La respuesta se arma por partes. Para cada parte con variantes, `santaReply.js` elige una a partir del id de la orden (por ejemplo, un hash del uuid módulo el número de variantes, con una semilla distinta por parte). Así la misma orden siempre da la misma carta y dos hermanos reciben cartas distintas.

Reglas del texto:

- Santa **nunca promete** un regalo. Dice que leyó la lista y que se la pasó a los duendes.
- Nada de fechas ni lugares concretos de la vida del niño: solo lo que viene en la carta.
- Todo el texto del niño se escapa antes de insertarlo.
- Español neutro, cálido y corto: la página tiene que caber con la franja de dirección de 2.95" arriba.

## Variables

| Variable | De dónde sale | Si falta |
| --- | --- | --- |
| `{nombre}` | `child_name`; si no hay, el primer nombre de `ship_name` | Se usa el saludo genérico |
| `{edad}` | `child_age` | Se omite la línea de la edad |
| `{regalos}` | Hasta 3 elementos de `gifts`, unidos con comas y "y" | Se usa la variante "sin regalos" |
| `{año}` | Año actual | — |

## 1. Saludo

- Con nombre: `Querido {nombre}:` o `Querida {nombre}:`. Como no se pregunta el género, usar **`Hola, {nombre}:`** por defecto. Si más adelante se añade un selector opcional, usar Querido/Querida.
- Sin nombre: `Hola, amiguito o amiguita:`

## 2. Apertura (elige 1 de 3)

1. ¡Tu carta llegó al Polo Norte! La leí junto a la chimenea del taller, con una taza de chocolate caliente, y me hizo sonreír de oreja a oreja.
2. ¡Qué alegría recibir tu carta! Uno de mis duendes del correo vino corriendo a traérmela, y la leí enseguida, con mis lentes puestos y mucha atención.
3. Esta mañana, mientras los renos desayunaban, llegó tu carta a mi escritorio. La leí dos veces porque me gustó muchísimo.

## 3. Línea de la edad (solo si hay `{edad}`; elige 1 de 2)

1. ¡{edad} años! Estás creciendo muy rápido, y se nota en lo bien que escribes.
2. Me contaron que ya tienes {edad} años. ¡Qué grande estás!

## 4. Sobre su año (elige 1 de 3)

1. Los duendes me han contado que este año te has esforzado mucho. Eso me pone muy, muy feliz.
2. Aquí en el Polo Norte siempre estamos pendientes de los niños y niñas que tratan de ser buenos, y tu nombre salió muchas veces en nuestras conversaciones.
3. Sé que a veces portarse bien no es fácil, pero también sé que lo intentas con todo tu corazón. Eso es lo que más me importa.

## 5. Regalos

Con 1 regalo (elige 1 de 2):

1. Anoté con cuidado lo que pediste: {regalos}. Ya le entregué tu lista a los duendes del taller para que la revisen con mucho cariño.
2. Vi que en tu lista pediste {regalos}. Guardé tu carta en el lugar especial donde los duendes revisan los deseos de Navidad.

Con 2 o más regalos (elige 1 de 2):

1. Anoté con cuidado tu lista: {regalos}. Ya se la entregué a los duendes del taller para que la revisen con mucho cariño.
2. Leí tu lista de deseos, con {regalos}, ¡y los duendes ya se asomaron a verla! La guardamos en el lugar especial donde revisamos los deseos de Navidad.

Con más de 3 regalos se nombran los 3 primeros y se añade: `…y todo lo demás que me pediste.`

Sin regalos:

- No me pediste nada en tu lista, y eso me dice que tienes un corazón muy generoso. Igual te tendremos muy presente aquí en el taller.

## 6. Consejo (elige 1 de 3)

1. Mientras tanto, sigue siendo amable, comparte con los demás y acuéstate temprano en Nochebuena.
2. Hasta entonces, recuerda ayudar en casa, abrazar mucho a tu familia y dormir temprano en Nochebuena.
3. Te pido un favor: sigue sonriendo, trata bien a todos y no te olvides de dormir temprano en Nochebuena.

## 7. Cierre (elige 1 de 3)

1. Rodolfo y los demás renos te mandan un saludo enorme.
2. La señora Claus y todos los duendes te mandan un abrazo grandote.
3. Los renos están practicando sus vuelos y te mandan muchos saludos desde el establo.

## 8. Despedida y firma (fijas)

> Con mucho cariño desde el Polo Norte,
>
> *Santa Claus* (en Pinyon Script o con la firma digitalizada)

## 9. P.D. (fija)

> P.D. En este sobre va una copia de la carta que me escribiste. ¡Guárdala como un recuerdo mágico!

## Encabezado

- "Taller de Santa Claus · Polo Norte"
- Fecha: `Diciembre, {año}` aunque la carta salga en noviembre, para que se lea navideña.

## Ejemplo completo (orden con nombre, edad y 3 regalos)

> Hola, Sofía:
>
> ¡Tu carta llegó al Polo Norte! La leí junto a la chimenea del taller, con una taza de chocolate caliente, y me hizo sonreír de oreja a oreja. ¡7 años! Estás creciendo muy rápido, y se nota en lo bien que escribes.
>
> Los duendes me han contado que este año te has esforzado mucho. Eso me pone muy, muy feliz.
>
> Anoté con cuidado tu lista: una bicicleta roja, un set de pintura y un libro de dinosaurios. Ya se la entregué a los duendes del taller para que la revisen con mucho cariño.
>
> Mientras tanto, sigue siendo amable, comparte con los demás y acuéstate temprano en Nochebuena. Rodolfo y los demás renos te mandan un saludo enorme.
>
> Con mucho cariño desde el Polo Norte,
> *Santa Claus*
>
> P.D. En este sobre va una copia de la carta que me escribiste. ¡Guárdala como un recuerdo mágico!
