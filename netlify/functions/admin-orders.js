// GET /.netlify/functions/admin-orders?limit=50
// Auth: Authorization: Bearer <JWT>
// Returns a list of recent paid orders (successful payment intents).

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
    const list = await stripe.paymentIntents.list({
      limit,
      expand: ['data.latest_charge', 'data.customer'],
    });

    const orders = list.data
      .filter((pi) => pi.status === 'succeeded')
      .map((pi) => {
        const charge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const shipping = charge?.shipping || pi.shipping || null;
        return {
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          created: pi.created,
          status: pi.status,
          description: pi.description || '',
          metadata: pi.metadata || {},
          customerEmail: charge?.billing_details?.email || pi.receipt_email || '',
          customerName: shipping?.name || charge?.billing_details?.name || '',
          shipping: shipping ? {
            name: shipping.name || '',
            line1: shipping.address?.line1 || '',
            line2: shipping.address?.line2 || '',
            city: shipping.address?.city || '',
            state: shipping.address?.state || '',
            postal_code: shipping.address?.postal_code || '',
            country: shipping.address?.country || '',
            phone: shipping.phone || '',
          } : null,
          receiptUrl: charge?.receipt_url || null,
          paymentMethod: charge?.payment_method_details?.card
            ? `${charge.payment_method_details.card.brand} •••• ${charge.payment_method_details.card.last4}`
            : (charge?.payment_method_details?.type || ''),
          refunded: !!charge?.refunded,
          amountRefunded: charge?.amount_refunded || 0,
        };
      });

    return jsonResponse(200, { orders, hasMore: list.has_more });
  } catch (err) {
    console.error('admin-orders error:', err);
    return jsonResponse(500, { error: err.message || 'Stripe error' });
  }
};
