/*
 * sw.js — Service worker do Classificador de Camarão.
 * Guarda o app shell em cache para funcionar sem sinal na fábrica.
 * A cada atualização de qualquer arquivo (tabelas, telas, ícones), mude
 * VERSION: o cache antigo é apagado e o novo é baixado na próxima abertura.
 */
const VERSION = '1.1.0';
const CACHE = 'classificador-camarao-' + VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './app.js',
  './manifest.webmanifest',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-512-maskable.png',
  './icones/apple-touch-icon.png',
  './icones/logo-frescatto.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('classificador-camarao-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Cache primeiro (o app é estático e versionado); rede como alternativa.
// Navegação sem cache correspondente cai no index.html (abre offline).
self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    caches.match(req, { ignoreSearch: true }).then((emCache) => {
      if (emCache) return emCache;
      return fetch(req).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
