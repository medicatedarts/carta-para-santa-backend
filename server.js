// server.js
// Backend de CartaParaSanta.com: recibe la carta → cobra con Stripe → al confirmarse el
// pago, Lob imprime y envía la respuesta de Santa con una copia de la carta del niño.
// Ver docs/ESPECIFICACION.md.
//
//   cp .env.example .env && npm install && npm run db:init && npm run dev
//   stripe listen --forward-to localhost:4000/api/webhook/stripe

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');

const db = require('./db');
const { validateCheckout } = require('./validate');
const { checkContent } = require('./contentFilter');
const { buildPrintHtml } = require('./printTemplate');
const lob = require('./lob');
const email = require('./email');
const { sendToLob, afterPaid } = require('./fulfill');
const { startJobs } = require('./jobs');

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');

for (const key of ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'LOB_API_KEY', 'ADMIN_TOKEN']) {
  if (!process.env[key]) console.warn(`⚠️  ${key} no está configurada`);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const app = express();
app.set('trust proxy', 1); // Render pone un proxy delante: así req.ip es la IP real

const origins = (process.env.CORS_ORIGINS || FRONTEND_URL).split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins }));

// Fuentes para la impresión (Lob las descarga desde aquí si están en fonts/).
app.use('/fonts', express.static(path.join(__dirname, 'fonts'), { maxAge: '30d' }));

// ---------------------------------------------------------------------------
// Webhooks: necesitan el body crudo para verificar la firma, así que van ANTES
// de express.json() (igual que en Yo Te Lo Dije).
// ---------------------------------------------------------------------------
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Firma de webhook de Stripe inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Se responde enseguida para que Stripe no reintente por demora; lo que falle
  // después lo retoma jobs.js (las órdenes pagadas sin carta se reintentan solas).
  res.status(200).send('ok');

  if (event.type !== 'checkout.session.completed') return;
  const session = event.data.object;
  const orderId = session.metadata && session.metadata.orderId;
  if (!orderId || session.payment_status !== 'paid') return;

  setImmediate(async () => {
    try {
      const order = await db.markPaid(orderId, {
        sessionId: session.id,
        paymentIntent: session.payment_intent,
        amountCents: session.amount_total,
      });
      // null = ya estaba pagada (webhook repetido) o no existe: no se hace nada más.
      if (order) await afterPaid(order);
    } catch (err) {
      console.error(`Error procesando el pago de ${orderId}:`, err.message);
    }
  });
});

app.post('/api/webhook/lob', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = req.body.toString('utf-8');
  if (!lob.verifyWebhook(raw, req.headers)) return res.status(401).send('firma inválida');

  let event;
  try { event = JSON.parse(raw); } catch (_) { return res.status(400).send('json inválido'); }
  res.status(200).send('ok');

  try {
    const type = event.event_type && event.event_type.id;
    const status = lob.EVENT_STATUS[type];
    if (!status) return;
    const lobId = event.reference_id || (event.body && event.body.id);
    const order = (lobId && (await db.getOrderByLobId(lobId))) ||
      (event.body && event.body.metadata && (await db.getOrder(event.body.metadata.orderId)));
    if (!order) return;

    // No retroceder: un evento atrasado de "en tránsito" no deshace "entregada".
    const rank = { sent_to_lob: 1, mailed: 2, in_transit: 3, delivered: 4 };
    if (status !== 'error' && (rank[order.status] || 0) >= rank[status]) return;

    // El evento "Mailed" de Lob es exclusivo del plan Enterprise: en los demás planes
    // el primer aviso que llega es el de USPS (in_transit / in_local_area). Por eso la
    // carta se da por "salida" con el primer evento de seguimiento que llegue, sea cual sea.
    const firstTracking = status !== 'error' && (rank[order.status] || 0) < rank.mailed;

    const patch = { status };
    if (firstTracking) patch.mailed_at = new Date();
    if (status === 'delivered') patch.delivered_at = new Date();
    if (status === 'error') patch.error = 'USPS devolvió la carta al remitente';
    const updated = await db.updateOrder(order.id, patch);

    if (firstTracking) await email.orderMailed(updated);
    if (status === 'error') await email.alert('USPS devolvió una carta', updated, 'Revisa la dirección y reenvía.');
  } catch (err) {
    console.error('Error procesando webhook de Lob:', err.message);
  }
});

app.use(express.json({ limit: '50kb' }));

// ---------------------------------------------------------------------------
// Límite simple de peticiones por IP (sin dependencias): 20 checkouts cada 15 min.
// ---------------------------------------------------------------------------
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.', code: 'rate_limited' });
    list.push(now);
    hits.set(key, list);
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k); }, 3600e3).unref();

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', async (_req, res) => {
  try {
    const s = await db.getSettings();
    res.json({ ...s, currency: process.env.STRIPE_CURRENCY || 'usd', taxMode: process.env.TAX_MODE || 'included' });
  } catch (err) {
    console.error('Error leyendo la configuración:', err.message);
    res.status(500).json({ error: 'No se pudo leer la configuración.' });
  }
});

app.post('/api/checkout', rateLimit(20, 15 * 60 * 1000), async (req, res) => {
  try {
    const settings = await db.getSettings();
    if (!settings.mailboxOpen) {
      return res.status(400).json({ error: 'El buzón del Polo Norte cerró por este año. ¡Gracias por escribirle a Santa!', code: 'mailbox_closed' });
    }
    if (!settings.priceCents || settings.priceCents < 50) {
      return res.status(500).json({ error: 'El precio no está configurado todavía.', code: 'config' });
    }

    let data;
    try {
      data = validateCheckout(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'validation' });
    }

    const content = checkContent(data.letter);
    if (content.action === 'block') {
      return res.status(400).json({ error: content.reason, code: 'content_policy' });
    }

    const order = await db.createOrder({
      ...data.letter,
      buyerName: data.buyer.name,
      buyerEmail: data.buyer.email,
      consentIp: req.ip || null,
      ship: data.shipTo,
      reviewReason: content.action === 'review' ? content.reason : null,
      amountCents: settings.priceCents,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: data.buyer.email,
      line_items: [{
        price_data: {
          currency: process.env.STRIPE_CURRENCY || 'usd',
          unit_amount: settings.priceCents,
          product_data: {
            name: 'Carta de respuesta de Santa — impresa y enviada por correo',
            description: `Para: ${data.shipTo.name} · Orden ${order.order_number}`,
          },
        },
        quantity: 1,
      }],
      metadata: { orderId: order.id, orderNumber: order.order_number },
      payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.order_number } },
      success_url: `${FRONTEND_URL}/gracias.html?order=${order.id}`,
      cancel_url: `${FRONTEND_URL}/enviar.html?cancelado=1`,
    });

    await db.updateOrder(order.id, { stripe_session_id: session.id });
    console.log(`🧾 Orden ${order.order_number} creada${order.review_reason ? ' (irá a revisión)' : ''}`);
    res.json({ checkoutUrl: session.url, orderId: order.id, orderNumber: order.order_number });
  } catch (err) {
    console.error('Error creando el checkout:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.', code: 'server' });
  }
});

// Estado para la página de gracias. Sin datos personales.
app.get('/api/order/:id', async (req, res) => {
  try {
    const order = await db.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    // needs_review / error / sent_to_lob se muestran al cliente como "en preparación".
    const publicStatus = {
      pending_payment: 'pending_payment', paid: 'preparing', needs_review: 'preparing', sent_to_lob: 'preparing',
      error: 'preparing', mailed: 'mailed', in_transit: 'mailed', delivered: 'delivered',
      cancelled: 'cancelled', refunded: 'refunded',
    }[order.status];
    res.json({ orderNumber: order.order_number, status: publicStatus, expectedDelivery: order.lob_expected_delivery });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo consultar el pedido.' });
  }
});

// ---------------------------------------------------------------------------
// Administración (header x-admin-token). La usa admin.html del frontend.
// ---------------------------------------------------------------------------
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'No autorizado.' });
  }
  next();
}
const admin = express.Router();
admin.use(requireAdmin);
// Express 4 no pasa al manejador de errores los rechazos de funciones async:
// se envuelve cada ruta del panel para que un fallo de la base de datos responda 500.
for (const m of ['get', 'post', 'patch', 'delete']) {
  const orig = admin[m].bind(admin);
  admin[m] = (route, ...handlers) => orig(route, ...handlers.map((h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)));
}

admin.get('/orders', async (req, res) => {
  res.json(await db.listOrders({ status: req.query.status, q: req.query.q, limit: req.query.limit, offset: req.query.offset }));
});

admin.get('/orders/:id', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  let lobUrl = null;
  if (order.lob_letter_id) {
    const letter = await lob.getLetter(order.lob_letter_id).catch(() => null);
    lobUrl = letter && letter.url;
  }
  res.json({ ...order, lobUrl });
});

admin.get('/orders/:id/preview', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).send('Pedido no encontrado');
  res.type('html').send(buildPrintHtml(order, { preview: true }));
});

// Carta de ejemplo de cualquier diseño, para revisar la impresión sin crear órdenes.
admin.get('/sample/:design', (req, res) => {
  res.type('html').send(buildPrintHtml({
    id: 'muestra-' + req.params.design, order_number: 'PN-00000', design: req.params.design,
    greeting: 'Querido Santa:', child_name: 'Sofía', child_age: 7,
    message: 'Este año me porté muy bien y ayudé a mi mamá con mi hermanito. ¿Cómo están Rodolfo y los demás renos?',
    gifts: ['Una bicicleta roja', 'Un set de pintura', 'Un libro de dinosaurios'],
    farewell: 'Con mucho cariño,', signature: 'Sofía', ship_name: 'Sofía Rivera',
  }, { preview: true }));
});

admin.post('/orders/:id/approve', async (req, res) => {
  const updated = await sendToLob(req.params.id, { fromStatuses: ['needs_review'] });
  if (!updated) return res.status(409).json({ error: 'No se pudo enviar: revisa el estado o el error de la orden.' });
  res.json(updated);
});

admin.post('/orders/:id/resend', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  // Reenvío decidido por una persona (por ejemplo, después de corregir la dirección):
  // usa una llave nueva para que Lob no devuelva el error anterior guardado.
  const updated = await sendToLob(order.id, {
    fromStatuses: ['error', 'paid'],
    idempotencyKey: `${order.id}-r${order.lob_attempts + 1}`,
  });
  if (!updated) return res.status(409).json({ error: 'No se pudo reenviar: revisa el estado o el error de la orden.' });
  res.json(updated);
});

admin.patch('/orders/:id/address', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.lob_letter_id) return res.status(409).json({ error: 'La carta ya está en Lob; no se puede cambiar la dirección.' });
  const a = req.body || {};
  const updated = await db.updateOrder(order.id, {
    ship_name: a.name ?? order.ship_name, ship_line1: a.line1 ?? order.ship_line1, ship_line2: a.line2 ?? order.ship_line2,
    ship_city: a.city ?? order.ship_city, ship_state: (a.state ?? order.ship_state).toUpperCase(), ship_zip: a.zip ?? order.ship_zip,
  });
  res.json(updated);
});

admin.post('/orders/:id/refund', async (req, res) => {
  const order = await db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
  if (order.lob_letter_id) return res.status(409).json({ error: 'La carta ya se envió a Lob; el reembolso se hace desde Stripe si corresponde.' });
  if (!['paid', 'needs_review', 'error'].includes(order.status) || !order.stripe_payment_intent) {
    return res.status(409).json({ error: 'Esta orden no tiene un pago que reembolsar.' });
  }
  try {
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent });
    const updated = await db.updateOrder(order.id, { status: 'refunded' });
    await email.orderRefunded(updated);
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `Stripe: ${err.message}` });
  }
});

admin.get('/stats', async (_req, res) => res.json(await db.stats()));
admin.get('/settings', async (_req, res) => res.json(await db.getSettings()));
admin.patch('/settings', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.priceCents !== undefined) {
    const n = Number(b.priceCents);
    if (!Number.isInteger(n) || n < 50) return res.status(400).json({ error: 'Precio inválido (en centavos, mínimo 50).' });
    patch.priceCents = n;
  }
  if (b.mailboxOpen !== undefined) patch.mailboxOpen = Boolean(b.mailboxOpen);
  for (const k of ['deadlineRecommended', 'mailboxCloseDate']) {
    if (b[k] !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b[k])) return res.status(400).json({ error: `${k} debe ser AAAA-MM-DD.` });
      patch[k] = b[k];
    }
  }
  res.json(await db.setSettings(patch));
});

app.use('/api/admin', admin);

// Borrado a pedido de un padre o madre (se mantiene de Yo Te Lo Dije).
app.delete('/api/order/:id', requireAdmin, async (req, res) => {
  const deleted = await db.deleteOrder(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Pedido no encontrado' });
  res.json({ ok: true, message: `Pedido ${req.params.id} eliminado.` });
});

// Errores no atrapados en rutas async (Express 4 no los atrapa solo).
app.use((err, _req, res, _next) => {
  console.error('Error no manejado:', err.message);
  res.status(500).json({ error: 'Error interno.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎅 CartaParaSanta backend en el puerto ${PORT}`);
    startJobs();
  });
}

module.exports = app;
