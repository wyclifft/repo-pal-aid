## Problem

In `backend-api/server.js` (`POST /api/auth/login`, line 3264-3266) the user is fetched by `userid + password` only:

```js
SELECT * FROM user WHERE TRIM(userid) = ? AND TRIM(password) = ?
```

If two accounts in different companies happen to share the same `userid` and `password`, MySQL returns whichever row it finds first. The strict CCODE check that follows (line 3297-3316) then compares that arbitrary row's `ccode` against the device's `ccode` and rejects the login with:

> "Access denied. Your account is restricted to your assigned company."

The legitimate account for the device's company is never considered.

## Fix (server.js only — minimal, additive)

Change the user lookup so the device's company is part of the match key when a `device_fingerprint` is supplied.

### Flow (new)

```text
1. Receive { userid, password, device_fingerprint }
2. If device_fingerprint present:
     a. Look up device ccode from devsettings (already done today, just move it earlier).
     b. SELECT * FROM user
        WHERE TRIM(userid)=? AND TRIM(password)=?
          AND UPPER(TRIM(ccode)) = UPPER(TRIM(deviceCcode))
        LIMIT 1
     c. If 0 rows -> fall back to the legacy lookup (userid+password only),
        then run the existing post-lookup CCODE guard so behaviour is identical
        for: (i) wrong password, (ii) genuine cross-company access attempt,
        (iii) device with no ccode registered, (iv) lookup failure.
3. If no device_fingerprint: keep current behaviour exactly (legacy clients).
4. Continue with existing toBool / response shape — no API contract change.
```

### Why this is safe for production

- **Backward compatible**: clients that don't send `device_fingerprint` (older builds) hit the unchanged code path.
- **No schema change**: uses existing `user.ccode` and `devsettings.ccode`.
- **Same response shape**: success and error payloads unchanged.
- **Same security posture**: the existing CCODE mismatch rejection still fires for any case the new scoped lookup can't resolve, so cross-company login attempts are still blocked.
- **Same error messages**: "Invalid credentials" for wrong password, "Access denied..." only when a real cross-company attempt happens.

### Logging

Add one `console.log` line when the scoped lookup succeeds (`[AUTH][CCODE] scoped match userid=… ccode=…`) so we can verify in prod logs that multi-tenant logins are now resolving correctly. No PII beyond what's already logged.

## Out of scope

- No frontend changes (`src/components/Login.tsx` already sends `device_fingerprint`).
- No changes to offline login path (hashed cache is per-device, already CCODE-correct).
- No changes to the `user` table schema or to any other endpoint.
- No version bump required (server-side only, no client cache invalidation needed). If you want one for traceability I'll add `2.10.105 / code 127 / sw v52` — say the word.

## Files touched

- `backend-api/server.js` — only the `/api/auth/login` handler (~lines 3250-3316).

## Verification

1. Two users in `user` table with identical `userid`+`password`, different `ccode` (A and B).
2. Device A (fingerprint mapped to ccode A in `devsettings`) logs in → returns user with ccode A. ✅
3. Device B logs in with same credentials → returns user with ccode B. ✅
4. Device A logs in with credentials that only exist under ccode B → "Access denied…" (unchanged). ✅
5. Wrong password on either device → "Invalid credentials" (unchanged). ✅
6. Legacy client without `device_fingerprint` → behaves exactly as today. ✅
