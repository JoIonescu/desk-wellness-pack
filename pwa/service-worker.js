/**
 * service-worker.js — Desk Wellness Pack PWA v4
 */

const CACHE_NAME     = 'dwp-shell-v4';
const SCHEDULE_CACHE = 'dwp-schedule-v1';
const SCHEDULE_KEY   = '/schedule.json';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

// ── Install ───────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] install v4');
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
  console.log('[SW] activate v4');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== SCHEDULE_CACHE).map(k => caches.delete(k))
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

// ── Push ──────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch(e) { return; }

  const { title, body, icon, badge, tag, screen } = data;
  const options = {
    body:    body    || 'Time for a reminder.',
    icon:    icon    || './assets/icons/icon-192.png',
    badge:   badge   || './assets/icons/icon-192.png',
    tag:     tag     || 'dwp-reminder',
    // Long vibrate pattern — may wake screen on some Android devices
    vibrate: [300, 100, 300, 100, 300],
    data:    { screen: screen || '', type: 'reminder' },
    // Keep notification visible on lock screen until user acts
    requireInteraction: true,
    actions: screen === 'stretch'
      ? [{ action: 'open',   title: 'Start stretch' },
         { action: 'snooze', title: 'Snooze 5 min'  }]
      : [{ action: 'open',   title: 'Log a glass'   },
         { action: 'skip',   title: 'Skip'           }],
  };

  // Show cron notification ALONGSIDE the status notification (different tag)
  // User sees both: "Stretch active" + "Time to stretch!" — taps the latter to start
  event.waitUntil(
    self.registration.showNotification(title || 'Desk Wellness', options)
  );
});

// ── Notification click ────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  const notifData = event.notification.data || {};
  const screen    = notifData.screen || '';
  const type      = notifData.type   || '';
  const action    = event.action;

  event.notification.close();

  event.waitUntil((async () => {

    // ── Status notification tapped ────────────────────────────────
    // User tapped the "timer running" bar notification.
    // Open app on home screen — app will re-show the status notif.
    if (type === 'status') {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing   = allClients.find(c => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'STATUS_TAPPED' });
      } else {
        await clients.openWindow('./');
      }
      return;
    }

    // ── Reminder notification: snooze action ──────────────────────
    if (action === 'snooze') {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      allClients.forEach(c => c.postMessage({ type: 'SNOOZE_FROM_NOTIF' }));
      return;
    }

    // ── Reminder notification: skip water ─────────────────────────
    if (action === 'skip') return;

    // ── Reminder notification tapped (default or 'open' action) ────
    // Close only the cron notification (status notification stays)
    // Navigate to break screen + unlock audio (tap = user gesture)
    const targetUrl  = self.location.origin + '/?screen=' + (screen || '');
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing   = allClients.find(c => new URL(c.url).origin === self.location.origin);

    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'NAVIGATE', screen, unlockAudio: true });
    } else {
      // App was killed — open with screen param, boot() will route correctly
      await clients.openWindow(targetUrl);
    }

  })());
});

// ── Messages from page ────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data?.type) return;
  if (event.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (event.data.type === 'CLOSE_STATUS_NOTIF') {
    self.registration.getNotifications({ tag:'dwp-status' })
      .then(function(notifs){ notifs.forEach(function(n){ n.close(); }); })
      .catch(function(){});
  }
});
