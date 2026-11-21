// recordatorios.js
// Recordatorios de compra sin terminar: el adulto llenó la carta y sus datos, fue a
// Stripe y no pagó. Se le escriben dos correos, sin descuentos:
//   1) a la hora de crear la orden;
//   2) a las 20 horas, avisando que la carta se borra sola a las 24-25 h (db.expireUnpaid).
//
// Reglas para no molestar (ni escribirle a quien ya compró):
//  - Nunca a órdenes con código de descuento (familia): esas las maneja Angel a mano.
//  - Nunca a quien pidió no recibir más recordatorios (tabla reminder_optouts, que
//    guarda el hash del correo y no el correo, para que sobreviva al borrado de 25 h).
//  - Nunca si ese correo ya tiene otra orden pagada (o en camino) creada después de esta
//    menos 1 h: es que volvió a empezar y sí pagó.
//  - Como máximo un correo de recordatorio por dirección cada 24 h, aunque tenga varias
//    órdenes abandonadas (pasa cuando alguien reintenta varias veces).
//  - El envío se "reclama" con un UPDATE atómico: si dos procesos corren a la vez, solo
//    uno manda el correo.
//
// Los enlaces van firmados con printUrl (HMAC + vencimiento) para que nadie pueda reabrir
// el pago de otra orden adivinando su id.

const crypto = require('crypto');
const db = require('./db');
const email = require('./email');
const printUrl = require('./printUrl');

const RESUME_TTL = 30 * 60 * 60; // 30 h: cubre de sobra hasta el borrado a las 25 h
const OPTOUT_TTL = 120 * 24 * 60 * 60; // 120 días: la baja debe funcionar aunque abran el correo tarde

const emailHash = (addr) =>
  crypto.createHash('sha256').update(String(addr || '').trim().toLowerCase()).digest('hex');

const resumePath = (orderId) => `/r/pagar/${orderId}`;
const optOutPath = (hash) => `/r/baja/${hash}`;

function links(order) {
  return {
    resumeUrl: printUrl.signedUrl(resumePath(order.id), RESUME_TTL),
    optOutUrl: printUrl.signedUrl(optOutPath(emailHash(order.buyer_email)), OPTOUT_TTL),
  };
}

// Ventanas (en horas desde created_at) y columna de cada recordatorio.
const STAGES = {
  1: { col: 'reminder1_at', from: 1, to: 19, extra: '' },
  2: { col: 'reminder2_at', from: 20, to: 24, extra: 'AND o.reminder1_at IS NOT NULL' },
};

async function candidates(n) {
  const s = STAGES[n];
  const { rows } = await db.query(
    `SELECT o.* FROM orders o
      WHERE o.status = 'pending_payment' AND o.purged_at IS NULL
        AND o.${s.col} IS NULL ${s.extra}
        AND o.promo_code IS NULL AND o.buyer_email IS NOT NULL
        AND o.created_at < now() - make_interval(hours => $1)
        AND o.created_at > now() - make_interval(hours => $2)
        AND NOT EXISTS (SELECT 1 FROM reminder_optouts x
                         WHERE x.email_hash = encode(sha256(convert_to(lower(trim(o.buyer_email)), 'UTF8')), 'hex'))
        AND NOT EXISTS (SELECT 1 FROM orders p
                         WHERE lower(p.buyer_email) = lower(o.buyer_email) AND p.id <> o.id
                           AND p.status NOT IN ('pending_payment', 'cancelled')
                           AND p.created_at > o.created_at - interval '1 hour')
        AND NOT EXISTS (SELECT 1 FROM orders r
                         WHERE lower(r.buyer_email) = lower(o.buyer_email) AND r.id <> o.id
                           AND GREATEST(r.reminder1_at, r.reminder2_at) > now() - interval '24 hours')
      ORDER BY o.created_at DESC
      LIMIT 50`,
    [s.from, s.to]
  );
  return rows;
}

async function claim(id, n) {
  const col = STAGES[n].col;
  const { rows } = await db.query(
    `UPDATE orders SET ${col} = now()
      WHERE id = $1 AND ${col} IS NULL AND status = 'pending_payment' AND purged_at IS NULL
      RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function sendReminders() {
  const settings = await db.getSettings();
  if (!settings.mailboxOpen) return; // con el buzón cerrado no tiene sentido invitar a pagar
  const seen = new Set();
  let sent = 0;
  // Primero el 2.º: si alguien tiene órdenes en las dos ventanas, gana la más urgente.
  for (const n of [2, 1]) {
    for (const o of await candidates(n)) {
      const key = emailHash(o.buyer_email);
      if (seen.has(key)) continue; // un solo correo por dirección en cada vuelta
      seen.add(key);
      const order = await claim(o.id, n);
      if (!order) continue;
      try {
        await email.abandonedReminder(order, n, {
          ...links(order),
          priceCents: order.amount_cents,
          deadline: settings.deadlineRecommended,
        });
        sent++;
      } catch (err) {
        // No se desmarca: preferimos perder un recordatorio a mandarlo dos veces.
        console.error(`Recordatorio ${n} de la orden ${order.order_number} falló:`, err.message);
      }
    }
  }
  if (sent) console.log(`💌 Recordatorios de compra enviados: ${sent}`);
}

async function optOut(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return false;
  await db.query('INSERT INTO reminder_optouts (email_hash) VALUES ($1) ON CONFLICT DO NOTHING', [hash]);
  return true;
}

module.exports = { sendReminders, optOut, links, emailHash, resumePath, optOutPath, STAGES };
