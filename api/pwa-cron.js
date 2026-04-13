const { Redis } = require('@upstash/redis');
const webpush = require('web-push');

// ── Google Calendar helpers ───────────────────────────────────────────────────

// Exchange a refresh token for a new access token.
// Returns { access_token, expires_in } or null on failure.
async function refreshGoogleToken(refreshToken) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  });
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) {
      console.warn('[cron] token refresh failed:', data.error);
      return null;
    }
    return { access_token: data.access_token, expires_in: data.expires_in || 3600 };
  } catch (e) {
    console.warn('[cron] token refresh error:', e.message);
    return null;
  }
}

// Returns a valid access token, refreshing via refresh_token if needed.
// Mutates schedule.googleAccessToken + googleTokenExpiresAt in place
// so the refreshed token gets saved back to Redis at the end of the record loop.
async function getValidAccessToken(schedule) {
  const now       = Date.now();
  const expiresAt = schedule.googleTokenExpiresAt || 0;

  if (expiresAt > now + 60000) {
    // Token valid for > 60 s — use as-is
    return schedule.googleAccessToken || null;
  }

  // Expired or nearly expired — try to refresh
  if (!schedule.googleRefreshToken) return null;
  const refreshed = await refreshGoogleToken(schedule.googleRefreshToken);
  if (!refreshed) return null;

  // Mutate so the caller's record gets the updated token saved to Redis
  schedule.googleAccessToken    = refreshed.access_token;
  schedule.googleTokenExpiresAt = now + (refreshed.expires_in - 60) * 1000;
  return refreshed.access_token;
}

// Check whether there is a current or imminent (≤15 min) calendar event.
// Returns { skip: boolean, rescheduleMs: number | null }
//   skip        = true  → don't fire, reschedule to rescheduleMs from now
//   skip        = false → fire normally
// Fails open: any error returns { skip: false } so the notification fires.
async function checkCalendarMeeting(schedule) {
  const noMeeting = { skip: false, rescheduleMs: null };

  if (!schedule.calendarEnabled || !schedule.googleAccessToken) return noMeeting;

  try {
    const accessToken = await getValidAccessToken(schedule);
    if (!accessToken) return noMeeting;

    const nowMs   = Date.now();
    const nowDate = new Date(nowMs);
    const maxDate = new Date(nowMs + 15 * 60000);

    const url =
      'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
      '?timeMin='      + encodeURIComponent(nowDate.toISOString()) +
      '&timeMax='      + encodeURIComponent(maxDate.toISOString()) +
      '&singleEvents=true' +
      '&orderBy=startTime';

    const resp = await fetch(url, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });

    // 401 = token revoked — clear calendar data to stop retrying
    if (resp.status === 401) {
      console.warn('[cron] calendar 401 — clearing calendar tokens');
      schedule.googleAccessToken    = null;
      schedule.googleRefreshToken   = null;
      schedule.googleTokenExpiresAt = null;
      schedule.calendarEnabled      = false;
      return noMeeting; // fail open
    }

    if (!resp.ok) {
      console.warn('[cron] calendar API error:', resp.status);
      return noMeeting; // fail open
    }

    const data   = await resp.json();
    const events = (data.items || []).filter(function(e) {
      if (!e.start || !e.start.dateTime) return false; // skip all-day events
      // Skip events the user declined
      const self = (e.attendees || []).find(function(a) { return a.self; });
      if (self && self.responseStatus === 'declined') return false;
      return true;
    });

    if (events.length === 0) return noMeeting;

    // Reschedule to the latest event end + 2-min buffer
    const latestEndMs = Math.max.apply(null, events.map(function(e) {
      return new Date(e.end.dateTime).getTime();
    }));
    const rescheduleMs = Math.max((latestEndMs + 2 * 60000) - nowMs, 2 * 60000);

    return { skip: true, rescheduleMs: rescheduleMs };

  } catch (e) {
    console.warn('[cron] calendar check error:', e.message);
    return noMeeting; // fail open
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const redis = Redis.fromEnv();
  const now = Date.now();
  const results = { checked: 0, fired: 0, errors: 0, skipped: 0, stale: 0, calSkipped: 0 };

  try {
    const keys = await redis.smembers('active_subs');
    if (!keys || keys.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active subscriptions', ...results });
    }

    results.checked = keys.length;

    for (const key of keys) {
      try {
        const raw = await redis.get(key);
        if (!raw) { await redis.srem('active_subs', key); continue; }

        const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const { subscription, schedule, installationId } = record;
        if (!subscription || !subscription.endpoint) continue;

        let updated = false;

        // ── Stretch ───────────────────────────────────────────────────────────
        if (schedule.stretchEnabled && schedule.nextStretchTime) {
          const overdueSec = (now - schedule.nextStretchTime) / 1000;

          if (overdueSec >= 0) {
            const maxOverdueSec = (schedule.stretchInterval || 30) * 60 * 2;

            if (overdueSec > maxOverdueSec) {
              // Stale guard — cron was down, skip and reset
              console.log(`[cron] stretch stale for ${installationId} (${Math.round(overdueSec/60)} min overdue) — skipping fire`);
              schedule.nextStretchTime = now + (schedule.stretchInterval || 30) * 60000;
              updated = true;
              results.stale++;
            } else {
              // Google Calendar check
              let calSkip = false;
              if (schedule.calendarSkipStretch && schedule.calendarEnabled && schedule.googleAccessToken) {
                const cal = await checkCalendarMeeting(schedule);
                if (cal.skip) {
                  calSkip = true;
                  schedule.nextStretchTime = now + cal.rescheduleMs;
                  updated = true;
                  results.calSkipped++;
                  console.log(`[cron] stretch meeting-skipped for ${installationId} — reschedule in ${Math.round(cal.rescheduleMs / 60000)} min`);
                }
              }

              if (!calSkip) {
                const payload = JSON.stringify({
                  type:   'stretch',
                  title:  'Time to stretch! 🧘',
                  body:   `You've been at your desk for ${schedule.stretchInterval} min. Take a quick break.`,
                  screen: 'stretch',
                  icon:   '/assets/icons/icon-192.png',
                  badge:  '/assets/icons/icon-192.png',
                  tag:    'stretch-reminder',
                });
                try {
                  await webpush.sendNotification(subscription, payload);
                  results.fired++;
                  console.log(`[cron] stretch fired for ${installationId}`);
                } catch (pushErr) {
                  console.error(`[cron] stretch push failed:`, pushErr.statusCode);
                  if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await redis.del(key); await redis.srem('active_subs', key);
                    results.errors++; continue;
                  }
                  results.errors++;
                }
                // Always reschedule — even on push failure — so cron doesn't retry next minute
                schedule.nextStretchTime = now + (schedule.stretchInterval || 30) * 60000;
                updated = true;
              }
            }
          }
        }

        // ── Water ─────────────────────────────────────────────────────────────
        if (schedule.waterEnabled && schedule.nextWaterTime) {
          const overdueSec = (now - schedule.nextWaterTime) / 1000;

          if (overdueSec >= 0) {
            const maxOverdueSec = (schedule.waterInterval || 30) * 60 * 2;

            if (overdueSec > maxOverdueSec) {
              console.log(`[cron] water stale for ${installationId} — skipping fire`);
              schedule.nextWaterTime = now + (schedule.waterInterval || 30) * 60000;
              updated = true;
              results.stale++;
            } else {
              // Google Calendar check
              let calSkip = false;
              if (schedule.calendarSkipWater && schedule.calendarEnabled && schedule.googleAccessToken) {
                const cal = await checkCalendarMeeting(schedule);
                if (cal.skip) {
                  calSkip = true;
                  schedule.nextWaterTime = now + cal.rescheduleMs;
                  updated = true;
                  results.calSkipped++;
                  console.log(`[cron] water meeting-skipped for ${installationId} — reschedule in ${Math.round(cal.rescheduleMs / 60000)} min`);
                }
              }

              if (!calSkip) {
                const payload = JSON.stringify({
                  type:   'water',
                  title:  'Drink some water! 💧',
                  body:   'Stay hydrated — time for a glass of water.',
                  screen: 'water',
                  icon:   '/assets/icons/icon-192.png',
                  badge:  '/assets/icons/icon-192.png',
                  tag:    'water-reminder',
                });
                try {
                  await webpush.sendNotification(subscription, payload);
                  results.fired++;
                  console.log(`[cron] water fired for ${installationId}`);
                } catch (pushErr) {
                  console.error(`[cron] water push failed:`, pushErr.statusCode);
                  if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await redis.del(key); await redis.srem('active_subs', key);
                    results.errors++; continue;
                  }
                  results.errors++;
                }
                schedule.nextWaterTime = now + (schedule.waterInterval || 30) * 60000;
                updated = true;
              }
            }
          }
        }

        if (updated) {
          record.schedule  = schedule;
          record.updatedAt = now;
          // Save back — must succeed — includes any refreshed tokens
          await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });
          console.log(`[cron] schedule updated for ${installationId} — nextStretch: ${schedule.nextStretchTime ? new Date(schedule.nextStretchTime).toISOString() : 'n/a'}`);
        } else {
          results.skipped++;
        }

      } catch (recordErr) {
        console.error(`[cron] error processing ${key}:`, recordErr);
        results.errors++;
      }
    }

    console.log(`[cron] done — checked:${results.checked} fired:${results.fired} calSkipped:${results.calSkipped} stale:${results.stale} errors:${results.errors} skipped:${results.skipped}`);
    return res.status(200).json({ ok: true, ...results });

  } catch (err) {
    console.error('[cron] fatal:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
