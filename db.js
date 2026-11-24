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

async function insertOrder(client, o) {
  for (let attempt = 0; attempt < 5; attempt++) {
    // SAVEPOINT: dentro de una transacción, un número de orden repetido aborta todo;
    // así solo se deshace este INSERT y se prueba otro número.
    await client.query('SAVEPOINT ins');
    try {
      const { rows } = await client.query(
        `INSERT INTO orders (
           id, group_id, letter_index, lang,
           order_number, status, design, greeting, child_name, child_age, message, gifts, farewell, signature,
           buyer_name, buyer_email, consent_at, consent_ip,
           ship_name, ship_line1, ship_line2, ship_city, ship_state, ship_zip, ship_country,
           review_reason, amount_cents)
         VALUES ($22,$23,$24,$25,$1,'pending_payment',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          newOrderNumber(), o.design, o.greeting, o.childName, o.childAge, o.message, JSON.stringify(o.gifts),
          o.farewell, o.signature, o.buyerName, o.buyerEmail, o.consentIp,
          o.ship.name, o.ship.line1, o.ship.line2, o.ship.city, o.ship.state, o.ship.zip, o.ship.country,
          o.reviewReason, o.amountCents, o.id, o.groupId, o.letterIndex || 0, o.lang === 'en' ? 'en' : 'es',
        ]
      );
      await client.query('RELEASE SAVEPOINT ins');
      return rows[0];
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT ins');
      // 23505 = unique_violation (número de orden repetido): probar otro.
      if (err.code === '23505' && /order_number/.test(err.detail || err.constraint || '')) continue;
      throw err;
    }
  }
  throw new Error('No se pudo generar un número de orden único');
}

/**
 * Crea las órdenes de una compra, una por carta (combo de hermanitos). Cada carta sigue
 * siendo su propia orden: su número, su estado y su envío a Lob con su propia
 * Idempotency-Key, como antes. Lo que las une es group_id, que es el id de la primera
 * (la que lleva la sesión de Stripe). Todo en una transacción: o se crean todas o ninguna.
 * @param {Object[]} list  datos de cada carta (como antes en createOrder)
 * @returns {Promise<Object[]>} las órdenes en orden (letter_index 0, 1, …)
 */
async function createOrderGroup(list) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groupId = crypto.randomUUID();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      out.push(await insertOrder(client, {
        ...list[i], id: i === 0 ? groupId : crypto.randomUUID(), groupId, letterIndex: i,
      }));
    }
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function createOrder(o) {
  return (await createOrderGroup([o]))[0];
}

// Todas las cartas de la compra a la que pertenece la orden `id` (o la orden sola si es de
// antes del combo, cuando group_id no existía).
async function getGroup(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return [];
  const { rows } = await query(
    `SELECT * FROM orders
      WHERE id = $1
         OR group_id = (SELECT group_id FROM orders WHERE id = $1 AND group_id IS NOT NULL)
      ORDER BY letter_index, created_at`,
    [id]
  );
  return rows;
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
  'status', 'promo_code', 'stripe_session_id', 'stripe_payment_intent', 'amount_cents', 'paid_at', 'review_reason',
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

// Órdenes que nunca se pagaron: la página de pago de Stripe vence a las 24 h, así que a las
// 25 h ya no pueden pagarse. Se cancelan y se borra todo lo personal (carta, dirección y
// datos del adulto): no se guarda nada de una compra que no se hizo (privacidad, COPPA).
async function expireUnpaid() {
  const { rowCount } = await query(
    `UPDATE orders SET status = 'cancelled', error = 'Sin pagar en 24 horas: cancelada y borrada sola',
        greeting = NULL, child_name = NULL, child_age = NULL, message = NULL, gifts = '[]'::jsonb,
        farewell = NULL, signature = NULL, buyer_name = NULL, buyer_email = NULL, consent_ip = NULL,
        ship_name = NULL, ship_line1 = NULL, ship_line2 = NULL, ship_city = NULL, ship_state = NULL,
        ship_zip = NULL, review_reason = NULL, purged_at = now()
      WHERE status = 'pending_payment' AND created_at < now() - interval '25 hours'`
  );
  return rowCount;
}

// Marca pagadas las cartas de la compra, solo las que seguían pendientes (un webhook repetido
// no las vuelve a procesar: devuelve []). `id` es la orden principal (la de la sesión de Stripe).
// Cada carta ya guarda su parte del precio desde que se creó; aquí la primera se ajusta para
// que la suma sea exactamente lo que cobró Stripe (por si el redondeo de Stripe difiere).
async function markPaidGroup(id, { sessionId, paymentIntent, amountCents }) {
  const group = await getGroup(id);
  if (!group.length) return [];
  const { rows } = await query(
    `UPDATE orders
        SET status = 'paid', paid_at = now(), stripe_session_id = $2, stripe_payment_intent = $3
      WHERE id = ANY($1::uuid[]) AND status = 'pending_payment'
      RETURNING *`,
    [group.map((o) => o.id), sessionId, paymentIntent]
  );
  if (!rows.length) return [];
  rows.sort((a, b) => a.letter_index - b.letter_index);
  if (amountCents != null && rows.length === group.length) {
    const others = rows.slice(1).reduce((sum, o) => sum + (o.amount_cents || 0), 0);
    const first = Math.max(0, amountCents - others);
    if (first !== rows[0].amount_cents) {
      await query('UPDATE orders SET amount_cents = $2 WHERE id = $1', [rows[0].id, first]);
      rows[0].amount_cents = first;
    }
  }
  return rows;
}

// Una sola orden (se mantiene para el código y las pruebas de antes del combo).
async function markPaid(id, payment) {
  const rows = await markPaidGroup(id, payment);
  return rows.find((o) => o.id === id) || rows[0] || null;
}

// lang = 'es' | 'en' para ver solo las órdenes de un sitio (CartaParaSanta o ReplyFromSanta).
function langOf(lang) { return lang === 'es' || lang === 'en' ? lang : null; }

async function listOrders({ status, q, lang, limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (langOf(lang)) { params.push(langOf(lang)); where.push(`COALESCE(lang, 'es') = $${params.length}`); }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(buyer_email) LIKE ${p} OR lower(order_number) LIKE ${p} OR lower(ship_name) LIKE ${p})`);
  }
  params.push(Math.min(Number(limit) || 50, 200), Number(offset) || 0);
  const { rows } = await query(
    `SELECT id, order_number, status, design, child_name, buyer_email, ship_name, ship_city, ship_state,
            amount_cents, review_reason, error, created_at, paid_at, mailed_at, lob_expected_delivery,
            reminder1_at, reminder2_at, group_id, letter_index, lang,
            (SELECT count(*) FROM orders g WHERE g.group_id = orders.group_id)::int AS group_size
       FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function stats({ lang } = {}) {
  // Mismo filtro por sitio que listOrders; sin lang cuenta los dos sitios.
  const l = langOf(lang);
  const params = l ? [l] : [];
  const and = l ? `AND COALESCE(lang, 'es') = $1` : '';
  const byStatus = await query(`SELECT status, count(*)::int AS n FROM orders WHERE true ${and} GROUP BY status`, params);
  const byDay = await query(
    `SELECT to_char(date_trunc('day', paid_at AT TIME ZONE 'America/Puerto_Rico'), 'YYYY-MM-DD') AS day,
            count(*)::int AS orders, COALESCE(sum(amount_cents), 0)::int AS cents
       FROM orders WHERE paid_at IS NOT NULL ${and}
      GROUP BY 1 ORDER BY 1 DESC LIMIT 60`,
    params
  );
  const rec = await query(
    `SELECT count(*) FILTER (WHERE reminder1_at IS NOT NULL)::int AS sent,
            count(*) FILTER (WHERE reminder1_at IS NOT NULL AND paid_at IS NOT NULL)::int AS recovered,
            COALESCE(sum(amount_cents) FILTER (WHERE reminder1_at IS NOT NULL AND paid_at IS NOT NULL), 0)::int AS cents
       FROM orders WHERE true ${and}`,
    params
  );
  return { byStatus: byStatus.rows, byDay: byDay.rows, reminders: rec.rows[0] };
}

async function deleteOrder(id) {
  const { rowCount } = await query('DELETE FROM orders WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------- settings (lo que se edita desde el panel) ----------
const SETTING_KEYS = ['price_cents', 'extra_price_cents', 'price_cents_en', 'extra_price_cents_en', 'mailbox_open', 'deadline_recommended', 'mailbox_close_date'];

async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    priceCents: Number(s.price_cents ?? process.env.LETTER_PRICE_CENTS ?? 0),
    // Precio de cada carta adicional en la misma compra (combo de hermanitos).
    extraPriceCents: Number(s.extra_price_cents ?? process.env.EXTRA_LETTER_PRICE_CENTS ?? 399),
    // Versión en inglés (ReplyFromSanta): precio propio, más alto que en español.
    priceCentsEn: Number(s.price_cents_en ?? process.env.LETTER_PRICE_CENTS_EN ?? 999),
    extraPriceCentsEn: Number(s.extra_price_cents_en ?? process.env.EXTRA_LETTER_PRICE_CENTS_EN ?? 499),
    mailboxOpen: s.mailbox_open ?? true,
    deadlineRecommended: s.deadline_recommended ?? process.env.DEADLINE_RECOMMENDED ?? null,
    mailboxCloseDate: s.mailbox_close_date ?? process.env.MAILBOX_CLOSE_DATE ?? null,
  };
}

async function setSettings(patch) {
  const map = {
    priceCents: 'price_cents', extraPriceCents: 'extra_price_cents', priceCentsEn: 'price_cents_en', extraPriceCentsEn: 'extra_price_cents_en', mailboxOpen: 'mailbox_open',
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
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text');
  // Recordatorios de compra sin terminar (recordatorios.js)
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder1_at timestamptz');
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS reminder2_at timestamptz');
  // Quien pide no recibir más recordatorios. Se guarda el hash del correo, no el correo.
  await query('CREATE TABLE IF NOT EXISTS reminder_optouts (email_hash text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())');
  // Combo de hermanitos: las cartas de una misma compra comparten group_id (el id de la primera).
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS group_id uuid');
  await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS letter_index smallint NOT NULL DEFAULT 0');
  await query('CREATE INDEX IF NOT EXISTS orders_group_idx ON orders (group_id)');
  // Versión en inglés: cada orden guarda el idioma en que se hizo (carta, correos, enlaces).
  await query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS lang text NOT NULL DEFAULT 'es'");
}

// Veces que un correo ha usado un código. Cuentan las órdenes pagadas o en curso; las
// canceladas/reembolsadas no, y las que quedaron sin pagar solo durante un día (por si
// abren varias páginas de pago a la vez).
async function countPromoUses(email, code) {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM orders
      WHERE lower(buyer_email) = lower($1) AND upper(promo_code) = upper($2)
        AND status NOT IN ('cancelled', 'refunded')
        AND (status <> 'pending_payment' OR created_at > now() - interval '1 day')`,
    [String(email || '').trim(), code]
  );
  return rows[0].n;
}

module.exports = {
  ensureSchema, countPromoUses, expireUnpaid, pool, query, createOrder, createOrderGroup, getGroup, markPaidGroup, getOrder, getOrderByLobId, updateOrder, claimForLob, markPaid,
  listOrders, stats, deleteOrder, getSettings, setSettings,
};
