const Stripe = require("stripe");
const crypto = require("crypto");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { installationId, sessionId } = req.body;

    if (!installationId || !sessionId) {
      res.status(400).json({ error: "Missing installationId or sessionId" });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      res.status(200).json({ paid: false });
      return;
    }

    // Verify this session was for water product
    if (session.metadata?.product !== "water") {
      res.status(400).json({ error: "Session is not for water product" });
      return;
    }

    // Issue HMAC token — "water:" prefix ensures different token from stretch
    const secret = process.env.LICENSE_SECRET;
    const waterLicenseToken = crypto
      .createHmac("sha256", secret)
      .update("water:" + installationId)
      .digest("hex");

    res.status(200).json({ paid: true, licenseToken: waterLicenseToken });
  } catch (error) {
    console.error("verify-water-payment error:", error);
    res.status(500).json({ error: error.message });
  }
};