// Netlify serverless function — creates a Stripe Checkout Session from a cart.
//
// Security model:
//   - The client sends only { id, quantity } per line.
//   - This function looks up the price server-side from products.json,
//     so the client cannot tamper with prices.
//   - The Stripe secret key lives in the STRIPE_SECRET_KEY env var (set in Netlify).
//
// The function returns { url } and the client redirects the browser there.

const fs = require('fs');
const path = require('path');

const Stripe = require('stripe');

// products.json lives at repo root: /data/products.json
// In a Netlify deploy, the function runs from /netlify/functions/, so we
// resolve up to the project root.
let PRODUCTS = null;
function loadProducts() {
  if (PRODUCTS) return PRODUCTS;
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'products.json'),
    path.join(process.cwd(), 'data', 'products.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      PRODUCTS = JSON.parse(raw);
      return PRODUCTS;
    } catch (e) {
      // try next
    }
  }
  throw new Error('Could not locate products.json');
}

const SHIPPING_FLAT_CENTS = 1100; // $11 USPS Priority — matches frontend preview

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
  if (!secret) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: 'Server is not configured: STRIPE_SECRET_KEY missing' }),
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
  const line_items = [];
  for (const item of items) {
    const product = byId.get(item.id);
    if (!product) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ error: `Unknown product: ${item.id}` }),
      };
    }
    const qty = Math.max(1, Math.min(10, parseInt(item.quantity, 10) || 1));

    // Each piece is one-of-one — force quantity to 1.
    const enforcedQty = 1;

    line_items.push({
      quantity: enforcedQty,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(product.price * 100),
        product_data: {
          name: product.name,
          description: product.detail || product.meta,
          metadata: { product_id: product.id, collection: product.collection || '' },
          // Stripe needs absolute URLs for product images. Skip for now —
          // can be added once a public deploy URL is known.
        },
      },
    });
  }

  // Determine the base URL for redirects. Stripe needs absolute URLs.
  // Prefer the request's own origin (works on Netlify previews + production).
  const origin =
    event.headers['origin'] ||
    (event.headers['x-forwarded-proto'] && event.headers['host']
      ? `${event.headers['x-forwarded-proto']}://${event.headers['host']}`
      : process.env.URL || 'http://localhost:8888');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      // Stripe collects email and shipping address itself — better than our old fake form.
      billing_address_collection: 'auto',
      shipping_address_collection: { allowed_countries: ['US'] },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: 'USPS Priority (2–3 business days)',
            fixed_amount: { amount: SHIPPING_FLAT_CENTS, currency: 'usd' },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
      ],
      phone_number_collection: { enabled: true },
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1#shop`,
      metadata: {
        cart_ids: items.map((i) => i.id).join(','),
      },
    });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ url: session.url, id: session.id }),
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
