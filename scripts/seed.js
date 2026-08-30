/**
 * Copia la semilla a la base de trabajo. Ejecutar: npm run seed
 * data/db.json esta fuera del repositorio; data/seed.json es la version versionada.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'data');
fs.copyFileSync(path.join(dir, 'seed.json'), path.join(dir, 'db.json'));
console.log('Base de trabajo creada en data/db.json a partir de la semilla.');
