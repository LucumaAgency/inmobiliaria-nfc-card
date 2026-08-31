/**
 * Fechas en la zona horaria del programa.
 *
 * Nunca usar `toISOString().slice(0,10)` para "hoy": eso da la fecha UTC y en
 * Peru (UTC-5) adelanta el dia desde las 19:00. El tope diario se reiniciaria
 * a las 7 de la noche y una tarjeta que vence hoy se leeria como vencida.
 *
 * Tampoco basta la hora local del servidor: el Plesk puede estar en UTC.
 * Por eso la zona es explicita y configurable.
 */
const ZONA = process.env.ZONA_HORARIA || 'America/Lima';

const formatoFecha = new Intl.DateTimeFormat('en-CA', {   // en-CA da YYYY-MM-DD
  timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit'
});

const formatoDia = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, weekday: 'short' });

const DIAS = { Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6', Sun: '7' };

/** 'YYYY-MM-DD' del dia en curso segun la zona del programa. */
function hoy(fecha = new Date()) {
  return formatoFecha.format(fecha);
}

/** Dia de la semana en el formato de beneficios.dias_validos: 1=lunes ... 7=domingo. */
function diaSemana(fecha = new Date()) {
  return DIAS[formatoDia.format(fecha)];
}

/** Desfase de la zona respecto de UTC, en milisegundos, en ese instante. */
function desfase(fecha) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: ZONA, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(fecha).map(p => [p.type, p.value]));

  const comoSiFueraUTC = Date.UTC(
    Number(partes.year), Number(partes.month) - 1, Number(partes.day),
    Number(partes.hour) % 24, Number(partes.minute), Number(partes.second));

  return comoSiFueraUTC - fecha.getTime();
}

/**
 * Instantes UTC en que empieza y termina el dia local.
 * Se usa para contar los canjes del dia sin depender de la zona de MySQL.
 */
function rangoDelDia(fecha = new Date()) {
  const [a, m, d] = hoy(fecha).split('-').map(Number);
  const medianocheComoUTC = Date.UTC(a, m - 1, d);
  // Se ajusta dos veces por si el desfase cambia justo en el borde del dia.
  let inicio = medianocheComoUTC - desfase(new Date(medianocheComoUTC));
  inicio = medianocheComoUTC - desfase(new Date(inicio));
  return { inicio: new Date(inicio), fin: new Date(inicio + 864e5) };
}

module.exports = { ZONA, hoy, diaSemana, rangoDelDia };
