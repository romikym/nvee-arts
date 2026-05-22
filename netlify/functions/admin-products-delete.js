// POST /.netlify/functions/admin-products-delete
// Auth: Authorization: Bearer <JWT>
// Body: { id }

const { getStore } = require('@netlify/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

const SEED_KEY = '_catalog';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
  if (!body.id) return jsonResponse(400, { error: 'id is required' });

  try {
    const store = getStore('products');
    const catalog = (await store.get(SEED_KEY, { type: 'json' })) || [];
    const before = catalog.length;
    const next = catalog.filter((p) => p.id !== body.id);
    if (next.length === before) return jsonResponse(404, { error: 'Product not found' });
    await store.setJSON(SEED_KEY, next);
    return jsonResponse(200, { success: true, count: next.length });
  } catch (err) {
    console.error('admin-products-delete error:', err);
    return jsonResponse(500, { error: err.message || 'Delete failed' });
  }
};
