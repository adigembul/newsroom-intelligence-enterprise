const CACHE = 'newsroom-intelligence-v2-1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/realtime')) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
