// scripts/build-papeles.js
// Genera papeles/papeles.json a partir del prototipo aprobado
// (docs/prototipo/LetterArt.dc.html): la decoración SVG de cada uno de los 5 diseños
// y sus estilos (fondo, papel, color de líneas, tipografía del saludo y la firma).
//
// Así lo que se imprime sale del mismo dibujo que se aprobó en el lienzo. Si se
// cambia un diseño en el prototipo, se vuelve a correr:
//   node scripts/build-papeles.js
// y se copia papeles/papeles.json al repo del frontend (assets/papeles/).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'prototipo', 'LetterArt.dc.html'), 'utf-8');

// 1) Bloques de decoración: <sc-if value="{{isX}}" …> … </sc-if>
const FLAG_TO_ID = { isClasica: 'clasica', isTaller: 'taller', isEstrellas: 'estrellas', isPolo: 'polonorte', isJuguetes: 'juguetes' };
const decor = {};
const re = /<sc-if value="\{\{(is\w+)\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g;
let m;
while ((m = re.exec(src))) {
  const id = FLAG_TO_ID[m[1]];
  if (!id) continue;
  const html = m[2].trim();
  if (/\{\{/.test(html)) throw new Error(`La decoración de ${id} tiene variables {{…}}; el generador espera markup estático.`);
  decor[id] = html;
}

// 2) Filtro SVG de acuarela (lo usan los juguetes)
const defs = (src.match(/<svg width="0" height="0"[\s\S]*?<\/svg>/) || [''])[0];

// 3) Estilos por diseño: el objeto LA del script del prototipo
const laSrc = src.match(/var LA = (\{[\s\S]*?\n\});/);
if (!laSrc) throw new Error('No se encontró el objeto LA en el prototipo');
const styles = vm.runInNewContext(`(${laSrc[1]})`);

const ids = Object.keys(FLAG_TO_ID).map((k) => FLAG_TO_ID[k]);
for (const id of ids) {
  if (!decor[id] || !styles[id]) throw new Error(`Falta el diseño ${id}`);
}

const out = { generatedFrom: 'docs/prototipo/LetterArt.dc.html', baseWidth: 536, defs, designs: {} };
for (const id of ids) out.designs[id] = { ...styles[id], decor: decor[id] };

fs.mkdirSync(path.join(__dirname, '..', 'papeles'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'papeles', 'papeles.json'), JSON.stringify(out, null, 2));
console.log(`✅ papeles/papeles.json con ${ids.length} diseños`);
