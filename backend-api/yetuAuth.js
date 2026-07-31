/**
 * v2.12.0 — Yetu Sacco webhook authentication (pluggable).
 *
 * Yetu Sacco has NOT yet confirmed the authentication mechanism for their
 * callback. Until they do, this verifier passes every request through and
 * simply records which auth-looking headers arrived, so the real scheme can
 * be enabled later by flipping one env var — no route or service change.
 *
 * When Yetu confirms:
 *   • Shared secret  -> set YETU_AUTH_MODE=secret and YETU_CALLBACK_SECRET
 *   • HMAC signature -> set YETU_AUTH_MODE=hmac   and YETU_CALLBACK_SECRET
 */
const crypto = require('crypto');

const AUTH_HEADER_HINTS = [
  'authorization',
  'x-api-key',
  'x-yetu-signature',
  'x-yetu-secret',
  'x-signature',
];

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
