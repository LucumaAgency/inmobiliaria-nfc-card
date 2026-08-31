/**
 * Rutas del panel de administracion. Todas exigen rol admin.
 * Se separan de server.js para que el archivo de rutas de caja no crezca.
 */
const repos = require('./repos');
const { generarLote, formatoValido: tokenValido } = require('./tokens');
const { hashear } = require('./claves');
const { hoy } = require('./fechas');

/** Devuelve true si atendio la ruta. */
async function manejar({ ruta, req, url, usuario, json, leerCuerpo }) {
  if (!ruta.startsWith('/api/admin/')) return false;

  if (!usuario) { json(401, { error: 'Sin sesión' }); return true; }
  if (usuario.rol !== 'admin') { json(403, { error: 'Requiere permisos de administrador' }); return true; }

  const cuerpo = req.method === 'POST' ? await leerCuerpo() : {};
  const q = url.searchParams;

  switch (ruta) {

    // ------------------------------------------------------------- resumen
    case '/api/admin/resumen': {
      const [resumen, tiendas, dias, ultimos] = await Promise.all([
        repos.admin.resumen(), repos.admin.porTienda(),
        repos.admin.canjesPorDia(30), repos.admin.ultimosCanjes(15)
      ]);
      json(200, { resumen, tiendas, dias, ultimos });
      return true;
    }

    // --------------------------------------------------------------- lotes
    case '/api/admin/lotes':
      json(200, { lotes: await repos.admin.lotes() });
      return true;

    case '/api/admin/lotes/crear': {
      const cantidad = Number(cuerpo.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 5000) {
        json(400, { error: 'La cantidad debe estar entre 1 y 5000' }); return true;
      }
      const codigo = String(cuerpo.codigo || '').trim().toUpperCase();
      if (!/^[A-Z0-9-]{3,30}$/.test(codigo)) {
        json(400, { error: 'Código de lote inválido' }); return true;
      }
      const tokens = generarLote(cantidad);
      await repos.admin.crearLote(codigo, cantidad, cuerpo.nota, usuario.id);
      // En bloques: una sola sentencia con 5000 filas revienta el paquete de MySQL.
      for (let i = 0; i < tokens.length; i += 500) {
        await repos.admin.insertarTarjetas(tokens.slice(i, i + 500), codigo);
      }
      json(200, { ok: true, codigo, cantidad, tokens });
      return true;
    }

    // El CSV que se le entrega al proveedor de impresión.
    case '/api/admin/lotes/csv': {
      const lote = q.get('lote');
      const filas = await repos.admin.listarTarjetas({ lote, limite: 5000 });
      const base = process.env.URL_BASE || '';
      const csv = ['token,url', ...filas.map(f => `${f.token},${base}/c/${f.token}`)].join('\n');
      json.raw(200, csv, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lote-${lote || 'todos'}.csv"`
      });
      return true;
    }

    // -------------------------------------------------------------- grabado
    case '/api/admin/grabar/siguiente': {
      const fila = await repos.admin.siguientePorGrabar(q.get('lote'));
      if (!fila) { json(200, { fin: true }); return true; }
      json(200, { token: fila.token, url: `${process.env.URL_BASE || ''}/c/${fila.token}` });
      return true;
    }

    case '/api/admin/grabar/confirmar': {
      const token = String(cuerpo.token || '').toUpperCase();
      if (!tokenValido(token)) { json(400, { error: 'Token inválido' }); return true; }
      await repos.admin.marcarGrabada(token, cuerpo.uid);
      json(200, { ok: true });
      return true;
    }

    // ------------------------------------------------------------ tarjetas
    case '/api/admin/tarjetas':
      json(200, { tarjetas: await repos.admin.listarTarjetas({
        estado: q.get('estado'), lote: q.get('lote'), q: q.get('q')
      }) });
      return true;

    case '/api/admin/tarjetas/estado': {
      const estados = ['activa', 'suspendida', 'perdida', 'vencida'];
      if (!estados.includes(cuerpo.estado)) { json(400, { error: 'Estado inválido' }); return true; }
      await repos.admin.cambiarEstadoTarjeta(String(cuerpo.token || '').toUpperCase(), cuerpo.estado);
      json(200, { ok: true });
      return true;
    }

    case '/api/admin/tarjetas/reponer': {
      try {
        await repos.admin.reponer(
          String(cuerpo.tokenViejo || '').toUpperCase(),
          String(cuerpo.tokenNuevo || '').toUpperCase(),
          cuerpo.motivo);
        json(200, { ok: true });
      } catch (e) { json(400, { error: e.message }); }
      return true;
    }

    // ------------------------------------------------------------ clientes
    case '/api/admin/clientes':
      json(200, { clientes: await repos.admin.listarClientes(q.get('q')) });
      return true;

    // Emitir = crear el cliente si hace falta y ligarlo a una tarjeta en blanco.
    case '/api/admin/emitir': {
      const doc = String(cuerpo.doc || '').trim();
      const token = String(cuerpo.token || '').toUpperCase();
      if (!/^\d{8,12}$/.test(doc)) { json(400, { error: 'Documento inválido' }); return true; }
      if (!tokenValido(token)) { json(400, { error: 'Código de tarjeta inválido' }); return true; }
      if (!String(cuerpo.nombre || '').trim()) { json(400, { error: 'Falta el nombre' }); return true; }
      if (!cuerpo.consentimiento) { json(400, { error: 'Falta el consentimiento de datos' }); return true; }

      let cliente = await repos.admin.clientePorDoc(doc);
      if (!cliente) {
        const r = await repos.admin.crearCliente({ ...cuerpo, doc, consentimiento: true });
        cliente = { id: r.insertId };
      }
      const vence = cuerpo.vence || hoy(new Date(Date.now() + 365 * 864e5));
      const r = await repos.admin.emitir(token, cliente.id, vence);
      if (!r.affectedRows) {
        json(400, { error: 'Esa tarjeta no existe o ya fue emitida' }); return true;
      }
      json(200, { ok: true, clienteId: cliente.id, token, vence });
      return true;
    }

    // ------------------------------------------------------------- tiendas
    case '/api/admin/tiendas':
      json(200, { tiendas: await repos.admin.listarTiendas() });
      return true;

    case '/api/admin/tiendas/crear': {
      if (!String(cuerpo.nombre || '').trim()) { json(400, { error: 'Falta el nombre' }); return true; }
      const r = await repos.admin.crearTienda(cuerpo);
      if (cuerpo.beneficio) {
        await repos.admin.cambiarBeneficio(r.insertId, {
          descripcion: cuerpo.beneficio, condiciones: cuerpo.condiciones,
          tope_diario: cuerpo.topeDiario, monto_minimo: cuerpo.montoMinimo,
          dias_validos: cuerpo.diasValidos
        });
      }
      json(200, { ok: true, id: r.insertId });
      return true;
    }

    case '/api/admin/tiendas/beneficio': {
      if (!String(cuerpo.descripcion || '').trim()) { json(400, { error: 'Falta la descripción' }); return true; }
      await repos.admin.cambiarBeneficio(Number(cuerpo.tiendaId), cuerpo);
      json(200, { ok: true });
      return true;
    }

    case '/api/admin/tiendas/usuario': {
      if (!/^[a-z0-9_-]{3,40}$/.test(String(cuerpo.usuario || ''))) {
        json(400, { error: 'Usuario inválido: solo minúsculas, números, guiones' }); return true;
      }
      if (String(cuerpo.clave || '').length < 8) {
        json(400, { error: 'La clave debe tener al menos 8 caracteres' }); return true;
      }
      try {
        await repos.admin.crearUsuarioCaja(cuerpo, await hashear(cuerpo.clave));
        json(200, { ok: true });
      } catch (e) {
        json(400, { error: e.code === 'ER_DUP_ENTRY' ? 'Ese usuario ya existe' : 'No se pudo crear' });
      }
      return true;
    }
  }

  json(404, { error: 'Ruta no encontrada' });
  return true;
}

module.exports = { manejar };
