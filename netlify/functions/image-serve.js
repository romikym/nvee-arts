// GET /.netlify/functions/image-serve?id=<id>
// Public — no auth. Returns the binary image stored in Blobs (store: 'product-images').
// Cache for a year since blob IDs are content-addressed and never change.

const { makeStore } = require('./_lib/blobs');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      body: '',
    };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
  }

  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Missing id' };
  }

  try {
    const store = makeStore('product-images');
    const result = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!result || !result.data) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Image not found' };
    }
    const buf = Buffer.from(result.data);
    const contentType = (result.metadata && result.metadata.contentType) || 'application/octet-stream';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('image-serve error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Internal error' };
  }
};
