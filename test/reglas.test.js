const { test } = require('node:test');
const assert = require('node:assert');
const { evaluar, hoy } = require('../lib/reglas');

const tienda = { id: 'T-001', topeDiario: 1 };
const vigente = { id: 'C-001', estado: 'activa', vence: '2099-01-01' };

test('tarjeta vigente sin canjes previos es válida', () => {
  assert.equal(evaluar(vigente, tienda, []).estado, 'VALIDO');
});

test('tarjeta inexistente', () => {
  assert.equal(evaluar(null, tienda, []).estado, 'NO_EXISTE');
});

test('tarjeta suspendida', () => {
  assert.equal(evaluar({ ...vigente, estado: 'suspendida' }, tienda, []).estado, 'SUSPENDIDA');
});

test('tarjeta reportada como perdida', () => {
  assert.equal(evaluar({ ...vigente, estado: 'perdida' }, tienda, []).estado, 'BLOQUEADA');
});

test('tarjeta vencida', () => {
  const r = evaluar({ ...vigente, vence: '2020-01-01' }, tienda, []);
  assert.equal(r.estado, 'VENCIDA');
  assert.match(r.motivo, /2020-01-01/);
});

test('tope diario alcanzado en esa tienda', () => {
  const canjes = [{ clienteId: 'C-001', tiendaId: 'T-001', fecha: `${hoy()}T10:00:00.000Z` }];
  assert.equal(evaluar(vigente, tienda, canjes).estado, 'TOPE');
});

test('el tope es por tienda, no global', () => {
  const canjes = [{ clienteId: 'C-001', tiendaId: 'T-002', fecha: `${hoy()}T10:00:00.000Z` }];
  assert.equal(evaluar(vigente, tienda, canjes).estado, 'VALIDO');
});

test('un canje de ayer no cuenta para el tope de hoy', () => {
  const canjes = [{ clienteId: 'C-001', tiendaId: 'T-001', fecha: '2020-05-05T10:00:00.000Z' }];
  assert.equal(evaluar(vigente, tienda, canjes).estado, 'VALIDO');
});

test('tope de 2 usos permite el segundo canje', () => {
  const t2 = { id: 'T-001', topeDiario: 2 };
  const canjes = [{ clienteId: 'C-001', tiendaId: 'T-001', fecha: `${hoy()}T10:00:00.000Z` }];
  assert.equal(evaluar(vigente, t2, canjes).estado, 'VALIDO');
});
