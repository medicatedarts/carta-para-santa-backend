# CartaParaSanta.com — Backend

Recibe la carta que escribió el niño o niña, cobra al adulto con **Stripe** y, en cuanto el pago se confirma, manda a **Lob** a imprimir y enviar por correo la respuesta de Santa junto con una copia de la carta original.

Sale de la base de [`te-lo-dije-backend`](https://github.com/medicatedarts/te-lo-dije-backend) (Express + Stripe + Lob). La especificación completa está en [`docs/ESPECIFICACION.md`](docs/ESPECIFICACION.md) y el texto de la respuesta de Santa en [`docs/RESPUESTA_DE_SANTA.md`](docs/RESPUESTA_DE_SANTA.md).

## Flujo

```
Sitio (enviar.html)
   │  POST /api/checkout  { letter, buyer, shipTo, consent }
   ▼
valida + filtra contenido → guarda la orden (pending_payment) → crea sesión de Stripe → devuelve checkoutUrl
   │
   ▼
El adulto paga en Stripe Checkout → vuelve a gracias.html?order=<id>
   │
   ▼
Stripe → POST /api/webhook/stripe  (checkout.session.completed)
   │
   ▼
orden "paid" ──► ¿contenido dudoso? ── sí ──► "needs_review" (se aprueba en el panel)
   │ no
   ▼
genera el HTML de 2 páginas (respuesta de Santa + copia de la carta) → Lob (Idempotency-Key = id de la orden)
   │
   ▼
"sent_to_lob" → Lob → POST /api/webhook/lob → "mailed" → "in_transit" → "delivered"
                                   │
                                   └─► con "mailed" se envía el correo "tu carta salió del Polo Norte"
```

## Diferencias con Yo Te Lo Dije

| Tema | Yo Te Lo Dije | CartaParaSanta |
| --- | --- | --- |
| Almacén | `orders.json` (se borra en cada deploy de Render) | **Postgres de Render** (`pg`) |
| Doble impresión | No hay protección | `Idempotency-Key` en Lob + chequeo de estado antes de enviar |
| Páginas | 1 | 2 (respuesta de Santa + copia de la carta del niño) |
| Contenido | Permite groserías, bloquea amenazas | Bloquea groserías, enlaces, correos y teléfonos; lo dudoso va a revisión |
| Seguimiento | Ninguno | Webhooks de Lob + correos al adulto |
| Panel | Solo `DELETE /api/order/:id` | Endpoints de administración (ver la especificación) |
| Consentimiento | Mayor de 18 / autorizado | Padre, madre o tutor (COPPA) |

## Correr en desarrollo

```bash
npm install
cp .env.example .env      # llena las llaves de prueba
npm run db:init           # crea las tablas (sql/schema.sql)
npm run dev               # http://localhost:4000
```

Webhooks en local:

```bash
stripe listen --forward-to localhost:4000/api/webhook/stripe
# Lob necesita una URL pública: usa ngrok y registra https://<tu-tunel>/api/webhook/lob en el dashboard de Lob
```

## Desplegar en Render

1. Crear un **Web Service** desde este repo (`npm install` / `npm start`). Usa un plan que **no se duerma**: el webhook de Stripe no puede encontrar el servidor apagado.
2. Crear un **Postgres** en Render y poner su `DATABASE_URL` en las variables del servicio.
3. Variables de entorno: copiar todas las de `.env.example`.
4. Dominio personalizado: `api.cartaparasanta.com`.
5. Stripe → Developers → Webhooks → `https://api.cartaparasanta.com/api/webhook/stripe` con el evento `checkout.session.completed`.
6. Lob → Webhooks → `https://api.cartaparasanta.com/api/webhook/lob` con `letter.mailed`, `letter.in_transit`, `letter.in_local_area`, `letter.processed_for_delivery`, `letter.re-routed`, `letter.returned_to_sender`.
7. Pasar `LOB_API_KEY` y `STRIPE_SECRET_KEY` a las claves **live** solo después de las pruebas.

## Llaves

| Variable | Dónde |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com → Developers |
| `LOB_API_KEY` | dashboard.lob.com → Settings → API Keys (test mientras pruebas) |
| `LOB_WEBHOOK_SECRET` | dashboard.lob.com → Webhooks → tu endpoint |
| `LOB_FROM_ADDRESS_ID` | Dirección de remitente creada en Lob (nombre "Santa Claus", dirección comercial real) |
| `DATABASE_URL` | Render → Postgres → Internal Database URL |
| `RESEND_API_KEY` (o el proveedor que escojas) | Proveedor de correo transaccional + registros SPF/DKIM en el DNS |
| `ADMIN_TOKEN` | Cadena larga y aleatoria que tú inventas |

Plan de lanzamiento: https://claude.ai/artifact/2n5macLYHsB344UeenFmp4
