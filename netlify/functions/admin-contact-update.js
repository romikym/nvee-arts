// POST /.netlify/functions/admin-contact-update
// Auth: Authorization: Bearer <JWT>
// Body: { id, read?, replied?, delete? }

const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }
  if (!body.id) return jsonResponse(400, { error: 'id is required' });

  try {
    const store = makeStore('contact-submissions');
    if (body.delete) {
      await store.delete(body.id);
      return jsonResponse(200, { success: true, deleted: true });
    }
    const existing = await store.get(body.id, { type: 'json' });
    if (!existing) return jsonResponse(404, { error: 'Not found' });
    if (typeof body.read === 'boolean') existing.read = body.read;
    if (typeof body.replied === 'boolean') existing.replied = body.replied;
    await store.setJSON(body.id, existing);
    return jsonResponse(200, { success: true, submission: existing });
  } catch (err) {
    console.error('admin-contact-update error:', err);
    return jsonResponse(500, { error: err.message || 'Update failed' });
  }
};
