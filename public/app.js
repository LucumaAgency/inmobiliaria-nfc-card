/**
 * ProbaCard - app del cajero.
 * Reglas de diseño:
 *  - Nunca depender de Web NFC: es una mejora en Android, no existe en iOS.
 *  - Todo canje se guarda primero en IndexedDB y luego se sube. Si no hay red,
 *    queda en cola y se reintenta al volver la conexión.
 */
const $ = s => document.querySelector(s);
const API = {
  login:   d => pedir('/api/login', { method: 'POST', body: JSON.stringify(d) }),
  logout:  () => pedir('/api/logout', { method: 'POST' }),
  sesion:  () => pedir('/api/sesion'),
  sync:    () => pedir('/api/sync'),
  validar: t => pedir('/api/validar/' + encodeURIComponent(t)),
  buscar:  q => pedir('/api/buscar?q=' + encodeURIComponent(q)),
  canjes:  () => pedir('/api/canjes'),
  enviar:  canjes => pedir('/api/canje', { method: 'POST', body: JSON.stringify({ canjes }) })
};
async function pedir(url, opt = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opt });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || 'Error'), { status: r.status, datos });
  return datos;
}

let tienda = null;
let clienteActual = null;

// --- IndexedDB: padrón offline + cola de canjes --------------------------
let bd;
function abrirBD() {
  return new Promise((ok, mal) => {
    const req = indexedDB.open('probacard', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('padron')) d.createObjectStore('padron', { keyPath: 'token' });
      if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'idLocal' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'clave' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => mal(req.error);
  });
}
function tx(almacen, modo = 'readonly') { return bd.transaction(almacen, modo).objectStore(almacen); }
function comoPromesa(req) { return new Promise((ok, mal) => { req.onsuccess = () => ok(req.result); req.onerror = () => mal(req.error); }); }
const guardarEn = (a, v) => comoPromesa(tx(a, 'readwrite').put(v));
const leerDe    = (a, k) => comoPromesa(tx(a).get(k));
const todoDe    = a => comoPromesa(tx(a).getAll());
const borrarDe  = (a, k) => comoPromesa(tx(a, 'readwrite').delete(k));

// --- sincronización ------------------------------------------------------
async function descargarPadron() {
  const datos = await API.sync();
  const almacen = bd.transaction('padron', 'readwrite').objectStore('padron');
  almacen.clear();
  datos.clientes.forEach(c => almacen.put(c));
  await guardarEn('meta', { clave: 'ultimoSync', valor: datos.generado });
  tienda = datos.tienda;
  return datos;
}

async function subirCola() {
  const cola = await todoDe('cola');
  if (!cola.length || !navigator.onLine) return pintarPendientes();
  try {
    const { resultados } = await API.enviar(cola);
    // DUPLICADO también se limpia: el servidor ya lo tenía registrado.
    for (const r of resultados) {
      if (['OK', 'DUPLICADO', 'RECHAZADO'].includes(r.estado)) await borrarDe('cola', r.idLocal);
    }
    const rechazados = resultados.filter(r => r.estado === 'RECHAZADO');
    if (rechazados.length) alert('Canjes rechazados al sincronizar:\n' + rechazados.map(r => '· ' + r.motivo).join('\n'));
  } catch (e) {
    console.warn('No se pudo sincronizar la cola:', e.message);
  }
  pintarPendientes();
}

async function pintarPendientes() {
  const cola = await todoDe('cola');
  const el = $('#pendientes');
  el.classList.toggle('oculto', cola.length === 0);
  el.textContent = `${cola.length} canje(s) pendientes de subir. Se envían solos al volver la conexión.`;
}

// --- validación (con respaldo offline) -----------------------------------
async function validar(token) {
  token = String(token || '').trim().toUpperCase();
  if (!token) return;
  try {
    const r = await API.validar(token);
    mostrarResultado(r);
  } catch (e) {
    if (e.status === 401) return irA('p-login');
    // Sin red: resolvemos con el padrón cacheado.
    const local = await leerDe('padron', token);
    if (!local) return mostrarResultado({ estado: 'NO_EXISTE', motivo: 'Sin conexión y no está en los datos guardados', cliente: null });
    mostrarResultado({ ...evaluarLocal(local), cliente: local, token: local.token, offline: true });
  }
}

/**
 * Cada estado tiene su color, su titulo y, sobre todo, que debe hacer el
 * cajero. El color ocupa la pantalla para que la decision se tome de reojo.
 */
const ESTADOS = {
  VALIDO:        { color: 'ok',    signo: '✓', titulo: 'VÁLIDO' },
  TOPE:          { color: 'aviso', signo: '!', titulo: 'YA LA USÓ HOY',
                   hacer: 'Cobra sin descuento.' },
  DIA_NO_VALIDO: { color: 'aviso', signo: '!', titulo: 'HOY NO APLICA',
                   hacer: 'El beneficio no corre este día. Cobra sin descuento.' },
  SIN_ACTIVAR:   { color: 'info',  signo: '•', titulo: 'SIN ACTIVAR',
                   hacer: 'El cliente debe activarla: que acerque la tarjeta a su celular.' },
  SIN_BENEFICIO: { color: 'info',  signo: '•', titulo: 'SIN BENEFICIO',
                   hacer: 'Esta tienda no tiene un beneficio vigente. Avisa a Proba.' },
  VENCIDA:       { color: 'mal',   signo: '✕', titulo: 'VENCIDA',
                   hacer: 'Deriva al cliente a Proba para renovarla.' },
  SUSPENDIDA:    { color: 'mal',   signo: '✕', titulo: 'SUSPENDIDA',
                   hacer: 'No apliques el descuento.' },
  BLOQUEADA:     { color: 'mal',   signo: '✕', titulo: 'BLOQUEADA',
                   hacer: 'Fue reportada como perdida. No apliques el descuento.' },
  NO_EXISTE:     { color: 'mal',   signo: '✕', titulo: 'NO REGISTRADA',
                   hacer: 'Revisa el código o búscalo por DNI.' }
};

/**
 * Reglas aplicadas con el padron cacheado. El servidor sigue mandando: esto
 * solo evita quedarse ciego cuando no hay señal. No conoce los canjes de
 * hoy, asi que no puede aplicar el tope diario.
 */
function evaluarLocal(local) {
  const hoy = new Date().toLocaleDateString('en-CA');   // fecha local, no UTC
  if (local.estado === 'en_blanco') return { estado: 'SIN_ACTIVAR', motivo: null };
  if (local.estado === 'perdida') return { estado: 'BLOQUEADA', motivo: null };
  if (local.estado === 'suspendida') return { estado: 'SUSPENDIDA', motivo: null };
  if (local.estado === 'vencida' || (local.vence && local.vence < hoy)) {
    return { estado: 'VENCIDA', motivo: local.vence ? `Venció el ${local.vence}` : null };
  }
  return { estado: 'VALIDO', motivo: 'Validado sin conexión' };
}

function mostrarResultado(r) {
  const ok = r.estado === 'VALIDO';
  const info = ESTADOS[r.estado] || { color: 'mal', signo: '✕', titulo: r.estado.replace(/_/g, ' ') };
  clienteActual = ok ? { token: r.token || r.cliente.token, ...r.cliente } : null;

  $('#banner-resultado').className = 'banner ' + info.color;
  $('#icono-resultado').textContent = info.signo;
  $('#texto-resultado').textContent = info.titulo;
  $('#motivo-resultado').textContent =
    ok ? [tienda && tienda.beneficio, r.motivo].filter(Boolean).join(' · ')
       : [r.motivo, info.hacer].filter(Boolean).join(' · ');

  const c = r.cliente;
  $('#nombre-cliente').textContent = c ? c.nombre : 'Tarjeta sin titular';
  $('#doc-cliente').textContent = c ? c.doc : '—';
  $('.ficha').classList.toggle('oculto', !c);
  $('.aviso').classList.toggle('oculto', !c);

  // Las condiciones del beneficio, a la vista al momento de cobrar.
  const minimo = tienda && tienda.montoMinimo;
  $('#nota-monto').textContent = minimo ? `Consumo mínimo: S/ ${minimo.toFixed(2)}` : (tienda?.condiciones || '');
  $('#nota-monto').classList.toggle('oculto', !$('#nota-monto').textContent);

  $('#bloque-monto').classList.toggle('oculto', !ok);
  $('#input-monto').value = '';
  irA('p-resultado');
}

async function confirmarCanje() {
  if (!clienteActual) return;
  const canje = {
    idLocal: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    token: clienteActual.token,
    monto: Number($('#input-monto').value) || 0,
    fecha: new Date().toISOString(),
    offline: !navigator.onLine
  };
  // Siempre a la cola primero: si el teléfono se apaga, el canje no se pierde.
  await guardarEn('cola', canje);
  await subirCola();
  $('#input-token').value = '';
  irA('p-caja');
}

// --- Web NFC (solo Android) ---------------------------------------------
async function activarNFC() {
  if (!('NDEFReader' in window)) return;
  $('#btn-nfc').classList.remove('oculto');
  $('#btn-nfc').onclick = async () => {
    try {
      const lector = new NDEFReader();
      await lector.scan();                       // pide permiso, requiere gesto del usuario
      $('#btn-nfc').textContent = 'Listo: acerca la tarjeta';
      lector.onreading = ({ message }) => {
        for (const reg of message.records) {
          if (reg.recordType !== 'url') continue;
          const url = new TextDecoder().decode(reg.data);
          const token = (url.match(/\/c\/([A-Za-z0-9]+)/) || [])[1];
          if (token) validar(token);
        }
      };
    } catch (e) {
      $('#btn-nfc').textContent = 'NFC no disponible, usa el código o el QR';
    }
  };
}

// --- navegación y arranque ----------------------------------------------
function irA(id) {
  document.querySelectorAll('.pantalla').forEach(p => p.classList.toggle('oculto', p.id !== id));
}

function pintarTienda() {
  if (!tienda) return;
  $('#nombre-tienda').textContent = tienda.nombre;
  $('#beneficio-tienda').textContent = tienda.beneficio;
}

async function entrarACaja() {
  pintarTienda();
  irA('p-caja');
  descargarPadron().then(pintarTienda).catch(() => {});
  subirCola();
  const t = new URLSearchParams(location.search).get('t');   // vino de /c/TOKEN
  if (t) { history.replaceState({}, '', '/'); validar(t); }
}

function estadoConexion() {
  $('#barra-conexion').classList.toggle('oculto', navigator.onLine);
}

let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', e => {   // solo Android
  e.preventDefault(); eventoInstalar = e;
  $('#btn-instalar').classList.remove('oculto');
});

function ayudaInstalacionIOS() {
  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const yaInstalada = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (esIOS && !yaInstalada && !localStorage.getItem('pc_ayuda_vista')) {
    $('#ayuda-ios').classList.remove('oculto');
  }
}

async function iniciar() {
  bd = await abrirBD();
  estadoConexion();
  addEventListener('online', () => { estadoConexion(); subirCola(); });
  addEventListener('offline', estadoConexion);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.tipo === 'sincronizar') subirCola(); });
  }

  // eventos
  $('#form-login').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      const r = await API.login({ usuario: f.get('usuario'), clave: f.get('clave') });
      tienda = r.tienda;
      $('#error-login').classList.add('oculto');
      entrarACaja();
      ayudaInstalacionIOS();
    } catch (e) {
      $('#error-login').textContent = e.message;
      $('#error-login').classList.remove('oculto');
    }
  };
  $('#btn-validar').onclick = () => validar($('#input-token').value);
  $('#input-token').onkeydown = e => { if (e.key === 'Enter') validar(e.target.value); };
  $('#btn-volver').onclick = () => { $('#input-token').value = ''; irA('p-caja'); };
  $('#btn-confirmar').onclick = confirmarCanje;

  $('#btn-buscar').onclick = async () => {
    const cont = $('#resultados-busqueda');
    cont.textContent = 'Buscando...';
    try {
      const { resultados } = await API.buscar($('#input-buscar').value);
      cont.innerHTML = '';
      if (!resultados.length) return cont.textContent = 'Sin resultados.';
      resultados.forEach(c => {
        const b = document.createElement('button');
        b.className = 'btn secundario';
        b.textContent = `${c.nombre} · DNI ${c.doc}`;
        b.onclick = () => validar(c.token);
        cont.appendChild(b);
      });
    } catch (e) { cont.textContent = e.message; }
  };

  $('#btn-menu').onclick = async () => {
    irA('p-menu');
    const meta = await leerDe('meta', 'ultimoSync');
    $('#info-sync').textContent = meta ? 'Última sincronización: ' + new Date(meta.valor).toLocaleString('es-PE') : 'Sin sincronizar aún';
    try {
      const { canjes } = await API.canjes();
      $('#lista-canjes').innerHTML = canjes.length
        ? canjes.map(c => `<div class="fila">${new Date(c.fecha).toLocaleString('es-PE')} · ${c.cliente || '—'} · S/ ${c.monto.toFixed(2)}</div>`).join('')
        : 'Todavía no hay canjes.';
    } catch { $('#lista-canjes').textContent = 'Sin conexión.'; }
  };
  $('#btn-cerrar-menu').onclick = () => irA('p-caja');
  $('#btn-sync').onclick = async () => { await descargarPadron().catch(() => {}); await subirCola(); alert('Sincronizado'); };
  $('#btn-salir').onclick = async () => { await API.logout().catch(() => {}); location.reload(); };
  $('#btn-instalar').onclick = async () => { eventoInstalar?.prompt(); eventoInstalar = null; };
  $('#btn-cerrar-ayuda').onclick = () => { localStorage.setItem('pc_ayuda_vista', '1'); $('#ayuda-ios').classList.add('oculto'); };

  activarNFC();

  // ¿hay sesión viva?
  try {
    const s = await API.sesion();
    tienda = s.tienda;
    entrarACaja();
    ayudaInstalacionIOS();
  } catch {
    irA('p-login');
  }
}
iniciar();
