/**
 * ProbaCard - servidor de validación de tarjetas NFC
 * Node puro, sin dependencias. Base de datos en JSON (data/db.json).
 * Fase 1: suficiente para el piloto. Migrar a MySQL cuando pase de ~5 tiendas.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3020;
const SECRET = process.env.PROBACARD_SECRET || 'cambiar-en-produccion';
if (process.env.NODE_ENV === 'production' && SECRET === 'cambiar-en-produccion') {
  console.error('Falta PROBACARD_SECRET. El servidor no arranca en producción sin él.');
  process.exit(1);
}
const DB_PATH = path.join(__dirname, 'data', 'db.json');
const PUBLIC = path.join(__dirname, 'public');

// --- persistencia -------------------------------------------------------
// Primer arranque: la base de trabajo no está versionada, se crea desde la semilla.
if (!fs.existsSync(DB_PATH)) {
  fs.copyFileSync(path.join(__dirname, 'data', 'seed.json'), DB_PATH);
  console.log('Base de trabajo creada desde data/seed.json');
}
let db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
let guardadoPendiente = false;
function guardar() {
  if (guardadoPendiente) return;
  guardadoPendiente = true;
  setTimeout(() => {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    guardadoPendiente = false;
  }, 200);
}

// --- sesión (cookie firmada, sin librerías) -----------------------------
function firmar(valor) {
  const mac = crypto.createHmac('sha256', SECRET).update(valor).digest('base64url');
  return `${valor}.${mac}`;
}
function verificar(cookie) {
  if (!cookie) return null;
  const i = cookie.lastIndexOf('.');
  if (i < 0) return null;
  const valor = cookie.slice(0, i);
  if (firmar(valor) !== cookie) return null;
  const [usuario, emitido] = valor.split('|');
  // 30 días: el cajero no debe volver a loguearse durante el piloto
  if (Date.now() - Number(emitido) > 30 * 864e5) return null;
  return db.usuarios.find(u => u.usuario === usuario) || null;
}
function sesionDe(req) {
  const raw = req.headers.cookie || '';
  const par = raw.split(';').map(s => s.trim()).find(s => s.startsWith('pc_sesion='));
  return par ? verificar(decodeURIComponent(par.slice(10))) : null;
}

const { hoy, evaluar, publico } = require('./lib/reglas');

// --- helpers HTTP -------------------------------------------------------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function estatico(res, rel) {
  const archivo = path.join(PUBLIC, rel);
  if (!archivo.startsWith(PUBLIC) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end('No encontrado'); }
  const ext = path.extname(archivo);
  // El service worker nunca se cachea: si no, queda pegada una versión vieja.
  const cache = rel === 'sw.js' ? 'no-cache' : 'public, max-age=3600';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  fs.createReadStream(archivo).pipe(res);
}

// --- rutas --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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

    // Login
    if (ruta === '/api/login' && req.method === 'POST') {
      const { usuario, clave } = await leerCuerpo(req);
      const u = db.usuarios.find(x => x.usuario === usuario && x.clave === clave);
      if (!u) return json(res, 401, { error: 'Usuario o clave incorrectos' });
      const cookie = firmar(`${u.usuario}|${Date.now()}`);
      res.setHeader('Set-Cookie',
        `pc_sesion=${encodeURIComponent(cookie)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax`);
      const t = db.tiendas.find(x => x.id === u.tiendaId);
      return json(res, 200, { ok: true, usuario: { nombre: u.nombre }, tienda: t });
    }

    if (ruta === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'pc_sesion=; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }

    // Sesión actual
    if (ruta === '/api/sesion') {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      return json(res, 200, { usuario: { nombre: u.nombre }, tienda: db.tiendas.find(t => t.id === u.tiendaId) });
    }

    // Paquete offline: el cajero se lo lleva cacheado
    if (ruta === '/api/sync') {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      return json(res, 200, {
        generado: new Date().toISOString(),
        tienda: db.tiendas.find(t => t.id === u.tiendaId),
        clientes: db.clientes.map(c => ({ token: c.token, ...publico(c), estado: c.estado }))
      });
    }

    // Validación por token NFC/QR
    if (ruta.startsWith('/api/validar/')) {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      const token = decodeURIComponent(ruta.slice('/api/validar/'.length)).toUpperCase();
      const tienda = db.tiendas.find(t => t.id === u.tiendaId);
      const cliente = db.clientes.find(c => c.token === token);
      const r = evaluar(cliente, tienda, db.canjes);
      return json(res, 200, { ...r, cliente: cliente ? publico(cliente) : null, tienda, token });
    }

    // Respaldo: el cliente olvidó la tarjeta -> buscar por DNI o celular
    if (ruta === '/api/buscar') {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 4) return json(res, 400, { error: 'Ingresa al menos 4 dígitos' });
      const encontrados = db.clientes.filter(c => c.doc.includes(q) || c.celular.includes(q));
      return json(res, 200, { resultados: encontrados.map(c => ({ token: c.token, ...publico(c) })) });
    }

    // Registrar canje (acepta lote, para la cola offline)
    if (ruta === '/api/canje' && req.method === 'POST') {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      const tienda = db.tiendas.find(t => t.id === u.tiendaId);
      const cuerpo = await leerCuerpo(req);
      const lote = Array.isArray(cuerpo.canjes) ? cuerpo.canjes : [cuerpo];
      const resultados = [];

      for (const item of lote) {
        // idempotencia: la cola offline puede reenviar el mismo canje
        if (item.idLocal && db.canjes.some(c => c.idLocal === item.idLocal)) {
          resultados.push({ idLocal: item.idLocal, estado: 'DUPLICADO' });
          continue;
        }
        const cliente = db.clientes.find(c => c.token === String(item.token || '').toUpperCase());
        const r = evaluar(cliente, tienda, db.canjes);
        if (r.estado !== 'VALIDO') {
          resultados.push({ idLocal: item.idLocal, estado: 'RECHAZADO', motivo: r.motivo });
          continue;
        }
        const canje = {
          id: 'K-' + crypto.randomBytes(4).toString('hex'),
          idLocal: item.idLocal || null,
          clienteId: cliente.id,
          tiendaId: tienda.id,
          usuario: u.usuario,
          monto: Number(item.monto) || 0,
          beneficio: tienda.beneficio,
          fecha: item.fecha || new Date().toISOString(),
          offline: !!item.offline
        };
        db.canjes.push(canje);
        resultados.push({ idLocal: item.idLocal, estado: 'OK', canje });
      }
      guardar();
      return json(res, 200, { resultados });
    }

    // Historial de la tienda
    if (ruta === '/api/canjes') {
      const u = sesionDe(req);
      if (!u) return json(res, 401, { error: 'Sin sesión' });
      const lista = db.canjes.filter(c => c.tiendaId === u.tiendaId).slice(-50).reverse()
        .map(c => ({ ...c, cliente: (db.clientes.find(x => x.id === c.clienteId) || {}).nombre }));
      return json(res, 200, { canjes: lista });
    }

    // La URL grabada en el chip NFC: /c/AB12XY -> abre la app con el token
    if (ruta.startsWith('/c/')) {
      const token = encodeURIComponent(ruta.slice(3).toUpperCase());
      res.writeHead(302, { Location: `/?t=${token}` });
      return res.end();
    }

    // Estáticos
    if (ruta === '/' || ruta === '/caja') return estatico(res, 'index.html');
    return estatico(res, ruta.slice(1));

  } catch (e) {
    console.error(e);
    json(res, 500, { error: 'Error del servidor' });
  }
});

server.listen(PORT, () => console.log(`ProbaCard escuchando en http://localhost:${PORT}`));
