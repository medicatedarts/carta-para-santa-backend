// lob.js
// Crear la carta en Lob y verificar sus webhooks. Igual que en Yo Te Lo Dije se usa
// fetch nativo (sin SDK), con dos añadidos:
//  - Idempotency-Key: si la misma orden se manda dos veces (webhook repetido, reintento
//    después de un corte de red), Lob devuelve la carta ya creada en vez de imprimir otra.
//  - Errores clasificados: los temporales (Lob caído, red) se reintentan solos; los
//    permanentes (dirección inválida) esperan a que los corrijas en el panel.

const crypto = require('crypto');
const { buildPrintHtml } = require('./printTemplate');

function fromAddress() {
  if (process.env.LOB_FROM_ADDRESS_ID) return process.env.LOB_FROM_ADDRESS_ID;
  return {
    name: process.env.LOB_FROM_NAME || 'Santa Claus',
    address_line1: process.env.LOB_FROM_ADDRESS_LINE1,
    address_line2: process.env.LOB_FROM_ADDRESS_LINE2 || undefined,
    address_city: process.env.LOB_FROM_ADDRESS_CITY,
    address_state: process.env.LOB_FROM_ADDRESS_STATE,
    address_zip: process.env.LOB_FROM_ADDRESS_ZIP,
    address_country: process.env.LOB_FROM_ADDRESS_COUNTRY || 'US',
  };
}

/**
 * Crea la carta en Lob.
 * @param {Object} order - fila de orders
 * @param {string} idempotencyKey - normalmente el id de la orden
 * @returns {Promise<{ id, expectedDelivery, price, url }>}
 */
async function createLetter(order, idempotencyKey) {
  const apiKey = process.env.LOB_API_KEY;
  if (!apiKey) throw Object.assign(new Error('LOB_API_KEY no configurada'), { retryable: false });

  const body = {
    description: `CartaParaSanta ${order.order_number}`,
    to: {
      name: order.ship_name,
      address_line1: order.ship_line1,
      address_line2: order.ship_line2 || undefined,
      address_city: order.ship_city,
      address_state: order.ship_state,
      address_zip: order.ship_zip,
      address_country: order.ship_country || 'US',
    },
    from: fromAddress(),
    file: buildPrintHtml(order),
    color: true,
    double_sided: false,
    // Lob imprime la dirección arriba de la página 1 (se ve por la ventana del sobre
    // estándar). printTemplate.js deja esa zona libre. Así no se cobra una hoja extra.
    address_placement: 'top_first_page',
    mail_type: 'usps_first_class',
    // Correspondencia de una compra, no publicidad.
    use_type: process.env.LOB_USE_TYPE || 'operational',
    metadata: { orderId: order.id, orderNumber: order.order_number },
  };

  let response;
  try {
    response = await fetch('https://api.lob.com/v1/letters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw Object.assign(new Error(`No se pudo contactar a Lob: ${err.message}`), { retryable: true });
  }

  let data = {};
  try { data = await response.json(); } catch (_) { /* respuesta vacía */ }

  if (!response.ok) {
    const msg = data?.error?.message || `Lob respondió ${response.status}`;
    // 429 y 5xx son temporales; 4xx (dirección inválida, parámetros) necesitan una persona.
    const retryable = response.status === 429 || response.status >= 500;
    throw Object.assign(new Error(msg), { retryable, status: response.status });
  }

  console.log(`💲 Lob ${data.id} (${order.order_number}): precio ${data.price ?? 'n/d'}, entrega estimada ${data.expected_delivery_date ?? 'n/d'}`);
  return {
    id: data.id,
    expectedDelivery: data.expected_delivery_date || null,
    price: data.price != null ? Number(data.price) : null,
    url: data.url || null,
  };
}

/** Datos de una carta ya creada (para el enlace al PDF en el panel). */
async function getLetter(lobLetterId) {
  const apiKey = process.env.LOB_API_KEY;
  if (!apiKey || !lobLetterId) return null;
  const res = await fetch(`https://api.lob.com/v1/letters/${encodeURIComponent(lobLetterId)}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') },
  });
  return res.ok ? res.json() : null;
}

/**
 * Verifica la firma de un webhook de Lob: HMAC-SHA256 de `${timestamp}.${rawBody}` con
 * LOB_WEBHOOK_SECRET, comparado con el header Lob-Signature. (Confirmar el formato en la
 * documentación de webhooks de Lob al registrarlo.)
 */
function verifyWebhook(rawBody, headers) {
  const secret = process.env.LOB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('⚠️  LOB_WEBHOOK_SECRET no está configurada: se aceptan webhooks de Lob sin verificar (solo en desarrollo)');
    return process.env.NODE_ENV !== 'production';
  }
  const signature = headers['lob-signature'];
  const timestamp = headers['lob-signature-timestamp'];
  if (!signature || !timestamp) return false;

  // Rechaza webhooks de más de 10 minutos (evita que se reenvíe uno viejo capturado).
  const ts = Number(timestamp);
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > 10 * 60 * 1000) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Evento de Lob → estado de la orden.
const EVENT_STATUS = {
  'letter.mailed': 'mailed',
  'letter.in_transit': 'in_transit',
  'letter.in_local_area': 'in_transit',
  'letter.processed_for_delivery': 'delivered',
  'letter.re-routed': 'in_transit',
  'letter.returned_to_sender': 'error',
};

module.exports = { createLetter, getLetter, verifyWebhook, EVENT_STATUS };
