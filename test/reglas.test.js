const { test } = require('node:test');
const assert = require('node:assert');
const { evaluar, cumpleMontoMinimo, diaSemana } = require('../lib/reglas');

const beneficio = { tope_diario: 1, monto_minimo: 0, dias_validos: '1234567' };
const vigente = { id: 1, estado: 'activa', vence: '2099-01-01', cliente_id: 7 };

test('tarjeta vigente sin canjes previos es válida', () => {
  assert.equal(evaluar(vigente, beneficio, 0).estado, 'VALIDO');
});

test('tarjeta inexistente', () => {
  assert.equal(evaluar(null, beneficio, 0).estado, 'NO_EXISTE');
});

test('tarjeta en blanco todavía no sirve para canjear', () => {
  assert.equal(evaluar({ ...vigente, estado: 'en_blanco' }, beneficio, 0).estado, 'SIN_ACTIVAR');
});

test('tarjeta suspendida', () => {
  assert.equal(evaluar({ ...vigente, estado: 'suspendida' }, beneficio, 0).estado, 'SUSPENDIDA');
});

test('tarjeta reportada como perdida', () => {
  assert.equal(evaluar({ ...vigente, estado: 'perdida' }, beneficio, 0).estado, 'BLOQUEADA');
});

test('tarjeta vencida por fecha aunque el estado diga activa', () => {
  const r = evaluar({ ...vigente, vence: '2020-01-01' }, beneficio, 0);
  assert.equal(r.estado, 'VENCIDA');
  assert.match(r.motivo, /2020-01-01/);
});

test('tienda sin beneficio vigente', () => {
  assert.equal(evaluar(vigente, null, 0).estado, 'SIN_BENEFICIO');
});

test('tope diario alcanzado', () => {
  assert.equal(evaluar(vigente, beneficio, 1).estado, 'TOPE');
});

test('tope de 2 usos permite el segundo canje', () => {
  assert.equal(evaluar(vigente, { ...beneficio, tope_diario: 2 }, 1).estado, 'VALIDO');
});

test('el beneficio no aplica en un día excluido', () => {
  const lunes = new Date('2026-08-31T15:00:00Z');          // 31/08/2026 es lunes
  assert.equal(diaSemana(lunes), '1');
  const soloFinDeSemana = { ...beneficio, dias_validos: '67' };
  assert.equal(evaluar(vigente, soloFinDeSemana, 0, lunes).estado, 'DIA_NO_VALIDO');
});

test('el beneficio sí aplica en un día permitido', () => {
  const sabado = new Date('2026-09-05T15:00:00Z');          // 05/09/2026 es sábado
  assert.equal(diaSemana(sabado), '6');
  assert.equal(evaluar(vigente, { ...beneficio, dias_validos: '67' }, 0, sabado).estado, 'VALIDO');
});

test('el domingo se representa como 7, no como 0', () => {
  assert.equal(diaSemana(new Date('2026-09-06T15:00:00Z')), '7');
});

test('monto mínimo: rechaza por debajo y acepta igual o encima', () => {
  const con = { ...beneficio, monto_minimo: 50 };
  assert.equal(cumpleMontoMinimo(con, 49.99).ok, false);
  assert.equal(cumpleMontoMinimo(con, 50).ok, true);
  assert.equal(cumpleMontoMinimo(beneficio, 0).ok, true);
});
