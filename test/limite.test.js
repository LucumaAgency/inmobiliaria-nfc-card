const { test } = require('node:test');
const assert = require('node:assert');
const { limitar, limpiar } = require('../lib/limite');

test('permite hasta el maximo y luego bloquea', () => {
  const opciones = { clave: 'prueba-a', maximo: 3, ventanaMs: 60_000 };
  assert.equal(limitar(opciones).permitido, true);
  assert.equal(limitar(opciones).permitido, true);
  assert.equal(limitar(opciones).permitido, true);
  const cuarto = limitar(opciones);
  assert.equal(cuarto.permitido, false);
  assert.ok(cuarto.esperaSegundos > 0);
});

test('la ventana expira y vuelve a permitir', async () => {
  const opciones = { clave: 'prueba-b', maximo: 1, ventanaMs: 40 };
  assert.equal(limitar(opciones).permitido, true);
  assert.equal(limitar(opciones).permitido, false);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(limitar(opciones).permitido, true);
});

test('limpiar reinicia el contador (login exitoso)', () => {
  const opciones = { clave: 'prueba-c', maximo: 2, ventanaMs: 60_000 };
  limitar(opciones); limitar(opciones);
  assert.equal(limitar(opciones).permitido, false);
  limpiar('prueba-c');
  assert.equal(limitar(opciones).permitido, true);
});

test('claves distintas no se interfieren', () => {
  const a = { clave: 'prueba-d1', maximo: 1, ventanaMs: 60_000 };
  const b = { clave: 'prueba-d2', maximo: 1, ventanaMs: 60_000 };
  assert.equal(limitar(a).permitido, true);
  assert.equal(limitar(b).permitido, true);
});
