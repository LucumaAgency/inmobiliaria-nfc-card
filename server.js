/**
 * ProbaCard - servidor de validación de tarjetas NFC.
 *
 * Una sola URL (/c/TOKEN) se comporta distinto según quién la abra:
 * cajero con sesión ve la validación, cliente ve su carnet, tarjeta en
 * blanco lleva a la activación.
 */
require('./lib/entorno').cargar();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { evaluar, cumpleMontoMinimo, publico } = require('./lib/reglas');
const { limitar, limpiar } = require('./lib/limite');
const { verificar: verificarClave } = require('./lib/claves');
const repos = require('./lib/repos');
const { cerrar } = require('./lib/db');

const PORT = Number(process.env.PORT) || 3020;
const PRODUCCION = process.env.NODE_ENV === 'production';
const SECRET = process.env.PROBACARD_SECRET || 'cambiar-en-produccion';
const PUBLIC = path.join(__dirname, 'public');

if (PRODUCCION && SECRET === 'cambiar-en-produccion') {
  console.error('Falta PROBACARD_SECRET. El servidor no arranca en producción sin él.');
  process.exit(1);
}

// --- sesión (cookie firmada, sin librerías) -----------------------------
function firmar(valor) {
  const mac = crypto.createHmac('sha256', SECRET).update(valor).digest('base64url');
  return `${valor}.${mac}`;
}

function verificarCookie(cookie) {
  if (!cookie) return null;
  const i = cookie.lastIndexOf('.');
  if (i < 0) return null;
  const valor = cookie.slice(0, i);
  const esperado = firmar(valor);
  // Comparación en tiempo constante sobre longitudes iguales.
  if (esperado.length !== cookie.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(cookie))) return null;

  const [usuario, emitido] = valor.split('|');
  // 30 días: si el cajero tuviera que loguearse cada turno, dejaría de usar la app.
  if (Date.now() - Number(emitido) > 30 * 864e5) return null;
  return usuario;
}

async function sesionDe(req) {
  const raw = req.headers.cookie || '';
  const par = raw.split(';').map(s => s.trim()).find(s => s.startsWith('pc_sesion='));
  if (!par) return null;
  const usuario = verificarCookie(decodeURIComponent(par.slice(10)));
  return usuario ? await repos.usuarios.porNombre(usuario) : null;
}

function ponerCookie(res, usuario) {
  const partes = [
    `pc_sesion=${encodeURIComponent(firmar(`${usuario}|${Date.now()}`))}`,
    'Path=/', `Max-Age=${30 * 86400}`, 'HttpOnly', 'SameSite=Lax'
  ];
  if (PRODUCCION) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

// --- helpers HTTP -------------------------------------------------------
function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function ipDe(req) {
  // Passenger va detrás de nginx: el cliente real viene en X-Forwarded-For.
  const reenviada = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || req.socket.remoteAddress || 'desconocida';
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

function estatico(res, rel) {
  const archivo = path.join(PUBLIC, rel);
  if (!archivo.startsWith(PUBLIC) || !fs.existsSync(archivo) || !fs.statSync(archivo).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('No encontrado');
  }
  // El service worker nunca se cachea: si no, queda pegada una versión vieja
  // de la app en los teléfonos de las tiendas y no hay forma de actualizarla.
  const cache = rel === 'sw.js' ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': MIME[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(archivo).pipe(res);
}

const tokenValido = t => /^[A-Z0-9]{4,12}$/.test(t);

/** Forma que la app del cajero espera para la tienda. */
function tiendaPublica(t) {
  return t && {
    id: t.id, nombre: t.nombre, rubro: t.rubro,
    beneficio: t.beneficio, condiciones: t.condiciones,
    topeDiario: t.tope_diario, montoMinimo: Number(t.monto_minimo || 0)
  };
}

// --- rutas --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ruta = url.pathname;

  try {
    // Salud del servicio. Lo usa el despliegue para verificar que quedó arriba.
    if (ruta === '/api/salud') {
      return json(res, 200, {
        ok: true,
        version: require('./package.json').version,
        entorno: process.env.NODE_ENV || 'development',
        hora: new Date().toISOString()
      });
    }

    // ------------------------------------------------------------- login
    if (ruta === '/api/login' && req.method === 'POST') {
      const { usuario, clave } = await leerCuerpo(req);

      // Se limita por IP y por usuario: si no, basta rotar el usuario para
      // seguir probando claves desde la misma máquina.
      for (const clv of [`login-ip:${ipDe(req)}`, `login-usuario:${usuario}`]) {
        const r = limitar({ clave: clv, maximo: 5, ventanaMs: 15 * 60_000 });
        if (!r.permitido) {
          return json(res, 429, { error: `Demasiados intentos. Espera ${r.esperaSegundos} segundos.` });
        }
      }

      const u = await repos.usuarios.porNombre(String(usuario || ''));
      const ok = u && await verificarClave(String(clave || ''), u.clave_hash);
      if (!ok) return json(res, 401, { error: 'Usuario o clave incorrectos' });

      limpiar(`login-ip:${ipDe(req)}`);
      limpiar(`login-usuario:${usuario}`);
      await repos.usuarios.marcarAcceso(u.id);
      ponerCookie(res, u.usuario);

      return json(res, 200, {
        ok: true,
        usuario: { nombre: u.nombre, rol: u.rol },
        tienda: tiendaPublica(u.tienda_id ? await repos.tiendas.conBeneficio(u.tienda_id) : null)
      });
    }

    if (ruta === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'pc_sesion=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      return json(res, 200, { ok: true });
    }

    // A partir de aquí casi todo pide sesión de caja.
    const usuario = await sesionDe(req);

    if (ruta === '/api/sesion') {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });
      return json(res, 200, {
        usuario: { nombre: usuario.nombre, rol: usuario.rol },
        tienda: tiendaPublica(usuario.tienda_id ? await repos.tiendas.conBeneficio(usuario.tienda_id) : null)
      });
    }

    // ------------------------------------------- padrón para trabajar offline
    if (ruta === '/api/sync') {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });
      const filas = await repos.tarjetas.padron();
      return json(res, 200, {
        generado: new Date().toISOString(),
        tienda: tiendaPublica(await repos.tiendas.conBeneficio(usuario.tienda_id)),
        clientes: filas.map(f => ({
          token: f.token, id: f.id, nombre: f.nombre, doc: f.doc,
          foto: f.foto, vence: f.vence, estado: f.estado
        }))
      });
    }

    // ------------------------------------------------------------ validar
    if (ruta.startsWith('/api/validar/')) {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });

      const token = decodeURIComponent(ruta.slice('/api/validar/'.length)).toUpperCase();
      if (!tokenValido(token)) return json(res, 400, { error: 'Código de tarjeta inválido' });

      const limite = limitar({ clave: `validar:${usuario.id}`, maximo: 120, ventanaMs: 60_000 });
      if (!limite.permitido) return json(res, 429, { error: 'Demasiadas consultas seguidas.' });

      const tienda = await repos.tiendas.conBeneficio(usuario.tienda_id);
      const tarjeta = await repos.tarjetas.porToken(token);
      const usosHoy = tarjeta ? await repos.canjes.usosHoy(tarjeta.id, tienda.id) : 0;
      const r = evaluar(tarjeta, tienda.beneficio_id ? tienda : null, usosHoy);

      // Se registra siempre, termine o no en canje.
      await repos.validaciones.registrar({
        token, tiendaId: tienda.id, usuarioId: usuario.id, resultado: r.estado
      });

      return json(res, 200, {
        ...r,
        token,
        cliente: tarjeta && tarjeta.cliente_id ? publico(tarjeta) : null,
        tienda: tiendaPublica(tienda)
      });
    }

    // ----------------------------------- respaldo: olvidó la tarjeta en casa
    if (ruta === '/api/buscar') {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });
      const q = (url.searchParams.get('q') || '').trim();
      if (!/^\d{4,15}$/.test(q)) return json(res, 400, { error: 'Ingresa al menos 4 dígitos' });

      const limite = limitar({ clave: `buscar:${usuario.id}`, maximo: 30, ventanaMs: 60_000 });
      if (!limite.permitido) return json(res, 429, { error: 'Demasiadas búsquedas seguidas.' });

      const filas = await repos.tarjetas.buscarPorDocOCelular(q);
      return json(res, 200, { resultados: filas.map(f => ({ token: f.token, ...publico(f) })) });
    }

    // -------------------------------------------------------------- canje
    if (ruta === '/api/canje' && req.method === 'POST') {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });

      const tienda = await repos.tiendas.conBeneficio(usuario.tienda_id);
      const cuerpo = await leerCuerpo(req);
      const lote = Array.isArray(cuerpo.canjes) ? cuerpo.canjes : [cuerpo];
      if (lote.length > 200) return json(res, 400, { error: 'Lote demasiado grande' });

      const resultados = [];
      for (const item of lote) {
        const idLocal = item.idLocal || null;

        // La cola offline reintenta: el mismo canje puede llegar dos veces.
        if (idLocal && await repos.canjes.existeLocal(idLocal)) {
          resultados.push({ idLocal, estado: 'DUPLICADO' });
          continue;
        }

        const token = String(item.token || '').toUpperCase();
        const tarjeta = tokenValido(token) ? await repos.tarjetas.porToken(token) : null;
        const usosHoy = tarjeta ? await repos.canjes.usosHoy(tarjeta.id, tienda.id) : 0;
        const r = evaluar(tarjeta, tienda.beneficio_id ? tienda : null, usosHoy);

        if (r.estado !== 'VALIDO') {
          resultados.push({ idLocal, estado: 'RECHAZADO', motivo: r.motivo });
          continue;
        }

        const monto = Number(item.monto) || 0;
        const minimo = cumpleMontoMinimo(tienda, monto);
        if (!minimo.ok) {
          resultados.push({ idLocal, estado: 'RECHAZADO', motivo: minimo.motivo });
          continue;
        }

        const fecha = item.fecha ? new Date(item.fecha) : new Date();
        await repos.canjes.registrar({
          idLocal, clienteId: tarjeta.cliente_id, tarjetaId: tarjeta.id,
          tiendaId: tienda.id, beneficioId: tienda.beneficio_id, usuarioId: usuario.id,
          monto, fecha: isNaN(fecha) ? new Date() : fecha, offline: !!item.offline
        });

        resultados.push({ idLocal, estado: 'OK' });
      }
      return json(res, 200, { resultados });
    }

    // ------------------------------------------------- historial de la tienda
    if (ruta === '/api/canjes') {
      if (!usuario) return json(res, 401, { error: 'Sin sesión' });
      const filas = await repos.canjes.ultimosDeTienda(usuario.tienda_id, 50);
      return json(res, 200, { canjes: filas.map(f => ({ ...f, monto: Number(f.monto) })) });
    }

    // ------------------------------------------- directorio público de tiendas
    if (ruta === '/api/directorio') {
      return json(res, 200, { tiendas: await repos.tiendas.directorio() });
    }

    // La URL grabada en el chip. El destino depende de quién la abre.
    if (ruta.startsWith('/c/')) {
      const token = ruta.slice(3).toUpperCase();
      if (!tokenValido(token)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      res.writeHead(302, { Location: `/?t=${encodeURIComponent(token)}` });
      return res.end();
    }

    if (ruta === '/' || ruta === '/caja') return estatico(res, 'index.html');
    return estatico(res, ruta.slice(1));

  } catch (e) {
    // Nunca devolver la traza al cliente: filtra rutas y estructura interna.
    console.error(`[${new Date().toISOString()}] ${req.method} ${ruta}:`, e.message);
    json(res, 500, { error: 'Error del servidor' });
  }
});

server.listen(PORT, () => console.log(`ProbaCard escuchando en http://localhost:${PORT}`));

// Passenger recicla procesos: cerrar el pool evita conexiones colgadas en MySQL.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    server.close(async () => { await cerrar(); process.exit(0); });
  });
}

module.exports = server;
