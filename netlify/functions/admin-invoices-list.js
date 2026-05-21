// GET /.netlify/functions/admin-invoices-list?limit=50
// Auth: Authorization: Bearer <JWT>
// Returns recent Stripe invoices.

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
    const list = await stripe.invoices.list({
      limit,
      expand: ['data.customer'],
    });

    const invoices = list.data.map((inv) => ({
      id: inv.id,
      number: inv.number || inv.id,
      status: inv.status,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      created: inv.created,
      dueDate: inv.due_date,
      hostedInvoiceUrl: inv.hosted_invoice_url,
      invoicePdf: inv.invoice_pdf,
      customerEmail: inv.customer_email || (typeof inv.customer === 'object' ? inv.customer?.email : '') || '',
      customerName: inv.customer_name || (typeof inv.customer === 'object' ? inv.customer?.name : '') || '',
      description: inv.description || (inv.lines?.data?.[0]?.description || ''),
    }));

    return jsonResponse(200, { invoices });
  } catch (err) {
    console.error('admin-invoices-list error:', err);
    return jsonResponse(500, { error: err.message || 'Stripe error' });
  }
};
