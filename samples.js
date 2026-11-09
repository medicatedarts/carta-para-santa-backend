// samples.js
// Cartas de ejemplo (corta y al máximo) que usan las vistas previas, el panel y el
// script de cartas de prueba. Un solo lugar para que todos prueben lo mismo.

const SAMPLES = {
  corta: {
    greeting: 'Querido Santa:', child_name: 'Sofía', child_age: 7,
    message: 'Este año me porté muy bien y ayudé a mi mamá con mi hermanito. ¿Cómo están Rodolfo y los demás renos?',
    gifts: ['Una bicicleta roja', 'Un set de pintura', 'Un libro de dinosaurios'],
    farewell: 'Con mucho cariño,', signature: 'Sofía', ship_name: 'Sofía Rivera',
  },
  larga: {
    greeting: 'Querido Santa Claus:', child_name: 'Sebastián Alejandro', child_age: 10,
    message: ('Este año fue muy especial. Empecé quinto grado, aprendí a nadar sin flotadores y ayudé a mi abuela a sembrar ' +
      'tomates en el patio. A veces peleé con mi hermana, pero siempre le pedí perdón. También leí muchos libros, mi favorito ' +
      'fue uno de dragones. Te quería contar que mi perro Coco aprendió a sentarse. ').repeat(2).slice(0, 700),
    gifts: Array.from({ length: 12 }, (_, i) => `Regalo número ${i + 1} con un nombre bastante largo para probar`.slice(0, 60)),
    farewell: 'Con todo mi cariño y un abrazo,', signature: 'Sebastián', ship_name: 'Sebastián Torres',
  },
};

/** Orden de ejemplo completa para un diseño y un tamaño ("corta" o "larga"). */
function sampleOrder(design, size = 'corta') {
  const s = SAMPLES[size] || SAMPLES.corta;
  return { id: `muestra-${design}-${size}`, order_number: 'PN-00000', design, ...s };
}

module.exports = { SAMPLES, sampleOrder };
