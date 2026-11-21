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

async function send({ to, subject, html, headers }) {
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
        from: process.env.EMAIL_FROM || 'Taller de Santa <hola@cartaparasanta.com>',
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
function layout(title, bodyHtml, footer = 'Recibes este correo porque hiciste un pedido en CartaParaSanta.com. Para pedir que borremos los datos de tu pedido, responde a este correo.') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#FBF7EF;font-family:Arial,Helvetica,sans-serif;color:#1F2A24">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #EADFC8;border-radius:16px">
<tr><td style="background:#0F3324;color:#FBF7EF;padding:20px 28px;border-radius:16px 16px 0 0;font-family:Georgia,serif;font-size:20px;font-weight:bold">CartaParaSanta<span style="color:#E2C27A">.com</span></td></tr>
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

function orderConfirmation(order) {
  const childData = [order.child_name && 'nombre', order.child_age && 'edad', 'el texto de la carta y la lista de regalos']
    .filter(Boolean).join(', ');
  return send({
    to: order.buyer_email,
    subject: `¡Tu carta llegó al Polo Norte! (${order.order_number})`,
    html: layout('¡Ho, ho, ho! Tu carta llegó al Polo Norte', `
<p style="font-size:16px;line-height:1.6">Hola, ${esc(order.buyer_name)}: recibimos tu pedido y el pago. Los duendes ya están preparando la respuesta de Santa.</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:12px 0">
<tr><td style="color:#5A645F">Orden</td><td><strong>${esc(order.order_number)}</strong></td></tr>
<tr><td style="color:#5A645F">Diseño</td><td>${esc(DESIGN_NAMES[order.design] || order.design)}</td></tr>
<tr><td style="color:#5A645F">Para</td><td>${esc(order.ship_name)}<br>${esc(order.ship_line1)}${order.ship_line2 ? '<br>' + esc(order.ship_line2) : ''}<br>${esc(order.ship_city)}, ${esc(order.ship_state)} ${esc(order.ship_zip)}</td></tr>
<tr><td style="color:#5A645F">Total</td><td>${order.amount_cents ? money(order.amount_cents) : 'Gratis (código de descuento)'}</td></tr>
</table>
<p style="font-size:15px;line-height:1.6">Te escribiremos otra vez cuando la carta salga del Polo Norte. Llega por correo postal en un sobre blanco con ventana, con la respuesta de Santa y una copia de la carta original.</p>
<p style="font-size:13px;line-height:1.6;color:#5A645F">Para hacer la carta guardamos ${esc(childData)}. Lo usamos solo para imprimirla y lo borramos después de la entrega, según nuestra política de privacidad.</p>`),
  });
}

function orderMailed(order) {
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
  return send({
    to: order.buyer_email,
    subject: `Tu pedido ${order.order_number} fue cancelado`,
    html: layout('Pedido cancelado', `
<p style="font-size:16px;line-height:1.6">Cancelamos la orden ${esc(order.order_number)} y devolvimos ${money(order.amount_cents)} a tu tarjeta. El reembolso puede tardar de 5 a 10 días en aparecer.</p>`),
  });
}

// Alerta interna: sin datos personales del niño, solo lo necesario para encontrar la orden.
// Recordatorio de compra sin terminar (recordatorios.js). n = 1 (a la hora) o 2 (a las 20 h).
function abandonedReminder(order, n, { resumeUrl, optOutUrl, priceCents, deadline }) {
  const who = order.child_name ? esc(order.child_name) : 'tu niño o niña';
  const hola = order.buyer_name ? esc(String(order.buyer_name).split(' ')[0]) : '';
  const when = dateEs(deadline);
  const subject = n === 1 ? 'Tu carta a Santa está casi lista 🎅' : 'Última llamada del Polo Norte: tu carta se borra pronto';
  const title = n === 1 ? 'Tu carta está casi lista' : 'Tu carta se borra en unas horas';
  const intro = n === 1
    ? `Los duendes encontraron la carta de <strong>${who}</strong> en el buzón, pero le falta el último paso para salir hacia el Polo Norte.`
    : `La carta de <strong>${who}</strong> sigue esperando en el buzón, pero por privacidad la guardamos solo 24 horas y se borra en unas horas. Si todavía quieres que Santa la reciba, aún estás a tiempo.`;
  const btn = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr><td style="background:#A53328;border-radius:999px">
<a href="${esc(resumeUrl)}" style="display:inline-block;padding:14px 26px;color:#FFFFFF;font-weight:bold;font-size:16px;text-decoration:none">Terminar mi envío al Polo Norte</a></td></tr></table>`;
  return send({
    to: order.buyer_email,
    subject,
    headers: { 'List-Unsubscribe': `<${optOutUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    html: layout(title, `
<p style="font-size:16px;line-height:1.6">¡Hola${hola ? ', ' + hola : ''}! ${intro}</p>
<table role="presentation" cellpadding="6" style="font-size:15px;margin:8px 0">
<tr><td style="color:#5A645F">Diseño</td><td>${esc(DESIGN_NAMES[order.design] || order.design)}</td></tr>
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

module.exports = { orderConfirmation, orderMailed, orderRefunded, abandonedReminder, alert, DESIGN_NAMES };
