/**
 * Rutas publicas: carnet del titular, activacion y directorio de tiendas.
 *
 * Nadie tiene sesion aqui. Cualquiera que encuentre una tarjeta en la calle
 * puede abrir estas URLs, asi que solo se muestra lo justo para que el
 * titular se reconozca; el historial exige identificarse.
 */
const repos = require('./repos');
const { nombreCorto, coincideDocumento, hoy } = require('./reglas');
const { limitar } = require('./limite');
const { formatoValido: tokenValido } = require('./tokens');

function estadoVisible(t) {
  if (t.estado === 'activa' && t.vence && t.vence < hoy()) return 'vencida';
  return t.estado;
}

async function manejar({ ruta, req, url, json, leerCuerpo, ip }) {
  // ------------------------------------------------- directorio de tiendas
  if (ruta === '/api/publico/directorio') {
    const filas = await repos.tiendas.directorio();
    json(200, {
      tiendas: filas.map(t => ({
        nombre: t.nombre, rubro: t.rubro, distrito: t.distrito,
        direccion: t.direccion, beneficio: t.beneficio, condiciones: t.condiciones,
        lat: t.lat, lng: t.lng
      }))
    });
    return true;
  }

  // ------------------------------------------------------ carnet: lo basico
  if (ruta.startsWith('/api/publico/tarjeta/')) {
    const token = decodeURIComponent(ruta.slice('/api/publico/tarjeta/'.length)).toUpperCase();
    if (!tokenValido(token)) { json(400, { error: 'Código inválido' }); return true; }

    // Evita que alguien recorra el espacio de codigos probando URLs.
    const l = limitar({ clave: `carnet:${ip}`, maximo: 30, ventanaMs: 60_000 });
    if (!l.permitido) { json(429, { error: 'Demasiadas consultas. Intenta en un minuto.' }); return true; }

    const t = await repos.carnet.porToken(token);
    if (!t) { json(404, { error: 'Tarjeta no registrada' }); return true; }

    if (t.estado === 'en_blanco') { json(200, { estado: 'en_blanco', token }); return true; }

    const ahorro = await repos.canjes.ahorroDeCliente(t.cliente_id);
    json(200, {
      token,
      estado: estadoVisible(t),
      nombre: nombreCorto(t.nombre),
      vence: t.vence,
      socioDesde: t.emitida_en,
      visitas: Number(ahorro.visitas),
      consumo: Number(ahorro.consumo)
    });
    return true;
  }

  // ------------------------------------ historial: exige identificarse
  if (ruta === '/api/publico/historial' && req.method === 'POST') {
    const cuerpo = await leerCuerpo();
    const token = String(cuerpo.token || '').toUpperCase();
    if (!tokenValido(token)) { json(400, { error: 'Código inválido' }); return true; }

    // Cuatro digitos son solo 10.000 combinaciones: sin limite estricto
    // se prueban todas. Con esto, 5 intentos por hora y tarjeta.
    const l = limitar({ clave: `historial:${token}`, maximo: 5, ventanaMs: 60 * 60_000 });
    if (!l.permitido) {
      json(429, { error: `Demasiados intentos. Espera ${Math.ceil(l.esperaSegundos / 60)} minutos.` });
      return true;
    }

    const t = await repos.carnet.porToken(token);
    if (!t || !t.cliente_id || !coincideDocumento(t.doc, cuerpo.documento)) {
      json(401, { error: 'Los datos no coinciden con esta tarjeta' });
      return true;
    }
    json(200, { historial: await repos.carnet.historial(t.cliente_id) });
    return true;
  }

  // ------------------------------------------- reportar tarjeta perdida
  if (ruta === '/api/publico/perdida' && req.method === 'POST') {
    const cuerpo = await leerCuerpo();
    const token = String(cuerpo.token || '').toUpperCase();
    if (!tokenValido(token)) { json(400, { error: 'Código inválido' }); return true; }

    const l = limitar({ clave: `perdida:${token}`, maximo: 5, ventanaMs: 60 * 60_000 });
    if (!l.permitido) { json(429, { error: 'Demasiados intentos.' }); return true; }

    const t = await repos.carnet.porToken(token);
    if (!t || !t.cliente_id || !coincideDocumento(t.doc, cuerpo.documento)) {
      json(401, { error: 'Los datos no coinciden con esta tarjeta' });
      return true;
    }
    await repos.tarjetas.marcarPerdida(token);
    json(200, { ok: true });
    return true;
  }

  // --------------------------------------------- autoactivacion del titular
  if (ruta === '/api/publico/activar' && req.method === 'POST') {
    const cuerpo = await leerCuerpo();
    const token = String(cuerpo.token || '').toUpperCase();
    if (!tokenValido(token)) { json(400, { error: 'Código inválido' }); return true; }

    const l = limitar({ clave: `activar:${ip}`, maximo: 5, ventanaMs: 60 * 60_000 });
    if (!l.permitido) { json(429, { error: 'Demasiados intentos. Intenta más tarde.' }); return true; }

    const nombre = String(cuerpo.nombre || '').trim();
    const doc = String(cuerpo.doc || '').trim();
    if (nombre.length < 3) { json(400, { error: 'Escribe tu nombre completo' }); return true; }
    if (!/^\d{8,12}$/.test(doc)) { json(400, { error: 'El documento debe tener entre 8 y 12 dígitos' }); return true; }
    if (cuerpo.celular && !/^\d{9}$/.test(String(cuerpo.celular))) {
      json(400, { error: 'El celular debe tener 9 dígitos' }); return true;
    }
    if (!cuerpo.consentimiento) { json(400, { error: 'Falta aceptar el tratamiento de datos' }); return true; }

    try {
      const r = await repos.carnet.activar(token, { nombre, doc, celular: cuerpo.celular, correo: cuerpo.correo });
      json(200, { ok: true, vence: r.vence });
    } catch (e) {
      json(400, { error: e.message });
    }
    return true;
  }

  return false;
}

module.exports = { manejar };
