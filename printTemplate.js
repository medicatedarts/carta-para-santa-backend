// printTemplate.js
// HTML de impresión para Lob: 2 páginas tamaño carta (8.5" × 11").
//   Página 1: la respuesta de Santa (diseño de docs/prototipo/SantaLetter.dc.html).
//   Página 2: copia de la carta del niño en el papel que escogió (papeles/papeles.json,
//             generado del prototipo LetterArt con scripts/build-papeles.js).
//
// Reglas de Lob que este archivo respeta (ESPECIFICACION §7):
//  - Lob ignora los márgenes de @page: todo se posiciona dentro de cada .page.
//  - Nada a sangre: el contenido de la página 2 deja 1/16" (6 px) libres en cada borde.
//  - address_placement = top_first_page: Lob imprime remitente y destinatario arriba a
//    la izquierda de la página 1. Esa zona (.lob-address-zone) queda libre; el escudo
//    del Polo Norte va arriba a la derecha, donde la plantilla de Lob permite un logo.
//  - Sin JavaScript: Lob no lo ejecuta, así que el ajuste de tamaño de letra para
//    cartas largas se calcula aquí en el servidor.
//  - Fuentes por URL pública (Google Fonts); nada en base64 ni rutas locales.

const papeles = require('./papeles/papeles.json');
const { buildSantaReply } = require('./santaReply');

const fs = require('fs');
const path = require('path');

// Fuentes: si existen los woff2 en fonts/ (ver fonts/README.md) se sirven desde el
// propio backend, que es lo más seguro para Lob. Si no, se usan desde Google Fonts.
const FONT_FILES = [
  ['Fraunces', 500, 'normal', 'fraunces-500.woff2'],
  ['Fraunces', 700, 'normal', 'fraunces-700.woff2'],
  ['Fraunces', 700, 'italic', 'fraunces-700italic.woff2'],
  ['Nunito', 400, 'normal', 'nunito-400.woff2'],
  ['Nunito', 800, 'normal', 'nunito-800.woff2'],
  ['Patrick Hand', 400, 'normal', 'patrickhand-400.woff2'],
  ['Pinyon Script', 400, 'normal', 'pinyonscript-400.woff2'],
];

function fontsHead() {
  const base = process.env.BACKEND_PUBLIC_URL;
  const dir = path.join(__dirname, 'fonts');
  const local = base && FONT_FILES.every(([, , , f]) => fs.existsSync(path.join(dir, f)));
  if (!local) return `<link rel="stylesheet" href="${FONTS_URL}">`;
  const faces = FONT_FILES.map(([family, weight, style, file]) =>
    `@font-face{font-family:'${family}';font-weight:${weight};font-style:${style};font-display:block;src:url('${base}/fonts/${file}') format('woff2');}`
  ).join('');
  return `<style>${faces}</style>`;
}

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,700&family=Nunito:wght@400;700;800&family=Patrick+Hand&family=Pinyon+Script&display=block';

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Página 1 — respuesta de Santa
// ---------------------------------------------------------------------------
function santaPage(order, { preview = false, now } = {}) {
  const r = buildSantaReply(order, now);
  return `
<section class="page santa">
  <div class="frame-stripes"></div>
  <div class="frame-gold"></div>
  <div class="lob-address-zone${preview ? ' show' : ''}">${preview ? 'Lob imprime aquí remitente y destinatario' : ''}</div>

  <div class="crest">
    <svg width="86" height="86" viewBox="0 0 86 86" aria-hidden="true">
      <circle cx="43" cy="43" r="40" fill="#B3261E"/>
      <circle cx="43" cy="43" r="33" fill="none" stroke="#E2C27A" stroke-width="1.5" stroke-dasharray="2 4"/>
      <path d="M43 18l5.6 15.4L64 39l-15.4 5.6L43 60l-5.6-15.4L22 39l15.4-5.6z" fill="#F3D58A"/>
      <path d="M28 64 h30" stroke="#F3D58A" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <p class="crest-top">${esc(r.header)}</p>
    <p class="crest-place">${esc(r.place)}</p>
    <p class="crest-date">${esc(r.date)}</p>
  </div>

  <div class="santa-body">
    <p class="santa-greeting">${esc(r.greeting)}</p>
    ${r.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('\n    ')}
    <p class="santa-farewell">${esc(r.farewell)}</p>
    <p class="santa-sign">${esc(r.signature)}</p>
    <p class="santa-ps">${esc(r.ps)}</p>
  </div>

  <svg class="bottom-ornament" width="220" height="24" viewBox="0 0 220 24" aria-hidden="true">
    <path d="M0 12h86M134 12h86" stroke="#C9A24A" stroke-width="1.5"/>
    <path d="M110 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#C9A24A"/>
    <circle cx="94" cy="12" r="2.5" fill="#B3261E"/><circle cx="126" cy="12" r="2.5" fill="#1F6B47"/>
  </svg>
</section>`;
}

// ---------------------------------------------------------------------------
// Página 2 — copia de la carta del niño
// ---------------------------------------------------------------------------
// El papel se dibuja a 536 × 696 px (las proporciones del prototipo) y se escala ×1.5
// para llenar la hoja dejando 6 px (1/16") libres en cada borde.
const BASE_W = 536;
const BASE_H = 696;
const SCALE = 1.5;

// "padding: 84px 30px 120px;" → { t, r, b, l }
function parsePadding(style) {
  const m = /padding:\s*([^;]+);/.exec(style || '');
  const v = (m ? m[1] : '0').trim().split(/\s+/).map((x) => parseFloat(x) || 0);
  const [t, r = t, b = t, l = r] = v;
  return { t, r, b, l };
}

// Estima cuántos renglones ocupa un texto con Patrick Hand (≈0.44 em por carácter medido con la fuente real,
// un poco de más para no quedarse corto).
function lines(text, widthPx, fontPx) {
  const perLine = Math.max(8, Math.floor(widthPx / (fontPx * 0.44)));
  return String(text || '')
    .split('\n')
    .reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

function introLine(order) {
  const name = (order.child_name || '').trim();
  if (name && order.child_age) return `Me llamo ${name} y tengo ${order.child_age} años.`;
  if (name) return `Me llamo ${name}.`;
  if (order.child_age) return `Tengo ${order.child_age} años.`;
  return '';
}

// Calcula tamaño de letra y alto de renglón para que la carta quepa en la hoja.
function fitText(order, d) {
  const rp = parsePadding(d.root);
  const pp = parsePadding(d.paper);
  const width = BASE_W - rp.l - rp.r - pp.l - pp.r;
  const height = BASE_H - rp.t - rp.b - pp.t - pp.b;
  const gifts = Array.isArray(order.gifts) ? order.gifts : [];

  const unitsAt = (font) => {
    let u = 2; // saludo = 2 renglones
    const intro = introLine(order);
    if (intro) u += lines(intro, width, font);
    if (order.message) u += lines(order.message, width, font);
    if (gifts.length) {
      u += 1; // "Esta es mi lista de regalos:"
      u += gifts.reduce((n, g) => n + lines(g, width - 30, font), 0);
    }
    if (order.farewell) u += 1;
    u += 1; // firma
    return u;
  };

  let font = 21;
  let lh = 32;
  // Bajar de medio en medio punto hasta que quepa (mínimo: 9 px base, que impreso a ×1.5 son 13.5 px ≈ 10 pt; solo pasa con cartas al máximo de todo).
  while (font > 9 && unitsAt(font) * lh > height) {
    font -= 0.5;
    lh = Math.round(font * (32 / 21) * 10) / 10;
  }
  return { font, lh };
}

function childPage(order) {
  const d = papeles.designs[order.design] || papeles.designs.clasica;
  const { font, lh } = fitText(order, d);
  const gifts = Array.isArray(order.gifts) ? order.gifts : [];
  const intro = introLine(order);
  const greetScale = lh / 32;

  // El saludo usa la tipografía del diseño; se escala junto con el texto.
  const greetStyle = d.greet
    .replace(/font-size:\s*(\d+(\.\d+)?)px/, (_, n) => `font-size: ${(parseFloat(n) * greetScale).toFixed(1)}px`)
    .replace(/line-height:\s*64px/, `line-height: ${(lh * 2).toFixed(1)}px`);

  const content = [
    `<p style="margin:0; ${greetStyle}">${esc(order.greeting || 'Querido Santa:')}</p>`,
    intro ? `<p style="margin:0">${esc(intro)}</p>` : '',
    order.message ? `<p style="margin:0; white-space:pre-wrap">${esc(order.message)}</p>` : '',
    gifts.length
      ? `<p style="margin:0">Esta es mi lista de regalos:</p><ol style="margin:0; padding-left:30px">${gifts
          .map((g) => `<li>${esc(g)}</li>`)
          .join('')}</ol>`
      : '',
    order.farewell ? `<p style="margin:0">${esc(order.farewell)}</p>` : '',
    `<p style="margin:0; ${d.sign}">${esc(order.signature || order.child_name || '')}</p>`,
  ].join('');

  return `
<section class="page child">
  <div class="paper-wrap">
    <div class="paper-root" style="position:relative; width:${BASE_W}px; height:${BASE_H}px; box-sizing:border-box; overflow:hidden; border-radius:6px; display:flex; flex-direction:column; ${d.root}">
      ${papeles.defs}
      ${d.decor}
      <div style="position:relative; z-index:1; flex:1; box-sizing:border-box; display:flex; flex-direction:column; ${d.paper}">
        <div style="font-family:'Patrick Hand', cursive; font-size:${font}px; line-height:${lh}px; color:${d.ink}; flex:1; display:flex; flex-direction:column; overflow-wrap:anywhere; background-image:repeating-linear-gradient(to bottom, transparent 0 ${lh - 1}px, ${d.line} ${lh - 1}px ${lh}px);">
          ${content}
        </div>
      </div>
    </div>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Documento completo
// ---------------------------------------------------------------------------
const CSS = `
  @page { size: 8.5in 11in; margin: 0; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  .page { position: relative; width: 8.5in; height: 11in; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }

  /* Página 1 */
  .santa { background: #FFFDF7; font-family: 'Fraunces', Georgia, serif; color: #2A241C; }
  .frame-stripes { position: absolute; inset: 22px; border: 6px solid transparent;
    border-image: repeating-linear-gradient(45deg, #B3261E 0 12px, #FFFDF7 12px 18px, #1F6B47 18px 30px, #FFFDF7 30px 36px) 6; }
  .frame-gold { position: absolute; inset: 36px; border: 1.5px solid #C9A24A; }
  /* Zona de dirección de Lob: arriba a la izquierda, 4.25" × 2.95". Se tapa el marco
     para que nada decorativo quede detrás de la ventana del sobre. */
  .lob-address-zone { position: absolute; left: 0; top: 0; width: 4.25in; height: 2.95in; background: #FFFDF7; z-index: 2;
    display: flex; align-items: center; justify-content: center; text-align: center; box-sizing: border-box;
    font-family: Arial, sans-serif; font-size: 12px; color: #5A645F; }
  .lob-address-zone.show { border: 2px dashed #8E9A93; }
  .crest { position: absolute; right: 64px; top: 62px; width: 300px; display: flex; flex-direction: column; align-items: center; text-align: center; z-index: 3; }
  .crest p { margin: 0; }
  .crest-top { margin-top: 10px !important; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase; color: #1F6B47; }
  .crest-place { margin-top: 2px !important; font-weight: 700; font-size: 30px; line-height: 1.05; color: #0F3324; }
  .crest-date { margin-top: 6px !important; font-family: 'Patrick Hand', cursive; font-size: 17px; color: #6B5016; }
  .santa-body { position: absolute; left: 96px; right: 96px; top: 300px; display: flex; flex-direction: column; gap: 13px; font-size: 17px; line-height: 1.5; z-index: 3; }
  .santa-body p { margin: 0; }
  .santa-greeting { font-family: 'Patrick Hand', cursive; font-size: 30px !important; line-height: 1.2; color: #B3261E; }
  .santa-farewell { margin-top: 6px !important; }
  .santa-sign { margin-top: -4px !important; font-family: 'Pinyon Script', cursive; font-size: 56px; line-height: 1.1; color: #B3261E; }
  .santa-ps { padding-top: 10px; border-top: 1px solid #E8D9B0; font-family: 'Patrick Hand', cursive; font-size: 18px; color: #4B3D22; }
  .bottom-ornament { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); }

  /* Página 2 */
  .child { background: #FFFFFF; }
  .paper-wrap { position: absolute; left: 6px; top: 6px; width: ${BASE_W}px; height: ${BASE_H}px; transform: scale(${SCALE}); transform-origin: 0 0; }
`;

/**
 * @param {Object} order - fila de orders
 * @param {Object} [opts] - { preview: true } marca la zona de dirección de Lob
 * @returns {string} HTML para el parámetro `file` de Lob
 */
function buildPrintHtml(order, opts = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>CartaParaSanta ${esc(order.order_number || '')}</title>
${fontsHead()}
<style>${CSS}</style>
</head>
<body>
${santaPage(order, opts)}
${childPage(order)}
</body>
</html>`;
}

module.exports = { buildPrintHtml, fitText, esc };
