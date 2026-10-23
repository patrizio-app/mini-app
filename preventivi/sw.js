/* Service worker: tiene la app salvata sul dispositivo per usarla senza internet.
 * Quando aggiorni i file della app, cambia VERSIONE così i dispositivi scaricano la nuova. */
const VERSIONE = 'ppp-prev-v3';
const FILE = [
  './', './index.html', './style.css', './app.js', './pdf.js', './pdf-css.js', './config-ppp.js',
  './manifest.webmanifest',
  './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js',
  './assets/Anton-Regular.woff2', './assets/Anton-Regular.woff',
  './assets/logo_white.png', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
      if (resp && resp.ok && new URL(e.request.url).origin === location.origin) {
        const copia = resp.clone();
        caches.open(VERSIONE).then(c => c.put(e.request, copia));
      }
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
