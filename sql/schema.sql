-- Esquema de CartaParaSanta.com (Postgres)
-- Ejecutar con:  psql "$DATABASE_URL" -f sql/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number           text UNIQUE NOT NULL,
  status                 text NOT NULL DEFAULT 'pending_payment'
                           CHECK (status IN ('pending_payment','paid','needs_review','sent_to_lob','mailed',
                                             'in_transit','delivered','error','cancelled','refunded')),

  -- Carta
  design                 text NOT NULL, -- la lista válida está en validate.js (DESIGNS)
  greeting               text,
  child_name             text,
  child_age              smallint CHECK (child_age IS NULL OR child_age BETWEEN 1 AND 17),
  message                text,
  gifts                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  farewell               text,
  signature              text,

  -- Adulto responsable
  buyer_name             text,
  buyer_email            text,
  consent_at             timestamptz,
  consent_ip             text,

  -- Envío
  ship_name              text,
  ship_line1             text,
  ship_line2             text,
  ship_city              text,
  ship_state             text,
  ship_zip               text,
  ship_country           text DEFAULT 'US',

  -- Revisión y pago
  review_reason          text,
  amount_cents           integer,
  stripe_session_id      text,
  stripe_payment_intent  text,

  -- Lob
  lob_letter_id          text UNIQUE,
  lob_expected_delivery  date,
  lob_price              numeric(10,2),
  lob_attempts           smallint NOT NULL DEFAULT 0,

  error                  text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  paid_at                timestamptz,
  sent_to_lob_at         timestamptz,
  mailed_at              timestamptz,
  delivered_at           timestamptz,
  purged_at              timestamptz
);

CREATE INDEX IF NOT EXISTS orders_status_idx      ON orders (status);
CREATE INDEX IF NOT EXISTS orders_buyer_email_idx ON orders (lower(buyer_email));
CREATE INDEX IF NOT EXISTS orders_created_idx     ON orders (created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value) VALUES
  ('price_cents',          '0'),
  ('mailbox_open',         'true'),
  ('deadline_recommended', '"2026-12-10"'),
  ('mailbox_close_date',   '"2026-12-14"')
ON CONFLICT (key) DO NOTHING;

-- Bases creadas antes del 9 nov 2026 tenían un CHECK con solo 5 diseños.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_design_check;
