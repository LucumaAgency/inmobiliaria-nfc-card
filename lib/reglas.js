/**
 * Reglas de negocio de ProbaCard.
 * Vive aparte del servidor para poder probarse sin base de datos ni HTTP.
 */

// Las fechas van siempre por la zona del programa, nunca por UTC ni por la
// hora del servidor. Ver lib/fechas.js.
const { hoy, diaSemana } = require('./fechas');

/**
 * Decide si una tarjeta puede usar el beneficio de una tienda.
 * @param tarjeta  fila de tarjetas con el cliente incorporado, o null
 * @param beneficio fila de beneficios vigente de esa tienda, o null
 * @param usosHoy  canjes que ya hizo esa tarjeta hoy en esa tienda
 */
function evaluar(tarjeta, beneficio, usosHoy = 0, fecha = new Date()) {
  if (!tarjeta) return { estado: 'NO_EXISTE', motivo: 'Tarjeta no registrada' };

  if (tarjeta.estado === 'en_blanco') return { estado: 'SIN_ACTIVAR', motivo: 'Tarjeta aún no activada' };
  if (tarjeta.estado === 'suspendida') return { estado: 'SUSPENDIDA', motivo: 'Tarjeta suspendida' };
  if (tarjeta.estado === 'perdida') return { estado: 'BLOQUEADA', motivo: 'Tarjeta reportada como perdida' };

  const dia = hoy(fecha);
  if (tarjeta.estado === 'vencida' || (tarjeta.vence && tarjeta.vence < dia)) {
    return { estado: 'VENCIDA', motivo: tarjeta.vence ? `Venció el ${tarjeta.vence}` : 'Tarjeta vencida' };
  }

  if (!beneficio) return { estado: 'SIN_BENEFICIO', motivo: 'La tienda no tiene un beneficio vigente' };

  if (beneficio.dias_validos && !beneficio.dias_validos.includes(diaSemana(fecha))) {
    return { estado: 'DIA_NO_VALIDO', motivo: 'El beneficio no aplica hoy' };
  }

  if (usosHoy >= beneficio.tope_diario) {
    return { estado: 'TOPE', motivo: `Ya usó el beneficio hoy (tope: ${beneficio.tope_diario})` };
  }

  return { estado: 'VALIDO', motivo: null };
}

/** El monto solo se conoce al confirmar el canje, por eso se valida aparte. */
function cumpleMontoMinimo(beneficio, monto) {
  const minimo = Number(beneficio?.monto_minimo || 0);
  if (minimo > 0 && Number(monto || 0) < minimo) {
    return { ok: false, motivo: `El beneficio exige un consumo mínimo de S/ ${minimo.toFixed(2)}` };
  }
  return { ok: true };
}

/** Datos del titular que el cajero puede ver. Nada mas que esto. */
function publico(tarjeta) {
  return {
    id: tarjeta.cliente_id,
    nombre: tarjeta.nombre,
    doc: tarjeta.doc,
    foto: tarjeta.foto,
    vence: tarjeta.vence
  };
}


/**
 * Nombre para el carnet publico. Cualquiera que encuentre la tarjeta en la
 * calle puede abrir esa URL, asi que se muestra lo justo para que el titular
 * se reconozca, sin exponer el nombre completo de un tercero.
 * "Juan Pérez Ramos" -> "Juan P. R."
 */
function nombreCorto(nombre) {
  const partes = String(nombre || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '';
  const [pila, ...resto] = partes;
  return [pila, ...resto.map(p => p[0].toUpperCase() + '.')].join(' ');
}

/** El titular se identifica con los ultimos 4 digitos de su documento. */
function coincideDocumento(documento, ultimos4) {
  const doc = String(documento || '');
  const dados = String(ultimos4 || '').trim();
  if (!/^\d{4}$/.test(dados) || doc.length < 4) return false;
  return doc.slice(-4) === dados;
}

module.exports = { hoy, diaSemana, evaluar, cumpleMontoMinimo, publico, nombreCorto, coincideDocumento };
