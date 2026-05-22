// POST /.netlify/functions/admin-refund
// Auth: Authorization: Bearer <JWT>
// Body: { kind: 'order' | 'invoice', id: string, amountCents?: number }
//
// For orders: id is a PaymentIntent id (pi_...). Refunds the full amount
// unless amountCents is provided.
//
// For invoices: id is an Invoice id (in_...). Resolves the linked
// payment_intent first and refunds that. Errors clearly if the invoice
// has no payment_intent (i.e. it was never paid).
//
// Returns: { refundId, amountRefunded, status }

const Stripe = require('stripe');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return jsonResponse(500, { error: 'STRIPE_SECRET_KEY missing' });
  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const kind = (body.kind || '').trim();
  const id = (body.id || '').trim();
  const amountCents = body.amountCents != null ? parseInt(body.amountCents, 10) : null;

  if (!['order', 'invoice'].includes(kind)) {
    return jsonResponse(400, { error: 'kind must be "order" or "invoice"' });
  }
  if (!id) return jsonResponse(400, { error: 'id is required' });
  if (amountCents != null && (isNaN(amountCents) || amountCents <= 0)) {
    return jsonResponse(400, { error: 'amountCents must be a positive integer if provided' });
  }

  try {
    let paymentIntentId = null;

    if (kind === 'order') {
      paymentIntentId = id;
    } else {
      // Resolve invoice → its payment_intent
      const invoice = await stripe.invoices.retrieve(id);
      if (!invoice.payment_intent) {
        return jsonResponse(400, {
          error: `Invoice "${invoice.number || id}" has no payment to refund (status: ${invoice.status}). Drafts and voids should be deleted instead.`,
        });
      }
      paymentIntentId = typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : invoice.payment_intent.id;
    }

    const refundParams = { payment_intent: paymentIntentId };
    if (amountCents != null) refundParams.amount = amountCents;

    const refund = await stripe.refunds.create(refundParams);

    return jsonResponse(200, {
      success: true,
      refundId: refund.id,
      amountRefunded: refund.amount,
      currency: refund.currency,
      status: refund.status,
      paymentIntentId,
    });
  } catch (err) {
    console.error('admin-refund error:', err);
    // Stripe errors come back with a clean .message
    return jsonResponse(500, { error: err.message || 'Refund failed' });
  }
};
