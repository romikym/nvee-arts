// Netlify serverless function — creates a Stripe PaymentIntent for the
// embedded Stripe Elements checkout (vs. the older redirect-based Checkout
// Session in create-checkout-session.js).
//
// Returns: { clientSecret, publishableKey, amount, currency, breakdown }
//
// Security model identical to create-checkout-session.js:
//   - Client sends only { id, quantity }.
//   - Server looks up the price in products.json (single source of truth).
//   - Client cannot tamper with prices.

const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

let PRODUCTS = null;
function loadProducts() {
  if (PRODUCTS) return PRODUCTS;
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'products.json'),
    path.join(process.cwd(), 'data', 'products.json'),
  ];
  for (const p of candidates) {
    try {
      PRODUCTS = JSON.parse(fs.readFileSync(p, 'utf8'));
      return PRODUCTS;
    } catch (e) {
      // try next
    }
  }
  throw new Error('Could not locate products.json');
}

// Fallback shipping for products that don't have a per-item `shipping` field set.
// Per-product shipping is preferred (set in the admin product form).
const SHIPPING_FLAT_CENTS = 1100; // $11 USPS Priority default

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const publishable = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secret) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Server is not configured: STRIPE_SECRET_KEY missing' }),
    };
  }
  if (!publishable) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Server is not configured: STRIPE_PUBLISHABLE_KEY missing' }),
    };
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  let products;
  try {
    products = loadProducts();
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  // Compute totals server-side. Shipping is per-product with a fallback default.
  let subtotalCents = 0;
  let shippingCents = 0;
  const lineSummary = [];
  for (const item of items) {
    const product = byId.get(item.id);
    if (!product) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: `Unknown product: ${item.id}` }),
      };
    }
    // Each piece is one-of-one — force quantity to 1.
    const qty = 1;
    const lineCents = Math.round(product.price * 100) * qty;
    subtotalCents += lineCents;

    // Per-product shipping with fallback. `product.shipping` is in dollars.
    const itemShippingCents = product.shipping != null
      ? Math.round(Number(product.shipping) * 100)
      : SHIPPING_FLAT_CENTS;
    shippingCents += itemShippingCents;

    lineSummary.push({
      id: product.id,
      name: product.name,
      price: product.price,
      shippingCents: itemShippingCents,
      quantity: qty,
    });
  }

  const totalCents = subtotalCents + shippingCents;

  try {
    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      // Lock the checkout to card payments only.
      // Apple Pay, Google Pay, and Link still show because they're
      // card-based wallets — surfaced automatically by the Payment
      // Element when `card` is allowed. This explicitly excludes
      // Alipay, ACH/US bank account, Klarna, Afterpay, etc.
      payment_method_types: ['card'],
      shipping: undefined, // collected via the Address Element on the client
      metadata: {
        cart_ids: items.map((i) => i.id).join(','),
        subtotal_cents: String(subtotalCents),
        shipping_cents: String(shippingCents),
      },
      description: `NVee Arts order — ${items.length} piece${items.length !== 1 ? 's' : ''}`,
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        clientSecret: intent.client_secret,
        publishableKey: publishable,
        amount: totalCents,
        currency: 'usd',
        breakdown: {
          subtotalCents,
          shippingCents,
          totalCents,
          lines: lineSummary,
        },
      }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message || 'Stripe error' }),
    };
  }
};
