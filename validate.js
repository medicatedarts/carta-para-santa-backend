// validate.js
// Límites y normalización de la carta (ESPECIFICACION §5). Deben coincidir con
// los del frontend: con estos tamaños cada carta cabe en una página impresa.

const DESIGNS = ['clasica', 'taller', 'estrellas', 'polonorte', 'juguetes', 'duendes', 'dulces', 'cascanueces'];

const LIMITS = {
  greeting: 40,
  childName: 30,
  message: 700,
  gifts: 12,
  gift: 60,
  farewell: 40,
  signature: 30,
  buyerName: 80,
  shipName: 60,
  line: 64,
  city: 40,
};

// Estados y territorios que acepta Lob como envío doméstico de EE. UU.
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD',
  'TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','GU','AS','MP',
]);

// Quita espacios sobrantes y caracteres de control (no se imprimen bien y
// pueden romper el HTML de impresión). Mantiene los saltos de línea del mensaje.
function clean(value, { multiline = false } = {}) {
  if (value === undefined || value === null) return '';
  let s = String(value).normalize('NFC').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
  if (multiline) {
    s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

function fail(message) {
  const err = new Error(message);
  err.code = 'validation';
  return err;
}

/**
 * Valida y normaliza el cuerpo de POST /api/checkout.
 * Devuelve { letter, buyer, shipTo, consent } limpio o lanza un error con code 'validation'
 * o 'consent_required' y un mensaje listo para mostrar.
 */
function validateCheckout(body) {
  const b = body || {};
  const l = b.letter || {};
  const buyer = b.buyer || {};
  const ship = b.shipTo || {};
  const consent = b.consent || {};

  const design = DESIGNS.includes(l.design) ? l.design : null;
  if (!design) throw fail('Escoge uno de los diseños de carta.');

  const greeting = clean(l.greeting) || 'Querido Santa:';
  const childName = clean(l.childName);
  const message = clean(l.message, { multiline: true });
  const farewell = clean(l.farewell);
  const signature = clean(l.signature);

  let childAge = null;
  if (l.childAge !== undefined && l.childAge !== null && String(l.childAge).trim() !== '') {
    childAge = Number(l.childAge);
    if (!Number.isInteger(childAge) || childAge < 1 || childAge > 17) {
      throw fail('La edad debe ser un número entre 1 y 17.');
    }
  }

  const gifts = (Array.isArray(l.gifts) ? l.gifts : []).map((g) => clean(g)).filter(Boolean);

  const tooLong = [
    [greeting, LIMITS.greeting, 'El saludo'],
    [childName, LIMITS.childName, 'El nombre'],
    [message, LIMITS.message, 'El mensaje'],
    [farewell, LIMITS.farewell, 'La despedida'],
    [signature, LIMITS.signature, 'La firma'],
  ].find(([v, max]) => v.length > max);
  if (tooLong) throw fail(`${tooLong[2]} es demasiado largo (máximo ${tooLong[1]} caracteres).`);
  if (gifts.length > LIMITS.gifts) throw fail(`La lista puede tener hasta ${LIMITS.gifts} regalos.`);
  if (gifts.some((g) => g.length > LIMITS.gift)) throw fail(`Cada regalo puede tener hasta ${LIMITS.gift} caracteres.`);
  if (!message && gifts.length === 0) throw fail('Escribe un mensaje o al menos un regalo para Santa.');

  // Adulto
  const buyerName = clean(buyer.name);
  const buyerEmail = clean(buyer.email).toLowerCase();
  if (!buyerName || buyerName.length > LIMITS.buyerName) throw fail('Escribe el nombre del adulto responsable.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(buyerEmail) || buyerEmail.length > 120) {
    throw fail('Revisa el correo electrónico.');
  }

  // Dirección
  const shipTo = {
    name: clean(ship.name),
    line1: clean(ship.line1),
    line2: clean(ship.line2),
    city: clean(ship.city),
    state: clean(ship.state).toUpperCase(),
    zip: clean(ship.zip),
    country: 'US',
  };
  if (ship.country && String(ship.country).toUpperCase() !== 'US') {
    const err = fail('Por ahora solo enviamos a Puerto Rico y Estados Unidos.');
    err.code = 'address_unsupported';
    throw err;
  }
  if (!shipTo.name || shipTo.name.length > LIMITS.shipName) throw fail('Escribe el nombre que va en el sobre.');
  if (!shipTo.line1 || shipTo.line1.length > LIMITS.line) throw fail('Escribe la dirección.');
  if (shipTo.line2.length > LIMITS.line) throw fail('La segunda línea de la dirección es demasiado larga.');
  if (!shipTo.city || shipTo.city.length > LIMITS.city) throw fail('Escribe la ciudad o el pueblo.');
  if (!US_STATES.has(shipTo.state)) throw fail('Escoge el estado o territorio.');
  if (!/^\d{5}(-\d{4})?$/.test(shipTo.zip)) throw fail('El código postal debe tener 5 dígitos.');

  // Consentimiento del adulto (COPPA): se valida aquí y no solo en el navegador,
  // porque cualquiera puede llamar a esta ruta directamente.
  if (!consent.isParentOrAuthorized || !consent.acceptedTerms || !consent.acceptedPrivacy) {
    const err = new Error('Falta confirmar que eres el adulto responsable y aceptar los términos y la privacidad.');
    err.code = 'consent_required';
    throw err;
  }

  return {
    letter: { design, greeting, childName, childAge, message, gifts, farewell, signature },
    buyer: { name: buyerName, email: buyerEmail },
    shipTo,
  };
}

module.exports = { validateCheckout, clean, DESIGNS, LIMITS, US_STATES };
