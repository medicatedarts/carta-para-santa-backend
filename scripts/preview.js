// scripts/preview.js
// Genera previews/<diseño>-<caso>.html con cartas de ejemplo para revisar la impresión
// en el navegador (o convertirlas a PDF) sin base de datos ni Lob.
//   npm run preview
// Ábrelos en Chrome y usa Imprimir → Guardar como PDF (tamaño carta, sin márgenes).

const fs = require('fs');
const path = require('path');
const { buildPrintHtml } = require('../printTemplate');
const { DESIGNS } = require('../validate');

const outDir = path.join(__dirname, '..', 'previews');
fs.mkdirSync(outDir, { recursive: true });

const { SAMPLES } = require('../samples');
const cases = Object.fromEntries(Object.entries(SAMPLES).map(([k, v], i) => [k, { id: `vista-previa-${k}-${i}`, order_number: 'PN-00000', ...v }]));

for (const design of DESIGNS) {
  for (const [name, c] of Object.entries(cases)) {
    const file = path.join(outDir, `${design}-${name}.html`);
    fs.writeFileSync(file, buildPrintHtml({ ...c, design }, { preview: true }));
  }
}
console.log(`✅ ${DESIGNS.length * Object.keys(cases).length} previews en ${outDir}`);
