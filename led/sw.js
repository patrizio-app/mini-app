/* Service worker: tiene la app salvata sul dispositivo per usarla senza internet.
 * VERSIONE la aggiorna da solo strumenti/monta_led.py a ogni montaggio. */
const VERSIONE = 'led-30515ec14f';
const FILE = [
  './', './index.html', './mini.css', './mini.js', './motore.js', './manifest.webmanifest',
  './editor/app.css', './editor/audio-assistant.css', './editor/coreografia.css',
  './editor/audio-assistant.js', './editor/coreografia.js', './editor/registro.js',
  './vendor/jszip.min.js', './vendor/exceljs.min.js',
  './fonts/fonts.css',
  './assets/icon-180.png', './assets/icon-192.png', './assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSIONE).then(async (c) => {
    await c.addAll(FILE);
    // i caratteri: tutti quelli citati in fonts.css
    const css = await (await fetch('./fonts/fonts.css')).text();
    const font = Array.from(css.matchAll(/url\(([^)]+\.woff2)\)/g), (m) => './fonts/' + m[1]);
    await c.addAll(Array.from(new Set(font)));
  }).then(() => self.skipWaiting()));
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
