// POST /.netlify/functions/admin-login
// Body: { password: "..." }
// Returns: { token: "<JWT>" } on success, 401 on bad password.
//
// TEMP: while we debug the login mismatch, 401 responses always include
// a `debug` object with non-secret length/hash-prefix info so we can spot
// trailing-whitespace mismatches. Remove the debug block once login works.

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
  const a = Buffer.from(submitted);
  const b = Buffer.from(adminPw);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    await new Promise(r => setTimeout(r, 400));
    const submittedHash = crypto.createHash('sha256').update(submitted).digest('hex').slice(0, 8);
    const configuredHash = crypto.createHash('sha256').update(adminPw).digest('hex').slice(0, 8);
    return jsonResponse(401, {
      error: 'Invalid password',
      debug: {
        submittedLength: submitted.length,
        configuredLength: adminPw.length,
        lengthsMatch: submitted.length === adminPw.length,
        submittedSha256Prefix: submittedHash,
        configuredSha256Prefix: configuredHash,
        hashesMatch: submittedHash === configuredHash,
        configuredStartsWithSpace: /^\s/.test(adminPw),
        configuredEndsWithSpace: /\s$/.test(adminPw),
        configuredHasNewline: /[\r\n]/.test(adminPw),
      },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const token = signToken({
    role: 'admin',
    iat: now,
    exp: now + (60 * 60 * 12),
  }, secret);
  return jsonResponse(200, { token, expiresInSec: 60 * 60 * 12 });
};
