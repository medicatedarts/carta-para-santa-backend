// i18n.js
// Versión en inglés (ReplyFromSanta). Los mensajes de error del servidor se escriben en
// español en todo el código; aquí se traducen al responder a una página en inglés, en un solo
// lugar, para no duplicar cada validación. Si un mensaje no está en la lista, sale en español:
// mejor un mensaje en español que ninguno. Al añadir un mensaje nuevo al servidor, añádelo aquí.

const LANGS = ['es', 'en'];
const langOf = (v) => (v === 'en' ? 'en' : 'es');

// Frases exactas.
const EXACT = {
  'Falta la carta.': 'The letter is missing.',
  'Escoge uno de los diseños de carta.': 'Choose one of the letter designs.',
  'La edad debe ser un número entre 1 y 17.': 'Age must be a number from 1 to 17.',
  'Escribe un mensaje o al menos un regalo para Santa.': 'Write a message or at least one gift for Santa.',
  'El nombre en el sobre es demasiado largo.': 'The name on the envelope is too long.',
  'Escribe el nombre que va en el sobre.': 'Write the name for the envelope.',
  'Escribe el nombre del adulto responsable.': "Write the parent or guardian's name.",
  'Revisa el correo electrónico.': 'Check the email address.',
  'Por ahora solo enviamos a Puerto Rico y Estados Unidos.': 'For now we only mail to the United States and Puerto Rico.',
  'Escribe la dirección.': 'Write the street address.',
  'La segunda línea de la dirección es demasiado larga.': 'Address line 2 is too long.',
  'Escribe la ciudad o el pueblo.': 'Write the city.',
  'Escoge el estado o territorio.': 'Choose the state or territory.',
  'El código postal debe tener 5 dígitos.': 'The ZIP code must have 5 digits.',
  'Falta confirmar que eres el adulto responsable y aceptar los términos y la privacidad.':
    'Please confirm you are the parent or guardian and accept the terms and privacy policy.',
  'Ese código no es válido.': 'That code is not valid.',
  'Ese código no existe o ya no está activo.': "That code doesn't exist or is no longer active.",
  'Ese código ya no está activo.': 'That code is no longer active.',
  'Ese código ya se usó todas las veces permitidas.': 'That code has already been used the maximum number of times.',
  'Ese código ya venció.': 'That code has expired.',
  'Los códigos no están disponibles ahora mismo.': 'Codes are not available right now.',
  'No pudimos revisar el código. Inténtalo de nuevo en unos minutos.': "We couldn't check the code. Please try again in a few minutes.",
  'No pudimos revisar el código.': "We couldn't check the code.",
  'Escribe primero el correo del adulto.': "Enter the parent's email first.",
  'Demasiados intentos. Espera unos minutos.': 'Too many attempts. Please wait a few minutes.',
  'No se pudo leer la configuración.': "Couldn't load the settings.",
  'El buzón del Polo Norte cerró por este año. ¡Gracias por escribirle a Santa!':
    "The North Pole mailbox is closed for this year. Thank you for writing to Santa!",
  'El precio no está configurado todavía.': 'The price is not set up yet.',
  'No se pudo iniciar el pago. Intenta de nuevo en un momento.': "We couldn't start the payment. Please try again in a moment.",
  'Pedido no encontrado': 'Order not found',
  'No se pudo consultar el pedido.': "We couldn't look up the order.",
  'Las cartas a Santa no pueden llevar enlaces ni correos. Bórralos e inténtalo de nuevo.':
    "Letters to Santa can't include links or email addresses. Please remove them and try again.",
  'Por seguridad, la carta no puede llevar números de teléfono. Bórralos e inténtalo de nuevo.':
    "For safety, the letter can't include phone numbers. Please remove them and try again.",
  'Santa prefiere palabras bonitas. Revisa tu carta y cambia las palabras feas.':
    'Santa prefers kind words. Please check the letter and change the unkind ones.',
  'No encontramos esa dirección en el correo postal. Revisa la calle, el número, el pueblo y el código postal.':
    "The postal service couldn't find that address. Check the street, number, city and ZIP code.",
  'A esa dirección le falta el número de apartamento, suite o buzón. Añádelo en la línea 2.':
    'That address is missing an apartment, suite or unit number. Add it on line 2.',
  'El número de apartamento o suite no coincide con esa dirección. Revísalo en la línea 2.':
    "The apartment or suite number doesn't match that address. Check it on line 2.",
};

const FIELDS = { 'El saludo': 'The greeting', 'El nombre': 'The name', 'El mensaje': 'The message', 'La despedida': 'The closing', 'La firma': 'The signature' };

// Frases con números o variantes.
const PATTERNS = [
  [/^Carta (\d+): (.*)$/s, (m) => `Letter ${m[1]}: ${tr('en', m[2])}`],
  [/^(El saludo|El nombre|El mensaje|La despedida|La firma) es demasiado largo \(máximo (\d+) caracteres\)\.$/, (m) => `${FIELDS[m[1]]} is too long (${m[2]} characters max).`],
  [/^La lista puede tener hasta (\d+) regalos\.$/, (m) => `The list can have up to ${m[1]} gifts.`],
  [/^Cada regalo puede tener hasta (\d+) caracteres\.$/, (m) => `Each gift can have up to ${m[1]} characters.`],
  [/^Puedes enviar hasta (\d+) cartas en una misma compra\.$/, (m) => `You can send up to ${m[1]} letters in one order.`],
  [/^Escribe el nombre que va en el sobre de la carta (\d+)\.$/, (m) => `Write the name for the envelope of letter ${m[1]}.`],
  [/^Este correo ya usó el código (\d+) (vez|veces), que es el máximo\.$/, (m) => `This email has already used the code ${m[1]} time${m[1] === '1' ? '' : 's'}, the maximum.`],
  [/^Este correo puede usar el código (\d+) (vez|veces) más, y esta compra tiene (\d+) cartas\.$/,
    (m) => `This email can use the code ${m[1]} more time${m[1] === '1' ? '' : 's'}, and this order has ${m[3]} letters.`],
];

/** Traduce un mensaje del servidor al idioma de la página. */
function tr(lang, msg) {
  if (langOf(lang) !== 'en' || typeof msg !== 'string') return msg;
  if (EXACT[msg]) return EXACT[msg];
  for (const [re, fn] of PATTERNS) {
    const m = msg.match(re);
    if (m) return fn(m);
  }
  return msg;
}

/**
 * Middleware: si la petición viene de la página en inglés (body.lang o ?lang=en), traduce
 * el campo `error` de cualquier respuesta JSON.
 */
function translateErrors(req, res, next) {
  const lang = langOf((req.body && req.body.lang) || req.query.lang);
  req.lang = lang;
  if (lang === 'en') {
    const json = res.json.bind(res);
    res.json = (body) => json(body && typeof body.error === 'string' ? { ...body, error: tr('en', body.error) } : body);
  }
  next();
}

module.exports = { LANGS, langOf, tr, translateErrors };
