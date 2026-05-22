// GET /.netlify/functions/get-products
// Public, no auth required. Returns the live product catalog.
// First call seeds Blobs from data/products.json (one-time bootstrap).

const fs = require('fs');
const path = require('path');
const { makeStore } = require('./_lib/blobs');

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60',
  };
}

const SEED_KEY = '_catalog'; // single blob holding the array

function loadSeed() {
  const candidates = [
    path.join(__dirname, '..', '..', 'data', 'products.json'),
    path.join(process.cwd(), 'data', 'products.json'),
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* try next */ }
  }
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const store = makeStore('products');
    let catalog = await store.get(SEED_KEY, { type: 'json' });
    if (!catalog || !Array.isArray(catalog) || catalog.length === 0) {
      catalog = loadSeed();
      if (catalog.length > 0) await store.setJSON(SEED_KEY, catalog);
    }
    // Filter out items marked soldOut on the public endpoint
    const visible = catalog.filter((p) => !p.soldOut);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify(visible),
    };
  } catch (err) {
    console.error('get-products error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message || 'Failed to load products' }),
    };
  }
};
