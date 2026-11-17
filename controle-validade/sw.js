/*
 * sw.js — Service worker do Validade em Dia.
 * Guarda o app no aparelho para abrir na hora e funcionar sem internet (as
 * etiquetas e o catálogo ficam no próprio aparelho, não passam por aqui).
 * Entrega o que está guardado e busca a versão nova em segundo plano: uma
 * atualização publicada aparece na abertura seguinte do app.
 * Mude VERSION a cada atualização para descartar o cache antigo.
 */
const VERSION = '0.3.0';
const CACHE = 'validade-' + VERSION;

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
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith('validade-') && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((emCache) => {
        const daRede = fetch(req).then((resp) => {
          if (resp.ok) cache.put(req, resp.clone());
          return resp;
        });
        if (emCache) {
          ev.waitUntil(daRede.catch(() => {}));
          return emCache;
        }
        return daRede.catch(() => (req.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
      })
    )
  );
});
