const { Redis } = require('@upstash/redis');
const webpush = require('web-push');

module.exports = async function handler(req, res) {
  // Auth check
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
  const results = { checked: 0, fired: 0, errors: 0, skipped: 0 };

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

        // Check stretch
        if (schedule.stretchEnabled && schedule.nextStretchTime && now >= schedule.nextStretchTime) {
          const payload = JSON.stringify({
            type:  'stretch',
            title: 'Time to stretch! 🧘',
            body:  `You've been at your desk for ${schedule.stretchInterval} min. Take a quick break.`,
            screen: 'stretch',
            icon:  '/assets/icons/icon-192.png',
            badge: '/assets/icons/icon-192.png',
            tag:   'stretch-reminder',
          });
          try {
            await webpush.sendNotification(subscription, payload);
            results.fired++;
            schedule.nextStretchTime = now + schedule.stretchInterval * 60 * 1000;
            updated = true;
            console.log(`[cron] stretch fired for ${installationId}`);
          } catch (pushErr) {
            console.error(`[cron] stretch push failed:`, pushErr.statusCode);
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              await redis.del(key); await redis.srem('active_subs', key);
            }
            results.errors++;
          }
        }

        // Check water
        if (schedule.waterEnabled && schedule.nextWaterTime && now >= schedule.nextWaterTime) {
          const payload = JSON.stringify({
            type:  'water',
            title: 'Drink some water! 💧',
            body:  'Stay hydrated — time for a glass of water.',
            screen: 'water',
            icon:  '/assets/icons/icon-192.png',
            badge: '/assets/icons/icon-192.png',
            tag:   'water-reminder',
          });
          try {
            await webpush.sendNotification(subscription, payload);
            results.fired++;
            schedule.nextWaterTime = now + schedule.waterInterval * 60 * 1000;
            updated = true;
            console.log(`[cron] water fired for ${installationId}`);
          } catch (pushErr) {
            console.error(`[cron] water push failed:`, pushErr.statusCode);
            if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
              await redis.del(key); await redis.srem('active_subs', key);
            }
            results.errors++;
          }
        }

        if (updated) {
          record.schedule = schedule;
          record.updatedAt = now;
          await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });
        } else {
          results.skipped++;
        }

      } catch (recordErr) {
        console.error(`[cron] error processing ${key}:`, recordErr);
        results.errors++;
      }
    }

    console.log(`[cron] done — checked:${results.checked} fired:${results.fired} errors:${results.errors}`);
    return res.status(200).json({ ok: true, ...results });

  } catch (err) {
    console.error('[cron] fatal:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
