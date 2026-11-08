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

const cases = {
  corta: {
    id: '6f1c2a5e-0b1d-4c7e-9d2a-1a2b3c4d5e6f', order_number: 'PN-48213',
    greeting: 'Querido Santa:', child_name: 'Sofía', child_age: 7,
    message: 'Este año me porté muy bien y ayudé a mi mamá con mi hermanito. ¿Cómo están Rodolfo y los demás renos?',
    gifts: ['Una bicicleta roja', 'Un set de pintura', 'Un libro de dinosaurios'],
    farewell: 'Con mucho cariño,', signature: 'Sofía', ship_name: 'Sofía Rivera',
  },
  larga: {
    id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d', order_number: 'PN-90417',
    greeting: 'Querido Santa Claus:', child_name: 'Sebastián Alejandro', child_age: 10,
    message: ('Este año fue muy especial. Empecé quinto grado, aprendí a nadar sin flotadores y ayudé a mi abuela a sembrar ' +
      'tomates en el patio. A veces peleé con mi hermana, pero siempre le pedí perdón. También leí muchos libros, mi favorito ' +
      'fue uno de dragones. Te quería contar que mi perro Coco aprendió a sentarse. ').repeat(2).slice(0, 700),
    gifts: Array.from({ length: 12 }, (_, i) => `Regalo número ${i + 1} con un nombre bastante largo para probar`).map((g) => g.slice(0, 60)),
    farewell: 'Con todo mi cariño y un abrazo,', signature: 'Sebastián', ship_name: 'Sebastián Torres',
  },
};

for (const design of DESIGNS) {
  for (const [name, c] of Object.entries(cases)) {
    const file = path.join(outDir, `${design}-${name}.html`);
    fs.writeFileSync(file, buildPrintHtml({ ...c, design }, { preview: true }));
  }
}
console.log(`✅ ${DESIGNS.length * Object.keys(cases).length} previews en ${outDir}`);
