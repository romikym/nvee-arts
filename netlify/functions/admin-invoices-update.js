// POST /.netlify/functions/admin-invoices-update
// Auth: Authorization: Bearer <JWT>
// Body: { id, description, amountDollars?, customerName? }
//
// Only works on DRAFT invoices. Stripe doesn't allow editing finalized invoices.

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
  const description = (body.description || '').trim();
  const amountDollars = body.amountDollars != null ? parseFloat(body.amountDollars) : null;
  const customerName = (body.customerName || '').trim();

  if (!description) return jsonResponse(400, { error: 'Description is required' });
  if (amountDollars != null && (isNaN(amountDollars) || amountDollars <= 0)) {
    return jsonResponse(400, { error: 'Amount must be a positive number' });
  }

  try {
    const existing = await stripe.invoices.retrieve(id, { expand: ['lines', 'customer'] });
    if (existing.status !== 'draft') {
      return jsonResponse(400, {
        error: `Invoice is "${existing.status}" — only drafts can be edited. Void or refund it in Stripe instead.`,
      });
    }

    // Update customer name if provided and different
    if (customerName && existing.customer) {
      const customerId = typeof existing.customer === 'object' ? existing.customer.id : existing.customer;
      const currentName = typeof existing.customer === 'object' ? (existing.customer.name || '') : '';
      if (customerName !== currentName) {
        await stripe.customers.update(customerId, { name: customerName });
      }
    }

    // If amount changed, delete existing line items and recreate
    if (amountDollars != null) {
      const customerId = typeof existing.customer === 'object' ? existing.customer.id : existing.customer;
      const existingItems = await stripe.invoiceItems.list({ invoice: id, limit: 50 });
      for (const item of existingItems.data) {
        try { await stripe.invoiceItems.del(item.id); } catch (e) { /* ignore */ }
      }
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: id,
        amount: Math.round(amountDollars * 100),
        currency: 'usd',
        description,
      });
    }

    // Update invoice description
    const updated = await stripe.invoices.update(id, { description });

    return jsonResponse(200, {
      success: true,
      id: updated.id,
      status: updated.status,
      amountDue: updated.amount_due,
    });
  } catch (err) {
    console.error('admin-invoices-update error:', err);
    return jsonResponse(500, { error: err.message || 'Update failed' });
  }
};
