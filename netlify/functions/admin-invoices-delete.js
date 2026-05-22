// POST /.netlify/functions/admin-invoices-delete
// Auth: Authorization: Bearer <JWT>
// Body: { id }
//
// - Draft invoices → permanently deleted.
// - Open invoices  → voided (cannot be deleted in Stripe).
// - Paid/uncollectible → rejected; refund via Stripe dashboard.

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
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const id = (body.id || '').trim();
  if (!id) return jsonResponse(400, { error: 'Invoice id is required' });

  try {
    const existing = await stripe.invoices.retrieve(id);
    if (existing.status === 'draft') {
      await stripe.invoices.del(id);
      return jsonResponse(200, { success: true, action: 'deleted', id });
    }
    if (existing.status === 'open') {
      const voided = await stripe.invoices.voidInvoice(id);
      return jsonResponse(200, { success: true, action: 'voided', id: voided.id, status: voided.status });
    }
    return jsonResponse(400, {
      error: `Invoice is "${existing.status}" — cannot be deleted. Refund it via the Stripe dashboard instead.`,
    });
  } catch (err) {
    console.error('admin-invoices-delete error:', err);
    return jsonResponse(500, { error: err.message || 'Delete failed' });
  }
};
