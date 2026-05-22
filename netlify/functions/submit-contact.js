// POST /.netlify/functions/submit-contact
// Body: { name, email, topic, phone?, budget?, size?, message, botcheck? }
//
// Stores the submission in Netlify Blobs (so it appears in the admin) AND
// forwards to Web3Forms so Veronica still gets the email notification.

const crypto = require('crypto');

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}
function jsonResponse(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

const TOPIC_LABELS = {
  general: 'General inquiry',
  commission: 'Custom commission',
  press: 'Press / interview',
  wholesale: 'Wholesale / stockist',
  shipping: 'Order or shipping question',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  if (body.botcheck) return jsonResponse(200, { success: true });

  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const topic = (body.topic || 'general').trim();
  const message = (body.message || '').trim();
  if (!name || !email || !message) return jsonResponse(400, { error: 'Name, email, and message are required' });
  if (message.length < 10) return jsonResponse(400, { error: 'Message is too short' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { error: 'Invalid email' });

  const topicLabel = TOPIC_LABELS[topic] || topic;
  const id = 'sub_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const submission = {
    id,
    createdAt: new Date().toISOString(),
    name,
    email,
    topic,
    topicLabel,
    phone: (body.phone || '').trim(),
    budget: (body.budget || '').trim(),
    size: (body.size || '').trim(),
    message,
    read: false,
    replied: false,
    userAgent: event.headers['user-agent'] || '',
  };

  // 1. Store in Blobs — capture any error so we can see it from the client.
  let storedOk = false;
  let storedError = null;
  let blobsModuleLoaded = false;
  try {
    // Lazy-require so a missing helper doesn't crash the whole function.
    const { makeStore } = require('./_lib/blobs');
    blobsModuleLoaded = true;
    const store = makeStore('contact-submissions');
    await store.setJSON(id, submission);
    storedOk = true;
    console.log('Blobs write OK:', id);
  } catch (err) {
    storedError = (err && (err.message || err.toString())) || 'unknown blobs error';
    console.error('Blobs write failed:', storedError, err && err.stack);
  }

  // 2. Forward to Web3Forms
  const web3formsKey = process.env.WEB3FORMS_ACCESS_KEY;
  let emailedOk = false;
  let emailedError = null;
  if (web3formsKey) {
    try {
      const w3Payload = {
        access_key: web3formsKey,
        subject: `[NVee Arts · ${topicLabel}] ${name}`,
        from_name: `${name} (via NVee Arts site)`,
        name, email,
        topic: topicLabel,
        phone: submission.phone,
        budget: submission.budget,
        size: submission.size,
        message,
      };
      const res = await fetch(WEB3FORMS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(w3Payload),
      });
      const data = await res.json().catch(() => ({}));
      emailedOk = !!(res.ok && data.success);
      if (!emailedOk) emailedError = data.message || `HTTP ${res.status}`;
    } catch (err) {
      emailedError = err.message || 'web3forms error';
    }
  } else {
    emailedError = 'WEB3FORMS_ACCESS_KEY env var missing';
  }

  // Server-side logs capture all detail (see Netlify function logs). Client
  // gets a minimal success ack — no internal status leakage.
  if (!storedOk && !emailedOk) {
    // Both delivery paths failed — surface a generic error so the form can show
    // the user a retry message. The reasons are in the function logs.
    return jsonResponse(500, { error: 'Could not deliver your message — please try again or email Veronica directly.' });
  }
  return jsonResponse(200, { success: true, id });
};
