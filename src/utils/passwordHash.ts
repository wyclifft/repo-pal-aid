/**
 * Password hashing for offline credential cache.
 *
 * SECURITY (v2.10.83): Plaintext passwords must NEVER be persisted.
 * We hash with SHA-256 + a per-user salt before writing to localStorage,
 * and only compare hash-to-hash on offline login.
 *
 * crypto.subtle is available on Android WebView ≥ API 24 (the legacy POS
 * baseline) and on every browser we ship to. A non-crypto fallback is
 * provided only so the app does not hard-fail on exotic environments —
 * such environments can no longer use offline login.
 */

const enc = new TextEncoder();

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Hash a password with a per-user salt (the user_id, lower-cased + trimmed).
 * Returns a lower-case hex SHA-256 digest, or null when subtle crypto is
 * unavailable (caller must then refuse to cache / refuse offline login).
 */
export async function hashPassword(userId: string, password: string): Promise<string | null> {
  if (!password) return null;
  const salt = (userId || '').toLowerCase().trim();
  const material = `delicoop:v1:${salt}:${password}`;

  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const buf = await crypto.subtle.digest('SHA-256', enc.encode(material));
      return toHex(buf);
    }
  } catch (e) {
    console.warn('[passwordHash] crypto.subtle.digest failed:', e);
  }
  return null;
}

/** Constant-time-ish equality for hex strings. */
export function hashesEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
