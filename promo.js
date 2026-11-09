// promo.js
// Códigos de descuento. Los códigos se crean en Stripe (Product catalog → Coupons → Promotion codes),
// pero se aplican desde nuestro formulario y no en la página de Stripe, porque Stripe no sabe
// limitar usos POR CORREO. Aquí se valida el código con Stripe y se cuenta cuántas veces lo ha
// usado ese correo en nuestra base (PROMO_MAX_PER_EMAIL, 4 por defecto: el código familiar).

const db = require('./db');

const CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;

function maxPerEmail() {
  const n = parseInt(process.env.PROMO_MAX_PER_EMAIL || '4', 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

function fail(message, code = 'promo_invalid') {
  return { ok: false, message, code };
}

// Precio final en centavos con el cupón aplicado (nunca negativo).
function applyCoupon(priceCents, coupon) {
  if (coupon.percent_off) return Math.max(0, Math.round(priceCents * (1 - coupon.percent_off / 100)));
  if (coupon.amount_off) return Math.max(0, priceCents - coupon.amount_off);
  return priceCents;
}

/**
 * Valida un código para un correo. Devuelve
 *   { ok: true, promotionCodeId, code, finalCents, coupon }  o  { ok: false, message, code }.
 */
async function checkPromo(stripe, rawCode, email, priceCents) {
  const codeText = String(rawCode || '').trim();
  if (!CODE_RE.test(codeText)) return fail('Ese código no es válido.');
  if (!stripe) return fail('Los códigos no están disponibles ahora mismo.', 'config');

  let pc;
  try {
    const list = await stripe.promotionCodes.list({ code: codeText, active: true, limit: 1 });
    pc = list.data[0];
  } catch (err) {
    console.error('Error consultando el código en Stripe:', err.message);
    return fail('No pudimos revisar el código. Inténtalo de nuevo en unos minutos.', 'promo_error');
  }
  if (!pc) return fail('Ese código no existe o ya no está activo.');

  // En versiones nuevas de la API el cupón viene en pc.promotion.coupon.
  let coupon = pc.coupon || (pc.promotion && pc.promotion.coupon);
  if (typeof coupon === 'string') coupon = await stripe.coupons.retrieve(coupon);
  if (!coupon || coupon.valid === false) return fail('Ese código ya no está activo.');

  const now = Math.floor(Date.now() / 1000);
  if (pc.expires_at && pc.expires_at < now) return fail('Ese código ya venció.');
  if (pc.max_redemptions && pc.times_redeemed >= pc.max_redemptions) {
    return fail('Ese código ya se usó todas las veces permitidas.', 'promo_exhausted');
  }

  const used = await db.countPromoUses(email, pc.code);
  const max = maxPerEmail();
  if (used >= max) {
    return fail(`Este correo ya usó el código ${max} ${max === 1 ? 'vez' : 'veces'}, que es el máximo.`, 'promo_email_limit');
  }

  return { ok: true, promotionCodeId: pc.id, code: pc.code, finalCents: applyCoupon(priceCents, coupon), coupon };
}

module.exports = { checkPromo, applyCoupon, maxPerEmail, CODE_RE };
