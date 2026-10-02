const CACHE = 'mvpoisk-shell-v47';
const SHELL = [
  './', './index.html', './movie.html', './my.html', './404.html', './styles.css?v=47',
  './js/config.js?v=47', './js/api.js?v=47', './js/images.js?v=47', './js/storage.js?v=47',
  './js/common.js?v=47', './js/account.js?v=47', './js/app.js?v=47', './js/movie.js?v=47', './js/my.js?v=47', './js/tv.js?v=47',
  './manifest.webmanifest',
  './icons/favicon-16.png', './icons/favicon-32.png', './icons/logo-mark-64.png', './icons/logo-mark-128.png',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/mvz-vps-promo.webp'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    } catch {
      const hit = await caches.match(request);
      if (hit) return hit;
      if (request.mode === 'navigate') return caches.match('./index.html');
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
