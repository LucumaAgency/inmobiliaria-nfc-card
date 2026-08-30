#!/usr/bin/env node
/**
 * Puente entre el servidor de ProbaCard y el Arduino con el lector RC522.
 *
 * El Arduino no sabe que tokens existen: este script pide el siguiente al
 * servidor, se lo manda a grabar, verifica lo escrito, manda bloquear y
 * recien ahi confirma. Si algo no coincide, no bloquea y se detiene.
 *
 * Uso:
 *   node grabador/puente.js --lote LOTE-2026-01 --puerto /dev/ttyUSB0
 *   node grabador/puente.js --lote LOTE-2026-01 --sin-bloqueo    (pruebas)
 *
 * Variables: URL_SERVIDOR, PC_USUARIO, PC_CLAVE (o se piden por consola).
 */
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const readline = require('readline');

const args = process.argv.slice(2);
const opcion = (nombre, pordefecto) => {
  const i = args.indexOf('--' + nombre);
  return i >= 0 ? args[i + 1] : pordefecto;
};
const bandera = nombre => args.includes('--' + nombre);

const LOTE = opcion('lote');
const PUERTO = opcion('puerto', '/dev/ttyUSB0');
const SERVIDOR = (opcion('servidor', process.env.URL_SERVIDOR) || 'http://localhost:3020').replace(/\/$/, '');
const BLOQUEAR = !bandera('sin-bloqueo');

if (!LOTE) {
  console.error('Falta --lote. Ejemplo:\n  node grabador/puente.js --lote LOTE-2026-01 --puerto /dev/ttyUSB0');
  process.exit(1);
}

// ------------------------------------------------------------------ consola
const preguntar = (texto, oculto = false) => new Promise(resolve => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (oculto) {
    rl.output.write(texto);
    rl.input.on('data', () => readline.moveCursor(rl.output, -100, 0));
  }
  rl.question(oculto ? '' : texto, r => { rl.close(); if (oculto) console.log(); resolve(r.trim()); });
});

// ------------------------------------------------------------------ servidor
let cookie = '';

async function pedir(ruta, opciones = {}) {
  const r = await fetch(SERVIDOR + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }
  });
  const guardada = r.headers.get('set-cookie');
  if (guardada) cookie = guardada.split(';')[0];
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || `HTTP ${r.status}`);
  return datos;
}

async function ingresar() {
  const usuario = process.env.PC_USUARIO || await preguntar('Usuario admin: ');
  const clave = process.env.PC_CLAVE || await preguntar('Clave: ', true);
  const r = await pedir('/api/login', { method: 'POST', body: JSON.stringify({ usuario, clave }) });
  if (r.usuario.rol !== 'admin') throw new Error('Ese usuario no es administrador');
  console.log(`Conectado como ${r.usuario.nombre}\n`);
}

// ------------------------------------------------------------------- arduino
class Arduino {
  constructor(puerto) {
    this.port = new SerialPort({ path: puerto, baudRate: 115200 });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    this.cola = [];
    this.parser.on('data', linea => {
      const l = linea.trim();
      if (!l) return;
      const siguiente = this.cola.shift();
      if (siguiente) siguiente(l);
      else if (l !== 'LISTO') console.log('  (arduino)', l);
    });
  }

  /** Manda un comando y espera una linea de respuesta. */
  enviar(comando, msEspera = 15000) {
    return new Promise((resolve, reject) => {
      const corte = setTimeout(() => {
        this.cola.shift();
        reject(new Error('el Arduino no respondió a tiempo'));
      }, msEspera);
      this.cola.push(respuesta => { clearTimeout(corte); resolve(respuesta); });
      this.port.write(comando + '\n');
    });
  }

  listo() {
    return new Promise(resolve => {
      // El Uno se reinicia al abrir el puerto serial: hay que esperarlo.
      setTimeout(async () => {
        try { resolve(await this.enviar('PING', 4000) === 'LISTO'); }
        catch { resolve(false); }
      }, 2200);
    });
  }

  cerrar() { this.port.close(); }
}

// --------------------------------------------------------------------- ciclo
(async () => {
  console.log(`ProbaCard - grabador RC522`);
  console.log(`Servidor: ${SERVIDOR}   Lote: ${LOTE}   Bloqueo: ${BLOQUEAR ? 'sí' : 'NO (pruebas)'}\n`);

  await ingresar();

  const arduino = new Arduino(PUERTO);
  if (!await arduino.listo()) {
    console.error(`El Arduino en ${PUERTO} no respondió. Revisa el puerto y que el sketch esté cargado.`);
    process.exit(1);
  }
  console.log(`Arduino listo en ${PUERTO}.\n`);

  let hechas = 0;
  let seguir = true;
  process.on('SIGINT', () => { seguir = false; console.log('\nDeteniendo...'); });

  while (seguir) {
    const tarea = await pedir(`/api/admin/grabar/siguiente?lote=${encodeURIComponent(LOTE)}`);
    if (tarea.fin) { console.log('\nLote completo.'); break; }

    process.stdout.write(`${tarea.token}  acerca una tarjeta... `);

    const escrito = await arduino.enviar(`ESCRIBIR ${tarea.url}`);
    if (!escrito.startsWith('OK')) { console.log(`falló (${escrito})`); break; }
    const uid = escrito.split(' ')[1] || null;

    // Verificar SIEMPRE antes de bloquear: el bloqueo es irreversible.
    const leido = await arduino.enviar('LEER');
    if (leido !== `URL ${tarea.url}`) {
      console.log(`\n  Lo grabado no coincide. No se bloqueó.`);
      console.log(`  esperado: ${tarea.url}`);
      console.log(`  leído:    ${leido}`);
      break;
    }

    if (BLOQUEAR) {
      const bloqueo = await arduino.enviar('BLOQUEAR');
      if (bloqueo !== 'OK') { console.log(`falló el bloqueo (${bloqueo})`); break; }
    }

    await pedir('/api/admin/grabar/confirmar', {
      method: 'POST', body: JSON.stringify({ token: tarea.token, uid })
    });

    hechas++;
    console.log(`grabada${uid ? `  uid ${uid}` : ''}   [${hechas}]`);
    console.log('  retira la tarjeta y pon la siguiente');
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`\n${hechas} tarjeta(s) grabada(s).`);
  arduino.cerrar();
  process.exit(0);
})().catch(e => { console.error('\nError:', e.message); process.exit(1); });
