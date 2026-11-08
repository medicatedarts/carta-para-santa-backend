// jobs.js
// Trabajos periódicos (ESPECIFICACION §10). Corren dentro del mismo servicio de Render
// con setInterval: no hace falta un cron aparte para el volumen de una temporada.
//
//  - Cada 10 min: retoma órdenes pagadas que no llegaron a Lob (el proceso murió a
//    mitad del webhook) y reintenta las que fallaron por un error temporal de Lob.
//  - Cada 10 min: avisa de órdenes pagadas que llevan más de 1 hora sin enviarse.
//  - Cada 6 h: borra el contenido de la carta y la dirección de las órdenes ya
//    entregadas hace más de RETENTION_DAYS_AFTER_DELIVERY días (privacidad, COPPA).

const db = require('./db');
const email = require('./email');
const { sendToLob, MAX_AUTO_ATTEMPTS } = require('./fulfill');

const alerted = new Set(); // para no repetir la misma alerta cada 10 minutos

async function retryStuck() {
  // Reclamadas pero sin respuesta de Lob (el proceso se reinició durante la llamada):
  // se reintentan con la misma Idempotency-Key, así que si Lob sí la creó no se duplica.
  await db.query(
    `UPDATE orders SET status = 'error', error = '[temporal] envío interrumpido'
      WHERE status = 'sent_to_lob' AND lob_letter_id IS NULL AND sent_to_lob_at < now() - interval '15 minutes'`
  );

  const { rows } = await db.query(
    `SELECT id FROM orders
      WHERE lob_letter_id IS NULL
        AND ((status = 'paid' AND paid_at < now() - interval '10 minutes')
          OR (status = 'error' AND error LIKE '[temporal]%' AND lob_attempts < $1))
      ORDER BY paid_at LIMIT 20`,
    [MAX_AUTO_ATTEMPTS]
  );
  for (const { id } of rows) await sendToLob(id, { fromStatuses: ['paid', 'error'] });

  const late = await db.query(
    `SELECT * FROM orders WHERE status IN ('paid','sent_to_lob') AND lob_letter_id IS NULL
        AND paid_at < now() - interval '1 hour'`
  );
  for (const o of late.rows) {
    if (alerted.has(o.id)) continue;
    alerted.add(o.id);
    await email.alert('Orden pagada sin enviar a Lob después de 1 hora', o, o.error || '');
  }
}

async function purgeOld() {
  const days = Number(process.env.RETENTION_DAYS_AFTER_DELIVERY || 45);
  // Si USPS no dio el evento de entrega, se toma la fecha de envío + 20 días.
  const { rowCount } = await db.query(
    `UPDATE orders SET
        greeting = NULL, child_name = NULL, child_age = NULL, message = NULL, gifts = '[]'::jsonb,
        farewell = NULL, signature = NULL, ship_name = NULL, ship_line1 = NULL, ship_line2 = NULL,
        ship_city = NULL, ship_zip = NULL, review_reason = NULL, purged_at = now()
      WHERE purged_at IS NULL
        AND COALESCE(delivered_at, mailed_at + interval '20 days') < now() - make_interval(days => $1)`,
    [days]
  );
  if (rowCount) console.log(`🧹 Borrado por retención: ${rowCount} órdenes`);
}

function safe(fn, name) {
  return () => fn().catch((err) => console.error(`Job ${name} falló:`, err.message));
}

function startJobs() {
  setTimeout(safe(retryStuck, 'retryStuck'), 30 * 1000);
  setInterval(safe(retryStuck, 'retryStuck'), 10 * 60 * 1000);
  setTimeout(safe(purgeOld, 'purgeOld'), 60 * 1000);
  setInterval(safe(purgeOld, 'purgeOld'), 6 * 60 * 60 * 1000);
}

module.exports = { startJobs, retryStuck, purgeOld };
