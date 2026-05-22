// GET /.netlify/functions/admin-products-list
// Auth: Authorization: Bearer <JWT>
// Returns ALL products (including sold ones, which the public endpoint hides).

const fs = require('fs');
const path = require('path');
const { getStore } = require('@netlify/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

const SEED_KEY = '_catalog';

function loadSeed() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'products.json'),
    path.join(process.cwd(), 'data', 'products.json'),
  ];
  for (const p of candidates) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* try next */ }
  }
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  try {
    const store = getStore('products');
    let catalog = await store.get(SEED_KEY, { type: 'json' });
    if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
      catalog = loadSeed();
      if (catalog.length > 0) await store.setJSON(SEED_KEY, catalog);
    }
    return jsonResponse(200, { products: catalog });
  } catch (err) {
    console.error('admin-products-list error:', err);
    return jsonResponse(500, { error: err.message || 'Failed to list products' });
  }
};
