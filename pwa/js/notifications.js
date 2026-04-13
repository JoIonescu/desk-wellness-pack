/**
 * notifications.js
 *
 * Day 3-4: This is where all notification scheduling logic lives.
 *
 * The service worker (service-worker.js) handles the actual push/notification
 * events. This module is the client-side interface that tells the SW when to
 * fire and what to say.
 *
 * Current state: placeholder exports so app.js and home.js can import without errors.
 * Full implementation arrives Day 3-4.
 */

/** Schedule a stretch notification in `intervalMinutes` from now. */
export async function scheduleStretch(intervalMinutes) {
  const fireAt = Date.now() + intervalMinutes * 60 * 1000;
  localStorage.setItem('nextStretchTime', JSON.stringify(fireAt));
  // Day 3-4: postMessage to SW to set a timeout / use Notification Triggers API
  console.log('[notifications] scheduleStretch in', intervalMinutes, 'min');
}

/** Cancel any pending stretch notification. */
export async function cancelStretch() {
  localStorage.removeItem('nextStretchTime');
  console.log('[notifications] cancelStretch');
}

/** Schedule a water notification in `intervalMinutes` from now. */
export async function scheduleWater(intervalMinutes) {
  const fireAt = Date.now() + intervalMinutes * 60 * 1000;
  localStorage.setItem('nextWaterTime', JSON.stringify(fireAt));
  console.log('[notifications] scheduleWater in', intervalMinutes, 'min');
}

/** Cancel any pending water notification. */
export async function cancelWater() {
  localStorage.removeItem('nextWaterTime');
  console.log('[notifications] cancelWater');
}
