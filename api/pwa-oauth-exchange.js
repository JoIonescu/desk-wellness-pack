// api/pwa-oauth-exchange.js
// Exchanges a Google OAuth2 authorisation code for access + refresh tokens.
// Called by pwa/oauth-callback.html after the user completes the Google consent screen.
//
// Required Vercel env vars:
//   GOOGLE_CLIENT_ID     — OAuth client ID (same as Extension, already in Console)
//   GOOGLE_CLIENT_SECRET — OAuth client secret (keep server-side only)
//
// POST body: { code: string, redirectUri: string }
// Response:  { access_token, refresh_token, expires_in, token_type }

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Env vars ──────────────────────────────────────────────────────
  var clientId     = process.env.GOOGLE_CLIENT_ID;
  var clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[pwa-oauth-exchange] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // ── Request body ──────────────────────────────────────────────────
  var body = req.body || {};
  var code        = body.code;
  var redirectUri = body.redirectUri;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: 'Missing code or redirectUri' });
  }

  // ── Exchange with Google ──────────────────────────────────────────
  try {
    var params = new URLSearchParams({
      code:          code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    });

    var googleResp = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params.toString(),
    });

    var data = await googleResp.json();

    if (!googleResp.ok) {
      // Google returns { error, error_description }
      console.error('[pwa-oauth-exchange] Google error:', data);
      return res.status(400).json({
        error: data.error || 'token_exchange_failed',
        error_description: data.error_description || ''
      });
    }

    // Return only what the client needs — never log tokens
    return res.status(200).json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token || null,
      expires_in:    data.expires_in    || 3600,
      token_type:    data.token_type    || 'Bearer',
    });

  } catch (err) {
    console.error('[pwa-oauth-exchange] fetch error:', err.message);
    return res.status(500).json({ error: 'Exchange request failed' });
  }
}
