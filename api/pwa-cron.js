const { Redis } = require('@upstash/redis');
const webpush = require('web-push');

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
  const results = { checked: 0, fired: 0, errors: 0, skipped: 0, stale: 0 };

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

        // ── Stretch ──────────────────────────────────────────────
        if (schedule.stretchEnabled && schedule.nextStretchTime) {
          const overdueSec = (now - schedule.nextStretchTime) / 1000;

          if (overdueSec >= 0) {
            // Stale guard: if overdue by more than 2x the interval, skip firing
            // (cron was down — don't spam the user with missed notifications)
            const maxOverdueSec = (schedule.stretchInterval || 30) * 60 * 2;
            if (overdueSec > maxOverdueSec) {
              console.log(`[cron] stretch stale for ${installationId} (${Math.round(overdueSec/60)} min overdue) — skipping fire`);
              schedule.nextStretchTime = now + (schedule.stretchInterval || 30) * 60000;
              updated = true;
              results.stale++;
            } else {
              const payload = JSON.stringify({
                type: 'stretch',
                title: 'Time to stretch! 🧘',
                body: `You've been at your desk for ${schedule.stretchInterval} min. Take a quick break.`,
                screen: 'stretch',
                icon: '/assets/icons/icon-192.png',
                badge: '/assets/icons/icon-192.png',
                tag: 'stretch-reminder',
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
              // Always reschedule — even if push failed — so we don't retry next minute
              schedule.nextStretchTime = now + (schedule.stretchInterval || 30) * 60000;
              updated = true;
            }
          }
        }

        // ── Water ─────────────────────────────────────────────────
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
              const payload = JSON.stringify({
                type: 'water',
                title: 'Drink some water! 💧',
                body: 'Stay hydrated — time for a glass of water.',
                screen: 'water',
                icon: '/assets/icons/icon-192.png',
                badge: '/assets/icons/icon-192.png',
                tag: 'water-reminder',
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

        if (updated) {
          record.schedule = schedule;
          record.updatedAt = now;
          // Save back — this is critical, must succeed
          await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });
          console.log(`[cron] schedule updated for ${installationId} — nextStretch: ${new Date(schedule.nextStretchTime).toISOString()}`);
        } else {
          results.skipped++;
        }

      } catch (recordErr) {
        console.error(`[cron] error processing ${key}:`, recordErr);
        results.errors++;
      }
    }

    console.log(`[cron] done — checked:${results.checked} fired:${results.fired} stale:${results.stale} errors:${results.errors} skipped:${results.skipped}`);
    return res.status(200).json({ ok: true, ...results });

  } catch (err) {
    console.error('[cron] fatal:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
