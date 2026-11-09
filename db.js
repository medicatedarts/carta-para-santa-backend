// db.js
// Acceso a Postgres. Reemplaza el orders.json de Yo Te Lo Dije: en Render el disco
// del servicio se borra en cada deploy o reinicio, así que un archivo local perdería
// pedidos ya pagados.

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render exige SSL desde fuera de su red; dentro (Internal URL) también lo acepta.
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

pool.on('error', (err) => console.error('Error inesperado en Postgres:', err.message));

const query = (text, params) => pool.query(text, params);

// Número visible para el cliente: "PN-" (Polo Norte) + 5 dígitos.
// Se reintenta si choca con uno existente (la columna es UNIQUE).
function newOrderNumber() {
  return 'PN-' + crypto.randomInt(10000, 100000);
}

async function createOrder(o) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await query(
        `INSERT INTO orders (
           order_number, status, design, greeting, child_name, child_age, message, gifts, farewell, signature,
           buyer_name, buyer_email, consent_at, consent_ip,
           ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_zip, ship_country,
           review_reason, amount_cents)
         VALUES ($1,'pending_payment',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          newOrderNumber(), o.design, o.greeting, o.childName, o.childAge, o.message, JSON.stringify(o.gifts),
          o.farewell, o.signature, o.buyerName, o.buyerEmail, o.consentIp,
          o.ship.name, o.ship.line1, o.ship.line2, o.ship.city, o.ship.state, o.ship.zip, o.ship.country,
          o.reviewReason, o.amountCents,
        ]
      );
      return rows[0];
    } catch (err) {
      // 23505 = unique_violation (número de orden repetido): probar otro.
      if (err.code === '23505' && /order_number/.test(err.detail || err.constraint || '')) continue;
      throw err;
    }
  }
  throw new Error('No se pudo generar un número de orden único');
}

async function getOrder(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getOrderByLobId(lobLetterId) {
  const { rows } = await query('SELECT * FROM orders WHERE lob_letter_id = $1', [lobLetterId]);
  return rows[0] || null;
}

// Actualiza solo las columnas permitidas (evita que un nombre de campo llegue a SQL sin control).
const UPDATABLE = new Set([
  'status', 'stripe_session_id', 'stripe_payment_intent', 'amount_cents', 'paid_at', 'review_reason',
  'lob_letter_id', 'lob_expected_delivery', 'lob_price', 'lob_attempts', 'error',
  'sent_to_lob_at', 'mailed_at', 'delivered_at',
  'ship_name', 'ship_line1', 'ship_line2', 'ship_city', 'ship_state', 'ship_zip',
]);

async function updateOrder(id, patch) {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return getOrder(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `UPDATE orders SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...keys.map((k) => patch[k])]
  );
  return rows[0] || null;
}

// Chequeo atómico antes de mandar a Lob (ESPECIFICACION §3): solo una llamada
// puede "reclamar" la orden. Si el webhook de Stripe llega dos veces, o el job de
// reintentos coincide con el webhook, la segunda no obtiene fila y no envía nada.
async function claimForLob(id, fromStatuses = ['paid', 'error']) {
  const { rows } = await query(
    `UPDATE orders
        SET status = 'sent_to_lob', sent_to_lob_at = now(), lob_attempts = lob_attempts + 1, error = NULL
      WHERE id = $1 AND lob_letter_id IS NULL AND status = ANY($2::text[])
      RETURNING *`,
    [id, fromStatuses]
  );
  return rows[0] || null;
}

// Marca pagada solo si seguía pendiente (otro webhook repetido no la vuelve a procesar).
async function markPaid(id, { sessionId, paymentIntent, amountCents }) {
  const { rows } = await query(
    `UPDATE orders
        SET status = 'paid', paid_at = now(), stripe_session_id = $2, stripe_payment_intent = $3,
            amount_cents = COALESCE($4, amount_cents)
      WHERE id = $1 AND status = 'pending_payment'
      RETURNING *`,
    [id, sessionId, paymentIntent, amountCents]
  );
  return rows[0] || null;
}

async function listOrders({ status, q, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(buyer_email) LIKE ${p} OR lower(order_number) LIKE ${p} OR lower(ship_name) LIKE ${p})`);
  }
  params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
  const { rows } = await query(
    `SELECT id, order_number, status, design, child_name, buyer_email, ship_name, ship_city, ship_state,
            amount_cents, review_reason, error, created_at, paid_at, mailed_at, lob_expected_delivery
       FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function stats() {
  const byStatus = await query('SELECT status, count(*)::int AS n FROM orders GROUP BY status');
  const byDay = await query(
    `SELECT to_char(date_trunc('day', paid_at AT TIME ZONE 'America/Puerto_Rico'), 'YYYY-MM-DD') AS day,
            count(*)::int AS orders, COALESCE(sum(amount_cents), 0)::int AS cents
       FROM orders WHERE paid_at IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC LIMIT 60`
  );
  return { byStatus: byStatus.rows, byDay: byDay.rows };
}

async function deleteOrder(id) {
  const { rowCount } = await query('DELETE FROM orders WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------- settings (lo que se edita desde el panel) ----------
const SETTING_KEYS = ['price_cents', 'mailbox_open', 'deadline_recommended', 'mailbox_close_date'];

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    priceCents: Number(s.price_cents ?? process.env.LETTER_PRICE_CENTS ?? 0),
    mailboxOpen: s.mailbox_open ?? true,
    deadlineRecommended: s.deadline_recommended ?? process.env.DEADLINE_RECOMMENDED ?? null,
    mailboxCloseDate: s.mailbox_close_date ?? process.env.MAILBOX_CLOSE_DATE ?? null,
  };
}

async function setSettings(patch) {
  const map = {
    priceCents: 'price_cents', mailboxOpen: 'mailbox_open',
    deadlineRecommended: 'deadline_recommended', mailboxCloseDate: 'mailbox_close_date',
  };
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined || !SETTING_KEYS.includes(col)) continue;
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [col, JSON.stringify(patch[k])]
    );
  }
  return getSettings();
}

// Ajustes de esquema que deben existir antes de recibir órdenes. Son idempotentes y corren
// al arrancar, para no depender de que alguien corra scripts/db-init.js tras cada cambio.
async function ensureSchema() {
  await query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_design_check');
}

module.exports = {
  ensureSchema, pool, query, createOrder, getOrder, getOrderByLobId, updateOrder, claimForLob, markPaid,
  listOrders, stats, deleteOrder, getSettings, setSettings,
};
