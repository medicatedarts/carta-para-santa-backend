// metaCapi.js
// Conversiones de Meta (Conversions API) enviadas desde el servidor.
//
// Por qué así y no con el Pixel en el navegador: el sitio lo usan niños, así que no
// ponemos código de Meta en las páginas ni cookies de terceros (ver privacidad.html).
// Solo avisamos a Meta cuando un ADULTO inicia el pago o paga, y solo con datos del
// adulto: su correo cifrado (SHA-256), la IP y el navegador desde donde pagó, el monto
// y, si llegó desde un anuncio, el identificador del clic (fbc). Nunca se envía nada
// de la carta, ni el nombre, la edad o la dirección del niño.
//
// Si faltan META_PIXEL_ID o META_CAPI_TOKEN no se envía nada (útil en desarrollo).
// Nunca lanza errores: una falla de Meta no puede afectar un pago ni una carta.

const crypto = require('crypto');

const API_VERSION = process.env.META_API_VERSION || 'v26.0';

function enabled() {
  return Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// fbc = "fb.1.<milisegundos>.<fbclid>" (formato de Meta). Lo arma el frontend con el
// fbclid de la URL del anuncio; aquí solo se acepta si tiene esa forma exacta.
function cleanFbc(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  return /^fb\.1\.\d{10,14}\.[A-Za-z0-9_\-.]+$/.test(value) ? value : null;
}

/**
 * Envía un evento a Meta. Devuelve true si Meta lo aceptó.
 * @param {Object} e
 * @param {'InitiateCheckout'|'Purchase'} e.eventName
 * @param {string} e.eventId    id único; Meta descarta duplicados con el mismo id
 * @param {string} e.email      correo del adulto (se cifra aquí)
 * @param {string} [e.fbc]
 * @param {string} [e.ip]
 * @param {string} [e.userAgent]
 * @param {number} [e.valueCents]
 * @param {string} [e.currency]
 * @param {string} [e.sourceUrl] página donde ocurrió (sin parámetros personales)
 * @param {string} [e.label]    número de orden, solo para el log
 */
async function sendEvent(e) {
  if (!enabled()) return false;
  try {
    const userData = { em: [sha256(e.email)] };
    const fbc = cleanFbc(e.fbc);
    if (fbc) userData.fbc = fbc;
    if (e.ip) userData.client_ip_address = e.ip;
    if (e.userAgent) userData.client_user_agent = String(e.userAgent).slice(0, 400);

    const event = {
      event_name: e.eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: e.eventId,
      action_source: 'website',
      event_source_url: e.sourceUrl,
      user_data: userData,
      custom_data: {
        currency: (e.currency || 'usd').toUpperCase(),
        value: Number(((e.valueCents || 0) / 100).toFixed(2)),
        content_name: 'Carta de Santa',
        content_type: 'product',
      },
    };

    const body = { data: [event] };
    // Código de "Probar eventos" de Events Manager: solo mientras pruebas.
    if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;

    const url = `https://graph.facebook.com/${API_VERSION}/${encodeURIComponent(process.env.META_PIXEL_ID)}/events`
      + `?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`⚠️  Meta rechazó ${e.eventName} (${e.label || ''}): ${res.status} ${text.slice(0, 300)}`);
      return false;
    }
    console.log(`📣 Meta: ${e.eventName} ${e.label || ''}`);
    return true;
  } catch (err) {
    console.warn(`⚠️  No se pudo enviar ${e.eventName} a Meta: ${err.message}`);
    return false;
  }
}

module.exports = { sendEvent, enabled, cleanFbc, sha256 };
