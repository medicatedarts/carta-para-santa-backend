// fulfill.js
// Lo que pasa después del pago: decidir si la carta va a revisión o a Lob, y mandarla.
// Lo usan el webhook de Stripe, el panel (aprobar / reenviar) y los trabajos periódicos.

const db = require('./db');
const lob = require('./lob');
const email = require('./email');

const MAX_AUTO_ATTEMPTS = 3;

/**
 * Manda la orden a Lob, solo si nadie más la está mandando (ESPECIFICACION §3).
 * @param {string} orderId
 * @param {Object} [opts]
 * @param {string[]} [opts.fromStatuses] estados desde los que se permite enviar
 * @param {string}   [opts.idempotencyKey] por defecto el id de la orden
 * @returns {Promise<Object|null>} la orden actualizada, o null si no se envió
 */
async function sendToLob(orderId, { fromStatuses = ['paid', 'error'], idempotencyKey } = {}) {
  // Chequeo atómico: si otra llamada ya la reclamó, esta no hace nada.
  const order = await db.claimForLob(orderId, fromStatuses);
  if (!order) return null;

  try {
    const letter = await lob.createLetter(order, idempotencyKey || order.id);
    const updated = await db.updateOrder(order.id, {
      lob_letter_id: letter.id,
      lob_expected_delivery: letter.expectedDelivery,
      lob_price: letter.price,
      error: null,
    });
    console.log(`✅ ${order.order_number} enviada a Lob (${letter.id})`);
    return updated;
  } catch (err) {
    // Los errores temporales se marcan para que el job los reintente; los demás esperan al panel.
    const tag = err.retryable && order.lob_attempts < MAX_AUTO_ATTEMPTS ? '[temporal] ' : '';
    const updated = await db.updateOrder(order.id, { status: 'error', error: tag + err.message });
    console.error(`❌ ${order.order_number} falló en Lob (intento ${order.lob_attempts}): ${err.message}`);
    if (!tag) await email.alert('Una carta no se pudo enviar a Lob', updated, err.message);
    return null;
  }
}

// Una carta ya pagada: a revisión si el filtro la marcó, o directo a Lob.
async function reviewOrSend(order) {
  if (order.review_reason) {
    const updated = await db.updateOrder(order.id, { status: 'needs_review' });
    await email.alert('Carta pendiente de revisión', updated, order.review_reason);
    return updated;
  }
  return sendToLob(order.id, { fromStatuses: ['paid'] });
}

/**
 * Después de marcar pagadas las cartas de una compra: UN correo de confirmación con todas
 * y luego cada carta por su cuenta (revisión o Lob). Si una falla, las demás siguen.
 * @param {Object[]} orders  las órdenes recién pagadas de la compra
 */
async function afterPaidGroup(orders) {
  if (!orders.length) return [];
  await email.orderConfirmation(orders);
  const out = [];
  for (const order of orders) {
    try {
      out.push(await reviewOrSend(order));
    } catch (err) {
      // jobs.js retoma las cartas pagadas que no llegaron a Lob.
      console.error(`Error enviando ${order.order_number} después del pago:`, err.message);
      out.push(null);
    }
  }
  return out;
}

/** Una sola orden (como antes del combo). */
async function afterPaid(order) {
  return (await afterPaidGroup([order]))[0];
}

module.exports = { sendToLob, afterPaid, afterPaidGroup, MAX_AUTO_ATTEMPTS };
