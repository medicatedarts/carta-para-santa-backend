// scripts/send-test-letter.js
// Manda cartas de prueba a Lob sin pasar por el sitio ni por Stripe. Sirve para ver
// cómo sale la impresión real (color, doblez, zona de dirección) y cuánto tarda en
// llegar, antes del lanzamiento.
//
// Con la clave de prueba (test_…) Lob NO imprime ni cobra: solo genera el PDF y te
// devuelve el enlace. Con la clave live (live_…) la carta se imprime y se envía de verdad.
//
// Uso:
//   node scripts/send-test-letter.js --design taller \
//     --to "Sofía Rivera|Calle 1 #23||Arecibo|PR|00612"
//
//   Formato de --to: "Nombre|Línea 1|Línea 2|Ciudad|Estado|Código postal" (Línea 2 puede ir vacía)
//
// Opciones:
//   --design <id>   clasica | taller | estrellas | polonorte | juguetes | duendes | dulces | cascanueces | todos  (por defecto: clasica)
//   --to "<...>"    dirección del destinatario (obligatoria salvo con --dry)
//   --larga         usa la carta de ejemplo al máximo (700 caracteres y 12 regalos)
//   --dry           no llama a Lob: guarda el HTML en previews/ para abrirlo en el navegador
//   --yes           no pide confirmación al usar la clave live
//
// Variables que usa (de .env):
//   LOB_API_KEY, LOB_FROM_ADDRESS_ID (o LOB_FROM_*)
//   BACKEND_PUBLIC_URL=https://api.cartaparasanta.com  y  ADMIN_TOKEN (el mismo de Render)
//
// Lob no acepta HTML de más de 10,000 caracteres, así que descarga la carta de ejemplo
// desde el backend en Render (GET /print/sample/<diseño>/<corta|larga>, con URL firmada).
// Por eso el backend tiene que estar desplegado y ADMIN_TOKEN debe ser igual al de Render.

try { require('dotenv').config(); } catch (_) { /* sin dotenv: se usan las variables del sistema */ }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { createLetter } = require('../lob');
const { samplePrintUrl } = require('../printUrl');
const { buildPrintHtml } = require('../printTemplate');
const { DESIGNS, US_STATES } = require('../validate');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const { SAMPLES } = require('../samples');

function parseTo(str) {
  const [name, line1, line2, city, state, zip] = String(str).split('|').map((s) => (s || '').trim());
  const st = (state || '').toUpperCase();
  if (!name || !line1 || !city || !US_STATES.has(st) || !/^\d{5}(-\d{4})?$/.test(zip || '')) {
    throw new Error('Dirección inválida. Formato: "Nombre|Línea 1|Línea 2|Ciudad|Estado|Código postal" (ej. PR, 00612)');
  }
  return { name, line1, line2, city, state: st, zip };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim().toLowerCase()); }));
}

(async () => {
  const designArg = arg('design') || 'clasica';
  const designs = designArg === 'todos' ? DESIGNS : [designArg];
  if (designs.some((d) => !DESIGNS.includes(d))) {
    console.error(`Diseño desconocido: ${designArg}. Opciones: ${DESIGNS.join(', ')}, todos`);
    process.exit(1);
  }
  const size = arg('larga') ? 'larga' : 'corta';
  const sample = SAMPLES[size];
  const dry = Boolean(arg('dry'));

  let to = { name: 'Sofía Rivera', line1: 'Calle 1 #23', line2: '', city: 'Arecibo', state: 'PR', zip: '00612' };
  if (!dry) {
    if (!arg('to') || arg('to') === true) {
      console.error('Falta --to "Nombre|Línea 1|Línea 2|Ciudad|Estado|Código postal"');
      process.exit(1);
    }
    try { to = parseTo(arg('to')); } catch (err) { console.error(err.message); process.exit(1); }

    const key = process.env.LOB_API_KEY || '';
    if (!key) { console.error('Falta LOB_API_KEY en .env'); process.exit(1); }
    if (!process.env.LOB_FROM_ADDRESS_ID && !process.env.LOB_FROM_ADDRESS_LINE1) {
      console.error('Falta el remitente: LOB_FROM_ADDRESS_ID (o los campos LOB_FROM_*) en .env');
      process.exit(1);
    }
    if (!/^https:\/\//.test(process.env.BACKEND_PUBLIC_URL || '')) {
      console.error('Falta BACKEND_PUBLIC_URL=https://api.cartaparasanta.com en .env (Lob descarga la carta desde el backend)');
      process.exit(1);
    }
    if (!process.env.PRINT_URL_SECRET && !process.env.ADMIN_TOKEN) {
      console.error('Falta ADMIN_TOKEN en .env (el mismo valor que en Render) para firmar la URL de la carta');
      process.exit(1);
    }
    const live = key.startsWith('live_');
    console.log(live
      ? `⚠️  Clave LIVE: se van a imprimir y enviar ${designs.length} carta(s) reales a ${to.name}, ${to.city} ${to.state}. Lob las cobra.`
      : `🧪 Clave de prueba: Lob genera el PDF de ${designs.length} carta(s) sin imprimir ni cobrar.`);
    if (live && !arg('yes')) {
      const answer = await ask('¿Continuar? (si/no) ');
      if (!['si', 'sí', 's', 'yes', 'y'].includes(answer)) { console.log('Cancelado.'); process.exit(0); }
    }
  }

  for (const design of designs) {
    const order = {
      id: crypto.randomUUID(),
      order_number: 'PRUEBA-' + crypto.randomInt(1000, 10000),
      design,
      ...sample,
      ship_name: to.name, ship_line1: to.line1, ship_line2: to.line2,
      ship_city: to.city, ship_state: to.state, ship_zip: to.zip, ship_country: 'US',
    };

    if (dry) {
      const dir = path.join(__dirname, '..', 'previews');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `prueba-${design}${arg('larga') ? '-larga' : ''}.html`);
      fs.writeFileSync(file, buildPrintHtml(order, { preview: true }));
      console.log(`📝 ${design}: ${file}`);
      continue;
    }

    try {
      // Llave única por envío de prueba: cada corrida crea una carta nueva.
      const letter = await createLetter(order, `prueba-${order.id}`, { fileUrl: samplePrintUrl(design, size) });
      console.log(`✅ ${design}: ${letter.id} · entrega estimada ${letter.expectedDelivery || 'n/d'} · precio ${letter.price ?? 'n/d'}`);
      if (letter.url) console.log(`   PDF: ${letter.url}`);
    } catch (err) {
      console.error(`❌ ${design}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (!dry) console.log('\nLas cartas aparecen en dashboard.lob.com → Letters. El PDF puede tardar unos segundos en generarse.');
})();
