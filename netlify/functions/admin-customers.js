// GET /.netlify/functions/admin-customers?limit=50
// Auth: Authorization: Bearer <JWT>
// Returns a list of customers with their total spent + order count.

const Stripe = require('stripe');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return jsonResponse(500, { error: 'STRIPE_SECRET_KEY missing' });
  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });

  const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50', 10) || 50, 100);

  try {
    // Stripe doesn't auto-create customers from PaymentIntents unless we explicitly
    // attach one. So `customers.list()` may be sparse. To give Veronica something
    // useful, we aggregate from successful PaymentIntents instead, grouped by email.
    const list = await stripe.paymentIntents.list({
      limit: 100,
      expand: ['data.latest_charge'],
    });

    const byEmail = new Map();
    for (const pi of list.data) {
      if (pi.status !== 'succeeded') continue;
      const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      const email = (charge?.billing_details?.email || pi.receipt_email || '').toLowerCase();
      if (!email) continue;
      const name = charge?.shipping?.name || charge?.billing_details?.name || '';
      const existing = byEmail.get(email);
      if (existing) {
        existing.orderCount += 1;
        existing.totalSpentCents += pi.amount;
        existing.lastOrder = Math.max(existing.lastOrder, pi.created);
        if (!existing.name && name) existing.name = name;
      } else {
        byEmail.set(email, {
          email,
          name,
          orderCount: 1,
          totalSpentCents: pi.amount,
          lastOrder: pi.created,
          firstOrder: pi.created,
        });
      }
    }

    const customers = Array.from(byEmail.values())
      .sort((a, b) => b.lastOrder - a.lastOrder)
      .slice(0, limit);

    return jsonResponse(200, { customers });
  } catch (err) {
    console.error('admin-customers error:', err);
    return jsonResponse(500, { error: err.message || 'Stripe error' });
  }
};
