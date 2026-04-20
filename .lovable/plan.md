

## Fix: Add Member Blocked by CORS — `X-Device-Fingerprint` Not Allowed — v2.10.42

### Root Cause

The browser preflight for `POST https://2backend.maddasystems.co.ke/api/members` is rejected because the response's `Access-Control-Allow-Headers` does not list `X-Device-Fingerprint`:

- `backend-api/server.js` line 41:  
  `'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, Origin'`
- `backend-api/.htaccess` line 21: same list.

But `src/services/mysqlApi.ts` line 1009 (the new `membersApi.create` from v2.10.40) sends `X-Device-Fingerprint`. Result: preflight fails → `TypeError: Failed to fetch` → Add Member never reaches the server.

The `console line 333 "undefined"` log is the same failed-fetch error being logged with an `undefined` argument by the API request wrapper — it disappears once the CORS fix lands.

Note: other endpoints work because they send the fingerprint in the URL path (`/api/devices/fingerprint/:fp`) or in the JSON body, not as a custom header. `membersApi.create` is the only caller that puts it in a header.

---

### Fix Strategy (Production-Safe)

Two coordinated, additive changes — neither breaks any existing client:

**1. Backend — allow the header (authoritative fix)**
- `backend-api/server.js` line 41 → append `, X-Device-Fingerprint`.
- `backend-api/.htaccess` line 21 → same append (covers Apache-level OPTIONS responses on cPanel/Passenger).

This is the same `X-Device-Fingerprint` header the Capacitor app already sends successfully on native (where Capacitor bypasses browser CORS), so existing production clients are unaffected.

**2. Frontend — remove the header dependency (defense-in-depth)**
- `src/services/mysqlApi.ts` `membersApi.create` already sends `device_fingerprint` inside the JSON body, and the server already reads `body.device_fingerprint` as a fallback (`server.js` line 3112).  
  → **Remove the `X-Device-Fingerprint` header from the request** so the call is a "simple" CORS POST that requires no preflight at all. The body fingerprint continues to work identically.

This means Add Member will start working immediately on the web preview even before the backend `.htaccess` is redeployed, and on native it remains identical (server resolves ccode from `body.device_fingerprint`).

**3. Version bump**
- `src/constants/appVersion.ts` → **v2.10.42 (Code 64)**.

---

### Backward Compatibility

- **Capacitor production app (v2.10.40 and earlier)**: still sends `X-Device-Fingerprint` header — backend now allows it, so no regression. Native Capacitor doesn't enforce browser CORS anyway; this purely fixes the web preview path.
- **All other endpoints**: untouched. CORS list is only widened, never narrowed.
- **Server `/api/members` handler**: unchanged. It already prefers the header but falls back to `body.device_fingerprint`, which the frontend will continue to send.
- **No DB changes, no schema migration**.

---

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Append `X-Device-Fingerprint` to `Access-Control-Allow-Headers` (line 41) |
| `backend-api/.htaccess` | Append `X-Device-Fingerprint` to `Access-Control-Allow-Headers` (line 21) |
| `src/services/mysqlApi.ts` | Drop the `X-Device-Fingerprint` request header in `membersApi.create` (body fallback already covers it) — eliminates the preflight requirement entirely |
| `src/constants/appVersion.ts` | Bump to **v2.10.42 (Code 64)** |

### Out of Scope

- Refactoring all callers to a uniform header policy — only the broken site is touched.
- Investigating the legacy `line 333 "undefined"` log — it is a downstream symptom of this CORS failure and will stop on its own once Add Member succeeds.

### Deployment Note

- Frontend fix (Vite build) is sufficient on its own to unblock Add Member end-to-end (header removed → no preflight needed → server reads fingerprint from body).
- Backend `server.js` + `.htaccess` redeploy is recommended for completeness so any other future client that wants to send the header continues to work — but it is **not** a blocker for this release.

