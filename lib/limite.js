/**
 * Rate limiting en memoria. Suficiente para un proceso de Passenger.
 * Si algun dia hay varias instancias, esto se mueve a la base o a Redis.
 */
const intentos = new Map();

function limitar({ clave, maximo, ventanaMs }) {
  const ahora = Date.now();
  const registro = intentos.get(clave);

  if (!registro || ahora > registro.hasta) {
    intentos.set(clave, { n: 1, hasta: ahora + ventanaMs });
    return { permitido: true, restantes: maximo - 1 };
  }
  registro.n++;
  if (registro.n > maximo) {
    return { permitido: false, esperaSegundos: Math.ceil((registro.hasta - ahora) / 1000) };
  }
  return { permitido: true, restantes: maximo - registro.n };
}

function limpiar(clave) { intentos.delete(clave); }

// Sin esto el mapa crece para siempre en un proceso de larga vida.
const aseo = setInterval(() => {
  const ahora = Date.now();
  for (const [k, v] of intentos) if (ahora > v.hasta) intentos.delete(k);
}, 60_000);
aseo.unref();

module.exports = { limitar, limpiar };
