// printTemplate.js
// HTML de impresión para Lob: 2 páginas tamaño carta (8.5" × 11").
//   Página 1: respuesta de Santa sobre el fondo papeles/fondos/santa.jpg
//   Página 2: copia de la carta del niño sobre el fondo del diseño que escogió
//
// Por qué está hecho así (lecciones de las primeras pruebas con Lob):
//  - El motor de Lob es un WebKit antiguo: no entiende flexbox, transform sin prefijo,
//    border-image con degradados ni fuentes woff2. Por eso los fondos son IMÁGENES a
//    300 ppp (2550×3300 px) y el texto va encima con posicionamiento absoluto en pulgadas.
//  - Las fuentes van en TTF (fonts/*.ttf), servidas por este backend.
//  - La caja de texto de cada diseño está en papeles/layout.json. Si diseñas un fondo nuevo,
//    reemplaza la imagen en papeles/fondos/ y ajusta su caja en layout.json
//    (ver docs/plantilla-fondos/).
//  - address_placement = top_first_page: Lob imprime remitente y destinatario arriba a la
//    izquierda de la página 1 (layout.santa.addressZone). Ahí no va nada.
//  - Sin JavaScript: el ajuste de letra para cartas largas se calcula aquí.

const path = require('path');
const layout = require('./papeles/layout.json');
const { buildSantaReply } = require('./santaReply');

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Recursos: desde el backend público (lo que usa Lob) o desde el disco (vistas previas locales).
function assetBase() {
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
  return base
    ? { fonts: `${base}/fonts`, fondos: `${base}/fondos` }
    : { fonts: `file://${path.join(__dirname, 'fonts')}`, fondos: `file://${path.join(__dirname, 'papeles', 'fondos')}` };
}

const FONTS = [
  ['Fraunces', 500, 'normal', 'fraunces-500'],
  ['Fraunces', 700, 'normal', 'fraunces-700'],
  ['Fraunces', 700, 'italic', 'fraunces-700italic'],
  ['Nunito', 400, 'normal', 'nunito-400'],
  ['Nunito', 800, 'normal', 'nunito-800'],
  ['Patrick Hand', 400, 'normal', 'patrickhand-400'],
  ['Pinyon Script', 400, 'normal', 'pinyonscript-400'],
];

const r3 = (n) => Math.round(n * 1000) / 1000;
const box = (b) => `left:${b.x}in;top:${b.y}in;width:${b.w}in;height:${b.h}in;`;

// ---------------------------------------------------------------------------
// Página 1 — respuesta de Santa
// ---------------------------------------------------------------------------
function santaPage(order, { preview = false, now } = {}, a) {
  const r = buildSantaReply(order, now);
  const L = layout.santa;
  const z = L.addressZone;
  return `
<div class="page">
  <img class="bg" src="${a.fondos}/${L.image}" alt="">
  ${preview ? `<div class="zone" style="${box(z)}">Lob imprime aquí remitente y destinatario</div>` : ''}
  <p class="santa-date" style="left:${L.date.x}in;top:${L.date.y}in;width:${L.date.w}in;color:${L.date.color}">${esc(r.date)}</p>
  <div class="abs santa-body" style="${box(L.textBox)}">
    <p class="santa-greeting">${esc(r.greeting)}</p>
    ${r.paragraphs.map((p) => `<p class="santa-p">${esc(p)}</p>`).join('\n    ')}
    <p class="santa-p santa-farewell">${esc(r.farewell)}</p>
    <p class="santa-sign">${esc(r.signature)}</p>
    <p class="santa-ps">${esc(r.ps)}</p>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Página 2 — copia de la carta del niño
// ---------------------------------------------------------------------------
function introLine(order) {
  const name = (order.child_name || '').trim();
  if (name && order.child_age) return `Me llamo ${name} y tengo ${order.child_age} años.`;
  if (name) return `Me llamo ${name}.`;
  if (order.child_age) return `Tengo ${order.child_age} años.`;
  return '';
}

// Renglones que ocupa un texto con Patrick Hand (≈0.44 em de ancho medio por carácter).
function lines(text, widthIn, fontPt) {
  const perLine = Math.max(8, Math.floor((widthIn * 72) / (fontPt * 0.44)));
  return String(text || '')
    .split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

/**
 * Tamaño de letra (pt) y alto de renglón (pulgadas) para que la carta quepa en la caja.
 * Base: 23.5 pt con renglones de 0.5" (lo mismo que se ve en el prototipo).
 */
function fitText(order, d) {
  const { w, h } = d.textBox;
  const gifts = Array.isArray(order.gifts) ? order.gifts : [];
  const intro = introLine(order);
  const units = (pt) => {
    let u = 2; // saludo = 2 renglones
    if (intro) u += lines(intro, w, pt);
    if (order.message) u += lines(order.message, w, pt);
    if (gifts.length) u += 1 + gifts.reduce((n, g) => n + lines(g, w - 0.35, pt), 0);
    if (order.farewell) u += 1;
    return u + 1; // firma
  };
  let pt = 23.5;
  let lh = 0.5;
  // Mínimo 10 pt: solo pasa con cartas al máximo de todo.
  while (pt > 10 && units(pt) * lh > h) {
    pt -= 0.5;
    lh = r3(pt * (0.5 / 23.5));
  }
  return { pt, lh };
}

// El motor de Lob (WebKit viejo) acomoda los renglones en píxeles CSS ENTEROS (96 por pulgada).
// Si el alto de renglón es fraccionario (p. ej. 0.3" = 28.8 px), cada renglón de texto se
// redondea y se va corriendo contra las líneas dibujadas. Por eso todo va en px enteros.
const PX = 96;

function childPage(order, a) {
  const d = layout.designs[order.design] || layout.designs.clasica;
  const fit = fitText(order, d);
  const pt = fit.pt;
  const lhPx = Math.round(fit.lh * PX);
  const gifts = Array.isArray(order.gifts) ? order.gifts : [];
  const intro = introLine(order);
  const tb = d.textBox;
  const top = Math.round(tb.y * PX);
  const left = Math.round(tb.x * PX);
  const width = Math.round(tb.w * PX);
  const height = Math.round(tb.h * PX);

  // Renglones del papel: divs de 1 px en la base de cada renglón de texto.
  const ruled = [];
  const n = Math.floor(height / lhPx);
  for (let i = 1; i <= n; i++) {
    ruled.push(`<div class="rule" style="left:${left}px;top:${top + i * lhPx - 1}px;width:${width}px;background:${d.line}"></div>`);
  }

  const greetStyle = [
    `font-family:'${d.greetFont}'`,
    `font-size:${r3(pt * (d.greetFont === 'Pinyon Script' ? 1.45 : 1.3))}pt`,
    `line-height:${lhPx * 2}px`,
    `color:${d.greetColor}`,
    d.greetItalic ? 'font-style:italic' : '',
    d.greetBold ? 'font-weight:700' : '',
    d.greetCenter ? 'text-align:center' : '',
  ].filter(Boolean).join(';');

  const p = (txt, extra = '') => `<p style="margin:0;line-height:${lhPx}px;${extra}">${txt}</p>`;
  const body = [
    `<p style="margin:0;${greetStyle}">${esc(order.greeting || 'Querido Santa:')}</p>`,
    intro ? p(esc(intro)) : '',
    order.message ? p(esc(order.message), 'white-space:pre-wrap') : '',
    gifts.length ? p('Esta es mi lista de regalos:') : '',
    ...gifts.map((g, i) => p(`${i + 1}.&nbsp;${esc(g)}`, 'padding-left:0.35in;text-indent:-0.22in')),
    order.farewell ? p(esc(order.farewell)) : '',
    p(esc(order.signature || order.child_name || ''), `color:${d.signColor};font-size:${r3(pt * 1.2)}pt`),
  ].join('');

  return `
<div class="page">
  <img class="bg" src="${a.fondos}/${d.image}" alt="">
  ${ruled.join('')}
  <div class="abs child-text" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${pt}pt;color:${d.ink}">${body}</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------
function css(a) {
  const faces = FONTS.map(([family, weight, style, file]) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};src:url('${a.fonts}/${file}.ttf') format('truetype');}`
  ).join('\n');
  return `${faces}
  @page { size: 8.5in 11in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  * { -webkit-print-color-adjust: exact; }
  .page { position: relative; width: 8.5in; height: 11in; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .bg { position: absolute; left: 0; top: 0; width: 8.5in; height: 11in; }
  .abs { position: absolute; overflow: hidden; }
  .rule { position: absolute; height: 1px; }
  .zone { position: absolute; border: 2px dashed #8E9A93; font-family: Arial, sans-serif; font-size: 9pt; color: #5A645F; text-align: center; padding-top: 1in; box-sizing: border-box; }
  .santa-date { position: absolute; margin: 0; text-align: center; font-family: 'Patrick Hand'; font-size: 13pt; }
  .santa-body { font-family: 'Fraunces'; font-weight: 500; font-size: 12.5pt; line-height: 1.5; color: #2A241C; }
  .santa-body p { margin: 0 0 0.12in 0; }
  .santa-greeting { font-family: 'Patrick Hand'; font-size: 22pt; line-height: 1.2; color: #B3261E; }
  .santa-farewell { margin-top: 0.06in !important; }
  .santa-sign { font-family: 'Pinyon Script'; font-size: 40pt; line-height: 1.15; color: #B3261E; }
  .santa-ps { padding-top: 0.1in; border-top: 1px solid #E8D9B0; font-family: 'Patrick Hand'; font-size: 13pt; line-height: 1.35; color: #4B3D22; }
  .child-text { font-family: 'Patrick Hand'; }
`;
}

/**
 * @param {Object} order - fila de orders
 * @param {Object} [opts] - { preview: true } marca la zona de dirección de Lob
 * @returns {string} HTML que Lob descarga (por URL firmada) para imprimir
 */
function buildPrintHtml(order, opts = {}) {
  const a = assetBase();
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>CartaParaSanta ${esc(order.order_number || '')}</title>
<style>${css(a)}</style>
</head>
<body>
${santaPage(order, opts, a)}
${childPage(order, a)}
</body>
</html>`;
}

module.exports = { buildPrintHtml, fitText, esc };
