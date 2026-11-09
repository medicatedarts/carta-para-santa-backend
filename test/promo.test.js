// Códigos de descuento: cálculo del precio y límites (Stripe y la base simulados).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
// db.js necesita pg y una base; aquí se reemplaza por un objeto simulado.
const db = { countPromoUses: async () => 0 };
const full = require.resolve(path.join(__dirname, '..', 'db.js'));
require.cache[full] = { id: full, filename: full, loaded: true, exports: db };
const { checkPromo, applyCoupon } = require('../promo');

function fakeStripe(pc) {
  return { promotionCodes: { list: async () => ({ data: pc ? [pc] : [] }) }, coupons: { retrieve: async () => null } };
}
const FAMILIA = { id: 'promo_1', code: 'FAMILIA2026', coupon: { percent_off: 100, valid: true }, max_redemptions: 20, times_redeemed: 3 };

test('applyCoupon: 100% deja la carta en 0 y nunca baja de 0', () => {
  assert.strictEqual(applyCoupon(799, { percent_off: 100 }), 0);
  assert.strictEqual(applyCoupon(799, { percent_off: 50 }), 400);
  assert.strictEqual(applyCoupon(799, { amount_off: 1000 }), 0);
});

test('checkPromo acepta el código y respeta el límite por correo', async () => {
  const orig = db.countPromoUses;
  try {
    db.countPromoUses = async () => 3;
    const ok = await checkPromo(fakeStripe(FAMILIA), 'familia2026', 'hermano@example.com', 799);
    assert.ok(ok.ok);
    assert.strictEqual(ok.finalCents, 0);
    db.countPromoUses = async () => 4;
    const no = await checkPromo(fakeStripe(FAMILIA), 'FAMILIA2026', 'hermano@example.com', 799);
    assert.strictEqual(no.ok, false);
    assert.strictEqual(no.code, 'promo_email_limit');
  } finally { db.countPromoUses = orig; }
});

test('checkPromo rechaza códigos agotados, inexistentes o con caracteres raros', async () => {
  const orig = db.countPromoUses;
  db.countPromoUses = async () => 0;
  try {
    const agotado = await checkPromo(fakeStripe({ ...FAMILIA, times_redeemed: 20 }), 'FAMILIA2026', 'a@b.co', 799);
    assert.strictEqual(agotado.code, 'promo_exhausted');
    assert.strictEqual((await checkPromo(fakeStripe(null), 'NOEXISTE', 'a@b.co', 799)).ok, false);
    assert.strictEqual((await checkPromo(fakeStripe(FAMILIA), "x'; drop", 'a@b.co', 799)).ok, false);
  } finally { db.countPromoUses = orig; }
});
