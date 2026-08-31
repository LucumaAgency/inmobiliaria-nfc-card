const { test } = require('node:test');
const assert = require('node:assert');
const { generar, generarLote, formatoValido, delGenerador, ALFABETO, LARGO } = require('../lib/tokens');

test('el token tiene el largo esperado y usa el alfabeto', () => {
  const t = generar();
  assert.equal(t.length, LARGO);
  assert.ok(delGenerador(t));
  assert.ok(formatoValido(t));
});

test('el alfabeto excluye caracteres que se confunden al dictar', () => {
  for (const c of ['O', '0', 'I', '1', 'S', '5', 'B', '8']) {
    assert.ok(!ALFABETO.includes(c), `${c} no debería estar en el alfabeto`);
  }
});

test('un lote no repite codigos', () => {
  const lote = generarLote(500);
  assert.equal(lote.length, 500);
  assert.equal(new Set(lote).size, 500);
});

test('los codigos no son correlativos', () => {
  const lote = generarLote(20);
  const ordenado = [...lote].sort();
  assert.notDeepEqual(lote, ordenado);
});

test('delGenerador exige el alfabeto propio', () => {
  assert.equal(delGenerador('ACDEFG'), true);
  assert.equal(delGenerador('ABC0DE'), false);   // contiene 0
  assert.equal(delGenerador('abcdef'), false);
});

test('formatoValido acepta tokens de otros lotes pero rechaza basura', () => {
  // Los codigos importados o de lotes viejos pueden traer B, 1, O, S.
  assert.equal(formatoValido('AB12XY'), true);
  assert.equal(formatoValido('ACDEFG'), true);
  assert.equal(formatoValido('abc'), false);
  assert.equal(formatoValido('AB1'), false);           // muy corto
  assert.equal(formatoValido('AB12XY-DROP'), false);
  assert.equal(formatoValido(''), false);
  assert.equal(formatoValido(null), false);
});
