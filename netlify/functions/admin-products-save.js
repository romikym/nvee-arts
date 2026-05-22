// POST /.netlify/functions/admin-products-save
// Auth: Authorization: Bearer <JWT>
// Body: a complete product object — upserts (insert if new id, update if existing).

const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

const SEED_KEY = '_catalog';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  let product;
  try { product = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  // Basic validation
  if (!product.id || !product.name || product.price == null) {
    return jsonResponse(400, { error: 'id, name, and price are required' });
  }
  // Normalize
  product.price = Number(product.price);
  if (isNaN(product.price) || product.price < 0) {
    return jsonResponse(400, { error: 'price must be a non-negative number' });
  }
  product.specs = product.specs || {};

  try {
    const store = makeStore('products');
    const catalog = (await store.get(SEED_KEY, { type: 'json' })) || [];
    const idx = catalog.findIndex((p) => p.id === product.id);
    if (idx >= 0) catalog[idx] = product;
    else catalog.push(product);
    await store.setJSON(SEED_KEY, catalog);
    return jsonResponse(200, { success: true, product, count: catalog.length });
  } catch (err) {
    console.error('admin-products-save error:', err);
    return jsonResponse(500, { error: err.message || 'Save failed' });
  }
};
