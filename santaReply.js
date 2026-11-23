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
  if (order.lang === 'en') return buildSantaReplyEn(order, now);
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

// ---------- Inglés (ReplyFromSanta) ----------
// Mismas partes y misma forma de escoger variantes que en español, para que dos hermanos
// tampoco reciban la misma carta en inglés.
const EN = {
  OPENINGS: [
    'Your letter made it all the way to the North Pole! I read it by the workshop fireplace with a mug of hot cocoa, and it made me smile from ear to ear.',
    'What a joy to get your letter! One of my mail elves came running to bring it to me, and I read it right away, glasses on and paying close attention.',
    'This morning, while the reindeer were having breakfast, your letter landed on my desk. I read it twice because I loved it so much.',
  ],
  AGE_LINES: [
    '{edad} years old! You are growing up so fast, and it shows in how well you write.',
    'The elves told me you are already {edad}. My, how big you are!',
  ],
  YEAR_LINES: [
    'The elves tell me you have been trying really hard this year. That makes me very, very happy.',
    'Here at the North Pole we always keep an eye on the boys and girls who try to be good, and your name came up again and again.',
    'I know being good is not always easy, but I also know you try with all your heart. That is what matters most to me.',
  ],
  GIFTS_ONE: [
    'I carefully wrote down what you asked for: {regalos}. I have already handed your list to the workshop elves so they can look at it with lots of love.',
    'I saw that you asked for {regalos}. I put your letter in the special place where the elves go over Christmas wishes.',
  ],
  GIFTS_MANY: [
    'I carefully wrote down your list: {regalos}. I have already handed it to the workshop elves so they can look at it with lots of love.',
    'I read your wish list, with {regalos}, and the elves have already peeked at it! We keep it in the special place where we go over Christmas wishes.',
  ],
  NO_GIFTS: 'You did not ask for anything on your list, and that tells me you have a very generous heart. We will keep you close in our thoughts here at the workshop.',
  ADVICE: [
    'Until then, keep being kind, share with others and go to bed early on Christmas Eve.',
    'Until then, remember to help out at home, give your family lots of hugs and go to sleep early on Christmas Eve.',
    'I have a favor to ask: keep smiling, be kind to everyone and do not forget to go to bed early on Christmas Eve.',
  ],
  CLOSINGS: [
    'Rudolph and the other reindeer send you a big hello.',
    'Mrs. Claus and all the elves send you a great big hug.',
    'The reindeer are practicing their flying and send you lots of greetings from the stable.',
  ],
};

function joinEn(items) {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return items.join(' and ');
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function buildSantaReplyEn(order, now) {
  const seed = order.id;
  const name = (order.child_name || '').trim() || firstName(order.ship_name);
  const gifts = (Array.isArray(order.gifts) ? order.gifts : []).filter(Boolean);
  const p1 = [pick(EN.OPENINGS, seed, 'opening')];
  if (order.child_age) p1.push(pick(EN.AGE_LINES, seed, 'age').replace('{edad}', order.child_age));
  let giftsText;
  if (gifts.length === 0) {
    giftsText = EN.NO_GIFTS;
  } else {
    let list = joinEn(gifts.slice(0, 3));
    if (gifts.length > 3) list = gifts.slice(0, 3).join(', ') + '… and everything else you asked for';
    giftsText = pick(gifts.length === 1 ? EN.GIFTS_ONE : EN.GIFTS_MANY, seed, 'gifts').replace('{regalos}', list);
  }
  return {
    header: "Santa's Workshop",
    place: 'North Pole',
    date: `December ${now.getFullYear()}`,
    greeting: name ? `Dear ${name},` : 'Dear friend,',
    paragraphs: [
      p1.join(' '),
      pick(EN.YEAR_LINES, seed, 'year'),
      giftsText,
      `${pick(EN.ADVICE, seed, 'advice')} ${pick(EN.CLOSINGS, seed, 'closing')}`,
    ],
    farewell: 'With love from the North Pole,',
    signature: 'Santa Claus',
    ps: 'P.S. Inside this envelope is a copy of the letter you wrote me. Keep it as a magical keepsake!',
  };
}

module.exports = { buildSantaReply, joinEs, joinEn, lowerFirst };
