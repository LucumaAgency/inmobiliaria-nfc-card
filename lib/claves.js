/**
 * Hash de claves con scrypt (viene en Node, sin dependencias).
 * Formato guardado: scrypt$<sal-hex>$<hash-hex>
 */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

async function hashear(clave) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(clave, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

async function verificar(clave, guardado) {
  const [algo, salHex, hashHex] = String(guardado || '').split('$');
  if (algo !== 'scrypt' || !salHex || !hashHex) return false;
  const hash = await scrypt(clave, Buffer.from(salHex, 'hex'), 64);
  const esperado = Buffer.from(hashHex, 'hex');
  // Comparacion en tiempo constante: evita filtrar informacion por el tiempo de respuesta.
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado);
}

module.exports = { hashear, verificar };
