// Netlify serverless function — creates a Stripe PaymentIntent for the
// embedded Stripe Elements checkout.
//
// Returns: { clientSecret, publishableKey, amount, currency, breakdown }
//
// Security model:
//   - Client sends only { id, quantity }.
//   - Server looks up the price from the live Blobs catalog (the same source
//     used by the admin and public shop). Falls back to the bundled
//     data/products.json if Blobs is empty (first deploy, before any admin
//     edits have happened).
//   - Client cannot tamper with prices.

const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const { makeStore } = require('./_lib/blobs');

const SEED_KEY = '_catalog';

function loadSeedFromDisk() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'products.json'),
    path.join(process.cwd(), 'data', 'products.json'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* try next */ }
  }
  return [];
}

async function loadProducts() {
  // Match get-products + admin-products-list: read from Blobs first, seed from
  // disk only if Blobs is empty. This guarantees we see the same catalog the
  // public shop and admin see, including newly-added products.
  try {
    const store = makeStore('products');
    const catalog = await store.get(SEED_KEY, { type: 'json' });
    if (catalog && Array.isArray(catalog) && catalog.length > 0) return catalog;
  } catch (err) {
    console.warn('Blobs read failed, falling back to disk seed:', err && err.message);
  }
  return loadSeedFromDisk();
}

// Fallback shipping for products that don't have a per-item `shipping` field set.
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
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'STRIPE_SECRET_KEY missing' }) };
  }
  if (!publishable) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'STRIPE_PUBLISHABLE_KEY missing' }) };
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Cart is empty' }) };
  }

  let products;
  try {
    products = await loadProducts();
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }

  const byId = new Map(products.map((p) => [p.id, p]));

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
    const qty = 1;
    const lineCents = Math.round(product.price * 100) * qty;
    subtotalCents += lineCents;

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
      payment_method_types: ['card'],
      shipping: undefined,
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
        breakdown: { subtotalCents, shippingCents, totalCents, lines: lineSummary },
      }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message || 'Stripe error' }) };
  }
};
