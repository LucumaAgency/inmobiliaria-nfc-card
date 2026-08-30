/**
 * Acceso a datos. Todas las consultas del sistema viven aqui, parametrizadas.
 * El servidor no arma SQL por su cuenta.
 */
const { consultar, una, enTransaccion } = require('./db');

// ------------------------------------------------------------------ usuarios
const usuarios = {
  porNombre: (usuario) => una(
    `SELECT u.*, t.nombre AS tienda_nombre
       FROM usuarios u LEFT JOIN tiendas t ON t.id = u.tienda_id
      WHERE u.usuario = ? AND u.activo = TRUE`, [usuario]),

  marcarAcceso: (id) => consultar('UPDATE usuarios SET ultimo_acceso = NOW() WHERE id = ?', [id])
};

// ------------------------------------------------------------------- tiendas
const tiendas = {
  /** Tienda con su beneficio vigente incorporado, que es como la usa la app. */
  conBeneficio: (id) => una(
    `SELECT t.id, t.nombre, t.rubro, t.estado,
            b.id AS beneficio_id, b.descripcion AS beneficio, b.condiciones,
            b.tope_diario, b.monto_minimo, b.dias_validos
       FROM tiendas t
       LEFT JOIN beneficios b
              ON b.tienda_id = t.id
             AND b.vigente_desde <= CURDATE()
             AND (b.vigente_hasta IS NULL OR b.vigente_hasta >= CURDATE())
      WHERE t.id = ?
      ORDER BY b.vigente_desde DESC
      LIMIT 1`, [id]),

  directorio: () => consultar(
    `SELECT t.id, t.nombre, t.rubro, t.direccion, t.distrito, t.lat, t.lng,
            b.descripcion AS beneficio, b.condiciones
       FROM tiendas t
       LEFT JOIN beneficios b
              ON b.tienda_id = t.id AND (b.vigente_hasta IS NULL OR b.vigente_hasta >= CURDATE())
      WHERE t.estado = 'activa'
      ORDER BY t.rubro, t.nombre`)
};

// ------------------------------------------------------------------ tarjetas
const CAMPOS_TARJETA = `
  t.id, t.token, t.estado, t.vence, t.cliente_id,
  c.nombre, c.doc, c.celular, c.foto`;

const tarjetas = {
  porToken: (token) => una(
    `SELECT ${CAMPOS_TARJETA}
       FROM tarjetas t LEFT JOIN clientes c ON c.id = t.cliente_id
      WHERE t.token = ?`, [token]),

  /** Respaldo cuando el cliente olvido la tarjeta. Solo tarjetas emitidas. */
  buscarPorDocOCelular: (q) => consultar(
    `SELECT ${CAMPOS_TARJETA}
       FROM tarjetas t JOIN clientes c ON c.id = t.cliente_id
      WHERE (c.doc LIKE ? OR c.celular LIKE ?)
        AND t.estado IN ('activa','vencida','suspendida')
      ORDER BY t.emitida_en DESC
      LIMIT 10`, [`%${q}%`, `%${q}%`]),

  /** Padron que la app se lleva para trabajar sin conexion. */
  padron: () => consultar(
    `SELECT t.token, t.estado, t.vence, t.cliente_id AS id, c.nombre, c.doc, c.foto
       FROM tarjetas t JOIN clientes c ON c.id = t.cliente_id
      WHERE t.estado IN ('activa','suspendida','vencida')`),

  marcarPerdida: (token) => consultar(
    `UPDATE tarjetas SET estado = 'perdida' WHERE token = ? AND estado = 'activa'`, [token])
};

// -------------------------------------------------------------------- canjes
const canjes = {
  usosHoy: async (tarjetaId, tiendaId) => {
    const f = await una(
      `SELECT COUNT(*) AS n FROM canjes
        WHERE tarjeta_id = ? AND tienda_id = ? AND DATE(fecha) = CURDATE()`,
      [tarjetaId, tiendaId]);
    return Number(f.n);
  },

  existeLocal: (idLocal) => una('SELECT id FROM canjes WHERE id_local = ?', [idLocal]),

  registrar: (c) => consultar(
    `INSERT INTO canjes (id_local, cliente_id, tarjeta_id, tienda_id, beneficio_id,
                         usuario_id, monto, fecha, offline)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.idLocal || null, c.clienteId, c.tarjetaId, c.tiendaId, c.beneficioId,
     c.usuarioId, c.monto, c.fecha, c.offline ? 1 : 0]),

  ultimosDeTienda: (tiendaId, limite = 50) => consultar(
    `SELECT k.id, k.monto, k.fecha, k.offline, c.nombre AS cliente, b.descripcion AS beneficio
       FROM canjes k
       JOIN clientes c ON c.id = k.cliente_id
       JOIN beneficios b ON b.id = k.beneficio_id
      WHERE k.tienda_id = ?
      ORDER BY k.fecha DESC
      LIMIT ${Number(limite) | 0}`, [tiendaId]),

  ahorroDeCliente: (clienteId) => una(
    `SELECT COUNT(*) AS visitas, COALESCE(SUM(monto), 0) AS consumo
       FROM canjes WHERE cliente_id = ?`, [clienteId])
};

// -------------------------------------------------------------- validaciones
const validaciones = {
  /**
   * Se registra TODA consulta, termine o no en canje.
   * El ratio validaciones/canjes es el termometro de salud del programa.
   */
  registrar: (v) => consultar(
    `INSERT INTO validaciones (token, tienda_id, usuario_id, resultado, offline)
     VALUES (?, ?, ?, ?, ?)`,
    [v.token || null, v.tiendaId || null, v.usuarioId || null, v.resultado, v.offline ? 1 : 0])
};


// ------------------------------------------------------------------- panel
const admin = {
  // --- lotes
  crearLote: (codigo, cantidad, nota, usuarioId) => consultar(
    'INSERT INTO lotes (codigo, cantidad, nota, creado_por) VALUES (?, ?, ?, ?)',
    [codigo, cantidad, nota || null, usuarioId]),

  lotes: () => consultar(
    `SELECT l.codigo, l.cantidad, l.nota, l.creado_en,
            SUM(t.grabada_en IS NOT NULL) AS grabadas,
            SUM(t.cliente_id IS NOT NULL) AS emitidas
       FROM lotes l LEFT JOIN tarjetas t ON t.lote = l.codigo
      GROUP BY l.id ORDER BY l.creado_en DESC`),

  insertarTarjetas: (tokens, lote) => consultar(
    `INSERT INTO tarjetas (token, lote, estado) VALUES ${tokens.map(() => '(?, ?, \'en_blanco\')').join(', ')}`,
    tokens.flatMap(t => [t, lote])),

  // --- grabado
  siguientePorGrabar: (lote) => una(
    `SELECT token FROM tarjetas
      WHERE lote = ? AND grabada_en IS NULL
      ORDER BY id LIMIT 1`, [lote]),

  marcarGrabada: (token, uidChip) => consultar(
    'UPDATE tarjetas SET grabada_en = NOW(), uid_chip = ? WHERE token = ?', [uidChip || null, token]),

  // --- tarjetas
  listarTarjetas: ({ estado, lote, q, limite = 100 }) => {
    const donde = [], params = [];
    if (estado) { donde.push('t.estado = ?'); params.push(estado); }
    if (lote)   { donde.push('t.lote = ?');   params.push(lote); }
    if (q)      { donde.push('(t.token LIKE ? OR c.nombre LIKE ? OR c.doc LIKE ?)');
                  params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    return consultar(
      `SELECT t.token, t.estado, t.lote, t.vence, t.emitida_en, t.grabada_en,
              c.id AS cliente_id, c.nombre, c.doc
         FROM tarjetas t LEFT JOIN clientes c ON c.id = t.cliente_id
         ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''}
        ORDER BY t.id DESC LIMIT ${Number(limite) | 0}`, params);
  },

  cambiarEstadoTarjeta: (token, estado) => consultar(
    'UPDATE tarjetas SET estado = ? WHERE token = ?', [estado, token]),

  /** Emitir: liga una tarjeta en blanco a un cliente. */
  emitir: (token, clienteId, vence) => consultar(
    `UPDATE tarjetas SET cliente_id = ?, estado = 'activa', vence = ?, emitida_en = NOW()
      WHERE token = ? AND estado = 'en_blanco'`, [clienteId, vence, token]),

  /** Reponer: bloquea la anterior y liga una nueva al mismo cliente. */
  reponer: (tokenViejo, tokenNuevo, motivo) => enTransaccion(async (cx) => {
    const [[vieja]] = await cx.execute('SELECT id, cliente_id, vence FROM tarjetas WHERE token = ?', [tokenViejo]);
    if (!vieja || !vieja.cliente_id) throw new Error('La tarjeta anterior no existe o no está emitida');
    const [[nueva]] = await cx.execute("SELECT id FROM tarjetas WHERE token = ? AND estado = 'en_blanco'", [tokenNuevo]);
    if (!nueva) throw new Error('La tarjeta nueva no existe o ya fue emitida');
    await cx.execute("UPDATE tarjetas SET estado = ? WHERE id = ?", [motivo === 'perdida' ? 'perdida' : 'suspendida', vieja.id]);
    await cx.execute(
      `UPDATE tarjetas SET cliente_id = ?, estado = 'activa', vence = ?, emitida_en = NOW(), reemplaza_a = ?
        WHERE id = ?`, [vieja.cliente_id, vieja.vence, vieja.id, nueva.id]);
    return { clienteId: vieja.cliente_id };
  }),

  // --- clientes
  crearCliente: (c) => consultar(
    `INSERT INTO clientes (nombre, doc, celular, correo, foto, consentimiento_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [c.nombre, c.doc, c.celular || null, c.correo || null, c.foto || null,
     c.consentimiento ? new Date() : null]),

  clientePorDoc: (doc) => una('SELECT * FROM clientes WHERE doc = ?', [doc]),

  listarClientes: (q, limite = 100) => consultar(
    `SELECT c.id, c.nombre, c.doc, c.celular, c.correo, c.creado_en,
            (SELECT COUNT(*) FROM canjes k WHERE k.cliente_id = c.id) AS canjes,
            (SELECT t.token FROM tarjetas t WHERE t.cliente_id = c.id AND t.estado = 'activa' LIMIT 1) AS token
       FROM clientes c
      ${q ? 'WHERE c.nombre LIKE ? OR c.doc LIKE ? OR c.celular LIKE ?' : ''}
      ORDER BY c.id DESC LIMIT ${Number(limite) | 0}`,
    q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []),

  // --- tiendas
  crearTienda: (t) => consultar(
    `INSERT INTO tiendas (nombre, rubro, direccion, distrito) VALUES (?, ?, ?, ?)`,
    [t.nombre, t.rubro || null, t.direccion || null, t.distrito || null]),

  listarTiendas: () => consultar(
    `SELECT t.*, b.descripcion AS beneficio, b.tope_diario, b.monto_minimo, b.dias_validos,
            (SELECT COUNT(*) FROM canjes k WHERE k.tienda_id = t.id) AS canjes
       FROM tiendas t
       LEFT JOIN beneficios b ON b.tienda_id = t.id AND b.vigente_hasta IS NULL
      ORDER BY t.nombre`),

  /** Cambiar el beneficio cierra el anterior en vez de pisarlo. */
  cambiarBeneficio: (tiendaId, b) => enTransaccion(async (cx) => {
    await cx.execute(
      'UPDATE beneficios SET vigente_hasta = CURDATE() WHERE tienda_id = ? AND vigente_hasta IS NULL',
      [tiendaId]);
    await cx.execute(
      `INSERT INTO beneficios (tienda_id, descripcion, condiciones, tope_diario, monto_minimo, dias_validos, vigente_desde)
       VALUES (?, ?, ?, ?, ?, ?, CURDATE())`,
      [tiendaId, b.descripcion, b.condiciones || null, b.tope_diario || 1,
       b.monto_minimo || 0, b.dias_validos || '1234567']);
  }),

  crearUsuarioCaja: (u, hash) => consultar(
    'INSERT INTO usuarios (usuario, clave_hash, rol, tienda_id, nombre) VALUES (?, ?, ?, ?, ?)',
    [u.usuario, hash, 'caja', u.tiendaId, u.nombre]),

  // --- reportes
  resumen: () => una(`
    SELECT
      (SELECT COUNT(*) FROM tarjetas WHERE estado <> 'en_blanco')            AS tarjetas_emitidas,
      (SELECT COUNT(*) FROM tarjetas WHERE estado = 'en_blanco')             AS tarjetas_en_blanco,
      (SELECT COUNT(*) FROM clientes)                                        AS clientes,
      (SELECT COUNT(*) FROM tiendas WHERE estado = 'activa')                 AS tiendas,
      (SELECT COUNT(*) FROM canjes)                                          AS canjes,
      (SELECT COALESCE(SUM(monto),0) FROM canjes)                            AS consumo,
      (SELECT COUNT(*) FROM canjes WHERE MONTH(fecha)=MONTH(CURDATE()) AND YEAR(fecha)=YEAR(CURDATE())) AS canjes_mes`),

  /** Ratio validaciones/canjes: el termometro de salud del programa. */
  porTienda: () => consultar(`
    SELECT t.id, t.nombre, t.rubro,
           (SELECT COUNT(*) FROM canjes k WHERE k.tienda_id = t.id)              AS canjes,
           (SELECT COALESCE(SUM(k.monto),0) FROM canjes k WHERE k.tienda_id = t.id) AS consumo,
           (SELECT COUNT(*) FROM validaciones v WHERE v.tienda_id = t.id)        AS validaciones,
           (SELECT COUNT(DISTINCT k.cliente_id) FROM canjes k WHERE k.tienda_id = t.id) AS clientes
      FROM tiendas t WHERE t.estado = 'activa' ORDER BY canjes DESC`),

  canjesPorDia: (dias = 30) => consultar(
    `SELECT DATE(fecha) AS dia, COUNT(*) AS canjes, COALESCE(SUM(monto),0) AS consumo
       FROM canjes WHERE fecha >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY DATE(fecha) ORDER BY dia`, [dias]),

  ultimosCanjes: (limite = 20) => consultar(
    `SELECT k.fecha, k.monto, k.offline, c.nombre AS cliente, t.nombre AS tienda
       FROM canjes k JOIN clientes c ON c.id = k.cliente_id JOIN tiendas t ON t.id = k.tienda_id
      ORDER BY k.fecha DESC LIMIT ${Number(limite) | 0}`)
};

module.exports = { usuarios, tiendas, tarjetas, canjes, validaciones, admin };
