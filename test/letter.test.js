// Pruebas de validación, filtro y respuesta de Santa (sin base de datos ni red).
//   npm test
const test = require('node:test');
const assert = require('node:assert');
const { validateCheckout } = require('../validate');
const { checkContent } = require('../contentFilter');
const { buildSantaReply } = require('../santaReply');

const base = () => ({
  letter: { design: 'clasica', greeting: 'Querido Santa:', childName: 'Sofía', childAge: '7',
    message: 'Este año me porté muy bien.', gifts: ['Una bicicleta roja', '  ', 'Un set de pintura'],
    farewell: 'Con cariño,', signature: 'Sofía' },
  buyer: { name: 'Ana Rivera', email: 'Ana@Ejemplo.com ' },
  shipTo: { name: 'Sofía Rivera', line1: 'Calle 1 #23', city: 'Arecibo', state: 'pr', zip: '00612', country: 'US' },
  consent: { isParentOrAuthorized: true, acceptedTerms: true, acceptedPrivacy: true },
});

test('valida y normaliza una carta correcta', () => {
  const r = validateCheckout(base());
  assert.deepStrictEqual(r.letter.gifts, ['Una bicicleta roja', 'Un set de pintura']);
  assert.strictEqual(r.letter.childAge, 7);
  assert.strictEqual(r.buyer.email, 'ana@ejemplo.com');
  assert.strictEqual(r.shipTo.state, 'PR');
});

test('rechaza sin consentimiento', () => {
  const b = base(); b.consent.acceptedPrivacy = false;
  assert.throws(() => validateCheckout(b), (e) => e.code === 'consent_required');
});

test('rechaza textos largos, edad inválida, zip inválido y diseño desconocido', () => {
  let b = base(); b.letter.message = 'a'.repeat(701);
  assert.throws(() => validateCheckout(b), /mensaje/);
  b = base(); b.letter.childAge = 30;
  assert.throws(() => validateCheckout(b), /edad/);
  b = base(); b.shipTo.zip = '612';
  assert.throws(() => validateCheckout(b), /postal/);
  b = base(); b.letter.design = 'dorada';
  assert.throws(() => validateCheckout(b), /diseños/);
  b = base(); b.letter.gifts = Array(13).fill('x');
  assert.throws(() => validateCheckout(b), /12 regalos/);
});

test('filtro: permite cartas normales y regalos con armas de juguete', () => {
  assert.strictEqual(checkContent({ message: 'Quiero una pistola de agua y un cono de helado', gifts: ['Nerf gun', 'PS5'] }).action, 'allow');
  assert.strictEqual(checkContent({ message: 'Mi hermano es tonto pero lo quiero. Me toca lavar los platos.' }).action, 'allow');
  assert.strictEqual(checkContent({ message: 'Quiero el set LEGO 75192 para 2026' }).action, 'allow');
});

test('filtro: bloquea groserías, enlaces, correos y teléfonos', () => {
  assert.strictEqual(checkContent({ message: 'Eres un pendejo' }).action, 'block');
  assert.strictEqual(checkContent({ gifts: ['coño'] }).action, 'block');
  assert.strictEqual(checkContent({ message: 'mira www.ejemplo.com' }).action, 'block');
  assert.strictEqual(checkContent({ message: 'escríbeme a nene@correo.com' }).action, 'block');
  assert.strictEqual(checkContent({ message: 'llama al 787-555-1234' }).action, 'block');
});

test('filtro: manda a revisión lo delicado', () => {
  assert.strictEqual(checkContent({ message: 'Santa, en mi casa me pegan' }).action, 'review');
  assert.strictEqual(checkContent({ message: 'te voy a matar' }).action, 'review');
});

test('respuesta de Santa: estable por orden y con los regalos', () => {
  const order = { id: '11111111-2222-3333-4444-555555555555', child_name: 'Sofía', child_age: 7,
    gifts: ['Una bicicleta roja', 'Un set de pintura', 'Un libro de dinosaurios', 'PS5'], ship_name: 'Sofía Rivera' };
  const a = buildSantaReply(order, new Date('2026-11-20'));
  const b = buildSantaReply(order, new Date('2026-11-20'));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.greeting, 'Hola, Sofía:');
  assert.match(a.paragraphs[0], /7 años/);
  assert.match(a.paragraphs[2], /una bicicleta roja, un set de pintura, un libro de dinosaurios… y todo lo demás/);
  assert.strictEqual(a.date, 'Diciembre, 2026');
});

test('respuesta de Santa: sin nombre de niño usa el del sobre; sin nada, saludo genérico', () => {
  assert.strictEqual(buildSantaReply({ id: 'x', ship_name: 'Luis Pérez', gifts: [] }).greeting, 'Hola, Luis:');
  const r = buildSantaReply({ id: 'y', gifts: [] });
  assert.strictEqual(r.greeting, 'Hola, amiguito o amiguita:');
  assert.match(r.paragraphs[2], /No me pediste nada/);
});
