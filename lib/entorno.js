/**
 * Carga .env sin dependencias externas.
 * Las variables ya definidas en el entorno (Plesk, GitHub Actions) mandan
 * sobre el archivo: en produccion .env no existe y eso esta bien.
 */
const fs = require('fs');
const path = require('path');

function cargar(archivo = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const i = limpia.indexOf('=');
    if (i < 1) continue;
    const clave = limpia.slice(0, i).trim();
    let valor = limpia.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}

module.exports = { cargar };
