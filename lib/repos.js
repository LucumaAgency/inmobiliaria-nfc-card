/**
 * Acceso a datos. Todas las consultas del sistema viven aqui, parametrizadas.
 * El servidor no arma SQL por su cuenta.
 */
const { consultar, una } = require('./db');

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

module.exports = { usuarios, tiendas, tarjetas, canjes, validaciones };
