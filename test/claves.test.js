const { test } = require('node:test');
const assert = require('node:assert');
const { hashear, verificar } = require('../lib/claves');

test('la clave correcta verifica', async () => {
  const guardado = await hashear('demo123');
  assert.equal(await verificar('demo123', guardado), true);
});

test('la clave incorrecta no verifica', async () => {
  const guardado = await hashear('demo123');
  assert.equal(await verificar('demo124', guardado), false);
});

test('dos hashes de la misma clave son distintos (sal aleatoria)', async () => {
  assert.notEqual(await hashear('demo123'), await hashear('demo123'));
});

test('un valor guardado invalido no revienta', async () => {
  assert.equal(await verificar('demo123', 'texto-plano'), false);
  assert.equal(await verificar('demo123', ''), false);
  assert.equal(await verificar('demo123', null), false);
});
