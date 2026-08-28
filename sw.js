const CACHE = 'mvpoisk-shell-v30';
const SHELL = [
  './', './index.html', './movie.html', './my.html', './404.html', './styles.css?v=30',
  './js/config.js?v=30', './js/api.js?v=30', './js/images.js?v=30', './js/storage.js?v=30',
  './js/common.js?v=30', './js/app.js?v=30', './js/movie.js?v=30', './js/my.js?v=30', './js/tv.js?v=30',
  './manifest.webmanifest',
  './icons/favicon-16.png', './icons/favicon-32.png', './icons/logo-mark-64.png', './icons/logo-mark-128.png',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
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
  event.respondWith(fetch(request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request).then(hit => hit || caches.match('./index.html'))));
});
