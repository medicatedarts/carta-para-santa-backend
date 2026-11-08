// santaReply.js
// Arma el texto de la respuesta de Santa a partir de docs/RESPUESTA_DE_SANTA.md.
//
// Cada parte con variantes se elige con un hash del id de la orden + el nombre de
// la parte: la misma orden siempre produce la misma carta (si se reimprime sale
// igual) y dos hermanos con órdenes distintas reciben cartas distintas.
// Devuelve texto plano; el escapado para HTML lo hace printTemplate.js.

const crypto = require('crypto');

const OPENINGS = [
  '¡Tu carta llegó al Polo Norte! La leí junto a la chimenea del taller, con una taza de chocolate caliente, y me hizo sonreír de oreja a oreja.',
  '¡Qué alegría recibir tu carta! Uno de mis duendes del correo vino corriendo a traérmela, y la leí enseguida, con mis lentes puestos y mucha atención.',
  'Esta mañana, mientras los renos desayunaban, llegó tu carta a mi escritorio. La leí dos veces porque me gustó muchísimo.',
];

const AGE_LINES = [
  '¡{edad} años! Estás creciendo muy rápido, y se nota en lo bien que escribes.',
  'Me contaron que ya tienes {edad} años. ¡Qué grande estás!',
];

const YEAR_LINES = [
  'Los duendes me han contado que este año te has esforzado mucho. Eso me pone muy, muy feliz.',
  'Aquí en el Polo Norte siempre estamos pendientes de los niños y niñas que tratan de ser buenos, y tu nombre salió muchas veces en nuestras conversaciones.',
  'Sé que a veces portarse bien no es fácil, pero también sé que lo intentas con todo tu corazón. Eso es lo que más me importa.',
];

const GIFTS_ONE = [
  'Anoté con cuidado lo que pediste: {regalos}. Ya le entregué tu lista a los duendes del taller para que la revisen con mucho cariño.',
  'Vi que en tu lista pediste {regalos}. Guardé tu carta en el lugar especial donde los duendes revisan los deseos de Navidad.',
];

const GIFTS_MANY = [
  'Anoté con cuidado tu lista: {regalos}. Ya se la entregué a los duendes del taller para que la revisen con mucho cariño.',
  'Leí tu lista de deseos, con {regalos}, ¡y los duendes ya se asomaron a verla! La guardamos en el lugar especial donde revisamos los deseos de Navidad.',
];

const NO_GIFTS = 'No me pediste nada en tu lista, y eso me dice que tienes un corazón muy generoso. Igual te tendremos muy presente aquí en el taller.';

const ADVICE = [
  'Mientras tanto, sigue siendo amable, comparte con los demás y acuéstate temprano en Nochebuena.',
  'Hasta entonces, recuerda ayudar en casa, abrazar mucho a tu familia y dormir temprano en Nochebuena.',
  'Te pido un favor: sigue sonriendo, trata bien a todos y no te olvides de dormir temprano en Nochebuena.',
];

const CLOSINGS = [
  'Rodolfo y los demás renos te mandan un saludo enorme.',
  'La señora Claus y todos los duendes te mandan un abrazo grandote.',
  'Los renos están practicando sus vuelos y te mandan muchos saludos desde el establo.',
];

function pick(list, seed, part) {
  const h = crypto.createHash('sha256').update(`${seed}:${part}`).digest();
  return list[h.readUInt32BE(0) % list.length];
}

// "Una bicicleta roja" → "una bicicleta roja" dentro de la frase, pero sin tocar
// siglas o marcas ("PS5", "LEGO").
function lowerFirst(s) {
  if (s.length > 1 && /[A-ZÁÉÍÓÚÑ]/.test(s[0]) && /[a-záéíóúñ]/.test(s[1])) {
    return s[0].toLowerCase() + s.slice(1);
  }
  return s;
}

function joinEs(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}

function firstName(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

/**
 * @param {Object} order - fila de la tabla orders
 * @param {Date} [now]
 * @returns {{ header, date, greeting, paragraphs: string[], farewell, signature, ps }}
 */
function buildSantaReply(order, now = new Date()) {
  const seed = order.id;
  const name = (order.child_name || '').trim() || firstName(order.ship_name);
  const gifts = (Array.isArray(order.gifts) ? order.gifts : []).filter(Boolean).map(lowerFirst);

  const p1 = [pick(OPENINGS, seed, 'opening')];
  if (order.child_age) p1.push(pick(AGE_LINES, seed, 'age').replace('{edad}', order.child_age));

  let giftsText;
  if (gifts.length === 0) {
    giftsText = NO_GIFTS;
  } else {
    let list = joinEs(gifts.slice(0, 3));
    if (gifts.length > 3) list = gifts.slice(0, 3).join(', ') + '… y todo lo demás que me pediste';
    giftsText = pick(gifts.length === 1 ? GIFTS_ONE : GIFTS_MANY, seed, 'gifts').replace('{regalos}', list);
  }

  return {
    header: 'Taller de Santa Claus',
    place: 'Polo Norte',
    date: `Diciembre, ${now.getFullYear()}`,
    greeting: name ? `Hola, ${name}:` : 'Hola, amiguito o amiguita:',
    paragraphs: [
      p1.join(' '),
      pick(YEAR_LINES, seed, 'year'),
      giftsText,
      `${pick(ADVICE, seed, 'advice')} ${pick(CLOSINGS, seed, 'closing')}`,
    ],
    farewell: 'Con mucho cariño desde el Polo Norte,',
    signature: 'Santa Claus',
    ps: 'P.D. En este sobre va una copia de la carta que me escribiste. ¡Guárdala como un recuerdo mágico!',
  };
}

module.exports = { buildSantaReply, joinEs, lowerFirst };
