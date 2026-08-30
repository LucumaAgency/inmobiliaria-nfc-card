#!/usr/bin/env node
/**
 * Cambia la clave de un usuario. Uso:
 *   node scripts/clave.js admin "clave nueva"
 */
require('../lib/entorno').cargar();
const { consultar, cerrar } = require('../lib/db');
const { hashear } = require('../lib/claves');

const [usuario, clave] = process.argv.slice(2);
if (!usuario || !clave) {
  console.error('Uso: node scripts/clave.js <usuario> <clave>');
  process.exit(1);
}
if (clave.length < 8) {
  console.error('La clave debe tener al menos 8 caracteres.');
  process.exit(1);
}

(async () => {
  const r = await consultar('UPDATE usuarios SET clave_hash = ? WHERE usuario = ?',
    [await hashear(clave), usuario]);
  console.log(r.affectedRows ? `Clave actualizada para ${usuario}.` : `No existe el usuario ${usuario}.`);
  await cerrar();
})().catch(async e => { console.error(e.message); await cerrar(); process.exit(1); });
