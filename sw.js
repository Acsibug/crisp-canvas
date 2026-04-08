// CrispNW Field Canvas — Service Worker v1.0
// Offline App Shell cache + Background Sync for lead queue

const CACHE_NAME = 'crispnw-shell-v5';
const APP_SHELL  = ['/', '/index.html', '/manifest.json'];
// ── Install: pre-cache App Shell ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// ── Activate: purge stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: Cache-first for App Shell, network-first for everything else ─────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests from this origin (skip GAS backend, placeholder CDN, etc.)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(response => {
        // Refresh cache for App Shell resources on successful network fetch
        if (response.ok && APP_SHELL.some(p => url.pathname === p || url.pathname.endsWith(p))) {
          caches.open(CACHE_NAME).then(c => c.put(req, response.clone()));
        }
        return response;
      }).catch(() => {
        // Offline fallback: serve cached index.html for page navigations
        if (req.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});

// ── Background Sync: drain the offline lead queue when connectivity returns ──
// The app stores queued leads in localStorage under 'crispnw_pendingLeads'.
// When the browser fires a 'sync' event (connectivity restored), we notify
// all open app clients to run their existing trySyncQueue() function.
self.addEventListener('sync', event => {
  if (event.tag === 'crispnw-sync-leads') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SW_SYNC_LEADS' }))
      )
    );
  }
});

// ── Message handler ───────────────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
