/**
 * Guarda de consistencia entre el servidor y la app del cajero.
 * Si alguien agrega un estado nuevo a las reglas y olvida darle color y
 * mensaje en la app, el cajero veria un banner rojo generico. Esta prueba
 * lo detecta antes de que llegue a una caja.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

/** Estados que puede devolver evaluar(). */
function estadosDeLasReglas() {
  const fuente = leer('lib/reglas.js');
  return new Set([...fuente.matchAll(/estado:\s*'([A-Z_]+)'/g)].map(m => m[1]));
}

/** Estados que la app del cajero sabe pintar. */
function estadosDeLaApp() {
  const fuente = leer('public/app.js');
  const bloque = fuente.slice(fuente.indexOf('const ESTADOS = {'), fuente.indexOf('function mostrarResultado'));
  return new Set([...bloque.matchAll(/^\s{2}([A-Z_]+):/gm)].map(m => m[1]));
}

test('la app del cajero cubre todos los estados de las reglas', () => {
  const reglas = estadosDeLasReglas();
  const app = estadosDeLaApp();
  const faltantes = [...reglas].filter(e => !app.has(e));
  assert.deepEqual(faltantes, [],
    `Sin color ni mensaje en public/app.js: ${faltantes.join(', ')}`);
});

test('la app no define estados que las reglas ya no devuelven', () => {
  const reglas = estadosDeLasReglas();
  const app = estadosDeLaApp();
  const sobrantes = [...app].filter(e => !reglas.has(e));
  assert.deepEqual(sobrantes, [],
    `Estados muertos en public/app.js: ${sobrantes.join(', ')}`);
});

test('las reglas devuelven los estados esperados', () => {
  assert.deepEqual([...estadosDeLasReglas()].sort(), [
    'BLOQUEADA', 'DIA_NO_VALIDO', 'NO_EXISTE', 'SIN_ACTIVAR',
    'SIN_BENEFICIO', 'SUSPENDIDA', 'TOPE', 'VALIDO', 'VENCIDA'
  ]);
});
