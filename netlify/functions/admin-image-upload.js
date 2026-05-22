// POST /.netlify/functions/admin-image-upload
// Auth: Authorization: Bearer <JWT>
// Body: { name, contentType, base64 }
// Returns: { id, url, contentType, sizeBytes }
//
// Stores the binary image data in Netlify Blobs (store: 'product-images') with
// metadata. The product's image URL becomes /.netlify/functions/image-serve?id=<id>.

const crypto = require('crypto');
const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const contentType = (body.contentType || '').toLowerCase().trim();
  if (!ALLOWED_TYPES.includes(contentType)) {
    return jsonResponse(400, { error: `Unsupported image type: ${contentType}. Use JPEG, PNG, WebP, or GIF.` });
  }

  // Strip any data URL prefix the client might have sent (e.g. "data:image/jpeg;base64,...")
  let b64 = String(body.base64 || '').trim();
  const m = b64.match(/^data:[^;]+;base64,(.*)$/);
  if (m) b64 = m[1];
  if (!b64) return jsonResponse(400, { error: 'Missing base64 image data' });

  let buf;
  try { buf = Buffer.from(b64, 'base64'); }
  catch { return jsonResponse(400, { error: 'Invalid base64' }); }
  if (buf.length === 0) return jsonResponse(400, { error: 'Empty image' });
  if (buf.length > MAX_BYTES) {
    return jsonResponse(400, { error: `Image too large (${Math.round(buf.length/1024/1024)} MB). Maximum is ${MAX_BYTES/1024/1024} MB.` });
  }

  // Pick a stable-ish id based on time + content hash, plus the extension
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  const id = `${Date.now().toString(36)}-${hash}.${ext}`;

  try {
    const store = makeStore('product-images');
    await store.set(id, buf, {
      metadata: {
        contentType,
        originalName: (body.name || '').slice(0, 120),
        sizeBytes: buf.length,
        uploadedAt: new Date().toISOString(),
      },
    });
    return jsonResponse(200, {
      id,
      url: `/.netlify/functions/image-serve?id=${encodeURIComponent(id)}`,
      contentType,
      sizeBytes: buf.length,
    });
  } catch (err) {
    console.error('admin-image-upload error:', err);
    return jsonResponse(500, { error: err.message || 'Upload failed' });
  }
};
