// POST /.netlify/functions/admin-invoices-create
// Auth: Authorization: Bearer <JWT>
// Body: { email, name?, description, amountDollars, sendNow? (boolean) }
// Creates a customer (or finds existing), an invoice item, finalizes the invoice,
// and optionally sends it to the customer via Stripe.

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

  const email = (body.email || '').trim();
  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const amountDollars = parseFloat(body.amountDollars);
  const sendNow = body.sendNow !== false; // default true

  if (!email) return jsonResponse(400, { error: 'Email is required' });
  if (!description) return jsonResponse(400, { error: 'Description is required' });
  if (!amountDollars || isNaN(amountDollars) || amountDollars <= 0) {
    return jsonResponse(400, { error: 'Valid positive amount required' });
  }

  try {
    // Look for an existing customer with that email; create if none.
    const existing = await stripe.customers.list({ email, limit: 1 });
    let customer = existing.data[0];
    if (!customer) {
      customer = await stripe.customers.create({ email, name: name || undefined });
    } else if (name && !customer.name) {
      customer = await stripe.customers.update(customer.id, { name });
    }

    // Create a draft invoice first, then add the item to it (more reliable than
    // creating a standalone invoice item without an invoice).
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 14,
      description,
      auto_advance: false,
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: Math.round(amountDollars * 100),
      currency: 'usd',
      description,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    let result = finalized;
    if (sendNow) {
      result = await stripe.invoices.sendInvoice(finalized.id);
    }

    return jsonResponse(200, {
      id: result.id,
      number: result.number || result.id,
      status: result.status,
      hostedInvoiceUrl: result.hosted_invoice_url,
      invoicePdf: result.invoice_pdf,
      amount: result.amount_due,
      sent: sendNow,
    });
  } catch (err) {
    console.error('admin-invoices-create error:', err);
    return jsonResponse(500, { error: err.message || 'Stripe error' });
  }
};
