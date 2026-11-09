// Verificación de dirección antes de cobrar (fetch simulado).
const test = require('node:test');
const assert = require('node:assert');
const { checkAddress } = require('../addressVerify');
const ship = { line1: '500 Calle Adjuntas', line2: 'Urb Victor Rojas 1', city: 'Arecibo', state: 'PR', zip: '00612' };
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test('con clave de prueba en modo auto no se verifica', async () => {
  process.env.LOB_API_KEY = 'test_x'; delete process.env.ADDRESS_VERIFICATION;
  global.fetch = async () => { throw new Error('no debería llamar'); };
  assert.deepStrictEqual(await checkAddress(ship), { ok: true, skipped: true });
});

test('con clave live: bloquea direcciones que USPS no entrega y acepta las buenas', async () => {
  process.env.LOB_API_KEY = 'live_x';
  global.fetch = reply(200, { deliverability: 'undeliverable' });
  assert.strictEqual((await checkAddress(ship)).code, 'address_undeliverable');
  global.fetch = reply(200, { deliverability: 'deliverable_missing_unit' });
  assert.match((await checkAddress(ship)).message, /apartamento/);
  global.fetch = reply(200, { deliverability: 'deliverable' });
  assert.deepStrictEqual(await checkAddress(ship), { ok: true });
  global.fetch = reply(200, { deliverability: 'deliverable_unnecessary_unit' });
  assert.strictEqual((await checkAddress(ship)).ok, true);
});

test('si Lob falla (403 sin cupo, red caída) la compra sigue', async () => {
  process.env.LOB_API_KEY = 'live_x';
  global.fetch = reply(403, { error: { message: 'payment method required' } });
  assert.strictEqual((await checkAddress(ship)).ok, true);
  global.fetch = async () => { throw new Error('ECONNRESET'); };
  assert.strictEqual((await checkAddress(ship)).ok, true);
});

test('ADDRESS_VERIFICATION=off nunca verifica', async () => {
  process.env.LOB_API_KEY = 'live_x'; process.env.ADDRESS_VERIFICATION = 'off';
  global.fetch = async () => { throw new Error('no debería llamar'); };
  assert.strictEqual((await checkAddress(ship)).skipped, true);
  delete process.env.ADDRESS_VERIFICATION;
});
