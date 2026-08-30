const { test } = require('node:test');
const assert = require('node:assert');
const { generar, generarLote, valido, ALFABETO, LARGO } = require('../lib/tokens');

test('el token tiene el largo esperado y usa el alfabeto', () => {
  const t = generar();
  assert.equal(t.length, LARGO);
  assert.ok(valido(t));
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

test('valido rechaza formatos incorrectos', () => {
  assert.equal(valido('abc'), false);
  assert.equal(valido('ABC0DE'), false);   // contiene 0
  assert.equal(valido(''), false);
});
