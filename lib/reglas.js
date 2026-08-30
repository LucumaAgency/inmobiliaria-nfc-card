/**
 * Reglas de negocio de ProbaCard.
 * Vive aparte del servidor para poder probarse sin levantar HTTP.
 */

function hoy() { return new Date().toISOString().slice(0, 10); }

function evaluar(cliente, tienda, canjes = []) {
  if (!cliente) return { estado: 'NO_EXISTE', motivo: 'Tarjeta no registrada' };
  if (cliente.estado === 'suspendida') return { estado: 'SUSPENDIDA', motivo: 'Tarjeta suspendida' };
  if (cliente.estado === 'perdida') return { estado: 'BLOQUEADA', motivo: 'Tarjeta reportada como perdida' };
  if (cliente.vence < hoy()) return { estado: 'VENCIDA', motivo: `Venció el ${cliente.vence}` };

  const usosHoy = canjes.filter(c =>
    c.clienteId === cliente.id && c.tiendaId === tienda.id && c.fecha.slice(0, 10) === hoy()
  ).length;
  if (usosHoy >= tienda.topeDiario) {
    return { estado: 'TOPE', motivo: `Ya usó el beneficio hoy (tope: ${tienda.topeDiario})` };
  }
  return { estado: 'VALIDO', motivo: null };
}

function publico(cliente) {
  return { id: cliente.id, nombre: cliente.nombre, doc: cliente.doc, foto: cliente.foto, vence: cliente.vence };
}


module.exports = { hoy, evaluar, publico };
