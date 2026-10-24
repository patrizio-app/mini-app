/* Service worker: tiene la app sul dispositivo per usarla senza internet.
 * GENERATO da strumenti/monta_contratti.py (la VERSIONE cambia da sola quando cambiano i file). */
const VERSIONE = 'contratti-1bba8bd085';
const FILE = ['./', './index.html', './style.css', './app.js', './logica.js', './pdf.js', './base.js', './pdf.css', './manifest.webmanifest', './tpl/pdf_preventivo.html', './tpl/pdf_contratto.html', './tpl/pdf_fattura.html', './vendor/nunjucks.min.js', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './fonts/Anton-Regular.woff2', './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n !== VERSIONE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    if (resp && resp.ok && new URL(e.request.url).origin === location.origin) {
      const c = resp.clone(); caches.open(VERSIONE).then(x => x.put(e.request, c));
    }
    return resp;
  }).catch(() => caches.match('./index.html'))));
});
