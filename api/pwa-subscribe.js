const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const redis = Redis.fromEnv();
    const { action, subscription, installationId, schedule } = req.body;

    if (!installationId) return res.status(400).json({ error: 'installationId required' });

    const key = `sub:${installationId}`;

    if (action === 'unsubscribe') {
      await redis.del(key);
      await redis.srem('active_subs', key);
      return res.status(200).json({ ok: true, action: 'deleted' });
    }

    if (action === 'subscribe' || action === 'update') {
      if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'subscription required' });
      }

      const now = Date.now();
      const record = {
        subscription,
        installationId,
        schedule: {
          stretchEnabled:  schedule && schedule.stretchEnabled  ? true : false,
          stretchInterval: schedule && schedule.stretchInterval ? schedule.stretchInterval : 30,
          waterEnabled:    schedule && schedule.waterEnabled    ? true : false,
          waterInterval:   schedule && schedule.waterInterval   ? schedule.waterInterval   : 30,
          nextStretchTime: schedule && schedule.stretchEnabled
            ? now + (schedule.stretchInterval || 30) * 60 * 1000 : null,
          nextWaterTime: schedule && schedule.waterEnabled
            ? now + (schedule.waterInterval || 30) * 60 * 1000 : null,
        },
        updatedAt: now,
      };

      await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });

      if (record.schedule.stretchEnabled || record.schedule.waterEnabled) {
        await redis.sadd('active_subs', key);
      } else {
        await redis.srem('active_subs', key);
      }

      return res.status(200).json({ ok: true, action: 'saved' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[pwa-subscribe] error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
