// Pruebas de la llamada a Lob (fetch simulado) y de la verificación de webhooks.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const lob = require('../lob');

const order = {
  id: '6f1c2a5e-0b1d-4c7e-9d2a-1a2b3c4d5e6f', order_number: 'PN-48213', design: 'taller',
  greeting: 'Querido Santa:', child_name: 'Sofía', child_age: 7, message: 'Hola', gifts: ['Una bici'],
  farewell: 'Con cariño,', signature: 'Sofía',
  ship_name: 'Sofía Rivera', ship_line1: 'Calle 1', ship_line2: '', ship_city: 'Arecibo', ship_state: 'PR', ship_zip: '00612',
};

test('createLetter manda los parámetros acordados y el Idempotency-Key', async () => {
  process.env.LOB_API_KEY = 'test_abc';
  process.env.LOB_FROM_ADDRESS_ID = 'adr_santa';
  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({ id: 'ltr_1', expected_delivery_date: '2026-12-01', price: '1.89' }) };
  };
  const r = await lob.createLetter(order, order.id);
  const body = JSON.parse(captured.init.body);
  assert.strictEqual(captured.init.headers['Idempotency-Key'], order.id);
  assert.strictEqual(body.address_placement, 'top_first_page');
  assert.strictEqual(body.mail_type, 'usps_first_class');
  assert.strictEqual(body.use_type, 'operational');
  assert.strictEqual(body.color, true);
  assert.strictEqual(body.from, 'adr_santa');
  assert.strictEqual(body.metadata.orderId, order.id);
  assert.match(body.file, /class="page santa"/);
  assert.match(body.file, /class="page child"/);
  assert.doesNotMatch(body.file, /Lob imprime aquí/); // la marca de preview no va a impresión
  assert.deepStrictEqual(r, { id: 'ltr_1', expectedDelivery: '2026-12-01', price: 1.89, url: null });
});

test('createLetter clasifica errores temporales y permanentes', async () => {
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: { message: 'address invalid' } }) });
  await assert.rejects(lob.createLetter(order, 'k'), (e) => e.retryable === false && /address invalid/.test(e.message));
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(lob.createLetter(order, 'k'), (e) => e.retryable === true);
});

test('verifyWebhook acepta la firma correcta y rechaza la incorrecta o vieja', () => {
  process.env.LOB_WEBHOOK_SECRET = 'secreto';
  const raw = JSON.stringify({ event_type: { id: 'letter.mailed' } });
  const ts = String(Date.now());
  const sig = crypto.createHmac('sha256', 'secreto').update(`${ts}.${raw}`).digest('hex');
  assert.strictEqual(lob.verifyWebhook(raw, { 'lob-signature': sig, 'lob-signature-timestamp': ts }), true);
  assert.strictEqual(lob.verifyWebhook(raw, { 'lob-signature': 'x'.repeat(64), 'lob-signature-timestamp': ts }), false);
  const old = String(Date.now() - 60 * 60 * 1000);
  const sigOld = crypto.createHmac('sha256', 'secreto').update(`${old}.${raw}`).digest('hex');
  assert.strictEqual(lob.verifyWebhook(raw, { 'lob-signature': sigOld, 'lob-signature-timestamp': old }), false);
});
