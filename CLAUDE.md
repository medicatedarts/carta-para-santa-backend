# Instrucciones para asistentes de código

Backend de CartaParaSanta.com: Express + Postgres + Stripe Checkout + Lob. Sale de `te-lo-dije-backend`.

- La especificación es `docs/ESPECIFICACION.md`. El texto de la respuesta de Santa es `docs/RESPUESTA_DE_SANTA.md`. Síguelos; si algo no está claro, pregunta antes de inventar.
- Mantén el estilo de Yo Te Lo Dije: CommonJS, `fetch` nativo para Lob, comentarios en español que expliquen el porqué.
- Nunca envíes una carta a Lob sin el chequeo atómico de estado de §3 y el header `Idempotency-Key`.
- Nunca registres en los logs el contenido de la carta ni direcciones completas.
- Los límites de validación (§5) deben coincidir con los del frontend.
- Usa siempre la test key de Lob y el modo test de Stripe en desarrollo.
- Los 5 diseños de papel (`papeles/`) se comparten con el frontend: si cambias uno, avisa para copiarlo allá.
