#!/usr/bin/env node
/**
 * Pasa los datos de data/seed.json (o data/db.json) a MySQL.
 * Uso: node scripts/importar-json.js [archivo]
 *
 * Sirve para no perder las tiendas y tarjetas de prueba al cambiar de motor.
 * Es idempotente: se puede correr de nuevo sin duplicar.
 */
require('../lib/entorno').cargar();
const fs = require('fs');
const path = require('path');
const { consultar, una, enTransaccion, cerrar } = require('../lib/db');
const { hashear } = require('../lib/claves');

const archivo = process.argv[2] || path.join(__dirname, '..', 'data', 'seed.json');
const { hoy } = require('../lib/fechas');
const HOY = hoy();

(async () => {
  const datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  console.log(`Importando desde ${path.basename(archivo)}\n`);

  const idTienda = {};   // 'T-001' -> id numerico
  const idCliente = {};  // 'C-001' -> id numerico
  const idUsuario = {};
  const idBeneficio = {};

  await enTransaccion(async () => {
    for (const t of datos.tiendas || []) {
      let fila = await una('SELECT id FROM tiendas WHERE nombre = ?', [t.nombre]);
      if (!fila) {
        const r = await consultar(
          'INSERT INTO tiendas (nombre, rubro, estado) VALUES (?, ?, ?)',
          [t.nombre, t.rubro || null, 'activa']
        );
        fila = { id: r.insertId };
        console.log(`  tienda    ${t.nombre}`);
      }
      idTienda[t.id] = fila.id;

      let ben = await una(
        'SELECT id FROM beneficios WHERE tienda_id = ? AND vigente_hasta IS NULL',
        [fila.id]
      );
      if (!ben) {
        const r = await consultar(
          `INSERT INTO beneficios (tienda_id, descripcion, condiciones, tope_diario, vigente_desde)
           VALUES (?, ?, ?, ?, ?)`,
          [fila.id, t.beneficio, t.condiciones || null, t.topeDiario || 1, HOY]
        );
        ben = { id: r.insertId };
      }
      idBeneficio[t.id] = ben.id;
    }

    for (const c of datos.clientes || []) {
      let fila = await una('SELECT id FROM clientes WHERE doc = ?', [c.doc]);
      if (!fila) {
        const r = await consultar(
          `INSERT INTO clientes (nombre, doc, celular, foto, consentimiento_en)
           VALUES (?, ?, ?, ?, NOW())`,
          [c.nombre, c.doc, c.celular || null, c.foto || null]
        );
        fila = { id: r.insertId };
        console.log(`  cliente   ${c.nombre}`);
      }
      idCliente[c.id] = fila.id;

      // En el JSON el estado y el vencimiento colgaban del cliente.
      // En MySQL pertenecen a la tarjeta, que es lo correcto.
      const existe = await una('SELECT id FROM tarjetas WHERE token = ?', [c.token]);
      if (!existe) {
        const estado = c.vence < HOY ? 'vencida' : (c.estado || 'activa');
        await consultar(
          `INSERT INTO tarjetas (token, lote, cliente_id, estado, vence, emitida_en)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [c.token, 'IMPORTADO', fila.id, estado, c.vence || null]
        );
        console.log(`  tarjeta   ${c.token} (${estado})`);
      }
    }

    for (const u of datos.usuarios || []) {
      let fila = await una('SELECT id FROM usuarios WHERE usuario = ?', [u.usuario]);
      if (!fila) {
        // Las claves del JSON estaban en texto plano. Aqui se hashean.
        const hash = await hashear(u.clave);
        const r = await consultar(
          'INSERT INTO usuarios (usuario, clave_hash, rol, tienda_id, nombre) VALUES (?, ?, ?, ?, ?)',
          [u.usuario, hash, 'caja', idTienda[u.tiendaId], u.nombre]
        );
        fila = { id: r.insertId };
        console.log(`  usuario   ${u.usuario}`);
      }
      idUsuario[u.usuario] = fila.id;
    }

    for (const k of datos.canjes || []) {
      if (k.idLocal && await una('SELECT id FROM canjes WHERE id_local = ?', [k.idLocal])) continue;
      const tarjeta = await una(
        'SELECT id FROM tarjetas WHERE cliente_id = ? ORDER BY id DESC LIMIT 1',
        [idCliente[k.clienteId]]
      );
      if (!tarjeta) continue;
      await consultar(
        `INSERT INTO canjes (id_local, cliente_id, tarjeta_id, tienda_id, beneficio_id,
                             usuario_id, monto, fecha, offline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [k.idLocal || null, idCliente[k.clienteId], tarjeta.id, idTienda[k.tiendaId],
         idBeneficio[k.tiendaId], idUsuario[k.usuario], k.monto || 0,
         new Date(k.fecha), !!k.offline]
      );
    }
  });

  const resumen = await consultar(`
    SELECT 'tiendas' t, COUNT(*) n FROM tiendas
    UNION ALL SELECT 'beneficios', COUNT(*) FROM beneficios
    UNION ALL SELECT 'clientes', COUNT(*) FROM clientes
    UNION ALL SELECT 'tarjetas', COUNT(*) FROM tarjetas
    UNION ALL SELECT 'usuarios', COUNT(*) FROM usuarios
    UNION ALL SELECT 'canjes', COUNT(*) FROM canjes
  `);
  console.log('\nEstado de la base:');
  for (const f of resumen) console.log(`  ${String(f.t).padEnd(12)} ${f.n}`);

  await cerrar();
})().catch(async e => {
  console.error('\nError en la importacion:', e.message);
  await cerrar();
  process.exit(1);
});
