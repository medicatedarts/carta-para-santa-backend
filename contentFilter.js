// contentFilter.js
// Filtro de contenido para CartaParaSanta.
//
// Sale del de Yo Te Lo Dije, pero la política es otra: aquí escribe un niño o niña,
// lo lee "Santa", y lo que pase el filtro se imprime en papel y llega a una casa.
//
//  - block  → no se crea la orden. El niño ve un mensaje amable y corrige la carta.
//             Groserías (español, incluidas las de Puerto Rico, e inglés), enlaces,
//             correos y teléfonos.
//  - review → la orden se cobra pero NO se envía a Lob: queda en "needs_review" y
//             llega una alerta. Son textos que un adulto debe leer antes de imprimir:
//             violencia, contenido sexual, o un niño que podría estar contando que
//             alguien le hace daño. En ese último caso lo importante es que una
//             persona lo lea, no rechazar la carta.
//
// Limitaciones (las mismas que en Yo Te Lo Dije): es por palabras, no entiende
// contexto, se puede evadir con errores a propósito y puede tener falsos positivos.
// Términos extra sin tocar el código: CUSTOM_BLOCKED_TERMS="uno,dos".

// Minúsculas y sin tildes en las vocales, pero conservando la ñ:
// "coño" no debe confundirse con "cono" (un cono de helado).
function normalize(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const w = (words) => words.map((t) => new RegExp(`(^|\\s)${t}(\\s|$)`));

// Groserías. Insultos suaves que los niños usan ("tonto", "feo") se permiten.
const PROFANITY = w([
  'mierda', 'mierdas', 'carajo', 'carajos', 'coño', 'puta', 'putas', 'puto', 'putos', 'putita',
  'hijueputa', 'hijo de puta', 'hdp', 'pendejo', 'pendeja', 'pendejos', 'pendejada', 'cabron', 'cabrona',
  'cabrones', 'joder', 'jodido', 'jodida', 'culo', 'culos', 'verga', 'vergas', 'cojones', 'chingar',
  'chingada', 'chingado', 'pinche', 'mamabicho', 'mamao', 'bellaco', 'bellaca', 'cabronazo', 'maricon',
  'maricones', 'marica', 'zorra', 'perra', 'malparido', 'gonorrea', 'conchetumare', 'concha de tu madre',
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'shitty', 'bitch', 'bitches', 'asshole', 'dick',
  'pussy', 'bastard', 'cunt', 'wtf', 'stfu', 'slut', 'whore', 'nigger', 'nigga', 'faggot', 'retard',
]);

// Señales para que un adulto lea la carta antes de imprimirla.
const REVIEW = w([
  // posible daño al niño
  'me pegan', 'me pega', 'me golpea', 'me golpean', 'me maltrata', 'me maltratan', 'me lastima',
  'me lastiman', 'me hace daño', 'me hacen daño', 'tocamientos', 'abuso', 'abusa', 'me abusa',
  'tengo miedo de mi', 'tengo miedo en mi casa', 'no quiero vivir', 'quiero morirme', 'me quiero morir',
  'hurts me', 'hits me', 'touches me', 'abuse', 'i want to die',
  // amenazas (solo frases: "pistola de agua", "Nerf gun" o "bomba" —la música— son regalos y palabras normales)
  'te voy a matar', 'voy a matar a', 'lo voy a matar', 'la voy a matar', 'matarte', 'matarlo', 'matarla',
  'kill you', 'kill him', 'kill her', 'i will kill',
  // sexual
  'sexo', 'sexual', 'desnudo', 'desnuda', 'porno', 'sex', 'naked', 'porn',
]);

const LINK = /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|io|co|me|ly|gg|tv|app|xyz|info|biz)\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(?:\d[\s().-]*){7,}/;

function loadCustomTerms() {
  return (process.env.CUSTOM_BLOCKED_TERMS || '')
    .split(',')
    .map((t) => normalize(t))
    .filter(Boolean)
    .map((t) => new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`));
}

const any = (text, patterns) => patterns.find((re) => re.test(text));

/**
 * @param {Object} letter - { greeting, childName, message, gifts: string[], farewell, signature }
 * @returns {{ action: 'allow'|'block'|'review', reason?: string, code?: string }}
 */
function checkContent(letter) {
  const raw = [letter.greeting, letter.childName, letter.message, ...(letter.gifts || []), letter.farewell, letter.signature]
    .filter(Boolean)
    .join('\n');
  const text = normalize(raw);

  if (LINK.test(raw) || EMAIL.test(raw)) {
    return { action: 'block', code: 'link', reason: 'Las cartas a Santa no pueden llevar enlaces ni correos. Bórralos e inténtalo de nuevo.' };
  }
  if (PHONE.test(raw)) {
    return { action: 'block', code: 'phone', reason: 'Por seguridad, la carta no puede llevar números de teléfono. Bórralos e inténtalo de nuevo.' };
  }
  if (any(text, PROFANITY) || any(text, loadCustomTerms())) {
    return { action: 'block', code: 'profanity', reason: 'Santa prefiere palabras bonitas. Revisa tu carta y cambia las palabras feas.' };
  }

  const flagged = any(text, REVIEW);
  if (flagged) {
    // Se guarda la regla que coincidió (no el texto del niño) para que el panel muestre por qué.
    return { action: 'review', code: 'review', reason: `Revisar antes de imprimir: coincide con "${flagged.source.replace(/\(\^\|\\s\)|\(\\s\|\$\)/g, '')}"` };
  }

  return { action: 'allow' };
}

module.exports = { checkContent, normalize };
