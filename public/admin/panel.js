/**
 * Panel de administracion de ProbaCard.
 * Sin framework: es un panel interno de pocas pantallas.
 */
const $ = s => document.querySelector(s);
const crear = (tag, props = {}) => Object.assign(document.createElement(tag), props);

async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, { headers: { 'Content-Type': 'application/json' }, ...opciones });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(datos.error || 'Error'), { status: r.status });
  return datos;
}
const enviar = (ruta, cuerpo) => api(ruta, { method: 'POST', body: JSON.stringify(cuerpo) });
const datosDe = form => Object.fromEntries(new FormData(form));

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = f => f ? new Date(f).toLocaleDateString('es-PE') : '—';
const fechaHora = f => f ? new Date(f).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const pastilla = e => `<span class="pastilla e-${e}">${e.replace('_', ' ')}</span>`;

/** Construye una tabla a partir de columnas y filas. */
function tabla(el, columnas, filas, vacio = 'Sin resultados.') {
  if (!filas.length) { el.innerHTML = `<tr><td>${vacio}</td></tr>`; return; }
  el.innerHTML =
    `<thead><tr>${columnas.map(c => `<th>${c.t}</th>`).join('')}</tr></thead>` +
    `<tbody>${filas.map(f =>
      `<tr>${columnas.map(c => `<td class="${c.clase || ''}">${c.v(f) ?? '—'}</td>`).join('')}</tr>`
    ).join('')}</tbody>`;
}

function mostrarSalida(el, texto, ok = true) {
  el.textContent = texto;
  el.className = `salida ${ok ? 'ok' : 'mal'}`;
}

// ------------------------------------------------------------------ vistas
const vistas = {
  async resumen() {
    const { resumen, tiendas, ultimos } = await api('/api/admin/resumen');
    $('#cifras').innerHTML = [
      ['Tarjetas emitidas', resumen.tarjetas_emitidas],
      ['En blanco', resumen.tarjetas_en_blanco],
      ['Clientes', resumen.clientes],
      ['Tiendas activas', resumen.tiendas],
      ['Canjes del mes', resumen.canjes_mes],
      ['Consumo acumulado', soles(resumen.consumo)]
    ].map(([k, v]) => `<div class="cifra"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

    tabla($('#tabla-tiendas-resumen'), [
      { t: 'Tienda', v: f => f.nombre },
      { t: 'Rubro', v: f => f.rubro },
      { t: 'Canjes', v: f => f.canjes, clase: 'num' },
      { t: 'Consumo', v: f => soles(f.consumo), clase: 'num' },
      { t: 'Clientes', v: f => f.clientes, clase: 'num' },
      // Si se valida mucho y se canjea poco, algo pasa en esa caja.
      { t: 'Valid./canje', v: f => f.canjes ? (f.validaciones / f.canjes).toFixed(1) : '—', clase: 'num' }
    ], tiendas, 'Todavía no hay tiendas.');

    tabla($('#tabla-ultimos'), [
      { t: 'Fecha', v: f => fechaHora(f.fecha) },
      { t: 'Cliente', v: f => f.cliente },
      { t: 'Tienda', v: f => f.tienda },
      { t: 'Monto', v: f => soles(f.monto), clase: 'num' },
      { t: 'Origen', v: f => f.offline ? 'Sin conexión' : 'En línea' }
    ], ultimos, 'Todavía no hay canjes.');
  },

  async tarjetas() {
    const p = new URLSearchParams();
    if ($('#filtro-q').value.trim()) p.set('q', $('#filtro-q').value.trim());
    if ($('#filtro-estado').value) p.set('estado', $('#filtro-estado').value);
    const { tarjetas } = await api('/api/admin/tarjetas?' + p);
    tabla($('#tabla-tarjetas'), [
      { t: 'Código', v: f => `<span class="mono">${f.token}</span>` },
      { t: 'Estado', v: f => pastilla(f.estado) },
      { t: 'Cliente', v: f => f.nombre },
      { t: 'Documento', v: f => f.doc },
      { t: 'Lote', v: f => f.lote },
      { t: 'Grabada', v: f => f.grabada_en ? 'Sí' : 'No' },
      { t: 'Vence', v: f => fecha(f.vence) }
    ], tarjetas, 'Sin tarjetas para ese filtro.');
  },

  async lotes() {
    const { lotes } = await api('/api/admin/lotes');
    tabla($('#tabla-lotes'), [
      { t: 'Lote', v: f => f.codigo },
      { t: 'Cantidad', v: f => f.cantidad, clase: 'num' },
      { t: 'Grabadas', v: f => f.grabadas || 0, clase: 'num' },
      { t: 'Emitidas', v: f => f.emitidas || 0, clase: 'num' },
      { t: 'Creado', v: f => fecha(f.creado_en) },
      { t: 'CSV', v: f => `<a href="/api/admin/lotes/csv?lote=${encodeURIComponent(f.codigo)}">Descargar</a>` }
    ], lotes, 'Todavía no hay lotes.');
  },

  async grabar() {
    const { lotes } = await api('/api/admin/lotes');
    $('#grabar-lote').innerHTML = lotes
      .map(l => `<option value="${l.codigo}">${l.codigo} (${(l.cantidad - (l.grabadas || 0))} por grabar)</option>`)
      .join('') || '<option value="">No hay lotes</option>';
    $('#aviso-nfc').classList.toggle('oculto', 'NDEFReader' in window);
  },

  async tiendas() {
    const { tiendas } = await api('/api/admin/tiendas');
    $('#usuario-tienda').innerHTML = tiendas.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('');
    tabla($('#tabla-tiendas'), [
      { t: 'Tienda', v: f => f.nombre },
      { t: 'Rubro', v: f => f.rubro },
      { t: 'Distrito', v: f => f.distrito },
      { t: 'Beneficio', v: f => f.beneficio },
      { t: 'Tope/día', v: f => f.tope_diario, clase: 'num' },
      { t: 'Mínimo', v: f => Number(f.monto_minimo) ? soles(f.monto_minimo) : '—', clase: 'num' },
      { t: 'Canjes', v: f => f.canjes, clase: 'num' }
    ], tiendas, 'Todavía no hay tiendas.');
  },

  async clientes() {
    const q = $('#filtro-cliente').value.trim();
    const { clientes } = await api('/api/admin/clientes' + (q ? `?q=${encodeURIComponent(q)}` : ''));
    tabla($('#tabla-clientes'), [
      { t: 'Nombre', v: f => f.nombre },
      { t: 'Documento', v: f => f.doc },
      { t: 'Celular', v: f => f.celular },
      { t: 'Tarjeta', v: f => f.token ? `<span class="mono">${f.token}</span>` : '—' },
      { t: 'Canjes', v: f => f.canjes, clase: 'num' },
      { t: 'Desde', v: f => fecha(f.creado_en) }
    ], clientes, 'Sin clientes.');
  },

  emitir: async () => {}
};

function irA(nombre) {
  document.querySelectorAll('.vista').forEach(v => v.classList.toggle('oculto', v.id !== 'v-' + nombre));
  document.querySelectorAll('#menu button').forEach(b => b.classList.toggle('activo', b.dataset.vista === nombre));
  vistas[nombre]?.().catch(e => console.error(e));
}

// ------------------------------------------------------- grabado por Web NFC
const grabado = { activo: false, token: null, url: null, hechas: 0 };

function anotar(texto, clase = '') {
  $('#grabar-log').prepend(crear('div', { textContent: texto, className: clase }));
}

async function siguienteTarjeta() {
  const lote = $('#grabar-lote').value;
  const r = await api(`/api/admin/grabar/siguiente?lote=${encodeURIComponent(lote)}`);
  if (r.fin) {
    $('#grabar-estado').textContent = 'Lote completo.';
    $('#grabar-token').textContent = '------';
    grabado.activo = false;
    return false;
  }
  grabado.token = r.token;
  grabado.url = r.url;
  $('#grabar-token').textContent = r.token;
  $('#grabar-estado').textContent = 'Acerca una tarjeta al teléfono';
  return true;
}

async function grabarUna() {
  const lector = new NDEFReader();
  await lector.write({ records: [{ recordType: 'url', data: grabado.url }] });

  // Verificar ANTES de bloquear: el bloqueo es irreversible.
  $('#grabar-estado').textContent = 'Verificando lo escrito...';
  const leido = await leerUnaVez(lector);
  if (leido !== grabado.url) {
    throw new Error(`Lo grabado no coincide (leído: ${leido || 'nada'}). No se bloqueó.`);
  }

  if ($('#grabar-bloquear').checked) {
    $('#grabar-estado').textContent = 'Bloqueando...';
    await lector.makeReadOnly();
  }
  await enviar('/api/admin/grabar/confirmar', { token: grabado.token });
}

function leerUnaVez(lector, msEspera = 4000) {
  return new Promise((resolve) => {
    const corte = setTimeout(() => resolve(null), msEspera);
    lector.onreading = ({ message }) => {
      clearTimeout(corte);
      const reg = message.records.find(r => r.recordType === 'url');
      resolve(reg ? new TextDecoder().decode(reg.data) : null);
    };
    lector.scan().catch(() => { clearTimeout(corte); resolve(null); });
  });
}

async function cicloGrabado() {
  while (grabado.activo) {
    if (!await siguienteTarjeta()) break;
    try {
      await grabarUna();
      grabado.hechas++;
      anotar(`${grabado.token}  grabada`, 'ok');
      $('#grabar-contador').textContent = `${grabado.hechas} grabadas en esta sesión`;
    } catch (e) {
      anotar(`${grabado.token}  ${e.message}`, 'mal');
      $('#grabar-estado').textContent = e.message;
      grabado.activo = false;   // se detiene: un error de grabado hay que mirarlo
      break;
    }
  }
  $('#btn-grabar').disabled = false;
}

// -------------------------------------------------------------------- inicio
function conectar() {
  $('#form-login').onsubmit = async ev => {
    ev.preventDefault();
    try {
      const r = await enviar('/api/login', datosDe(ev.target));
      if (r.usuario.rol !== 'admin') throw new Error('Este usuario no tiene acceso al panel');
      entrar();
    } catch (e) {
      $('#error-login').textContent = e.message;
      $('#error-login').classList.remove('oculto');
    }
  };

  document.querySelectorAll('#menu button').forEach(b => b.onclick = () => irA(b.dataset.vista));
  $('#btn-salir').onclick = async () => { await enviar('/api/logout', {}); location.reload(); };

  $('#btn-filtrar').onclick = () => vistas.tarjetas();
  $('#filtro-q').onkeydown = e => { if (e.key === 'Enter') vistas.tarjetas(); };
  $('#btn-filtrar-cliente').onclick = () => vistas.clientes();
  $('#filtro-cliente').onkeydown = e => { if (e.key === 'Enter') vistas.clientes(); };

  $('#form-lote').onsubmit = async ev => {
    ev.preventDefault();
    const salida = $('#salida-lote');
    try {
      const r = await enviar('/api/admin/lotes/crear', datosDe(ev.target));
      mostrarSalida(salida, `Lote ${r.codigo} creado con ${r.cantidad} tarjetas. Descarga el CSV para el proveedor.`);
      salida.classList.remove('oculto');
      ev.target.reset();
      vistas.lotes();
    } catch (e) {
      mostrarSalida(salida, e.message, false);
      salida.classList.remove('oculto');
    }
  };

  $('#form-emitir').onsubmit = async ev => {
    ev.preventDefault();
    const salida = $('#salida-emitir');
    const datos = datosDe(ev.target);
    datos.consentimiento = ev.target.consentimiento.checked;
    datos.token = String(datos.token).toUpperCase();
    try {
      const r = await enviar('/api/admin/emitir', datos);
      mostrarSalida(salida, `Tarjeta ${r.token} emitida. Vence el ${fecha(r.vence)}.`);
      ev.target.reset();
    } catch (e) {
      mostrarSalida(salida, e.message, false);
    }
    salida.classList.remove('oculto');
  };

  $('#form-tienda').onsubmit = async ev => {
    ev.preventDefault();
    try { await enviar('/api/admin/tiendas/crear', datosDe(ev.target)); ev.target.reset(); vistas.tiendas(); }
    catch (e) { alert(e.message); }
  };

  $('#form-usuario').onsubmit = async ev => {
    ev.preventDefault();
    const d = datosDe(ev.target);
    try { await enviar('/api/admin/tiendas/usuario', { ...d, tiendaId: Number(d.tiendaId) });
          ev.target.reset(); alert('Usuario de caja creado.'); }
    catch (e) { alert(e.message); }
  };

  // Leer el codigo de una tarjeta en blanco al emitir, en vez de tipearlo.
  if ('NDEFReader' in window) {
    $('#btn-leer-nfc').classList.remove('oculto');
    $('#btn-leer-nfc').onclick = async () => {
      try {
        const lector = new NDEFReader();
        await lector.scan();
        lector.onreading = ({ message }) => {
          const reg = message.records.find(r => r.recordType === 'url');
          if (!reg) return;
          const url = new TextDecoder().decode(reg.data);
          const token = (url.match(/\/c\/([A-Za-z0-9]+)/) || [])[1];
          if (token) $('#emitir-token').value = token.toUpperCase();
        };
      } catch (e) { alert('No se pudo leer NFC: ' + e.message); }
    };
  }

  $('#btn-grabar').onclick = () => {
    if (!('NDEFReader' in window)) return alert('Este navegador no puede escribir NFC.');
    if (!$('#grabar-lote').value) return alert('Primero crea un lote.');
    grabado.activo = true;
    grabado.hechas = 0;
    $('#grabador').classList.remove('oculto');
    $('#btn-grabar').disabled = true;
    cicloGrabado();
  };
  $('#btn-parar').onclick = () => {
    grabado.activo = false;
    $('#btn-grabar').disabled = false;
    $('#grabar-estado').textContent = 'Detenido.';
  };
}

function entrar() {
  $('#p-login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  irA('resumen');
}

(async function iniciar() {
  conectar();
  try {
    const s = await api('/api/sesion');
    if (s.usuario.rol === 'admin') entrar();
  } catch { /* sin sesión: queda el login */ }
})();
