/**
 * service-worker.js — Desk Wellness Pack PWA
 *
 * Handles:
 * 1. Shell caching (offline support)
 * 2. Schedule storage (shared with page via postMessage + Cache API)
 * 3. Periodic Background Sync — checks ~every 5 min if a reminder is due
 * 4. Notification display + click/action handling
 */

const CACHE_NAME     = 'dwp-shell-v2';
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
  console.log('[SW] install');
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
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== SCHEDULE_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch — cache-first for shell, passthrough for API ───────────
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

// ── Schedule storage (Cache API — accessible from SW) ────────────
async function getSchedule() {
  try {
    const cache = await caches.open(SCHEDULE_CACHE);
    const resp  = await cache.match(SCHEDULE_KEY);
    if (!resp) return {};
    return await resp.json();
  } catch (e) {
    return {};
  }
}

async function setSchedule(data) {
  try {
    const cache = await caches.open(SCHEDULE_CACHE);
    await cache.put(
      SCHEDULE_KEY,
      new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
    );
  } catch (e) {
    console.warn('[SW] setSchedule error', e);
  }
}

// ── Check if any reminders are due and fire them ──────────────────
async function checkAndNotify() {
  const schedule = await getSchedule();
  const now = Date.now();
  let changed = false;

  if (schedule.stretchEnabled && schedule.nextStretchTime && now >= schedule.nextStretchTime) {
    await showReminder('stretch', schedule.stretchInterval ?? 30);
    schedule.nextStretchTime = now + (schedule.stretchInterval ?? 30) * 60000;
    changed = true;
  }

  if (schedule.waterEnabled && schedule.nextWaterTime && now >= schedule.nextWaterTime) {
    await showReminder('water', schedule.waterInterval ?? 30);
    schedule.nextWaterTime = now + (schedule.waterInterval ?? 30) * 60000;
    changed = true;
  }

  if (changed) await setSchedule(schedule);
}

async function showReminder(type, intervalMin) {
  const isStretch = type === 'stretch';
  await self.registration.showNotification(
    isStretch ? 'Time to stretch! 🧘' : 'Drink some water! 💧',
    {
      body: isStretch
        ? `You've been at your desk for ${intervalMin} min. Take a quick break.`
        : 'Stay hydrated — time for a glass of water.',
      tag:     isStretch ? 'stretch-reminder' : 'water-reminder',
      icon:    './assets/icons/icon-192.png',
      badge:   './assets/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data:    { screen: type },
      actions: isStretch
        ? [{ action: 'open',   title: 'Start stretch' },
           { action: 'snooze', title: 'Snooze 5 min'  }]
        : [{ action: 'open',   title: 'Log a glass'   },
           { action: 'skip',   title: 'Skip'           }],
    }
  );
}

// ── Periodic Background Sync ──────────────────────────────────────
// Chrome for Android fires this roughly every minInterval (we request 5 min).
// Actual frequency is controlled by the browser based on battery/usage patterns.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-reminders') {
    console.log('[SW] periodic sync fired — checking reminders');
    event.waitUntil(checkAndNotify());
  }
});

// ── Notification click ────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const screen = event.notification.data?.screen ?? '';
  const action = event.action;

  event.waitUntil((async () => {
    // Snooze: reschedule stretch 5 min from now, don't open app
    if (action === 'snooze') {
      const s = await getSchedule();
      s.nextStretchTime = Date.now() + 5 * 60000;
      await setSchedule(s);
      // Also tell any open clients to update their countdown
      const allClients = await clients.matchAll({ type: 'window' });
      allClients.forEach(c => c.postMessage({ type: 'SNOOZED', screen: 'stretch' }));
      return;
    }

    // Water skip: just close (notification already closed)
    if (action === 'skip') return;

    // Default / 'open': focus existing window or open new one
    const targetUrl  = self.location.origin + (screen ? `/?screen=${screen}` : '/');
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

// ── Notification dismissed by user ───────────────────────────────
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] notification dismissed:', event.notification.tag);
});

// ── Messages from page ────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (!event.data?.type) return;
  const { type, data } = event.data;

  const handlers = {
    SCHEDULE_STRETCH: async () => {
      const s = await getSchedule();
      s.stretchEnabled  = true;
      s.stretchInterval = data.interval;
      s.nextStretchTime = Date.now() + data.interval * 60000;
      await setSchedule(s);
    },
    CANCEL_STRETCH: async () => {
      const s = await getSchedule();
      s.stretchEnabled  = false;
      s.nextStretchTime = null;
      await setSchedule(s);
    },
    SCHEDULE_WATER: async () => {
      const s = await getSchedule();
      s.waterEnabled  = true;
      s.waterInterval = data.interval;
      s.nextWaterTime = Date.now() + data.interval * 60000;
      await setSchedule(s);
    },
    CANCEL_WATER: async () => {
      const s = await getSchedule();
      s.waterEnabled  = false;
      s.nextWaterTime = null;
      await setSchedule(s);
    },
    SNOOZE_STRETCH: async () => {
      const s = await getSchedule();
      s.nextStretchTime = Date.now() + 5 * 60000;
      await setSchedule(s);
    },
    SKIP_WAITING: () => self.skipWaiting(),
  };

  const handler = handlers[type];
  if (handler) handler().catch(e => console.error('[SW] message handler error:', type, e));
  else console.log('[SW] unhandled message:', type);
});
