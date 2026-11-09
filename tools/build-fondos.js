// tools/build-fondos.js
// Genera las páginas HTML (sin texto) de los fondos actuales y papeles/layout.json con la
// caja de texto de cada diseño. Luego tools/render-fondos.py las convierte en imágenes
// de 2550×3300 px (8.5×11" a 300 ppp). Solo hace falta para regenerar los fondos a partir
// del prototipo; si diseñas tus propios fondos, reemplaza las imágenes y ajusta layout.json.
const fs = require('fs');
const path = require('path');
const papeles = require('../papeles/papeles.json');

const BASE_W = 536, BASE_H = 696, SCALE = 1.5, OFF = 6;
const out = path.join(__dirname, 'fondos-html');
fs.mkdirSync(out, { recursive: true });

const pad = (style) => {
  const m = /padding:\s*([^;]+);/.exec(style || '');
  const v = (m ? m[1] : '0').trim().split(/\s+/).map((x) => parseFloat(x) || 0);
  const [t, r = t, b = t, l = r] = v; return { t, r, b, l };
};
const inch = (px) => Math.round((px / 96) * 1000) / 1000;
const F = path.join(__dirname, '..', 'fonts');
const faces = [['Fraunces',700,'normal','fraunces-700'],['Fraunces',700,'italic','fraunces-700italic'],['Fraunces',500,'normal','fraunces-500'],['Nunito',400,'normal','nunito-400'],['Nunito',800,'normal','nunito-800'],['Patrick Hand',400,'normal','patrickhand-400'],['Pinyon Script',400,'normal','pinyonscript-400']].map(([f,w,s,n]) => `@font-face{font-family:'${f}';font-weight:${w};font-style:${s};src:url('file://${F}/${n}.ttf')}`).join('');
const head = `<!doctype html><html><head><meta charset="utf-8"><style>${faces}
@page{size:8.5in 11in;margin:0}html,body{margin:0;padding:0}
.page{position:relative;width:816px;height:1056px;overflow:hidden}
.wrap{position:absolute;left:${OFF}px;top:${OFF}px;width:${BASE_W}px;height:${BASE_H}px;transform:scale(${SCALE});transform-origin:0 0}
</style></head><body>`;

const layout = { generatedFrom: 'docs/prototipo/LetterArt.dc.html', pageInches: { w: 8.5, h: 11 }, designs: {} };
for (const [id, d] of Object.entries(papeles.designs)) {
  const rp = pad(d.root), pp = pad(d.paper);
  fs.writeFileSync(path.join(out, `papel-${id}.html`), `${head}<div class="page"><div class="wrap">
<div style="position:relative;width:${BASE_W}px;height:${BASE_H}px;box-sizing:border-box;overflow:hidden;border-radius:6px;display:flex;flex-direction:column;${d.root}">
${papeles.defs}${d.decor}
<div style="position:relative;z-index:1;flex:1;box-sizing:border-box;${d.paper}"></div></div></div></div></body></html>`);
  const x = OFF + (rp.l + pp.l) * SCALE, y = OFF + (rp.t + pp.t) * SCALE;
  const w = (BASE_W - rp.l - rp.r - pp.l - pp.r) * SCALE, h = (BASE_H - rp.t - rp.b - pp.t - pp.b) * SCALE;
  const g = d.greet;
  layout.designs[id] = {
    image: `papel-${id}.jpg`,
    textBox: { x: inch(x), y: inch(y), w: inch(w), h: inch(h) },
    ink: d.ink, line: d.line,
    greetFont: /Pinyon/.test(g) ? 'Pinyon Script' : /Fraunces/.test(g) ? 'Fraunces' : /Nunito/.test(g) ? 'Nunito' : 'Patrick Hand',
    greetItalic: /italic/.test(g), greetBold: /font-weight:\s*(700|800)/.test(g),
    greetColor: (/color:\s*(#[0-9A-Fa-f]{3,6})/.exec(g) || [])[1] || d.ink,
    greetCenter: /text-align:\s*center/.test(g),
    signColor: (/color:\s*(#[0-9A-Fa-f]{3,6})/.exec(d.sign) || [])[1] || d.ink,
  };
}

// Caja del logo en px CSS (96 por pulgada): 2.4" de ancho, centrado sobre la fecha (x 6.66").
const LOGO_RATIO = (() => { const b = fs.readFileSync(path.join(__dirname, '..', 'papeles', 'logo-taller.png')); return b.readUInt32BE(20) / b.readUInt32BE(16); })();
const LOGO = { w: 230, h: Math.round(230 * LOGO_RATIO), top: 44 };
LOGO.left = Math.round(6.66 * 96 - LOGO.w / 2);

// Fondo de la respuesta de Santa (sin texto ni fecha; la zona de dirección queda limpia)
fs.writeFileSync(path.join(out, 'santa.html'), `${head}<div class="page" style="background:#FFFDF7;font-family:Georgia,serif">
<div style="position:absolute;inset:22px;border:6px solid transparent;border-image:repeating-linear-gradient(45deg,#B3261E 0 12px,#FFFDF7 12px 18px,#1F6B47 18px 30px,#FFFDF7 30px 36px) 6"></div>
<div style="position:absolute;inset:36px;border:1.5px solid #C9A24A"></div>
<div style="position:absolute;left:0;top:0;width:408px;height:283px;background:#FFFDF7"></div>
<!-- Logo "El Taller del Polo Norte" (papeles/logo-taller.png), centrado sobre la fecha -->
<img src="file://${path.join(__dirname, '..', 'papeles', 'logo-taller.png')}" style="position:absolute;left:${LOGO.left}px;top:${LOGO.top}px;width:${LOGO.w}px;height:${LOGO.h}px">
<svg style="position:absolute;left:298px;bottom:46px" width="220" height="24" viewBox="0 0 220 24"><path d="M0 12h86M134 12h86" stroke="#C9A24A" stroke-width="1.5"/><path d="M110 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#C9A24A"/><circle cx="94" cy="12" r="2.5" fill="#B3261E"/><circle cx="126" cy="12" r="2.5" fill="#1F6B47"/></svg>
</div></body></html>`);
layout.santa = {
  image: 'santa.jpg',
  addressZone: { x: 0, y: 0, w: 4.25, h: 2.95 },
  date: { x: 5.1, y: 2.22, w: 3.125, color: '#6B5016' },
  textBox: { x: 1.0, y: 3.125, w: 6.5, h: 6.9 },
};
fs.writeFileSync(path.join(__dirname, '..', 'papeles', 'layout.json'), JSON.stringify(layout, null, 2));
console.log('ok', Object.keys(layout.designs));
