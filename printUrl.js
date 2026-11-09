// printUrl.js
// Lob solo acepta HTML directo de menos de 10,000 caracteres. Las cartas son más
// grandes (dibujos SVG de los papeles), así que a Lob se le pasa una URL desde donde
// descarga el HTML. Esa URL la sirve este mismo backend.
//
// Como la página contiene la carta del niño, la URL va firmada (HMAC) y vence: sin la
// firma correcta nadie puede ver una carta adivinando el id. La clave es
// PRINT_URL_SECRET, o ADMIN_TOKEN si no se definió otra.

const crypto = require('crypto');

const DEFAULT_TTL = 7 * 24 * 60 * 60; // 7 días: de sobra para que Lob la descargue

function secret() {
  const s = process.env.PRINT_URL_SECRET || process.env.ADMIN_TOKEN;
  if (!s) throw new Error('Falta PRINT_URL_SECRET (o ADMIN_TOKEN) para firmar las URL de impresión');
  return s;
}

function sign(path, exp) {
  return crypto.createHmac('sha256', secret()).update(`${path}|${exp}`).digest('hex');
}

/** URL pública y firmada para `path` (por ejemplo "/print/order/<id>"). */
function signedUrl(path, ttlSeconds = DEFAULT_TTL) {
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) {
    throw new Error('BACKEND_PUBLIC_URL debe ser la URL https pública del backend (Lob descarga la carta desde ahí)');
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${base}${path}?exp=${exp}&sig=${sign(path, exp)}`;
}

/** Comprueba la firma y la fecha de vencimiento de una petición. */
function verify(path, exp, sig) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Math.floor(Date.now() / 1000)) return false;
  let expected;
  try { expected = sign(path, e); } catch (_) { return false; }
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const orderPrintUrl = (orderId) => signedUrl(`/print/order/${orderId}`);
const samplePrintUrl = (design, size) => signedUrl(`/print/sample/${design}/${size}`);

module.exports = { signedUrl, verify, orderPrintUrl, samplePrintUrl };
