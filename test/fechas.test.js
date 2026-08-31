const { test } = require('node:test');
const assert = require('node:assert');
const { hoy, diaSemana, rangoDelDia, ZONA } = require('../lib/fechas');

test('la zona por defecto es la de Lima', () => {
  assert.equal(ZONA, 'America/Lima');
});

// El bug que motivó este módulo: a las 20:00 de Lima, toISOString() ya
// devuelve el día siguiente. El tope diario se reiniciaba a las 7 de la
// noche y una tarjeta que vencía hoy se leía como vencida.
test('a las 20:00 de Lima el día todavía es el mismo', () => {
  const nocheEnLima = new Date('2026-08-31T01:00:00Z');   // 30/08 20:00 en Lima
  assert.equal(nocheEnLima.toISOString().slice(0, 10), '2026-08-31');
  assert.equal(hoy(nocheEnLima), '2026-08-30');
});

test('a las 00:30 de Lima ya es el día siguiente', () => {
  assert.equal(hoy(new Date('2026-08-31T05:30:00Z')), '2026-08-31');
});

test('el día de la semana usa 1=lunes y 7=domingo', () => {
  assert.equal(diaSemana(new Date('2026-08-31T15:00:00Z')), '1');  // lunes
  assert.equal(diaSemana(new Date('2026-09-05T15:00:00Z')), '6');  // sábado
  assert.equal(diaSemana(new Date('2026-09-06T15:00:00Z')), '7');  // domingo
});

test('el día de la semana también respeta la zona', () => {
  // 07/09 00:30 UTC es todavía domingo 06/09 a las 19:30 en Lima.
  // Con la hora del servidor en UTC daría lunes y el beneficio de fin de
  // semana dejaría de aplicar a las 7 de la noche del domingo.
  const domingoDeNoche = new Date('2026-09-07T00:30:00Z');
  assert.equal(diaSemana(domingoDeNoche), '7');
  assert.equal(hoy(domingoDeNoche), '2026-09-06');
});

test('el rango del día va de medianoche a medianoche de Lima', () => {
  const { inicio, fin } = rangoDelDia(new Date('2026-08-30T18:00:00Z'));
  assert.equal(inicio.toISOString(), '2026-08-30T05:00:00.000Z');
  assert.equal(fin.toISOString(), '2026-08-31T05:00:00.000Z');
});

test('un canje de las 22:00 cae en el día correcto', () => {
  const canje = new Date('2026-08-31T03:00:00Z');   // 30/08 22:00 en Lima
  const { inicio, fin } = rangoDelDia(canje);
  assert.ok(canje >= inicio && canje < fin);
  assert.equal(hoy(canje), '2026-08-30');
});
