// GET /.netlify/functions/admin-contact-list
// Auth: Authorization: Bearer <JWT>
// Returns all stored contact submissions, sorted newest first.

const { makeStore } = require('./_lib/blobs');
const { requireAuth, corsHeaders, jsonResponse } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Method not allowed' });

  const auth = requireAuth(event);
  if (!auth.ok) return auth.response;

  try {
    const store = makeStore('contact-submissions');
    const { blobs } = await store.list();
    const submissions = [];
    for (const blob of blobs) {
      const data = await store.get(blob.key, { type: 'json' });
      if (data) submissions.push(data);
    }
    submissions.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return jsonResponse(200, { submissions });
  } catch (err) {
    console.error('admin-contact-list error:', err);
    return jsonResponse(500, { error: err.message || 'Failed to list submissions' });
  }
};
