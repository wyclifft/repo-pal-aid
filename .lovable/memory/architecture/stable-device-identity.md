---
name: Stable Device Identity Across Reinstalls
description: SSAID-derived fingerprint on native (v2.10.112) + server-bound identity recovery (v2.10.109–111) so reinstall/clear-data preserves devcode, uniquedevcode, and counters
type: architecture
---

**v2.10.112 (primary fix):** On native, `generateDeviceFingerprint()` derives deterministically from Android SSAID: `fp = sha256("ssaid:" + Device.getId().identifier)`. Same APK signing key + same user profile → identical fingerprint after uninstall/reinstall/clear-data. Server resolves it directly via `/api/devices/fingerprint/:fp` — no duplicate pending row created. Back-compat: an existing `localStorage['device_id']` is NEVER overwritten (priority 1), so devices already approved under the legacy entropy hash keep their fingerprint and approved row. Web behavior unchanged (entropy fallback).


A reinstalled / cleared-data device must recover its ORIGINAL identity from the server instead of being issued a fresh one. Fresh identities risk TRNID / MILKID / STOREID / AIID mixups because counters restart.

**Endpoint:** `POST /api/device/resolve-identity` (additive, never modifies any existing endpoint). Body: `{ ssaid, model, manufacturer, osVersion, platform, legacyFingerprint, ccode? }`.

**Match priority against `approved_devices`:**
1. `device_fingerprint == legacyFingerprint` (back-compat)
2. `ssaid` exact (optionally scoped by `ccode`)
3. `ssaid + device_model + device_manufacturer` (3-way defensive)

**On hit:** server returns the original `device_fingerprint` (in `resolved_fingerprint`) plus the same payload shape as `/api/devices/fingerprint/:fp` (devcode, trnid, milkid, storeid, aiid from devsettings). The trnid self-heal `GREATEST(devsettings.trnid, MAX(transrefno))` is applied here too. Client rehydrates localStorage and `setStoredDeviceId(resolved_fingerprint)`.

**On miss:** 404. Client falls through to existing registration / `getByFingerprint` flow unchanged.

**Schema (additive):** `approved_devices` gains `ssaid`, `device_model`, `device_manufacturer`, `os_version`, `fingerprint_history` (TEXT, comma-joined), `last_seen_at`, plus `(ccode,ssaid)` and `(ssaid)` indexes. Migration: `backend-api/MIGRATION_APPROVED_DEVICES_HW.sql`. Backend wraps every new-column access in try/catch on `ER_BAD_FIELD_ERROR` so it stays safe until the migration is run.

**Frontend bundle:** `src/utils/deviceFingerprint.ts:collectHardwareBundle()` uses `@capacitor/device` (`Device.getId()` → SSAID on Android, `Device.getInfo()` for model/manufacturer/osVersion). The legacy `generateDeviceFingerprint()` is UNCHANGED — used as `legacyFingerprint` in the bundle.

**Login flow:** `src/components/Login.tsx` calls `mysqlApi.devices.resolveIdentity(bundle)` BEFORE the existing `getByFingerprint`, with a 1.5s/2s timeout. If a hit returns a different `resolved_fingerprint`, the client overwrites `deviceFingerprint` and skips the secondary lookup. Any failure → silent fall-through.

**What this fixes:** same APK + same signing key + same user, after uninstall + reinstall → SSAID stable → server returns original identity → counters continue.

**What it does NOT fix:** factory reset (SSAID rotates — best-effort 3-way match only), sideloaded APK with different signing key (correctly treated as new device), web PWA "Clear site data" (out of scope).

**Production safety:** strictly additive. No existing endpoint, response shape, sync engine, reference generator format, receipt rendering, photo capture, Bluetooth, or auth flow is modified. Old APKs in the field never call the new endpoint and keep working.
