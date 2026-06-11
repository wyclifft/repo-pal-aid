## Goal

Make the device fingerprint deterministic from hardware (SSAID) on native Android, so reinstall/clear-data always yields the SAME fingerprint — no server lookup needed for recovery.

## Why this is better

Current `generateDeviceFingerprint()` builds a hash from `userAgent + screen + canvas + Math.random() + Date.now()`, then caches it in localStorage. After clear-data, localStorage is gone and the random seed produces a brand new hash — that is exactly what created the duplicate `id 268` pending row. The server-side identity-recovery flow (v2.10.109–111) was a workaround. Using SSAID as the source makes the fingerprint itself stable.

## Plan

1. **`src/utils/deviceFingerprint.ts` — change `generateDeviceFingerprint()`**
   - Order of preference (first match wins, then cached in localStorage):
     1. Stored `device_id` in localStorage (back-compat — existing installs keep their current fingerprint, so server rows like `id 267` are NOT orphaned).
     2. On native: `await Device.getId()` → SSAID. Derive fingerprint as `sha256("ssaid:" + ssaid)` (64 hex chars, same shape as today). Salting with a constant prefix avoids leaking the raw SSAID and keeps length/format identical so backend columns, indexes, and logs are unchanged.
     3. Fallback (web, or SSAID unavailable): current entropy-based hash — unchanged.
   - Persist the result to `localStorage['device_id']` exactly as today.
   - Keep the function async and the return shape (hex string) identical.

2. **Back-compat with existing approved rows**
   - Existing devices already have a localStorage `device_id` AND a matching `approved_devices.device_fingerprint`. Step 1.1 ensures they keep using it — no migration churn, no mass re-approval.
   - Only fresh installs / cleared-data devices take the new SSAID-derived path. They will deterministically produce the same fingerprint every reinstall.
   - The server-side identity-recovery endpoint (`/api/device/resolve-identity`) stays in place as a safety net for: (a) devices that were approved BEFORE this change and later clear data — the legacy fingerprint won't match, but SSAID still will; (b) factory resets where SSAID rotates (best-effort 3-way match remains).

3. **One-time self-heal on native**
   - On native only, if `localStorage['device_id']` exists AND differs from the SSAID-derived value, do NOT overwrite. Log once `[FP] legacy fingerprint retained (pre-SSAID install)`. This protects production devices already approved on the old scheme.
   - New installs land directly on the SSAID-derived fingerprint.

4. **Web platform**
   - No SSAID available → keep current behavior unchanged. Web is not the production target; native Android is.

5. **No backend changes**
   - `approved_devices.device_fingerprint` column, indexes, lookups, sync, receipts, references — all untouched.
   - SSAID is also separately stored on the row (already added in v2.10.109 migration), so the server still has the raw SSAID for the resolve-identity safety net.

6. **Version + docs**
   - Bump `APP_VERSION` to `2.10.112` and `versionCode` to `133`.
   - Update `src/constants/appVersion.ts` comment explaining the SSAID-derived fingerprint.
   - Update `.lovable/memory/architecture/stable-device-identity.md` with the new "fingerprint = sha256('ssaid:' + ssaid)" rule and the legacy-retention guard.

## Technical details

```ts
// new path inside generateDeviceFingerprint()
if (Capacitor.isNativePlatform()) {
  try {
    const { identifier } = await Device.getId();
    if (identifier) {
      const fp = await sha256Hex('ssaid:' + identifier); // 64 hex chars
      localStorage.setItem(DEVICE_ID_KEY, fp);
      return fp;
    }
  } catch {/* fall through to entropy path */}
}
```

`sha256Hex` reuses the existing `crypto.subtle.digest('SHA-256', …)` block with the same `simpleHash` fallback already in the file — no new deps.

## Expected result

- Fresh install on HMD Pulse → fingerprint deterministically derived from SSAID `b4d7e02f1500f505`. Reinstall/clear-data → identical fingerprint → server finds approved row directly via `getByFingerprint`, no pending row created, no recovery dance needed.
- Existing approved devices (like row `id 267`) keep working with their current fingerprint — zero disruption.
- Web users unaffected.

## What this does NOT change

- Reference generator format, sync engine, IndexedDB schema, receipt rendering, photo capture, Bluetooth, auth flow, RLS — all untouched.
- `approved_devices` schema — untouched.
- `/api/device/resolve-identity` — kept as a safety net, not removed.
