# Especificación del backend — CartaParaSanta.com

Documento de referencia para construir el backend. Se parte del código de `te-lo-dije-backend` (Express, Stripe Checkout, Lob por `fetch`) y se cambia lo que se indica aquí.

- Lanzamiento: **jueves 19 de noviembre de 2026**.
- Fecha límite recomendada de pedidos: **10 de diciembre**. Cierre del buzón: **14 de diciembre**.
- Plan completo: https://claude.ai/artifact/2n5macLYHsB344UeenFmp4

---

## 1. Estructura sugerida

```
server.js              rutas Express (checkout, webhooks, pedido, config, admin)
db.js                  pool de Postgres (pg) + consultas, incluido el chequeo atómico claimForLob
sql/schema.sql         tablas
validate.js            límites y normalización de la carta
contentFilter.js       filtro adaptado a niños (ver §6)
santaReply.js          arma el texto de la respuesta de Santa (ver docs/RESPUESTA_DE_SANTA.md)
printTemplate.js       HTML de 2 páginas para Lob, con ajuste automático de letra para cartas largas
papeles/papeles.json   los 5 diseños, generados del prototipo con scripts/build-papeles.js
fonts/                 woff2 opcionales para que Lob no dependa de Google Fonts (ver fonts/README.md)
lob.js                 crear carta, clasificar errores, verificar webhooks
fulfill.js             después del pago: revisión o envío a Lob
email.js               correos al adulto y alertas (Resend por fetch)
jobs.js                reintentos, alertas y borrado por retención (setInterval)
scripts/               db-init, preview (cartas de ejemplo en previews/), build-papeles
test/                  pruebas con node --test (sin base de datos ni red)
```

Dependencias nuevas sobre Yo Te Lo Dije: `pg`. Opcional: `resend` (o `fetch` directo a su API).

## 2. Modelo de datos

Ver `sql/schema.sql`. Resumen de `orders`:

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid | Se usa también como `Idempotency-Key` en Lob |
| `order_number` | text único | Formato `PN-` + 5 dígitos (PN = Polo Norte). Es lo que ve el cliente |
| `status` | text | Ver §3 |
| `design` | text | `clasica` · `taller` · `estrellas` · `polonorte` · `juguetes` |
| `greeting`, `child_name`, `child_age`, `message`, `gifts` (jsonb), `farewell`, `signature` | | Contenido de la carta |
| `buyer_name`, `buyer_email` | | Adulto responsable |
| `ship_name`, `ship_line1`, `ship_line2`, `ship_city`, `ship_state`, `ship_zip`, `ship_country` | | Destinatario del sobre |
| `consent_at`, `consent_ip` | | Consentimiento del adulto |
| `review_reason` | text | Por qué quedó en revisión |
| `amount_cents`, `stripe_session_id`, `stripe_payment_intent` | | Pago |
| `lob_letter_id`, `lob_expected_delivery`, `lob_price` | | Lob |
| `error` | text | Último error |
| `created_at`, `paid_at`, `sent_to_lob_at`, `mailed_at`, `delivered_at`, `purged_at` | timestamptz | |

Tabla `settings` (clave/valor) para lo que se edita desde el panel: `price_cents`, `mailbox_open`, `deadline_recommended`, `mailbox_close_date`.

## 3. Estados

```
pending_payment ─► paid ─► sent_to_lob ─► mailed ─► in_transit ─► delivered
                    │           │
                    ├─► needs_review ─(aprobar)─► sent_to_lob
                    └─► error ─(reenviar)─► sent_to_lob
Cualquier estado anterior a sent_to_lob ─► cancelled / refunded
```

Reglas:

- Solo el webhook de Stripe (o el panel) pasa una orden a `paid`.
- **Antes de llamar a Lob**, comprobar con un `UPDATE … WHERE id = $1 AND lob_letter_id IS NULL AND status IN ('paid','needs_review','error') RETURNING *`. Si no devuelve fila, no se envía. Esto y el `Idempotency-Key` evitan cartas duplicadas.
- La pantalla de confirmación nunca dice "enviada" antes de `mailed`.

## 4. API pública

### `GET /api/config`

Lo lee la landing y la compra.

```json
{ "priceCents": 0, "currency": "usd", "taxMode": "included",
  "mailboxOpen": true, "deadlineRecommended": "2026-12-10", "mailboxCloseDate": "2026-12-14" }
```

### `POST /api/checkout`

```json
{
  "letter": {
    "design": "clasica",
    "greeting": "Querido Santa:",
    "childName": "Sofía",
    "childAge": 7,
    "message": "Este año me porté muy bien…",
    "gifts": ["Una bicicleta roja", "Un set de pintura"],
    "farewell": "Con mucho cariño,",
    "signature": "Sofía"
  },
  "buyer":  { "name": "Ana Rivera", "email": "ana@ejemplo.com" },
  "shipTo": { "name": "Sofía Rivera", "line1": "Calle 1 #23", "line2": "", "city": "Arecibo", "state": "PR", "zip": "00612", "country": "US" },
  "consent": { "isParentOrAuthorized": true, "acceptedTerms": true, "acceptedPrivacy": true }
}
```

Respuesta: `{ "checkoutUrl": "https://checkout.stripe.com/…", "orderId": "…", "orderNumber": "PN-48213" }`.

Errores `400` con `{ "error": "<mensaje para mostrar>", "code": "<código>" }`: `validation`, `content_policy`, `consent_required`, `mailbox_closed`, `address_unsupported`, `address_undeliverable`, `address_deliverable_missing_unit`, `address_deliverable_incorrect_unit`.

Pasos:

1. Si `mailbox_open` es falso → `400 mailbox_closed`.
2. Validar (§5) y normalizar (recortar espacios, quitar regalos vacíos).
3. Consentimiento: los tres en `true`, si no → `400 consent_required`.
4. Filtro de contenido (§6): `block` → `400 content_policy`; `review` → la orden se guarda con `review_reason` y se marcará `needs_review` al pagar.
4b. Dirección verificada con Lob US Verifications (`addressVerify.js`, solo con clave live en modo `auto`): `undeliverable`, `deliverable_missing_unit` o `deliverable_incorrect_unit` → `400` con `code` `address_…` y `field: 'shipTo'`. Si Lob falla, la compra sigue.
5. Insertar la orden `pending_payment`.
6. Stripe Checkout: `mode: 'payment'`, `customer_email: buyer.email`, `metadata.orderId`, `payment_intent_data.metadata.orderId`, producto "Carta de respuesta de Santa — impresa y enviada por correo", `success_url = FRONTEND_URL/gracias.html?order=<id>`, `cancel_url = FRONTEND_URL/enviar.html?cancelado=1`.

### `GET /api/order/:id`

`{ "orderNumber": "PN-48213", "status": "sent_to_lob", "expectedDelivery": "2026-12-03" }`. No devuelve datos personales.

## 5. Validación (la misma en el frontend)

| Campo | Regla |
| --- | --- |
| `design` | Uno de los 5 ids |
| `greeting` | 1–40 caracteres |
| `childName` | Opcional, ≤ 30 |
| `childAge` | Opcional, entero 1–17 |
| `message` | Opcional, ≤ 700 |
| `gifts` | 0–12 elementos, cada uno 1–60 caracteres |
| `farewell` | ≤ 40 |
| `signature` | ≤ 30 |
| `buyer.email` | Formato de correo |
| `shipTo` | `name`, `line1`, `city`, `state`, `zip` obligatorios; `country` = `US` (incluye Puerto Rico). `zip` de 5 dígitos o 5+4 |

Con estos límites cada carta cabe en una página impresa. Si se cambian, probar los 5 diseños al máximo.

## 6. Filtro de contenido (adaptado a niños)

Se parte de `contentFilter.js` de Yo Te Lo Dije, pero la política cambia: el texto lo escribe un niño y lo lee Santa.

- **Bloquear** (`block`, mensaje amable: "Santa prefiere palabras bonitas. Revisa tu carta."): groserías en español e inglés, enlaces (`http`, `www.`, `.com`), correos y números de teléfono.
- **Revisión** (`review`): términos que podrían indicar una situación delicada que un adulto debe ver antes de imprimir (por ejemplo, menciones de violencia o de que alguien le hace daño). La orden se cobra, queda en `needs_review` y llega una alerta a `ALERT_EMAIL`. Tú decides en el panel si se envía.
- Mantener `CUSTOM_BLOCKED_TERMS` para añadir términos sin tocar el código.
- Aplicar a: `greeting`, `childName`, `message`, `gifts`, `farewell`, `signature`.

## 7. Plantilla de impresión (Lob)

Una carta = un HTML con **2 páginas** tamaño carta (8.5" × 11"):

1. **Respuesta de Santa**: el diseño de la carta de respuesta del prototipo (marco de rayas, sello del Polo Norte, firma). Texto armado por `santaReply.js`.
2. **Copia de la carta del niño**: el mismo papel de los 5 diseños que escogió, con su texto.

Reglas de impresión (de la documentación de Lob y de lo que ya funciona en Yo Te Lo Dije):

- `@page { size: letter; margin: 0; }`. Lob ignora los márgenes de `@page`: el margen va como `padding`.
- **Zona de dirección:** con `address_placement: 'top_first_page'` Lob imprime remitente y destinatario arriba de la página 1. Yo Te Lo Dije reserva una franja de `2.95in` arriba (`.address-space`). Aquí se hace igual en la página 1. Encima de esa franja solo puede ir decoración fuera de la zona de dirección de la plantilla oficial de Lob; confirmar con los PDFs de prueba.
- Nada a sangre: todo al menos a 1/16" del borde. Los marcos de rayas llevan un margen blanco fino alrededor.
- Fuentes e imágenes por **URL pública HTTPS** del backend (`BACKEND_PUBLIC_URL/fonts/…`, `/papeles/…`), nunca base64 ni rutas locales.
- Escapar todo el texto del usuario (`escapeHtml` de Yo Te Lo Dije).
- Los 5 papeles: la carpeta `papeles/` es la fuente de verdad (un CSS por diseño + SVG de decoración). El frontend tiene una copia para la vista previa. Si se cambia un diseño, se cambia en los dos repos.

Llamada a Lob (`POST https://api.lob.com/v1/letters`):

```js
{
  description: `CartaParaSanta ${order.order_number}`,
  to: { name, address_line1, address_line2, address_city, address_state, address_zip, address_country: 'US' },
  from: process.env.LOB_FROM_ADDRESS_ID,
  file: html,
  color: true,
  double_sided: false,
  address_placement: 'top_first_page',
  mail_type: 'usps_first_class',
  use_type: process.env.LOB_USE_TYPE || 'operational',
  metadata: { orderId: order.id, orderNumber: order.order_number }
}
// Headers: Authorization Basic (como en Yo Te Lo Dije) + 'Idempotency-Key': order.id
```

Guardar `id`, `expected_delivery_date` y `price` de la respuesta.

Horario: Lob produce lo que recibe antes de las 10 am hora del Pacífico (1 pm en Puerto Rico); lo demás entra al día hábil siguiente. First Class: de 5 a 7 días hábiles según la guía de Lob.

## 8. Webhooks

### Stripe — `POST /api/webhook/stripe`

Igual que en Yo Te Lo Dije (body crudo, firma verificada), con estos cambios:

- `checkout.session.completed` con `payment_status === 'paid'` → `status = 'paid'`, `paid_at`, `amount_cents`, `stripe_payment_intent`.
- Responder `200` enseguida y procesar después (`setImmediate`). Si el proceso muere, el job de §10 retoma la orden.
- Si la orden tiene `review_reason` → `needs_review` + alerta. Si no → enviar a Lob.
- Correo de confirmación al adulto (§9) en ambos casos.

### Lob — `POST /api/webhook/lob`

- Verificar la firma: header `Lob-Signature` = HMAC-SHA256 de `` `${timestamp}.${rawBody}` `` con `LOB_WEBHOOK_SECRET`, usando `Lob-Signature-Timestamp`. Confirmar el formato exacto en la documentación de webhooks de Lob.
- Buscar la orden por `body.reference_id` (id de la carta) o `metadata.orderId`.
- `letter.mailed` → `mailed` + correo "tu carta salió del Polo Norte".
- `letter.in_transit` / `letter.in_local_area` → `in_transit`.
- `letter.processed_for_delivery` → `delivered` (es el último evento que da USPS).
- `letter.returned_to_sender` → `error` + alerta.

## 9. Correos al adulto

En español, con el número de orden. Proveedor: Resend (u otro), con SPF y DKIM en el DNS de `cartaparasanta.com`.

| Cuándo | Asunto | Contenido |
| --- | --- | --- |
| Pago confirmado | "¡Tu carta llegó al Polo Norte! (PN-48213)" | Resumen: diseño, nombre en el sobre, dirección, total. Qué se guardó del niño y cuándo se borra. Fecha estimada |
| `mailed` | "La respuesta de Santa ya va en camino" | Aviso de envío y fecha estimada de Lob |
| Reembolso | "Tu pedido PN-48213 fue cancelado" | Monto reembolsado |

Alertas a `ALERT_EMAIL`: orden en `needs_review`, orden en `error`, orden `paid` sin `lob_letter_id` después de 1 hora.

## 10. Trabajos periódicos (`jobs.js`)

Cada 10 minutos:

- Órdenes `paid` sin `lob_letter_id` con más de 10 minutos → reintentar Lob (máximo 3 intentos, luego `error` + alerta).
- Alerta si hay órdenes `paid` sin enviar después de 1 hora.

Una vez al día:

- Borrado por retención: órdenes con `delivered_at` (o `mailed_at` + 20 días) más viejas que `RETENTION_DAYS_AFTER_DELIVERY` → vaciar el contenido de la carta y la dirección, poner `purged_at`. Se conservan el número de orden, el monto y las fechas para contabilidad.

## 11. Administración

Todas con header `x-admin-token: <ADMIN_TOKEN>`. Las usa `admin.html` del frontend.

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/admin/orders?status=&q=` | Lista paginada; `q` busca por correo, número de orden o nombre en el sobre |
| `GET /api/admin/orders/:id` | Detalle completo + enlace al PDF de Lob (`url` de la carta) |
| `GET /api/admin/orders/:id/preview` | El HTML de impresión, para verlo antes de aprobar |
| `POST /api/admin/orders/:id/approve` | `needs_review` → Lob |
| `POST /api/admin/orders/:id/resend` | `error` → Lob (con la dirección corregida si se editó) |
| `PATCH /api/admin/orders/:id/address` | Corregir la dirección antes de reenviar |
| `POST /api/admin/orders/:id/refund` | Reembolso en Stripe → `refunded`. Solo si aún no se envió a Lob |
| `GET /api/admin/stats` | Órdenes y ventas por día y por estado |
| `PATCH /api/admin/settings` | `price_cents`, `mailbox_open`, fechas |
| `DELETE /api/order/:id` | Borrado a pedido del padre o madre (se mantiene de Yo Te Lo Dije) |

## 12. Seguridad y privacidad

- CORS solo para `CORS_ORIGINS`.
- Límite de peticiones en `/api/checkout` (por ejemplo, 20 por IP cada 15 minutos).
- Nunca registrar en los logs el mensaje ni la dirección completa; basta con el número de orden.
- No se guarda nada del niño antes de que el adulto envíe la compra con el consentimiento marcado.
- Claves solo en variables de entorno de Render.

## 13. Pruebas mínimas antes de abrir

- [ ] Los 5 diseños, con carta corta y con carta al máximo de caracteres y 12 regalos: PDF de Lob (test key) sin cortes.
- [ ] Sin nombre, sin edad y sin regalos: la respuesta de Santa se lee bien.
- [ ] Webhook de Stripe enviado dos veces: una sola carta en Lob.
- [ ] Tarjeta rechazada: la orden queda `pending_payment` y no se envía nada.
- [ ] Dirección que Lob rechaza: `error`, alerta, corrección y reenvío desde el panel.
- [ ] Texto con groserías → `400 content_policy`. Texto delicado → `needs_review`.
- [ ] 3 o 4 cartas reales con la live key (Puerto Rico y EE. UU.) a más tardar el 11 de noviembre.
