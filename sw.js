/*
  Service Worker - DoseCheck
  Estratégia:
  - Cache-first para assets do app (app shell)
  - Network-first (com fallback) para chamadas de API (quando existirem)

  Observação: Como o app é SPA (hash routing), cacheamos index.html.
*/

// Cache com nome estável: facilita atualizar sem precisar “reinstalar” o atalho.
const CACHE_NAME = 'dosecheck-cache';

// Atualize a lista se adicionar novos arquivos estáticos.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/maskable-512.svg',
  './icons/screenshot-narrow.svg',
  './icons/screenshot-wide.svg'
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Atualiza os arquivos do app shell dentro do mesmo cache.
      await cache.addAll(APP_SHELL);

      // Deixa a atualização disponível imediatamente.
      // O app controla a UX (banner) para evitar reload automático.
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k)))
      );

      // Boa prática moderna: Navigation Preload (quando suportado)
      // Ajuda a reduzir latência de navegação em redes lentas.
      try {
        if (self.registration && self.registration.navigationPreload) {
          await self.registration.navigationPreload.enable();
        }
      } catch {
        // Ignora (nem todos browsers suportam)
      }

      self.clients.claim();
    })()
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isNavigationRequest(req) {
  if (req.mode === 'navigate') return true;
  const accept = req.headers.get('accept') || '';
  return accept.includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Só cuidamos de GET.
  if (req.method !== 'GET') return;

  // Network-first para API
  if (isApiRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // Network-first para navegação (garante que index.html atualize quando estiver online)
  if (isNavigationRequest(req)) {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            const cache = await caches.open(CACHE_NAME);
            cache.put('./index.html', preload.clone());
            return preload;
          }

          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match('./index.html');
          return cached || new Response('Offline', { status: 503 });
        }
      })()
    );
    return;
  }

  // Assets: stale-while-revalidate (rápido e atualiza em background)
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const cache = await caches.open(CACHE_NAME);

      const revalidate = (async () => {
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return null;
        }
      })();

      if (cached) {
        event.waitUntil(revalidate);
        return cached;
      }

      const fresh = await revalidate;
      if (fresh) return fresh;

      const fallback = await caches.match('./index.html');
      return fallback || new Response('Offline', { status: 503 });
    })()
  );
});
