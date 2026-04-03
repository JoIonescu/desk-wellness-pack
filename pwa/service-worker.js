/**
 * service-worker.js
 *
 * Day 1-2 scope: install + cache shell, offline-first fetch.
 * Notifications (Day 3-4) will be added here: self.addEventListener('push', ...)
 */

const CACHE_NAME = 'dwp-pwa-v1';

// Files to cache on install — the app shell
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/base.css',
  '/js/app.js',
  '/js/storage.js',
  '/js/notifications.js',
  '/js/home.js',
  '/js/stretch.js',
  '/js/water.js',
  '/js/welcome.js',
  '/js/license.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails silently on individual misses — use individual add
      return Promise.allSettled(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Could not cache:', url, err.message);
          })
        )
      );
    }).then(() => {
      console.log('[SW] Install complete');
      return self.skipWaiting(); // activate immediately
    })
  );
});

// ── Activate ──────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Activate complete');
      return self.clients.claim(); // take control of all pages
    })
  );
});

// ── Fetch — cache-first for shell, network-first for API ──────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't intercept non-GET or cross-origin (Vercel backend, Stripe)
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls: network-first, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // Shell: cache-first, fall back to network, fall back to /index.html for SPA routing
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // Cache fresh responses
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: return the shell
          return caches.match('/index.html');
        });
    })
  );
});

// ── Notifications ─────────────────────────────────────────────────
// Placeholder — Day 3-4 will add:
// self.addEventListener('push', ...)
// self.addEventListener('notificationclick', ...)

// ── Message from client (e.g. schedule/cancel notification) ───────
self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // Day 3-4 will handle: SCHEDULE_STRETCH, SCHEDULE_WATER, CANCEL_STRETCH, CANCEL_WATER
    default:
      console.log('[SW] Unhandled message:', event.data.type);
  }
});