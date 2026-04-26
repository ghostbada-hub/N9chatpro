// ── N9chat Pro — Service Worker v4 (offline-ready) ──────────────
const CACHE_NAME = 'n9chat-pro-v4';

// Tous les assets locaux à pré-cacher à l'installation
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

// CDN externes à cacher au premier accès
const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
];

// ── INSTALL : pré-cache les assets locaux ───────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        PRECACHE_ASSETS.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => { if (res.ok) cache.put(url, res); })
            .catch(() => {})
        )
      )
    )
  );
});

// ── ACTIVATE : supprime les anciens caches ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH : stratégie selon le type de requête ───────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Appels API Groq → réseau uniquement, pas de cache
  //    Si hors ligne, renvoyer une réponse JSON d'erreur lisible
  if (url.hostname.includes('groq.com') || url.hostname.includes('api.groq')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({
            error: true,
            message: 'Hors ligne — connexion réseau requise pour les réponses IA.'
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. Assets locaux (même origine) → Cache-first, puis réseau
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => {
          // Fallback : renvoyer index.html pour les navigations
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }

  // 3. CDN externes (fonts, libs) → Cache-first, puis réseau, silencieux hors ligne
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // 4. Tout le reste → réseau direct
  event.respondWith(fetch(event.request).catch(() => new Response('', { status: 408 })));
});
