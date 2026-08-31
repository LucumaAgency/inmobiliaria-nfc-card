/**
 * Service worker de ProbaCard.
 * Estrategia: red primero para la API, caché primero para el armazón de la app.
 * Sube CACHE cada vez que cambies archivos de public/.
 */
const CACHE = 'probacard-v2';
const ARMAZON = ['/', '/app.js', '/estilos.css', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;              // los POST los maneja la cola en IndexedDB
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API: siempre red. Si falla, que el JS decida con los datos offline.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req));
    return;
  }

  // Armazón: caché primero, y refresca en segundo plano.
  e.respondWith(
    caches.match(req).then(hit => {
      const red = fetch(req).then(resp => {
        if (resp.ok) caches.open(CACHE).then(c => c.put(req, resp.clone()));
        return resp;
      }).catch(() => hit || caches.match('/'));
      return hit || red;
    })
  );
});

// Android: reintenta la cola aunque la app esté cerrada. En iOS no existe; ahí
// la sincronización la dispara app.js al abrir y al volver la conexión.
self.addEventListener('sync', e => {
  if (e.tag === 'sync-canjes') {
    e.waitUntil(self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ tipo: 'sincronizar' }))));
  }
});
