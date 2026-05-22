// POST /.netlify/functions/admin-hidden-update
// Auth: Authorization: Bearer <JWT>
// Body: { kind: 'order' | 'invoice', id: string, action: 'hide' | 'unhide' }
// Returns: updated { orders, invoices } lists.

const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');
const { loadHidden, STORE, KEY } = require('./admin-hidden-list');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const kind = (body.kind || '').trim();
  const id = (body.id || '').trim();
  const action = (body.action || '').trim();

  if (!['order', 'invoice'].includes(kind)) return jsonResponse(400, { error: 'kind must be "order" or "invoice"' });
  if (!id) return jsonResponse(400, { error: 'id is required' });
  if (!['hide', 'unhide'].includes(action)) return jsonResponse(400, { error: 'action must be "hide" or "unhide"' });

  try {
    const store = makeStore(STORE);
    const hidden = await loadHidden(store);
    const listKey = kind === 'order' ? 'orders' : 'invoices';
    const list = new Set(hidden[listKey]);
    if (action === 'hide') list.add(id);
    else list.delete(id);
    hidden[listKey] = Array.from(list);
    await store.setJSON(KEY, hidden);
    return jsonResponse(200, hidden);
  } catch (err) {
    console.error('admin-hidden-update error:', err);
    return jsonResponse(500, { error: err.message || 'Update failed' });
  }
};
