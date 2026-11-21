// Recordatorios de compra sin terminar: enlaces firmados, baja y reglas de envío
// (la base y el correo simulados).
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.PRINT_URL_SECRET = 'secreto-de-prueba';
process.env.BACKEND_PUBLIC_URL = 'https://api.example.com';

const calls = [];
const db = {
  rows: { 1: [], 2: [] },
  claimed: new Set(),
  getSettings: async () => ({ mailboxOpen: true, deadlineRecommended: '2026-12-12' }),
  query: async (sql, params) => {
    calls.push(sql);
    if (sql.includes('SELECT o.* FROM orders o')) return { rows: sql.includes('reminder2_at IS NULL') ? db.rows[2] : db.rows[1] };
    if (sql.startsWith('UPDATE orders SET reminder')) {
      const key = `${params[0]}|${sql.includes('reminder1_at') ? 1 : 2}`;
      if (db.claimed.has(key)) return { rows: [] };
      db.claimed.add(key);
      const all = [...db.rows[1], ...db.rows[2]];
      return { rows: [all.find((o) => o.id === params[0])] };
    }
    if (sql.startsWith('INSERT INTO reminder_optouts')) return { rows: [] };
    throw new Error('consulta inesperada: ' + sql);
  },
};
const sent = [];
const email = { abandonedReminder: async (order, n, opts) => sent.push({ order, n, opts }) };
for (const [name, exp] of [['db.js', db], ['email.js', email]]) {
  const full = require.resolve(path.join(__dirname, '..', name));
  require.cache[full] = { id: full, filename: full, loaded: true, exports: exp };
}
const printUrl = require('../printUrl');
const r = require('../recordatorios');

const order = (id, mail, extra = {}) => ({ id, order_number: 'CPS-' + id, buyer_email: mail, amount_cents: 599, ...extra });

function check(url) {
  const u = new URL(url);
  return printUrl.verify(u.pathname, u.searchParams.get('exp'), u.searchParams.get('sig'));
}

test('los enlaces van firmados y no sirven para otra orden', () => {
  const { resumeUrl, optOutUrl } = r.links(order('aaa', 'Mamá@Example.com '));
  assert.ok(resumeUrl.startsWith('https://api.example.com/r/pagar/aaa?'));
  assert.ok(check(resumeUrl));
  assert.ok(check(optOutUrl));
  const otra = resumeUrl.replace('/r/pagar/aaa', '/r/pagar/bbb');
  assert.ok(!check(otra));
  // La baja usa el hash del correo normalizado, nunca el correo.
  assert.ok(optOutUrl.includes(r.emailHash('mamá@example.com')));
  assert.ok(!optOutUrl.toLowerCase().includes('example.com/r/baja/mam'));
});

test('optOut solo acepta un hash válido', async () => {
  assert.strictEqual(await r.optOut('no-es-un-hash'), false);
  assert.strictEqual(await r.optOut(r.emailHash('a@b.com')), true);
});

test('un solo correo por dirección por vuelta, el 2.º tiene prioridad y no se repite', async () => {
  sent.length = 0;
  db.rows[2] = [order('o2', 'papa@example.com')];
  db.rows[1] = [order('o1', 'PAPA@example.com'), order('o3', 'tia@example.com')];
  await r.sendReminders();
  assert.deepStrictEqual(sent.map((s) => [s.order.id, s.n]), [['o2', 2], ['o3', 1]]);
  assert.strictEqual(sent[0].opts.priceCents, 599);
  assert.strictEqual(sent[0].opts.deadline, '2026-12-12');
  // Segunda vuelta: ya reclamadas, no se envía nada otra vez.
  sent.length = 0;
  await r.sendReminders();
  assert.strictEqual(sent.length, 0);
});

test('la consulta excluye códigos de descuento, bajas y a quien ya compró', async () => {
  const sql = calls.find((c) => c.includes('SELECT o.* FROM orders o'));
  assert.match(sql, /promo_code IS NULL/);
  assert.match(sql, /reminder_optouts/);
  assert.match(sql, /p\.status NOT IN \('pending_payment', 'cancelled'\)/);
  assert.match(sql, /interval '24 hours'/);
});

test('con el buzón cerrado no se manda nada', async () => {
  sent.length = 0;
  const orig = db.getSettings;
  db.getSettings = async () => ({ mailboxOpen: false });
  db.rows[1] = [order('o9', 'x@example.com')];
  await r.sendReminders();
  db.getSettings = orig;
  assert.strictEqual(sent.length, 0);
});
