/**
 * api/pwa-vapid-public-key.js
 *
 * Returns the VAPID public key to the PWA so it can subscribe to push.
 * Public key is not secret — safe to expose.
 */

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // cache 24h

  return res.status(200).json({
    publicKey: process.env.VAPID_PUBLIC_KEY,
  });
}
