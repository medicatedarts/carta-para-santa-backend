// Pruebas del envío a Lob con la base de datos, Lob y el correo simulados.
// Comprueban lo más delicado: que una carta nunca se mande dos veces y que los
// errores temporales y permanentes se traten distinto.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// --- simulaciones ---
const orders = new Map();
const lobCalls = [];
let lobBehavior = 'ok';
const alerts = [];

function stub(modPath, exports) {
  const full = require.resolve(path.join(__dirname, '..', modPath));
  require.cache[full] = { id: full, filename: full, loaded: true, exports };
}

stub('db.js', {
  async claimForLob(id, from) {
    const o = orders.get(id);
    if (!o || o.lob_letter_id || !from.includes(o.status)) return null;
    Object.assign(o, { status: 'sent_to_lob', lob_attempts: o.lob_attempts + 1, error: null });
    return { ...o };
  },
  async updateOrder(id, patch) { Object.assign(orders.get(id), patch); return { ...orders.get(id) }; },
});
stub('lob.js', {
  async createLetter(order, key) {
    lobCalls.push({ id: order.id, key });
    if (lobBehavior === 'temporal') throw Object.assign(new Error('Lob 503'), { retryable: true });
    if (lobBehavior === 'permanent') throw Object.assign(new Error('address invalid'), { retryable: false });
    return { id: 'ltr_' + order.id, expectedDelivery: '2026-12-01', price: 1.5 };
  },
});
stub('email.js', {
  async orderConfirmation() {}, async alert(subject) { alerts.push(subject); },
});

const { sendToLob, afterPaid } = require('../fulfill');

const mk = (id, extra = {}) => orders.set(id, { id, order_number: 'PN-' + id, status: 'paid', lob_letter_id: null, lob_attempts: 0, ...extra });

test('dos envíos simultáneos de la misma orden producen una sola carta', async () => {
  mk('a'); lobBehavior = 'ok'; lobCalls.length = 0;
  const [r1, r2] = await Promise.all([sendToLob('a'), sendToLob('a')]);
  assert.strictEqual(lobCalls.length, 1);
  assert.strictEqual([r1, r2].filter(Boolean).length, 1);
  assert.strictEqual(orders.get('a').lob_letter_id, 'ltr_a');
  assert.strictEqual(lobCalls[0].key, 'a'); // Idempotency-Key = id de la orden
  assert.strictEqual(await sendToLob('a'), null); // ya enviada: no se repite
});

test('error temporal queda marcado para reintento; permanente genera alerta', async () => {
  mk('b'); lobBehavior = 'temporal';
  await sendToLob('b');
  assert.strictEqual(orders.get('b').status, 'error');
  assert.match(orders.get('b').error, /^\[temporal\]/);

  mk('c'); lobBehavior = 'permanent'; alerts.length = 0;
  await sendToLob('c');
  assert.doesNotMatch(orders.get('c').error, /temporal/);
  assert.strictEqual(alerts.length, 1);
});

test('una orden con review_reason va a revisión y no a Lob', async () => {
  mk('d', { review_reason: 'Revisar' }); lobBehavior = 'ok'; lobCalls.length = 0;
  await afterPaid({ ...orders.get('d') });
  assert.strictEqual(orders.get('d').status, 'needs_review');
  assert.strictEqual(lobCalls.length, 0);
  // y se aprueba desde el panel
  await sendToLob('d', { fromStatuses: ['needs_review'] });
  assert.strictEqual(orders.get('d').lob_letter_id, 'ltr_d');
});
