// POST /.netlify/functions/submit-contact
// Body: { name, email, topic, phone?, budget?, size?, message, botcheck? }
//
// Stores the submission in Netlify Blobs (so it appears in the admin) AND
// forwards to Web3Forms so Veronica still gets the email notification.

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

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

  // Honeypot — bots fill the `botcheck` field, silently accept and drop.
  if (body.botcheck) return jsonResponse(200, { success: true });

  const name = (body.name || '').trim();
  const email = (body.email || '').trim();
  const topic = (body.topic || 'general').trim();
  const message = (body.message || '').trim();
  if (!name || !email || !message) {
    return jsonResponse(400, { error: 'Name, email, and message are required' });
  }
  if (message.length < 10) {
    return jsonResponse(400, { error: 'Message is too short' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, { error: 'Invalid email' });
  }

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

  // 1. Store in Blobs
  try {
    const store = getStore('contact-submissions');
    await store.setJSON(id, submission);
  } catch (err) {
    console.error('Blobs write failed:', err);
    // Don't fail the user-facing submit if storage fails — email still goes through.
  }

  // 2. Forward to Web3Forms for email delivery
  const web3formsKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (web3formsKey) {
    try {
      const w3Payload = {
        access_key: web3formsKey,
        subject: `[NVee Arts · ${topicLabel}] ${name}`,
        from_name: `${name} (via NVee Arts site)`,
        name,
        email,
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
      if (!res.ok || !data.success) {
        console.error('Web3Forms forward failed:', data);
      }
    } catch (err) {
      console.error('Web3Forms forward error:', err);
    }
  }

  return jsonResponse(200, { success: true, id });
};
