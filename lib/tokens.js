/**
 * Generacion de codigos de tarjeta.
 *
 * Alfabeto sin caracteres que se confundan al dictarlos o al leerlos
 * impresos: sin O/0, sin I/1, sin S/5, sin B/8. El codigo va impreso en
 * la tarjeta y alguien lo va a tipear en la caja.
 */
const crypto = require('crypto');

const ALFABETO = 'ACDEFGHJKLMNPQRTUVWXYZ2346789';
const LARGO = 6;

function generar() {
  const bytes = crypto.randomBytes(LARGO * 2);
  let token = '';
  for (let i = 0; token.length < LARGO; i++) {
    // Rechaza los valores que sesgarian el modulo hacia las primeras letras.
    const b = bytes[i % bytes.length];
    if (b >= 256 - (256 % ALFABETO.length)) continue;
    token += ALFABETO[b % ALFABETO.length];
  }
  return token;
}

/** Genera `cantidad` codigos distintos entre si. */
function generarLote(cantidad) {
  const set = new Set();
  // 29^6 = 594 millones de combinaciones: las colisiones son rarisimas,
  // pero el Set las descarta igual.
  while (set.size < cantidad) set.add(generar());
  return [...set];
}

const valido = t => new RegExp(`^[${ALFABETO}]{${LARGO}}$`).test(t);

module.exports = { generar, generarLote, valido, ALFABETO, LARGO };
