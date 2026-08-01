/**
 * v2.12.1 — Yetu Sacco webhook authentication (pluggable).
 *
 * CONFIRMED BY YETU: HTTP Basic Authentication.
 *   Set YETU_AUTH_MODE=basic (this is also the default when credentials exist)
 *   Set YETU_BASIC_USER and YETU_BASIC_PASS to the agreed credentials.
 * Yetu then calls the webhook with:
 *   Authorization: Basic base64(user:pass)
 *
 * Other modes remain available without a route/service change:
 *   • YETU_AUTH_MODE=secret -> shared secret header (YETU_CALLBACK_SECRET)
 *   • YETU_AUTH_MODE=hmac   -> HMAC-SHA256 signature (YETU_CALLBACK_SECRET)
 *   • YETU_AUTH_MODE=none   -> pass-through (testing only)
 */
const crypto = require('crypto');

const AUTH_HEADER_HINTS = [
  'authorization',
  'x-api-key',
  'x-yetu-signature',
  'x-yetu-secret',
  'x-signature',
];

/** Timing-safe string compare that never throws on length mismatch. */
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

/** Parse an `Authorization: Basic ...` header into { user, pass } or null. */
const parseBasicAuth = (headerValue) => {
  const raw = String(headerValue || '');
  if (!/^basic\s+/i.test(raw)) return null;
  const encoded = raw.replace(/^basic\s+/i, '').trim();
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
};

/** Non-sensitive summary of the auth headers a request carried. */
const describeAuthHeaders = (headers = {}) =>
  AUTH_HEADER_HINTS.filter((h) => headers[h] !== undefined);

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
const verifyYetuRequest = (req, rawBody) => {
  const mode = String(process.env.YETU_AUTH_MODE || 'none').toLowerCase();
  const headers = req.headers || {};

  if (mode === 'none') {
    console.log('[YETU][AUTH] mode=none (pass-through) headers=', describeAuthHeaders(headers).join(',') || 'n/a');
    return { ok: true };
  }

  const secret = process.env.YETU_CALLBACK_SECRET || '';
  if (!secret) {
    console.warn('[YETU][AUTH] mode=%s but YETU_CALLBACK_SECRET is not set — rejecting', mode);
    return { ok: false, reason: 'auth_not_configured' };
  }

  if (mode === 'secret') {
    const provided =
      headers['x-yetu-secret'] ||
      headers['x-api-key'] ||
      String(headers['authorization'] || '').replace(/^Bearer\s+/i, '');
    if (!provided || String(provided) !== secret) {
      console.warn('[YETU][AUTH] shared-secret mismatch');
      return { ok: false, reason: 'unauthorized' };
    }
    return { ok: true };
  }

  if (mode === 'hmac') {
    const provided = String(headers['x-yetu-signature'] || headers['x-signature'] || '');
    const expected = crypto.createHmac('sha256', secret).update(rawBody || '').digest('hex');
    const a = Buffer.from(provided.replace(/^sha256=/i, ''), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[YETU][AUTH] hmac mismatch');
      return { ok: false, reason: 'unauthorized' };
    }
    return { ok: true };
  }

  console.warn('[YETU][AUTH] unknown YETU_AUTH_MODE=%s — rejecting', mode);
  return { ok: false, reason: 'auth_not_configured' };
};

module.exports = { verifyYetuRequest, describeAuthHeaders };
