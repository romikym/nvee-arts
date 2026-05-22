// GET /.netlify/functions/admin-hidden-list
// Auth: Authorization: Bearer <JWT>
// Returns: { orders: [pi_...], invoices: [in_...] }
//
// These are admin-side "hide from view" lists. The underlying Stripe data
// is NEVER modified by the Hide action — it's purely a presentation filter
// stored in Blobs so test orders and refunded invoices can be cleaned out
// of the admin UI without losing the source record.

const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

const STORE = 'admin-meta';
const KEY = 'hidden';

async function loadHidden(store) {
  const data = await store.get(KEY, { type: 'json' });
  if (data && typeof data === 'object') {
    return {
      orders: Array.isArray(data.orders) ? data.orders : [],
      invoices: Array.isArray(data.invoices) ? data.invoices : [],
    };
  }
  return { orders: [], invoices: [] };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  try {
    const store = makeStore(STORE);
    const hidden = await loadHidden(store);
    return jsonResponse(200, hidden);
  } catch (err) {
    console.error('admin-hidden-list error:', err);
    return jsonResponse(500, { error: err.message || 'Failed to load hidden lists' });
  }
};

// Exported for reuse from sibling functions that need to filter.
module.exports.loadHidden = loadHidden;
module.exports.STORE = STORE;
module.exports.KEY = KEY;
