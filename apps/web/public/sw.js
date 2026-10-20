// Офлайн-оболочка: страница — сначала из сети, без сети — из кэша; сборка (/assets/) — из кэша навсегда,
// у её файлов в имени хэш. Данные (/api/) не кэшируются никогда — компьютер и телефон смотрят в одну базу.
const SHELL = 'bj-shell-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  if (u.pathname.startsWith('/assets/')) e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); return r; })));
});
