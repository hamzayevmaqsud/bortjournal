/* Бортжурнал — service worker: страница открывается и без сети.
   Файлы приложения — сначала из сети (чтобы обновления приходили сразу), без сети — из кэша.
   Запросы к /api/ не кэшируются: данные всегда с сервера. */
const CACHE = 'bortjournal-v8';
const SHELL = ['/', '/app.js', '/plan.js', '/styles.css', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

/* напоминания: сервер присылает { title, body, url, tag } */
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Бортжурнал', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Бортжурнал', {
    body: m.body || '', tag: m.tag || undefined, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const w = list.find(c => new URL(c.url).origin === location.origin);
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
