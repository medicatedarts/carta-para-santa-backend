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
const crypto = require('crypto');
const Stripe = require('stripe');

const db = require('./db');
const { checkPromo } = require('./promo');
const { validateCheckout, maxLetters } = require('./validate');
const { translateErrors, langOf } = require('./i18n');
const { checkContent } = require('./contentFilter');
const { checkAddress } = require('./addressVerify');
const { buildPrintHtml } = require('./printTemplate');
const printUrl = require('./printUrl');
const { sampleOrder } = require('./samples');
const { DESIGNS } = require('./validate');
const lob = require('./lob');
const email = require('./email');
const { sendToLob, afterPaidGroup } = require('./fulfill');
const { startJobs } = require('./jobs');
const metaCapi = require('./metaCapi');
const recordatorios = require('./recordatorios');

const PORT = process.env.PORT || 4000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5500').replace(/\/$/, '');
// Versión en inglés (ReplyFromSanta): mismo backend, otra web. Sin la variable, las órdenes en
// inglés vuelven a la web en español (mejor que a ninguna).
const FRONTEND_URL_EN = (process.env.FRONTEND_URL_EN || FRONTEND_URL).replace(/\/$/, '');
const frontendFor = (lang) => (lang === 'en' ? FRONTEND_URL_EN : FRONTEND_URL);

for (const key of ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'LOB_API_KEY', 'ADMIN_TOKEN']) {
  if (!process.env[key]) console.warn(`⚠️  ${key} no está configurada`);
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const app = express();
app.set('trust proxy', 1); // Render pone un proxy delante: así req.ip es la IP real
app.disable('x-powered-by');

// Cabeceras de seguridad básicas (sin dependencias). La API no se muestra en iframes ajenos
// ni la página de impresión, y los navegadores no deben adivinar tipos de contenido.
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Resource-Policy': 'cross-origin', // fondos y fuentes los carga Lob y el panel
  });
  next();
});

const origins = (process.env.CORS_ORIGINS || [FRONTEND_URL, FRONTEND_URL_EN].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins }));

// Fuentes para la impresión (Lob las descarga desde aquí si están en fonts/).
app.use('/fonts', express.static(path.join(__dirname, 'fonts'), { maxAge: '30d' }));
// Fondos de las cartas (imágenes a 300 ppp que Lob descarga al imprimir).
app.use('/fondos', express.static(path.join(__dirname, 'papeles', 'fondos'), { maxAge: '1d' }));

// ---------------------------------------------------------------------------
// HTML de impresión para Lob (URL firmada y con vencimiento, ver printUrl.js).
// ---------------------------------------------------------------------------
app.get('/print/order/:id', async (req, res) => {
  if (!printUrl.verify(req.path, req.query.exp, req.query.sig)) return res.status(403).send('Enlace inválido o vencido');
  try {
    const order = await db.getOrder(req.params.id);
    if (!order || order.purged_at) return res.status(404).send('No encontrada');
    res.set('Cache-Control', 'private, no-store').type('html').send(buildPrintHtml(order));
  } catch (err) {
    console.error('Error sirviendo la carta para imprimir:', err.message);
    res.status(500).send('Error');
  }
});

app.get('/print/sample/:design/:size', (req, res) => {
  if (!printUrl.verify(req.path, req.query.exp, req.query.sig)) return res.status(403).send('Enlace inválido o vencido');
  if (!DESIGNS.includes(req.params.design) || !['corta', 'larga'].includes(req.params.size)) return res.status(404).send('No encontrada');
  res.set('Cache-Control', 'private, no-store').type('html').send(buildPrintHtml(sampleOrder(req.params.design, req.params.size)));
});

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
  // "no_payment_required": la orden se cubrió completa con un código de descuento (p. ej. 100% familia).
  if (!orderId || !['paid', 'no_payment_required'].includes(session.payment_status)) return;

  setImmediate(async () => {
    try {
      // Todas las cartas de la compra (combo de hermanitos) se marcan pagadas juntas.
      const paid = await db.markPaidGroup(orderId, {
        sessionId: session.id,
        paymentIntent: session.payment_intent,
        amountCents: session.amount_total,
      });
      const order = paid[0];
      // Vacío = ya estaban pagadas (webhook repetido) o no existen: no se hace nada más.
      // Excepción: si llega un pago de una orden que ya se canceló por no pagarse, se avisa.
      if (!order) {
        const prev = await db.getOrder(orderId);
        if (prev && prev.status === 'cancelled') {
          await email.alert('Llegó un pago de una orden ya cancelada (revisar en Stripe)', prev, `sesión ${session.id}`);
        }
        return;
      }
      // Conversión para Meta (solo datos del adulto; ver metaCapi.js). Sin await: nunca
      // debe atrasar ni romper el envío de la carta. Las órdenes gratis no cuentan como venta.
      if (session.amount_total > 0) {
        const md = session.metadata || {};
        metaCapi.sendEvent({
          eventName: 'Purchase',
          eventId: order.id, // el mismo id descarta duplicados si Stripe repite el webhook
          email: (session.customer_details && session.customer_details.email) || order.buyer_email,
          fbc: md.fbc,
          ip: md.ip,
          userAgent: md.ua,
          valueCents: session.amount_total,
          currency: session.currency,
          sourceUrl: `${frontendFor(order.lang)}/gracias.html`,
          label: order.order_number,
        });
      }
      await afterPaidGroup(paid);
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
// Páginas en inglés: los mensajes de error salen traducidos (i18n.js).
app.use(['/api/config', '/api/promo', '/api/checkout', '/api/order'], translateErrors);

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
setInterval(() => {
  const now = Date.now();
  for (const m of [hits, adminFails]) for (const [k, v] of m) if (!v.some((t) => now - t < 3600e3)) m.delete(k);
}, 3600e3).unref();

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', async (req, res) => {
  try {
    const s = await db.getSettings();
    // Cada web ve su propio precio: priceCents / extraPriceCents ya vienen en su idioma.
    const p = pricesFor(s, req.lang);
    res.json({ ...s, priceCents: p.first, extraPriceCents: p.extra, lang: req.lang, maxLetters: maxLetters(), currency: process.env.STRIPE_CURRENCY || 'usd', taxMode: process.env.TAX_MODE || 'included' });
  } catch (err) {
    console.error('Error leyendo la configuración:', err.message);
    res.status(500).json({ error: 'No se pudo leer la configuración.' });
  }
});

// Revisa un código de descuento antes de pagar (para mostrar el total nuevo en enviar.html).
app.post('/api/promo', rateLimit(30, 15 * 60 * 1000), async (req, res) => {
  try {
    const settings = await db.getSettings();
    const email = String((req.body && req.body.email) || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return res.status(400).json({ error: 'Escribe primero el correo del adulto.', code: 'promo_email' });
    }
    const prices = letterPrices(settings, req.body.letters, req.lang);
    const r = await checkPromo(stripe, req.body.code, email, prices);
    if (!r.ok) return res.status(400).json({ error: r.message, code: r.code });
    res.json({ code: r.code, priceCents: prices.reduce((a, b) => a + b, 0), finalCents: r.finalCents });
  } catch (err) {
    console.error('Error en /api/promo:', err.message);
    res.status(500).json({ error: 'No pudimos revisar el código.' });
  }
});

// Precio de lista de cada carta de una compra: la primera al precio normal y las demás
// (hermanitos) al precio de carta adicional. Nunca más caro que la primera.
function pricesFor(settings, lang) {
  const first = lang === 'en' ? settings.priceCentsEn : settings.priceCents;
  const extraRaw = lang === 'en' ? settings.extraPriceCentsEn : settings.extraPriceCents;
  return { first, extra: Math.min(extraRaw > 0 ? extraRaw : first, first) };
}
function letterPrices(settings, count, lang = 'es') {
  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), maxLetters());
  const { first, extra } = pricesFor(settings, lang);
  return Array.from({ length: n }, (_, i) => (i === 0 ? first : extra));
}

// Sesión de pago de Stripe para una orden ya creada. La usan el checkout y el enlace de
// los recordatorios (/r/pagar), que abre una sesión nueva para la misma orden.
// Recibe las órdenes de la compra (una por carta) y el precio de lista de cada una. La
// primera orden es la principal: su id va en la metadata y en la página de gracias.
function createStripeSession(orders, { prices, promo = null, metaMetadata = {}, expiresAt } = {}) {
  const order = orders[0];
  const many = orders.length > 1;
  const en = order.lang === 'en';
  const site = frontendFor(order.lang);
  return stripe.checkout.sessions.create({
    mode: 'payment',
    locale: en ? 'en' : 'es',
    payment_method_types: ['card'],
    // El código se aplica desde nuestro formulario (promo.js), no en la página de Stripe,
    // para poder limitar los usos por correo.
    ...(promo ? { discounts: [{ promotion_code: promo.promotionCodeId }] } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    customer_email: order.buyer_email,
    // Una línea por carta, cada una con su precio de lista; si hay código, Stripe aplica el
    // descuento encima del total.
    line_items: orders.map((o, i) => ({
      price_data: {
        currency: process.env.STRIPE_CURRENCY || 'usd',
        unit_amount: prices[i],
        product_data: {
          name: en
            ? (i === 0 ? "Santa's reply letter — printed and mailed" : 'Extra letter for a sibling — printed and mailed')
            : (i === 0 ? 'Carta de respuesta de Santa — impresa y enviada por correo' : 'Carta adicional para hermanito — impresa y enviada por correo'),
          description: en ? `For: ${o.ship_name} · Order ${o.order_number}` : `Para: ${o.ship_name} · Orden ${o.order_number}`,
        },
      },
      quantity: 1,
    })),
    metadata: {
      orderId: order.id, orderNumber: order.order_number,
      ...(many ? { letters: String(orders.length), orderNumbers: orders.map((o) => o.order_number).join(',') } : {}),
      ...metaMetadata,
    },
    payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.order_number, ...(many ? { letters: String(orders.length) } : {}) } },
    success_url: `${site}/gracias.html?order=${order.id}`,
    cancel_url: `${site}/enviar.html?cancelado=1`,
  });
}

// ---------------------------------------------------------------------------
// Enlaces de los correos de recordatorio (recordatorios.js). Van firmados y vencen.
// ---------------------------------------------------------------------------
// Retomar el pago: abre una sesión nueva de Stripe para la MISMA orden. Antes se
// revisa la sesión anterior: si ya se pagó (y el webhook no ha llegado) no se crea otra,
// y si sigue abierta se expira para que no se pueda pagar dos veces.
app.get('/r/pagar/:id', rateLimit(30, 15 * 60 * 1000), async (req, res) => {
  if (!printUrl.verify(req.path, req.query.exp, req.query.sig)) {
    return res.redirect(303, `${FRONTEND_URL}/carta.html`);
  }
  const id = req.params.id;
  try {
    // Toda la compra (combo de hermanitos): se paga junta, igual que la primera vez.
    const group = await db.getGroup(id);
    const order = group[0];
    const site = frontendFor(order && order.lang);
    if (!order || order.id !== id || order.purged_at || order.status === 'cancelled' || order.status === 'refunded') {
      return res.redirect(303, `${site}/carta.html`);
    }
    if (group.some((o) => o.status !== 'pending_payment')) return res.redirect(303, `${site}/gracias.html?order=${order.id}`);

    if (order.stripe_session_id) {
      const prev = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      if (prev.status === 'complete') return res.redirect(303, `${site}/gracias.html?order=${order.id}`);
      if (prev.status === 'open') await stripe.checkout.sessions.expire(prev.id);
    }

    // La sesión nueva vence antes del borrado automático (25 h), para que nadie pague
    // una orden que ya no existe. Stripe pide al menos 30 minutos.
    const purgeAt = Math.floor(new Date(order.created_at).getTime() / 1000) + 25 * 3600 - 10 * 60;
    const now = Math.floor(Date.now() / 1000);
    if (purgeAt - now < 31 * 60) return res.redirect(303, `${site}/carta.html`);
    const expiresAt = Math.min(purgeAt, now + 23 * 3600);

    // Los recordatorios nunca van a órdenes con código, así que el precio guardado es el de lista.
    const session = await createStripeSession(group, { prices: group.map((o) => o.amount_cents), expiresAt });
    await db.updateOrder(order.id, { stripe_session_id: session.id });
    console.log(`💌 Orden ${order.order_number}: volvió desde el recordatorio`);
    res.redirect(303, session.url);
  } catch (err) {
    console.error('Error retomando el pago:', err.message);
    res.status(500).type('html').send(simplePage('Algo salió mal', 'No pudimos abrir el pago. Intenta otra vez en unos minutos o responde al correo y te ayudamos.'));
  }
});

// Baja de los recordatorios. GET muestra un botón (los antivirus de correo abren los
// enlaces solos y no queremos dar de baja por error); POST la registra. El POST también
// sirve para la baja en un clic de Gmail y Apple Mail (cabecera List-Unsubscribe-Post).
app.get('/r/baja/:hash', (req, res) => {
  if (!printUrl.verify(req.path, req.query.exp, req.query.sig)) {
    return res.status(403).type('html').send(simplePage('Enlace vencido', 'Este enlace ya no es válido. Responde a cualquiera de nuestros correos y te quitamos de la lista.'));
  }
  const action = `${req.path}?exp=${encodeURIComponent(req.query.exp)}&sig=${encodeURIComponent(req.query.sig)}`;
  res.type('html').send(simplePage('¿Dejar de recibir recordatorios?',
    'Si pulsas el botón no te volveremos a escribir para recordarte un pedido sin terminar. Los correos de tus pedidos pagados (confirmación y envío) sí te seguirán llegando.',
    `<form method="post" action="${action}"><button type="submit">No quiero más recordatorios</button></form>`));
});
app.post('/r/baja/:hash', express.urlencoded({ extended: false }), async (req, res) => {
  if (!printUrl.verify(req.path, req.query.exp, req.query.sig)) return res.status(403).type('html').send(simplePage('Enlace vencido', 'Este enlace ya no es válido.'));
  try {
    await recordatorios.optOut(req.params.hash);
    // La baja es por correo (sirve para ambos idiomas): el mensaje va en los dos.
    res.type('html').send(simplePage('Listo · Done', 'No te enviaremos más recordatorios. ¡Feliz Navidad! 🎄 — We won\'t send you any more reminders. Merry Christmas!'));
  } catch (err) {
    console.error('Error registrando la baja:', err.message);
    res.status(500).type('html').send(simplePage('Algo salió mal', 'No pudimos registrar la baja. Responde a nuestro correo y te quitamos a mano.'));
  }
});

function simplePage(title, text, extra = '') {
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)} · CartaParaSanta.com</title>
<style>body{margin:0;font-family:Georgia,serif;background:#FBF6EE;color:#2B2622;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
main{max-width:460px;background:#fff;border-radius:16px;padding:28px;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}
h1{color:#A53328;font-size:26px;margin:0 0 12px}p{font-size:17px;line-height:1.55}
button{min-height:48px;padding:12px 24px;border:0;border-radius:999px;background:#A53328;color:#fff;font-size:17px;font-weight:bold;cursor:pointer}
a{color:#376A49}</style></head><body><main><h1>${e(title)}</h1><p>${e(text)}</p>${extra}
<p><a href="${e(FRONTEND_URL)}/">Volver a CartaParaSanta.com</a></p></main></body></html>`;
}

app.post('/api/checkout', rateLimit(20, 15 * 60 * 1000), async (req, res) => {
  try {
    const settings = await db.getSettings();
    if (!settings.mailboxOpen) {
      return res.status(400).json({ error: 'El buzón del Polo Norte cerró por este año. ¡Gracias por escribirle a Santa!', code: 'mailbox_closed' });
    }
    const lang = langOf(req.body && req.body.lang);
    if (!pricesFor(settings, lang).first || pricesFor(settings, lang).first < 50) {
      return res.status(500).json({ error: 'El precio no está configurado todavía.', code: 'config' });
    }

    let data;
    try {
      data = validateCheckout(req.body);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code || 'validation' });
    }
    const many = data.letters.length > 1;

    // Filtro de contenido, carta por carta. Si una se bloquea, no se crea ninguna.
    const contents = data.letters.map((l) => checkContent(l));
    const blocked = contents.findIndex((c) => c.action === 'block');
    if (blocked >= 0) {
      return res.status(400).json({ error: (many ? `Carta ${blocked + 1}: ` : '') + contents[blocked].reason, code: 'content_policy', letter: blocked });
    }

    // Precio de lista de cada carta: la primera normal y las demás al precio de hermanito.
    const prices = letterPrices(settings, data.letters.length, data.lang);

    // Código de descuento (opcional): se valida aquí, con el límite por correo (cada carta cuenta).
    let promo = null;
    if (req.body.promoCode) {
      promo = await checkPromo(stripe, req.body.promoCode, data.buyer.email, prices);
      if (!promo.ok) return res.status(400).json({ error: promo.message, code: promo.code, field: 'promo' });
    }
    const amounts = promo ? promo.parts : prices;

    // Dirección: se verifica con USPS (vía Lob) antes de cobrar. Es la misma para todas.
    const address = await checkAddress(data.shipTo);
    if (!address.ok) {
      return res.status(400).json({ error: address.message, code: address.code, field: 'shipTo' });
    }

    // Una orden por carta, cada una con su nombre en el sobre y su parte del precio.
    const orders = await db.createOrderGroup(data.letters.map((l, i) => ({
      ...l,
      lang: data.lang,
      buyerName: data.buyer.name,
      buyerEmail: data.buyer.email,
      consentIp: req.ip || null,
      ship: { ...data.shipTo, name: l.shipName },
      reviewReason: contents[i].action === 'review' ? contents[i].reason : null,
      amountCents: amounts[i],
    })));
    const order = orders[0];
    const totalCents = amounts.reduce((a, b) => a + b, 0);

    // Para Meta (metaCapi.js): el identificador del clic del anuncio, si lo hay, y el
    // navegador e IP del adulto. Viajan en la metadata de Stripe para usarlos cuando
    // llegue el webhook del pago. Nada de esto es del niño.
    const attribution = {
      fbc: metaCapi.cleanFbc(req.body.attribution && req.body.attribution.fbc),
      ua: (req.get('user-agent') || '').slice(0, 400),
      ip: req.ip || '',
    };
    const metaMetadata = metaCapi.enabled()
      ? Object.fromEntries(Object.entries(attribution).filter(([, v]) => v))
      : {};

    const session = await createStripeSession(orders, { prices, promo, metaMetadata });

    for (const o of orders) {
      await db.updateOrder(o.id, { stripe_session_id: session.id, promo_code: promo ? promo.code : null });
    }
    console.log(`🧾 Orden ${order.order_number} creada${many ? ` con ${orders.length} cartas` : ''}${orders.some((o) => o.review_reason) ? ' (irá a revisión)' : ''}`);
    if (totalCents > 0) {
      metaCapi.sendEvent({
        eventName: 'InitiateCheckout',
        eventId: `ic-${order.id}`,
        email: data.buyer.email,
        fbc: attribution.fbc,
        ip: attribution.ip,
        userAgent: attribution.ua,
        valueCents: totalCents,
        currency: process.env.STRIPE_CURRENCY || 'usd',
        sourceUrl: `${frontendFor(data.lang)}/enviar.html`,
        label: order.order_number,
      });
    }
    res.json({ checkoutUrl: session.url, orderId: order.id, orderNumber: order.order_number, orderNumbers: orders.map((o) => o.order_number) });
  } catch (err) {
    console.error('Error creando el checkout:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo en un momento.', code: 'server' });
  }
});

// Estado para la página de gracias. Sin datos personales.
app.get('/api/order/:id', async (req, res) => {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const group = await db.getGroup(req.params.id);
    const order = group.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });
    // needs_review / error / sent_to_lob se muestran al cliente como "en preparación".
    const toPublic = (st) => ({
      pending_payment: 'pending_payment', paid: 'preparing', needs_review: 'preparing', sent_to_lob: 'preparing',
      error: 'preparing', mailed: 'mailed', in_transit: 'mailed', delivered: 'delivered',
      cancelled: 'cancelled', refunded: 'refunded',
    }[st]);
    // Combo de hermanitos: el estado general es el de la carta más atrasada (nunca se dice
    // que "salió" si alguna todavía no sale). Las reembolsadas o canceladas no cuentan, salvo
    // que lo estén todas.
    const rank = { pending_payment: 0, preparing: 1, mailed: 2, delivered: 3 };
    const live = group.map((o) => toPublic(o.status)).filter((st) => st in rank);
    const status = live.length ? live.reduce((a, b) => (rank[b] < rank[a] ? b : a)) : toPublic(order.status);
    const dates = group.map((o) => o.lob_expected_delivery).filter(Boolean).sort();
    res.json({
      orderNumber: order.order_number,
      orderNumbers: group.map((o) => o.order_number),
      letters: group.length,
      status,
      expectedDelivery: dates.length ? dates[dates.length - 1] : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo consultar el pedido.' });
  }
});

// ---------------------------------------------------------------------------
// Administración (header x-admin-token). La usa admin.html del frontend.
// ---------------------------------------------------------------------------
// Intentos fallidos por IP: con 10 en 15 minutos se bloquea esa IP un rato (frena a quien
// intente adivinar el token). La comparación es de tiempo constante.
const adminFails = new Map();
function tokenMatches(given) {
  const real = process.env.ADMIN_TOKEN;
  if (!real || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  const now = Date.now();
  const fails = (adminFails.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (fails.length >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
  if (!tokenMatches(req.headers['x-admin-token'])) {
    fails.push(now);
    adminFails.set(req.ip, fails);
    return res.status(401).json({ error: 'No autorizado.' });
  }
  adminFails.delete(req.ip);
  res.set('Cache-Control', 'private, no-store');
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
  res.json(await db.listOrders({ status: req.query.status, q: req.query.q, lang: req.query.lang, limit: req.query.limit, offset: req.query.offset }));
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
  res.type('html').send(buildPrintHtml(sampleOrder(req.params.design, req.query.size === 'larga' ? 'larga' : 'corta'), { preview: true }));
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
    // En una compra con varias cartas se devuelve solo la parte de esta carta.
    const group = await db.getGroup(order.id);
    const partial = group.length > 1;
    if (partial && !(order.amount_cents > 0)) return res.status(409).json({ error: 'Esta carta no tiene monto que reembolsar.' });
    await stripe.refunds.create({ payment_intent: order.stripe_payment_intent, ...(partial ? { amount: order.amount_cents } : {}) });
    const updated = await db.updateOrder(order.id, { status: 'refunded' });
    await email.orderRefunded(updated);
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `Stripe: ${err.message}` });
  }
});

admin.get('/stats', async (req, res) => res.json(await db.stats({ lang: req.query.lang })));

// Revisión de la configuración de producción, para el panel. Solo dice si cada pieza está
// bien (y en qué modo), nunca devuelve claves ni direcciones completas.
admin.get('/check', async (_req, res) => {
  const items = [];
  const add = (group, label, status, detail = '') => items.push({ group, label, status, detail });
  const mode = (k, live, test) => (!k ? 'falta' : k.startsWith(live) ? 'live' : k.startsWith(test) ? 'test' : 'desconocido');

  // --- Lob ---
  const lobKey = process.env.LOB_API_KEY || '';
  const lobMode = mode(lobKey, 'live_', 'test_');
  add('Lob', 'Clave de Lob', lobMode === 'live' ? 'ok' : lobMode === 'test' ? 'warn' : 'error', `modo ${lobMode}`);
  const adr = process.env.LOB_FROM_ADDRESS_ID || '';
  if (!adr) add('Lob', 'Remitente', 'error', 'falta LOB_FROM_ADDRESS_ID');
  else if (lobKey) {
    try {
      const r = await fetch(`https://api.lob.com/v1/addresses/${encodeURIComponent(adr)}`, {
        headers: { Authorization: 'Basic ' + Buffer.from(lobKey + ':').toString('base64') },
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) add('Lob', 'Remitente', 'ok', `${j.name || ''}${j.company ? ' · ' + j.company : ''} · ${j.address_city || ''}, ${j.address_state || ''}`);
      else add('Lob', 'Remitente', 'error', `Lob no encuentra ${adr} con esta clave (¿se creó en el otro modo?)`);
    } catch (err) {
      add('Lob', 'Remitente', 'warn', 'no se pudo consultar Lob: ' + err.message);
    }
  }
  add('Lob', 'Secreto del webhook de Lob', process.env.LOB_WEBHOOK_SECRET ? 'ok' : 'warn',
    process.env.LOB_WEBHOOK_SECRET ? 'configurado' : 'falta: no llegarán los avisos de rastreo');

  // --- Stripe ---
  const sk = process.env.STRIPE_SECRET_KEY || '';
  const skMode = mode(sk, 'sk_live_', 'sk_test_') === 'desconocido' ? mode(sk, 'rk_live_', 'rk_test_') : mode(sk, 'sk_live_', 'sk_test_');
  add('Stripe', 'Clave de Stripe', skMode === 'live' ? 'ok' : skMode === 'test' ? 'warn' : 'error', `modo ${skMode}`);
  if (sk) {
    try {
      const acct = await stripe.accounts.retrieve();
      add('Stripe', 'Cuenta puede cobrar', acct.charges_enabled ? 'ok' : 'error',
        acct.charges_enabled ? (acct.settings && acct.settings.dashboard && acct.settings.dashboard.display_name) || 'sí' : 'Stripe todavía no permite cobros: completa la activación');
    } catch (err) {
      add('Stripe', 'Cuenta puede cobrar', 'error', err.message);
    }
    try {
      const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
      const mine = hooks.data.filter((h) => /\/api\/webhook\/stripe$/.test(h.url));
      const good = mine.find((h) => h.status === 'enabled' && (h.enabled_events.includes('checkout.session.completed') || h.enabled_events.includes('*')));
      add('Stripe', 'Webhook de Stripe', good ? 'ok' : 'error',
        good ? good.url : mine.length ? 'existe pero está apagado o sin checkout.session.completed' : 'no hay webhook a /api/webhook/stripe en este modo');
    } catch (err) {
      add('Stripe', 'Webhook de Stripe', 'warn', 'no se pudo consultar: ' + err.message);
    }
    try {
      const codes = await stripe.promotionCodes.list({ active: true, limit: 10 });
      add('Stripe', 'Códigos de descuento activos', codes.data.length ? 'ok' : 'warn',
        codes.data.length ? codes.data.map((c) => `${c.code} (${c.times_redeemed}/${c.max_redemptions || '∞'})`).join(', ') : 'ninguno en este modo');
    } catch (err) {
      add('Stripe', 'Códigos de descuento activos', 'warn', err.message);
    }
  }
  const wh = process.env.STRIPE_WEBHOOK_SECRET || '';
  add('Stripe', 'Secreto del webhook de Stripe', wh.startsWith('whsec_') ? 'ok' : 'error', wh ? 'configurado' : 'falta');

  // --- Meta (Conversions API) ---
  add('Meta', 'Conversiones de anuncios', metaCapi.enabled() ? 'ok' : 'warn',
    metaCapi.enabled() ? `conjunto de datos ${process.env.META_PIXEL_ID}` : 'falta META_PIXEL_ID o META_CAPI_TOKEN: Meta no verá las ventas');
  if (process.env.META_TEST_EVENT_CODE) add('Meta', 'Modo de prueba', 'warn', 'META_TEST_EVENT_CODE está puesto: bórralo cuando termines de probar');

  // --- Correo y URLs ---
  add('Correo', 'Resend', process.env.RESEND_API_KEY ? 'ok' : 'error', process.env.RESEND_API_KEY ? (process.env.EMAIL_FROM || 'remitente por defecto') : 'falta RESEND_API_KEY');
  add('Correo', 'Alertas internas', process.env.ALERT_EMAIL ? 'ok' : 'warn', process.env.ALERT_EMAIL ? 'configurado' : 'falta ALERT_EMAIL');
  add('Sitio', 'BACKEND_PUBLIC_URL', /^https:\/\//.test(process.env.BACKEND_PUBLIC_URL || '') ? 'ok' : 'error', process.env.BACKEND_PUBLIC_URL || 'falta');
  add('Sitio', 'FRONTEND_URL', /^https:\/\//.test(process.env.FRONTEND_URL || '') ? 'ok' : 'error', process.env.FRONTEND_URL || 'falta');
  const settings = await db.getSettings();
  add('Sitio', 'Buzón', settings.mailboxOpen ? 'ok' : 'warn', settings.mailboxOpen ? 'abierto' : 'cerrado');
  add('Sitio', 'Precio', settings.priceCents >= 50 ? 'ok' : 'error', settings.priceCents ? `${(settings.priceCents / 100).toFixed(2)} USD` : 'falta');
  add('Sitio', 'Precio en inglés', settings.priceCentsEn >= 50 ? 'ok' : 'warn', `${(settings.priceCentsEn / 100).toFixed(2)} USD · hermanito ${(settings.extraPriceCentsEn / 100).toFixed(2)} USD`);
  add('Sitio', 'FRONTEND_URL_EN', /^https:\/\//.test(process.env.FRONTEND_URL_EN || '') ? 'ok' : 'warn', process.env.FRONTEND_URL_EN || 'falta (las órdenes en inglés vuelven a la web en español)');
  add('Sitio', 'Carta adicional (hermanitos)', settings.extraPriceCents >= 50 && settings.extraPriceCents <= settings.priceCents ? 'ok' : 'warn',
    `${(settings.extraPriceCents / 100).toFixed(2)} USD · hasta ${maxLetters()} cartas por compra`);

  res.json({ items, allLive: lobMode === 'live' && skMode === 'live' && !items.some((i) => i.status === 'error') });
});
admin.get('/settings', async (_req, res) => res.json(await db.getSettings()));
admin.patch('/settings', async (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.priceCents !== undefined) {
    const n = Number(b.priceCents);
    if (!Number.isInteger(n) || n < 50) return res.status(400).json({ error: 'Precio inválido (en centavos, mínimo 50).' });
    patch.priceCents = n;
  }
  for (const k of ['priceCentsEn', 'extraPriceCentsEn']) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 50) return res.status(400).json({ error: `${k}: precio inválido (en centavos, mínimo 50).` });
    patch[k] = n;
  }
  if (b.extraPriceCents !== undefined) {
    const n = Number(b.extraPriceCents);
    if (!Number.isInteger(n) || n < 50) return res.status(400).json({ error: 'Precio de carta adicional inválido (en centavos, mínimo 50).' });
    patch.extraPriceCents = n;
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
  db.ensureSchema()
    .catch((err) => console.error('No se pudo ajustar el esquema:', err.message))
    .finally(() => {
      app.listen(PORT, () => {
        console.log(`🎅 CartaParaSanta backend en el puerto ${PORT}`);
        startJobs();
      });
    });
}

module.exports = app;
