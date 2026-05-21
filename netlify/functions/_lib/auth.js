// Shared auth helpers for the admin endpoints.
// Issues and verifies signed JWTs using a shared secret env var (ADMIN_JWT_SECRET).
// Auth model: single admin user, password compared against ADMIN_PASSWORD env var.

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
function base64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString();
}

// Sign a payload with HS256.
function signToken(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${data}.${sig}`;
}

// Verify a token and return its decoded payload, or null on any failure.
function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  // constant-time comparison
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(base64urlDecode(body)); } catch { return null; }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// Verify the Authorization header on an incoming Netlify Function event.
// Returns {ok: true, payload} or {ok: false, response}.
function requireAuth(event) {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    return { ok: false, response: jsonResponse(500, { error: 'Server not configured: ADMIN_JWT_SECRET missing' }) };
  }
  const header = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const payload = verifyToken(token, secret);
  if (!payload || payload.role !== 'admin') {
    return { ok: false, response: jsonResponse(401, { error: 'Unauthorized' }) };
  }
  return { ok: true, payload };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

module.exports = { signToken, verifyToken, requireAuth, corsHeaders, jsonResponse };
