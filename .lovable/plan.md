## Problem

The server did find the same physical device by `ssaid`, but it selected the newest pending row instead of the existing approved row:

```text
Existing approved row: id 267, same ssaid, approved = 1, user_id = 31
New pending row:      id 268, same ssaid, approved = 0, user_id = pending
```

Current lookup orders by `last_seen_at DESC, id DESC`, so after clear-data the freshly registered pending row becomes the preferred identity. That is why the app keeps the new fingerprint instead of recovering the original approved fingerprint.

## Plan

1. **Fix backend identity selection**
   - Update `POST /api/device/resolve-identity` in `backend-api/server.js` and `sync-service/server.js`.
   - When matching by `ssaid`, prefer an approved/authorized existing device before any pending row.
   - Use ordering like: approved first, real assigned users before `pending`, then newest seen row.
   - Keep the endpoint additive and backward-compatible.

2. **Prevent future duplicate pending rows from stealing identity**
   - Update device registration so when a new fingerprint is registered with the same `ssaid`, the backend first attempts identity recovery.
   - If an approved row already exists for that `ssaid`, return that original row instead of inserting a new pending device.
   - If no approved row exists, registration can still create a pending row as today.

3. **Send hardware bundle during registration**
   - Update `src/services/mysqlApi.ts` device registration payload to allow `ssaid`, `device_model`, `device_manufacturer`, `os_version`, and `legacyFingerprint`.
   - Update `src/components/Login.tsx` so the same hardware bundle collected during login is reused when registering a new device.
   - This allows the server to avoid creating duplicate pending rows after clear-data.

4. **Add safe cleanup SQL for production**
   - Add a small MySQL cleanup script for this exact duplicate case:
     - keep approved row `267`
     - remove or mark duplicate pending row `268`
     - optionally append the new fingerprint to `fingerprint_history`
   - This will be manual, so production data is not changed automatically by the app.

5. **Version and documentation**
   - Bump app version to the next patch version.
   - Add comments documenting that stable device recovery must always prefer approved identities over pending duplicates.

## Expected result

After clear-data/reinstall, the HMD Pulse with `ssaid = b4d7e02f1500f505` will resolve back to the original approved fingerprint from row `267`, preserving `devcode`, `trnid`, `milkid`, `storeid`, and `aiid` instead of creating/using row `268`.