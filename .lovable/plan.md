
# Stable Device Identity Across Reinstalls (v2.10.109)

Make the **server** the authority for a device's identity, so that uninstall / clear-data / reinstall never produces a new `devcode`, `uniquedevcode`, or per-route `clientFetch` digit. This eliminates the root cause of TRNID / MILKID / STOREID / AIID mixups when a device is reinstalled.

## The problem today

- `devcode`, `uniquedevcode`, and per-route `clientFetch` are stored in `localStorage` / IndexedDB.
- On uninstall + reinstall (or "Clear data"), all of this is wiped.
- The device runs the authorization flow again. Today the only key the server uses to recognize "this is the same physical device" is the locally-generated `device_fingerprint`, which on web/PWA is itself derived from local storage and so is also new after a wipe.
- Result: the server can issue a **different `devcode` / `uniquedevcode`** to what is physically the same device, and the device's `trnid` counter restarts from whatever it had cached. Two records can end up sharing the same `transrefno` family → mixups.

## The fix: server-issued, hardware-bound identity

On every login / authorization, the device sends a **stable hardware fingerprint bundle**. The server looks it up in `approved_devices`; if a match is found, it returns the device's **original** `(devcode, uniquedevcode, trnid, milkid, storeid, aiid, route clientFetch map)`. The client rehydrates these instead of generating them locally.

```text
Reinstall flow (today):
  Wipe → Login → server issues NEW devcode → trnid resets → ID collisions risk

Reinstall flow (target):
  Wipe → Login → send hw bundle → server matches approved_devices row
       → returns SAME devcode + last-known trnid/milkid/storeid/aiid
       → client rehydrates localStorage → IDs continue from where they left off
```

## Hardware fingerprint bundle (stable across uninstall)

The client sends a small JSON bundle on every authorization / login. Each field is best-effort; the server scores matches.

| Field | Source | Stable across uninstall? |
|---|---|---|
| `ssaid` | Capacitor `Device.getId()` (Android `Settings.Secure.ANDROID_ID`) | ✅ Same APK signing key + same user profile |
| `model` | `Device.getInfo().model` | ✅ |
| `manufacturer` | `Device.getInfo().manufacturer` | ✅ |
| `osVersion` | `Device.getInfo().osVersion` | ✅ (until OS upgrade) |
| `webViewVersion` | `Device.getInfo().webViewVersion` | mostly |
| `legacyFingerprint` | current `generateDeviceFingerprint()` output | back-compat with rows already in `approved_devices` |

Web/PWA continues to use the existing localStorage-derived fingerprint (web reinstalls are rare and out of scope for this hardening).

## Server-side identity resolution

New endpoint, additive:

```
POST /api/device/resolve-identity
Body: { ccode, hwBundle: { ssaid, model, manufacturer, osVersion, legacyFingerprint } }
```

Match priority against `approved_devices` (within the same `ccode`):
1. Exact `device_fingerprint == legacyFingerprint` (current behavior — back-compat).
2. Exact `ssaid` match (new, primary key for reinstall recovery).
3. `ssaid` + `model` + `manufacturer` triple — guards against the rare SSAID collision after factory reset.

On match → return the stored `uniquedevcode`, `devcode`, current `trnid`, `milkid`, `storeid`, `aiid`, and the route→`clientFetch` map. Also update the row's `last_seen_at` and append the new fingerprint to a `fingerprint_history` JSON column so future matches widen, never narrow.

On no match → fall through to the **existing** device-registration flow (unchanged). The new SSAID is then stored alongside the new fingerprint, so the second reinstall is recognized.

## Schema (additive — one migration)

```sql
ALTER TABLE approved_devices
  ADD COLUMN ssaid              VARCHAR(64)  NULL,
  ADD COLUMN device_model       VARCHAR(128) NULL,
  ADD COLUMN device_manufacturer VARCHAR(128) NULL,
  ADD COLUMN fingerprint_history JSON        NULL,
  ADD COLUMN last_seen_at       DATETIME     NULL,
  ADD INDEX idx_ccode_ssaid (ccode, ssaid);
```

All nullable, no defaults break existing rows. The existing `device_fingerprint UNIQUE` constraint stays — this is purely additive recovery metadata.

## Backend changes (`backend-api/server.js`)

- New `POST /api/device/resolve-identity` (above). Defensive: if any DB lookup throws, fall back to "no match" so the existing registration flow handles it — never blocks a reinstalled device from re-authorizing.
- On every successful device login (existing endpoint), **upsert** `ssaid`, `model`, `manufacturer`, `last_seen_at`, and append-merge `fingerprint_history` for the matched row. No change to the response shape of any existing endpoint.
- Counter-restore safety: when serving an identity-resolve hit, return the **server-side** `trnid` from `devsettings` (already authoritative). Client must trust it and overwrite local. Combined with the existing `GREATEST()` counter persistence rule and per-process mutex, this is collision-safe even if two devices ever shared a `devcode`.

## Frontend changes

### `src/utils/deviceFingerprint.ts`
Add `collectHardwareBundle()` that returns the bundle above. Existing `generateDeviceFingerprint()` is **untouched** (still used as `legacyFingerprint`).

### Authorization / login flow (`src/components/Login.tsx`, `src/contexts/AuthContext.tsx`, `src/utils/referenceGenerator.ts`)
1. Before showing the device-registration UI, call `POST /api/device/resolve-identity` with the bundle.
2. If the server returns a known device:
   - Write `devcode`, `uniquedevcode` to localStorage.
   - Call existing `initializeDeviceConfig()` / `storeDeviceConfig()` with returned `devcode`.
   - Seed local `trnid`, `milkid`, `storeid`, `aiid` from the server values (respecting `GREATEST()` semantics — never roll back if local cache happens to be ahead from an in-flight transaction).
   - Rehydrate per-route `clientFetch` from the returned route map (already covered by existing route fetch on login — just ensure it runs before any reference is generated).
3. If the server returns no match → existing registration flow runs unchanged.

### Offline safety
- Identity-resolve is an online-only optimization. When offline, the device falls back to whatever's in cache (current behavior). The `member-cache-resilience` rule already covers "load-then-sync, never wipe on network error".
- If `resolve-identity` fails with 5xx → we do **not** block login; the existing `resilient-device-authorization-blocking` rule continues to apply.

## What this fixes vs what it doesn't

| Scenario | Fixed by this plan |
|---|---|
| Same APK, same signing key, uninstall + reinstall | ✅ SSAID stable → server returns original identity |
| Factory reset (SSAID changes) | ⚠️ Partial — `model + manufacturer` match plus operator confirmation; falls through to registration if uncertain |
| Different signed APK (sideload) | ❌ Treated as a new device (correct behavior) |
| Web PWA "Clear site data" | ❌ Out of scope — web is rare in your fleet |
| Two physical devices sharing one `devcode` | Already handled today by server-side `trnid` mutex; this plan does not change that |

## Out of scope

- IMEI / `Build.SERIAL` / MAC address (blocked by Android 10+ permissions, would risk Play Store rejection).
- External-storage fingerprint files (Android 11+ scoped storage blocks this).
- Account-Manager-based identity (adds a permission prompt and visible account entry).
- Any change to the `transrefno` / `milkid` / `storeid` / `aiid` formats or to the reference generator itself.
- Any change to `devsettings` schema or counter semantics.

## Rollout (production-safe)

1. Ship the migration (additive columns + index).
2. Ship the new `POST /api/device/resolve-identity` endpoint. **No existing endpoint is modified.**
3. Ship the new APK / web build that calls resolve-identity opportunistically. Old APKs in the field keep working unchanged (they just never get the recovery benefit).
4. Monitor `[DEVICE][RESOLVE]` logs for hit/miss ratios over one week before considering further changes.

## Files touched

- `backend-api/MIGRATION_APPROVED_DEVICES_HW.sql` — new.
- `backend-api/server.js` — add resolve-identity endpoint; upsert hw fields on existing login. No existing route signatures changed.
- `src/utils/deviceFingerprint.ts` — add `collectHardwareBundle()`. Existing function unchanged.
- `src/services/mysqlApi.ts` — add `device.resolveIdentity()` call.
- `src/contexts/AuthContext.tsx` (or `Login.tsx`) — call resolve-identity before the registration branch; rehydrate identity on hit.
- `src/utils/referenceGenerator.ts` — accept a server-seeded counter snapshot (use `GREATEST(local, server)`).
- `src/constants/appVersion.ts` — bump to **v2.10.109**.
- New memory: `.lovable/memory/architecture/stable-device-identity.md` + index entry.

## Expected impact

- Reinstalled devices recover their `devcode`, `uniquedevcode`, and counter state automatically on next login.
- TRNID / MILKID / STOREID / AIID continuity is preserved across uninstalls.
- Zero regression risk for in-field APKs (they don't call the new endpoint).
- No change to receipt rendering, sync engine, Z-Reports, Bluetooth, photo capture, or any existing API contract.
