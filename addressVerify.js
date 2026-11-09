// addressVerify.js
// Verifica la dirección con Lob (US Verifications / USPS) ANTES de cobrar.
// Si la dirección no existe, el padre lo ve en la pantalla de compra y la corrige ahí,
// en vez de pagar y que la carta quede atascada en Lob.
//
// Notas de Lob:
//  - Con la clave de prueba (test_) Lob nunca verifica direcciones reales: responde datos
//    simulados. Por eso, en modo "auto", solo se verifica con la clave live_.
//  - Las primeras 300 verificaciones live del mes no requieren método de pago; después Lob
//    responde 403 hasta que haya uno. Ante cualquier fallo de Lob (403, red, caída) la
//    compra sigue: es mejor vender y corregir a mano que perder la venta. Lob vuelve a
//    validar al crear la carta.
//  - No se reemplaza lo que escribió el padre por la versión estandarizada: en Puerto Rico
//    Lob separa la urbanización y es fácil perderla. Solo se usa como filtro.
//
// ADDRESS_VERIFICATION = auto (por defecto: solo con clave live) | on | off

const MESSAGES = {
  undeliverable: 'No encontramos esa dirección en el correo postal. Revisa la calle, el número, el pueblo y el código postal.',
  deliverable_missing_unit: 'A esa dirección le falta el número de apartamento, suite o buzón. Añádelo en la línea 2.',
  deliverable_incorrect_unit: 'El número de apartamento o suite no coincide con esa dirección. Revísalo en la línea 2.',
};

function enabled() {
  const mode = (process.env.ADDRESS_VERIFICATION || 'auto').toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return (process.env.LOB_API_KEY || '').startsWith('live_');
}

/**
 * @param {{ line1, line2, city, state, zip }} ship
 * @returns {Promise<{ ok: true, skipped?: boolean } | { ok: false, code: string, message: string }>}
 */
async function checkAddress(ship) {
  if (!enabled() || !process.env.LOB_API_KEY) return { ok: true, skipped: true };

  let res;
  let data = {};
  try {
    res = await fetch('https://api.lob.com/v1/us_verifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(process.env.LOB_API_KEY + ':').toString('base64'),
      },
      body: JSON.stringify({
        primary_line: ship.line1,
        secondary_line: ship.line2 || undefined,
        city: ship.city,
        state: ship.state,
        zip_code: ship.zip,
      }),
      signal: AbortSignal.timeout(8000),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    console.warn('Verificación de dirección no disponible (se permite la compra):', err.message);
    return { ok: true, skipped: true };
  }

  if (!res.ok) {
    console.warn(`Verificación de dirección respondió ${res.status} (se permite la compra): ${data?.error?.message || ''}`);
    return { ok: true, skipped: true };
  }

  const d = data.deliverability;
  if (MESSAGES[d]) return { ok: false, code: 'address_' + d, message: MESSAGES[d] };
  // deliverable y deliverable_unnecessary_unit se aceptan.
  return { ok: true };
}

module.exports = { checkAddress };
