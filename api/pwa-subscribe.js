/**
 * api/pwa-subscribe.js
 *
 * Called by the PWA when user presses Start or Stop.
 * Saves / updates / deletes a push subscription + schedule in Upstash Redis.
 *
 * POST body:
 * {
 *   action:       'subscribe' | 'unsubscribe' | 'update',
 *   subscription: { endpoint, keys: { p256dh, auth } },  // Web Push subscription object
 *   installationId: string,
 *   schedule: {
 *     stretchEnabled: boolean, stretchInterval: number,  // minutes
 *     waterEnabled:   boolean, waterInterval:   number,
 *   }
 * }
 */

import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // CORS — PWA is on a different domain from the API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, subscription, installationId, schedule } = req.body;

    if (!installationId) {
      return res.status(400).json({ error: 'installationId required' });
    }

    const key = `sub:${installationId}`;

    if (action === 'unsubscribe') {
      await redis.del(key);
      return res.status(200).json({ ok: true, action: 'deleted' });
    }

    if (action === 'subscribe' || action === 'update') {
      if (!subscription?.endpoint) {
        return res.status(400).json({ error: 'subscription required' });
      }

      const now = Date.now();
      const record = {
        subscription,
        installationId,
        schedule: {
          stretchEnabled:  schedule?.stretchEnabled  ?? false,
          stretchInterval: schedule?.stretchInterval ?? 30,
          waterEnabled:    schedule?.waterEnabled    ?? false,
          waterInterval:   schedule?.waterInterval   ?? 30,
          // When is the next notification due?
          nextStretchTime: schedule?.stretchEnabled
            ? now + (schedule?.stretchInterval ?? 30) * 60 * 1000
            : null,
          nextWaterTime: schedule?.waterEnabled
            ? now + (schedule?.waterInterval ?? 30) * 60 * 1000
            : null,
        },
        updatedAt: now,
      };

      // Store with 7-day TTL — auto-cleans stale subscriptions
      await redis.set(key, JSON.stringify(record), { ex: 7 * 24 * 60 * 60 });

      // Also keep an index of all active subscription keys so the cron can find them
      if (schedule?.stretchEnabled || schedule?.waterEnabled) {
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
}
