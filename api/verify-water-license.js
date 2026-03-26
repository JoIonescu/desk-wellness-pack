const crypto = require("crypto");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { installationId, licenseToken } = req.body;

    if (!installationId || !licenseToken) {
      res.status(400).json({ error: "Missing installationId or licenseToken" });
      return;
    }

    const secret = process.env.LICENSE_SECRET;

    // Recompute expected water token — "water:" prefix matches verify-water-payment
    const expected = crypto
      .createHmac("sha256", secret)
      .update("water:" + installationId)
      .digest("hex");

    const valid = crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(licenseToken, "hex")
    );

    res.status(200).json({ valid });
  } catch (error) {
    console.error("verify-water-license error:", error);
    res.status(500).json({ valid: false, error: error.message });
  }
};