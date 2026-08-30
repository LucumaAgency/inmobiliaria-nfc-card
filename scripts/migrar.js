#!/usr/bin/env node
/**
 * Aplica los archivos de migrations/ que aun no se hayan corrido.
 * Uso: npm run migrate
 *
 * Lleva registro en la tabla `migraciones`, asi que es seguro correrlo
 * varias veces: solo aplica lo que falta.
 */
require('../lib/entorno').cargar();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DIR = path.join(__dirname, '..', 'migrations');

/** Parte el archivo en sentencias respetando los ; dentro de comillas. */
function sentencias(sql) {
  const fuera = sql.replace(/^\s*--.*$/gm, '');
  return fuera.split(';').map(s => s.trim()).filter(Boolean);
}

(async () => {
  const conexion = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME,
    multipleStatements: false
  });

  await conexion.query(`CREATE TABLE IF NOT EXISTS migraciones (
    archivo VARCHAR(80) PRIMARY KEY,
    aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [aplicadas] = await conexion.query('SELECT archivo FROM migraciones');
  const yaEstan = new Set(aplicadas.map(f => f.archivo));

  const archivos = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  let corridas = 0;

  for (const archivo of archivos) {
    if (yaEstan.has(archivo)) {
      console.log(`  ya aplicada  ${archivo}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(DIR, archivo), 'utf8');
    process.stdout.write(`  aplicando    ${archivo} ... `);
    try {
      for (const sentencia of sentencias(sql)) await conexion.query(sentencia);
      await conexion.query('INSERT INTO migraciones (archivo) VALUES (?)', [archivo]);
      console.log('listo');
      corridas++;
    } catch (e) {
      console.log('ERROR');
      console.error(`\n${archivo}: ${e.message}\n`);
      await conexion.end();
      process.exit(1);
    }
  }

  console.log(corridas ? `\n${corridas} migracion(es) aplicada(s).` : '\nLa base ya estaba al dia.');
  await conexion.end();
})();
