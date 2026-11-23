// email.js
// Correos al adulto y alertas para ti. Usa la API de Resend con fetch (sin SDK).
// Si RESEND_API_KEY no está configurada, solo deja constancia en el log y sigue:
// un correo que falla nunca debe impedir que la carta se envíe.

const { esc } = require('./printTemplate');

const DESIGN_NAMES = {
  clasica: 'Correo aéreo clásico',
  taller: 'Taller de los duendes',
  estrellas: 'Noche de estrellas',
  polonorte: 'Cielo del Polo Norte',
  juguetes: 'Juguetes en acuarela',
  duendes: 'Duendes y renos',
  dulces: 'Dulces navideños',
  cascanueces: 'El cascanueces',
};

async function send({ to, subject, html, headers, lang }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`✉️  (sin RESEND_API_KEY) correo no enviado: "${subject}"`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: lang === 'en'
          ? (process.env.EMAIL_FROM_EN || "Santa's Workshop <hola@cartaparasanta.com>")
          : (process.env.EMAIL_FROM || 'Taller de Santa <hola@cartaparasanta.com>'),
        to: Array.isArray(to) ? to : [to],
        // Los correos salen de un subdominio que solo envía; las respuestas de los
        // padres van a una dirección que sí recibe (y se reenvía a tu Gmail).
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
        subject,
        html,
        ...(headers ? { headers } : {}),
      }),
    });
    if (!res.ok) console.error(`✉️  Resend respondió ${res.status} para "${subject}"`);
    return res.ok;
  } catch (err) {
    console.error(`✉️  No se pudo enviar "${subject}":`, err.message);
    return false;
  }
}

// footer: texto al pie. Las alertas internas usan uno propio (no son de un pedido del cliente).
function layout(title, bodyHtml, footer = 'Recibes este correo porque hiciste un pedido en CartaParaSanta.com. Para pedir que borremos los datos de tu pedido, responde a este correo.', brand = ['CartaParaSanta', '.com'], lang = 'es') {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#FBF7EF;font-family:Arial,Helvetica,sans-serif;color:#1F2A24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EADFC8;border-radius:16px">
<tr><td style="background:#0F3324;color:#FBF7EF;padding:20px 28px;border-radius:16px 16px 0 0;font-family:Georgia,serif;font-size:20px;font-weight:bold">${brand[0]}<span style="color:#E2C27A">${brand[1]}</span></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:24px;color:#0F3324">${title}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#5A645F;border-top:1px solid #EADFC8">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const money = (cents) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);
const dateEs = (d) => {
  if (!d) return null;
  const dt = new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00Z' : d);
  return dt.toLocaleDateString('es-PR', { day: 'numeric', month: 'long', timeZone: 'America/Puerto_Rico' });
};

// Confirmación del pago. Recibe una orden o las órdenes de una compra (combo de hermanitos):
// siempre se manda UN solo correo con todas las cartas.
function orderConfirmation(orderOrList) {
  const orders = Array.isArray(orderOrList) ? orderOrList : [orderOrList];
  if (orders[0] && orders[0].lang === 'en') return en.orderConfirmation(orders);
  const order = orders[0];
  const many = orders.length > 1;
  const total = orders.reduce((sum, o) => sum + (o.amount_cents || 0), 0);
  const childData = [orders.some((o) => o.child_name) && 'nombre', orders.some((o) => o.child_age) && 'edad', 'el texto de la carta y la lista de regalos']
    .filter(Boolean).join(', ');
  const numbers = orders.map((o) => o.order_number).join(', ');
  const address = `${esc(order.ship_line1)}${order.ship_line2 ? '<br>' + esc(order.ship_line2) : ''}<br>${esc(order.ship_city)}, ${esc(order.ship_state)} ${esc(order.ship_zip)}`;
  const rows = many
    ? `<tr><td style="color:#5A645F;vertical-align:top">Cartas</td><td>${orders.map((o, i) =>
        `<strong>${i + 1}. ${esc(o.ship_name)}</strong> · ${esc(DESIGN_NAMES[o.design] || o.design)}<br><span style="color:#5A645F;font-size:13px">Orden ${esc(o.order_number)}</span>`).join('<br>')}</td></tr>
<tr><td style="color:#5A645F;vertical-align:top">Dirección</td><td>${address}</td></tr>`
    : `<tr><td style="color:#5A645F">Orden</td><td><strong>${esc(order.order_number)}</strong></td></tr>
<tr><td style="color:#5A645F">Diseño</td><td>${esc(DESIGN_NAMES[order.design] || order.design)}</td></tr>
<tr><td style="color:#5A645F">Para</td><td>${esc(order.ship_name)}<br>${address}</td></tr>`;
  return send({
    to: order.buyer_email,
    subject: many ? `¡Tus ${orders.length} cartas llegaron al Polo Norte! (${numbers})` : `¡Tu carta llegó al Polo Norte! (${order.order_number})`,
    html: layout(many ? `¡Ho, ho, ho! Tus ${orders.length} cartas llegaron al Polo Norte` : '¡Ho, ho, ho! Tu carta llegó al Polo Norte', `
<p style="font-size:16px;line-height:1.6">Hola, ${esc(order.buyer_name)}: recibimos tu pedido y el pago. Los duendes ya están preparando ${many ? 'las respuestas' : 'la respuesta'} de Santa.</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:12px 0">
${rows}
<tr><td style="color:#5A645F">Total</td><td>${total ? money(total) : 'Gratis (código de descuento)'}</td></tr>
</table>
<p style="font-size:15px;line-height:1.6">${many
  ? 'Cada nene recibe su propio sobre blanco con ventana, con la respuesta de Santa y la copia de su carta. Los sobres pueden llegar en días distintos. Te escribiremos cuando salga cada uno.'
  : 'Te escribiremos otra vez cuando la carta salga del Polo Norte. Llega por correo postal en un sobre blanco con ventana, con la respuesta de Santa y una copia de la carta original.'}</p>
<p style="font-size:13px;line-height:1.6;color:#5A645F">Para hacer ${many ? 'las cartas' : 'la carta'} guardamos ${esc(childData)}. Lo usamos solo para imprimir${many ? 'las' : 'la'} y lo borramos después de la entrega, según nuestra política de privacidad.</p>`),
  });
}

function orderMailed(order) {
  if (order.lang === 'en') return en.orderMailed(order);
  const when = dateEs(order.lob_expected_delivery);
  return send({
    to: order.buyer_email,
    subject: 'La respuesta de Santa ya va en camino',
    html: layout('¡La carta salió del Polo Norte!', `
<p style="font-size:16px;line-height:1.6">La respuesta de Santa para ${esc(order.ship_name)} (orden ${esc(order.order_number)}) ya está en el correo postal.${when ? ` Debería llegar alrededor del <strong>${esc(when)}</strong>.` : ''}</p>
<p style="font-size:15px;line-height:1.6">Busca un sobre blanco con ventana: adentro está la magia.</p>`),
  });
}

function orderRefunded(order) {
  if (order.lang === 'en') return en.orderRefunded(order);
  return send({
    to: order.buyer_email,
    subject: `Tu pedido ${order.order_number} fue cancelado`,
    html: layout('Pedido cancelado', `
<p style="font-size:16px;line-height:1.6">Cancelamos la orden ${esc(order.order_number)} y devolvimos ${money(order.amount_cents)} a tu tarjeta. El reembolso puede tardar de 5 a 10 días en aparecer.</p>`),
  });
}

// Alerta interna: sin datos personales del niño, solo lo necesario para encontrar la orden.
// Recordatorio de compra sin terminar (recordatorios.js). n = 1 (a la hora) o 2 (a las 20 h).
function abandonedReminder(order, n, opts) {
  if (order.lang === 'en') return en.abandonedReminder(order, n, opts);
  const { resumeUrl, optOutUrl, priceCents, deadline, letters = 1 } = opts;
  const first = order.child_name ? esc(order.child_name) : 'tu niño o niña';
  // Combo de hermanitos: "la carta de Sofía y 1 más".
  const who = letters > 1 ? `${first}</strong> y <strong>${letters - 1} ${letters === 2 ? 'nene' : 'nenes'} más` : first;
  const carta = letters > 1 ? 'Las cartas' : 'La carta';
  const hola = order.buyer_name ? esc(String(order.buyer_name).split(' ')[0]) : '';
  const when = dateEs(deadline);
  const subject = n === 1 ? 'Tu carta a Santa está casi lista 🎅' : 'Última llamada del Polo Norte: tu carta se borra pronto';
  const title = n === 1 ? 'Tu carta está casi lista' : 'Tu carta se borra en unas horas';
  const intro = n === 1
    ? `Los duendes encontraron ${carta.toLowerCase()} de <strong>${who}</strong> en el buzón, pero ${letters > 1 ? 'les' : 'le'} falta el último paso para salir hacia el Polo Norte.`
    : `${carta} de <strong>${who}</strong> ${letters > 1 ? 'siguen' : 'sigue'} esperando en el buzón, pero por privacidad ${letters > 1 ? 'las' : 'la'} guardamos solo 24 horas y se ${letters > 1 ? 'borran' : 'borra'} en unas horas. Si todavía quieres que Santa ${letters > 1 ? 'las' : 'la'} reciba, aún estás a tiempo.`;
  const btn = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="background:#A53328;border-radius:999px">
<a href="${esc(resumeUrl)}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-weight:bold;font-size:16px;text-decoration:none">Terminar mi envío al Polo Norte</a></td></tr></table>`;
  return send({
    to: order.buyer_email,
    subject,
    headers: { 'List-Unsubscribe': `<${optOutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: layout(title, `
<p style="font-size:16px;line-height:1.6">¡Hola${hola ? ', ' + hola : ''}! ${intro}</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:8px 0">
${letters > 1 ? `<tr><td style="color:#5A645F">Cartas</td><td>${letters}</td></tr>` : `<tr><td style="color:#5A645F">Diseño</td><td>${esc(DESIGN_NAMES[order.design] || order.design)}</td></tr>`}
<tr><td style="color:#5A645F">Total</td><td><strong>${money(priceCents)}</strong> (envío e IVU incluidos)</td></tr>
</table>
${btn}
<p style="font-size:15px;line-height:1.6">${when ? `Para que llegue antes de Navidad, termina tu pedido antes del <strong>${esc(when)}</strong>. ` : ''}Tus datos ya están guardados: no tienes que escribir nada otra vez.</p>
<p style="font-size:15px;line-height:1.6">¿Tuviste algún problema con el pago? Responde a este correo y te ayudamos.</p>`,
      `Te escribimos porque empezaste un pedido en CartaParaSanta.com y no se completó el pago. Si no lo terminas, la carta y tus datos se borran solos a las 24 horas. <a href="${esc(optOutUrl)}" style="color:#5A645F">No quiero más recordatorios</a>.<br>CartaParaSanta.com · Urb. Victor Rojas 1, 500 Calle Adjuntas, Arecibo, PR 00612`),
  });
}

function alert(subject, order, detail = '') {
  const to = process.env.ALERT_EMAIL;
  if (!to) {
    console.warn(`🚨 ${subject} — ${order ? order.order_number : ''} ${detail}`);
    return Promise.resolve(false);
  }
  return send({
    to,
    subject: `[CartaParaSanta] ${subject}${order ? ' · ' + order.order_number : ''}`,
    html: layout(esc(subject), `<p style="font-size:15px">Orden: <strong>${order ? esc(order.order_number) : '—'}</strong> (${order ? esc(order.status) : ''})</p><p style="font-size:14px;color:#5A645F">${esc(detail)}</p><p style="font-size:14px">Revísala en el <a href="${(process.env.FRONTEND_URL || 'https://www.cartaparasanta.com')}/admin.html" style="color:#B3261E">panel administrativo</a>.</p>`, 'Alerta interna del sistema de CartaParaSanta.com.'),
  });
}

// ---------------------------------------------------------------------------
// Inglés (ReplyFromSanta). Mismos correos, mismo diseño, otro idioma y otra marca.
// ---------------------------------------------------------------------------
const BRAND_EN = (process.env.BRAND_EN || 'ReplyFromSanta.com').replace(/\.com$/i, '');
const DESIGN_NAMES_EN = {
  clasica: 'Classic airmail', taller: "Elves' workshop", estrellas: 'Starry night', polonorte: 'North Pole sky',
  juguetes: 'Watercolor toys', duendes: 'Elves and reindeer', dulces: 'Christmas sweets', cascanueces: 'The nutcracker',
};
const dateEn = (d) => {
  if (!d) return '';
  const x = new Date(String(d).slice(0, 10) + 'T12:00:00Z');
  return Number.isNaN(x.getTime()) ? '' : x.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
};
const layoutEn = (title, body, footer) => layout(title, body,
  footer || `You are receiving this email because you placed an order at ${BRAND_EN}.com. To ask us to delete your order data, just reply to this email.`,
  [BRAND_EN, '.com'], 'en');

const en = {
  orderConfirmation(orders) {
    const order = orders[0];
    const many = orders.length > 1;
    const total = orders.reduce((sum, o) => sum + (o.amount_cents || 0), 0);
    const numbers = orders.map((o) => o.order_number).join(', ');
    const address = `${esc(order.ship_line1)}${order.ship_line2 ? '<br>' + esc(order.ship_line2) : ''}<br>${esc(order.ship_city)}, ${esc(order.ship_state)} ${esc(order.ship_zip)}`;
    const rows = many
      ? `<tr><td style="color:#5A645F;vertical-align:top">Letters</td><td>${orders.map((o, i) =>
          `<strong>${i + 1}. ${esc(o.ship_name)}</strong> · ${esc(DESIGN_NAMES_EN[o.design] || o.design)}<br><span style="color:#5A645F;font-size:13px">Order ${esc(o.order_number)}</span>`).join('<br>')}</td></tr>
<tr><td style="color:#5A645F;vertical-align:top">Address</td><td>${address}</td></tr>`
      : `<tr><td style="color:#5A645F">Order</td><td><strong>${esc(order.order_number)}</strong></td></tr>
<tr><td style="color:#5A645F">Design</td><td>${esc(DESIGN_NAMES_EN[order.design] || order.design)}</td></tr>
<tr><td style="color:#5A645F">For</td><td>${esc(order.ship_name)}<br>${address}</td></tr>`;
    return send({
      lang: 'en',
      to: order.buyer_email,
      subject: many ? `Your ${orders.length} letters reached the North Pole! (${numbers})` : `Your letter reached the North Pole! (${order.order_number})`,
      html: layoutEn(many ? `Ho ho ho! Your ${orders.length} letters reached the North Pole` : 'Ho ho ho! Your letter reached the North Pole', `
<p style="font-size:16px;line-height:1.6">Hi ${esc(order.buyer_name)}, we received your order and payment. The elves are already preparing Santa's ${many ? 'replies' : 'reply'}.</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:12px 0">
${rows}
<tr><td style="color:#5A645F">Total</td><td>${total ? money(total) : 'Free (discount code)'}</td></tr>
</table>
<p style="font-size:15px;line-height:1.6">${many
  ? 'Each child gets their own white window envelope with Santa\'s reply and a copy of their letter. The envelopes may arrive on different days. We will email you as each one goes out.'
  : 'We will email you again when the letter leaves the North Pole. It arrives by mail in a white window envelope, with Santa\'s reply and a copy of the original letter.'}</p>
<p style="font-size:13px;line-height:1.6;color:#5A645F">To make the ${many ? 'letters' : 'letter'} we keep the child's name, age, letter text and wish list. We use them only to print and delete them after delivery, as described in our privacy policy.</p>`),
    });
  },
  orderMailed(order) {
    const when = dateEn(order.lob_expected_delivery);
    return send({
      lang: 'en',
      to: order.buyer_email,
      subject: "Santa's reply is on its way",
      html: layoutEn('The letter has left the North Pole!', `
<p style="font-size:16px;line-height:1.6">Santa's reply for ${esc(order.ship_name)} (order ${esc(order.order_number)}) is now in the mail.${when ? ` It should arrive around <strong>${esc(when)}</strong>.` : ''}</p>
<p style="font-size:15px;line-height:1.6">Look for a white window envelope: the magic is inside.</p>`),
    });
  },
  orderRefunded(order) {
    return send({
      lang: 'en',
      to: order.buyer_email,
      subject: `Your order ${order.order_number} was canceled`,
      html: layoutEn('Order canceled', `
<p style="font-size:16px;line-height:1.6">We canceled order ${esc(order.order_number)} and refunded ${money(order.amount_cents)} to your card. The refund can take 5 to 10 days to show up.</p>`),
    });
  },
  abandonedReminder(order, n, { resumeUrl, optOutUrl, priceCents, deadline, letters = 1 }) {
    const first = order.child_name ? esc(order.child_name) : 'your child';
    const who = letters > 1 ? `${first}</strong> and <strong>${letters - 1} more` : first;
    const hi = order.buyer_name ? esc(String(order.buyer_name).split(' ')[0]) : '';
    const when = dateEn(deadline);
    const plural = letters > 1;
    const subject = n === 1 ? 'Your letter to Santa is almost ready 🎅' : 'Last call from the North Pole: your letter will be deleted soon';
    const title = n === 1 ? 'Your letter is almost ready' : 'Your letter will be deleted in a few hours';
    const intro = n === 1
      ? `The elves found the ${plural ? 'letters' : 'letter'} from <strong>${who}</strong> in the mailbox, but ${plural ? 'they still need' : 'it still needs'} one last step to fly to the North Pole.`
      : `The ${plural ? 'letters' : 'letter'} from <strong>${who}</strong> ${plural ? 'are' : 'is'} still waiting in the mailbox, but for privacy we only keep ${plural ? 'them' : 'it'} for 24 hours. If you still want Santa to get ${plural ? 'them' : 'it'}, there is still time.`;
    const btn = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="background:#A53328;border-radius:999px">
<a href="${esc(resumeUrl)}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-weight:bold;font-size:16px;text-decoration:none">Finish sending to the North Pole</a></td></tr></table>`;
    return send({
      lang: 'en',
      to: order.buyer_email,
      subject,
      headers: { 'List-Unsubscribe': `<${optOutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      html: layoutEn(title, `
<p style="font-size:16px;line-height:1.6">Hi${hi ? ' ' + hi : ''}! ${intro}</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:8px 0">
${plural ? `<tr><td style="color:#5A645F">Letters</td><td>${letters}</td></tr>` : `<tr><td style="color:#5A645F">Design</td><td>${esc(DESIGN_NAMES_EN[order.design] || order.design)}</td></tr>`}
<tr><td style="color:#5A645F">Total</td><td><strong>${money(priceCents)}</strong> (shipping included)</td></tr>
</table>
${btn}
<p style="font-size:15px;line-height:1.6">${when ? `To get it before Christmas, finish your order by <strong>${esc(when)}</strong>. ` : ''}Your details are saved: you don't have to type anything again.</p>
<p style="font-size:15px;line-height:1.6">Had trouble with the payment? Reply to this email and we'll help.</p>`,
        `We're writing because you started an order at ${BRAND_EN}.com and the payment wasn't completed. If you don't finish it, the letter and your details are deleted automatically after 24 hours. <a href="${esc(optOutUrl)}" style="color:#5A645F">No more reminders</a>.<br>${BRAND_EN}.com · Urb. Victor Rojas 1, 500 Calle Adjuntas, Arecibo, PR 00612`),
    });
  },
};

module.exports = { orderConfirmation, orderMailed, orderRefunded, abandonedReminder, alert, DESIGN_NAMES, DESIGN_NAMES_EN };
