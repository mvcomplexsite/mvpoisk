const CACHE = 'mvpoisk-shell-v16';
const SHELL = [
  './', './index.html', './movie.html', './my.html', './404.html', './styles.css?v=16',
  './js/config.js?v=16', './js/api.js?v=16', './js/images.js?v=16', './js/storage.js?v=16',
  './js/common.js?v=16', './js/app.js?v=16', './js/movie.js?v=16', './js/my.js?v=16',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
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
