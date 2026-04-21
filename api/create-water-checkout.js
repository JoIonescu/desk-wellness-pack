const Stripe = require("stripe");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const { installationId } = req.body;
    if (!installationId) {
      res.status(400).json({ error: "Missing installationId" });
      return;
    }

    // FIX: fallback was pointing to old renamed URL "smart-stretch-backend.vercel.app"
    const baseUrl = process.env.BASE_URL || "https://desk-wellness-pack.vercel.app";

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: "Water Reminder — Pro",
              description: "Lifetime Pro: custom glass goal + skip during meetings"
            },
            unit_amount: 500 // €5.00
          },
          quantity: 1
        }
      ],
      mode: "payment",
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&product=water`,
      cancel_url: `${baseUrl}/cancel`,
      metadata: { installationId, product: "water" }
    });

    res.status(200).json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    console.error("create-water-checkout error:", error);
    res.status(500).json({ error: error.message });
  }
};
