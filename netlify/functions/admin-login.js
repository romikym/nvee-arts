// POST /.netlify/functions/admin-login
// Body: { password: "..." }
// Returns: { token: "<JWT>" } on success, 401 on bad password.

const crypto = require('crypto');
const { signToken, corsHeaders, jsonResponse } = require('./_lib/auth');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method not allowed' });

  const adminPw = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!adminPw) return jsonResponse(500, { error: 'Server not configured: ADMIN_PASSWORD missing' });
  if (!secret)  return jsonResponse(500, { error: 'Server not configured: ADMIN_JWT_SECRET missing' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { error: 'Invalid JSON' }); }

  const submitted = (body.password || '').toString();
  // constant-time comparison
  const a = Buffer.from(submitted);
  const b = Buffer.from(adminPw);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    // small delay to slow down guessing
    await new Promise(r => setTimeout(r, 400));
    return jsonResponse(401, { error: 'Invalid password' });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({
    role: 'admin',
    iat: now,
    exp: now + (60 * 60 * 12), // 12-hour session
  }, secret);
  return jsonResponse(200, { token, expiresInSec: 60 * 60 * 12 });
};
