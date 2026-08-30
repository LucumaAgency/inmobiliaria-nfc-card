/**
 * Conexion a MySQL. Pool compartido por toda la aplicacion.
 * Passenger levanta y baja procesos: el pool debe ser chico y con limite de cola.
 */
const mysql = require('mysql2/promise');

let pool;

function obtenerPool() {
  if (pool) return pool;
  const faltantes = ['DB_HOST', 'DB_USER', 'DB_NAME'].filter(k => !process.env[k]);
  if (faltantes.length) {
    throw new Error(`Faltan variables de entorno de la base de datos: ${faltantes.join(', ')}`);
  }
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 8,
    queueLimit: 30,
    timezone: 'Z',
    dateStrings: ['DATE']   // 'vence' se compara como texto: evita sorpresas de zona horaria
  });
  return pool;
}

/** Consulta parametrizada. Nunca concatenar valores en el SQL. */
async function consultar(sql, params = []) {
  const [filas] = await obtenerPool().execute(sql, params);
  return filas;
}

/** Primera fila o null. */
async function una(sql, params = []) {
  const filas = await consultar(sql, params);
  return filas[0] || null;
}

/** Ejecuta fn dentro de una transaccion y hace rollback si algo falla. */
async function enTransaccion(fn) {
  const conexion = await obtenerPool().getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await fn(conexion);
    await conexion.commit();
    return resultado;
  } catch (e) {
    await conexion.rollback();
    throw e;
  } finally {
    conexion.release();
  }
}

async function cerrar() {
  if (pool) { await pool.end(); pool = undefined; }
}

module.exports = { obtenerPool, consultar, una, enTransaccion, cerrar };
