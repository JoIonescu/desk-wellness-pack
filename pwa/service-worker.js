/**
 * service-worker.js — Desk Wellness Pack PWA
 * Handles: shell caching + push notification display + notification clicks
 */

const CACHE_NAME = 'dwp-shell-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] install v3');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        SHELL_FILES.map(url =>
          cache.add(url).catch(e => console.warn('[SW] cache miss:', url, e.message))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] activate v3');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});

// ── Push — fired by server via web-push ───────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] push received');
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch(e) {
    console.error('[SW] push data parse error:', e);
    return;
  }

  const { title, body, icon, badge, tag, screen } = data;

  const options = {
    body:    body    || 'Time for a reminder.',
    icon:    icon    || './assets/icons/icon-192.png',
    badge:   badge   || './assets/icons/icon-192.png',
    tag:     tag     || 'dwp-reminder',
    vibrate: [200, 100, 200],
    data:    { screen: screen || '' },
    requireInteraction: false,
    actions: screen === 'stretch'
      ? [{ action: 'open',   title: 'Start stretch' },
         { action: 'snooze', title: 'Snooze 5 min'  }]
      : [{ action: 'open',   title: 'Log a glass'   },
         { action: 'skip',   title: 'Skip'           }],
  };

  event.waitUntil(
    self.registration.showNotification(title || 'Desk Wellness', options)
  );
});

// ── Notification click ────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const screen = event.notification.data?.screen || '';
  const action = event.action;

  event.waitUntil((async () => {
    // Snooze: tell the page / server to push again in 5 min
    // For now: just open the app — full snooze via server comes later
    if (action === 'skip') return;

    const targetUrl  = self.location.origin + '/?screen=' + (screen || '');
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing   = allClients.find(c => new URL(c.url).origin === self.location.origin);

    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'NAVIGATE', screen });
    } else {
      await clients.openWindow(targetUrl);
    }
  })());
});

// ── Messages from page ────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
