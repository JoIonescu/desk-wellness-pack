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

    const key = 'sub:' + installationId;

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
      const se = !!(schedule && schedule.stretchEnabled);
      const we = !!(schedule && schedule.waterEnabled);
      const si = (schedule && schedule.stretchInterval) ? Number(schedule.stretchInterval) : 30;
      const wi = (schedule && schedule.waterInterval)   ? Number(schedule.waterInterval)   : 30;

      // Use exact timestamps from client if provided, otherwise calculate from interval
      // This ensures the server fires at exactly the same moment the client countdown hits 0:00
      const nst = se
        ? (schedule.nextStretchTime ? Number(schedule.nextStretchTime) : now + si * 60000)
        : null;
      const nwt = we
        ? (schedule.nextWaterTime   ? Number(schedule.nextWaterTime)   : now + wi * 60000)
        : null;

      const record = {
        subscription,
        installationId,
        schedule: {
          stretchEnabled:  se,
          stretchInterval: si,
          waterEnabled:    we,
          waterInterval:   wi,
          nextStretchTime: nst,
          nextWaterTime:   nwt,
        },
        updatedAt: now,
      };

      await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });

      if (se || we) {
        await redis.sadd('active_subs', key);
      } else {
        await redis.srem('active_subs', key);
      }

      return res.status(200).json({ ok: true, action: 'saved', nextStretchTime: nst, nextWaterTime: nwt });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('[pwa-subscribe] error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};
