/**
 * Carnet del titular.
 * Esta pagina la puede abrir cualquiera que tenga la tarjeta en la mano,
 * asi que solo muestra nombre abreviado y estado. El historial y el reporte
 * de perdida exigen identificarse con los ultimos 4 digitos del documento.
 */
const $ = (s, raiz = document) => raiz.querySelector(s);
const contenido = $('#contenido');

const token = (new URLSearchParams(location.search).get('t') || '').toUpperCase();

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mes = f => f ? new Date(f).toLocaleDateString('es-PE', { month: 'short', year: 'numeric' }) : '—';
const fechaCorta = f => new Date(f).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });

async function api(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : {});
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || 'No se pudo completar la operación');
  return datos;
}

function pintar(mensaje, clase = 'aviso-caja') {
  contenido.innerHTML = '';
  contenido.append(Object.assign(document.createElement('div'), { className: clase, textContent: mensaje }));
}

const ESTADOS = {
  activa:     { texto: 'ACTIVA', clase: '' },
  vencida:    { texto: 'VENCIDA', clase: 'aviso' },
  suspendida: { texto: 'SUSPENDIDA', clase: 'mal' },
  perdida:    { texto: 'BLOQUEADA', clase: 'mal' }
};

// ------------------------------------------------------------------ carnet
function mostrarCarnet(datos) {
  const nodo = $('#tpl-carnet').content.cloneNode(true);
  const estado = ESTADOS[datos.estado] || { texto: datos.estado.toUpperCase(), clase: 'mal' };

  $('.estado', nodo).textContent = estado.texto;
  if (estado.clase) $('.estado', nodo).classList.add(estado.clase);
  $('.nombre', nodo).textContent = datos.nombre;
  $('.meta', nodo).textContent =
    `Socio desde ${mes(datos.socioDesde)} · Vence ${mes(datos.vence)}`;

  $('.ahorro-cifra', nodo).textContent = soles(datos.consumo);
  $('.ahorro-texto', nodo).textContent = datos.visitas === 1
    ? 'consumido con tu tarjeta en 1 visita'
    : `consumido con tu tarjeta en ${datos.visitas} visitas`;

  const panel = $('.panel-identidad', nodo);
  const historial = $('.historial', nodo);
  const error = $('.error', nodo);
  let pendiente = null;   // 'historial' o 'perdida'

  const pedirIdentidad = (accion, texto) => {
    pendiente = accion;
    $('.explica', panel).textContent = texto;
    $('.doc', panel).value = '';
    error.classList.add('oculto');
    panel.classList.remove('oculto');
    $('.doc', panel).focus();
  };

  $('[data-accion="historial"]', nodo).onclick = () =>
    pedirIdentidad('historial', 'Para ver tu historial, confirma que esta tarjeta es tuya.');

  $('[data-accion="perdida"]', nodo).onclick = () =>
    pedirIdentidad('perdida', 'Vamos a bloquear esta tarjeta. Confirma que es tuya.');

  $('[data-accion="cancelar"]', panel).onclick = () => panel.classList.add('oculto');

  $('[data-accion="confirmar"]', panel).onclick = async () => {
    const documento = $('.doc', panel).value.trim();
    error.classList.add('oculto');
    try {
      if (pendiente === 'historial') {
        const r = await api('/api/publico/historial', { token, documento });
        panel.classList.add('oculto');
        historial.classList.remove('oculto');
        historial.innerHTML = r.historial.length
          ? r.historial.map(h => `
              <div class="fila">
                <div><b>${h.tienda}</b><br><span class="der">${h.beneficio}</span></div>
                <div class="der">${soles(h.monto)}<br>${fechaCorta(h.fecha)}</div>
              </div>`).join('')
          : '<div class="vacio">Todavía no has usado tu tarjeta.</div>';
      } else {
        if (!confirm('La tarjeta quedará bloqueada de inmediato. ¿Continuar?')) return;
        await api('/api/publico/perdida', { token, documento });
        pintar('Tarjeta bloqueada. Acércate a Proba para que te emitan una nueva; tu historial se conserva.', 'exito');
      }
    } catch (e) {
      error.textContent = e.message;
      error.classList.remove('oculto');
    }
  };

  contenido.innerHTML = '';
  contenido.append(nodo);
}

// -------------------------------------------------------------- activación
function mostrarActivacion() {
  const nodo = $('#tpl-activar').content.cloneNode(true);
  $('.token', nodo).textContent = token;
  const form = $('.formulario', nodo);
  const error = $('.error', form);

  form.onsubmit = async ev => {
    ev.preventDefault();
    error.classList.add('oculto');
    const datos = Object.fromEntries(new FormData(form));
    datos.token = token;
    datos.consentimiento = form.consentimiento.checked;
    try {
      await api('/api/publico/activar', datos);
      cargar();   // vuelve a leer la tarjeta: ahora sale el carnet
    } catch (e) {
      error.textContent = e.message;
      error.classList.remove('oculto');
    }
  };

  contenido.innerHTML = '';
  contenido.append(nodo);
}

// ------------------------------------------------------------------ inicio
async function cargar() {
  if (!token) return pintar('Acerca tu tarjeta al teléfono o escanea el código QR impreso en ella.');
  try {
    const datos = await api(`/api/publico/tarjeta/${encodeURIComponent(token)}`);
    if (datos.estado === 'en_blanco') mostrarActivacion();
    else mostrarCarnet(datos);
  } catch (e) {
    pintar(e.message);
  }
}
cargar();
