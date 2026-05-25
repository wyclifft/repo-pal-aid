# Fix dual-mode HC-04 scale: ignore BLE port, use Classic SPP only

## Problem

Dual-mode modules like HC-04 expose two Bluetooth endpoints:
- `HC-04BLE` — BLE GATT side. Pairs/connects silently, advertises generic services, but **does not stream weight data**.
- `HC-04` — Classic SPP (RFCOMM) side. PIN-paired (1234) and the only port that emits weight frames.

Today the BLE auto-reconnect / scan path picks up `HC-04BLE` because the name matches the broad `HC-` pattern in `BTM_SERIES_PATTERNS` (`src/services/bluetooth.ts:79`). It connects, never receives data, and the saved `storedDevice` keeps re-binding to the BLE half on every restart.

Per the logs (BA01 v2.10.98), `[BT][scale] status: connecting → connected (HC-04BLE)` followed by no weight events, then disconnect cycles.

## Goal (UI/connection-layer only — no backend, no transaction logic)

1. Never auto-connect to the BLE half of a dual-mode scale (any device whose name ends in `BLE` or matches `*-BLE` / `*BLE` suffix on a known scale family).
2. Hide the BLE half from the BLE scan results / paired list shown to the user, so it can't be picked accidentally.
3. For HC-04-class devices, route the user to the Classic SPP path (which already exists and requires the user to have paired with PIN 1234 in Android Bluetooth settings).
4. On startup, if the previously stored scale device is the BLE half, treat it as invalid: clear it and prompt the user to connect via Classic BT from Settings.

## Scope (files touched)

1. `src/services/bluetooth.ts`
   - Add helper `isBleHalfOfDualModeScale(name)` → true when `name` ends with `BLE` (case-insensitive) and the stripped base matches `isCompatibleScale` (e.g. `HC-04BLE`, `HC-05BLE`, `BTM…BLE`). Pure name check, no side effects.
   - In `isCompatibleScale` (used by BLE scan filter and auto-reconnect), return `false` when `isBleHalfOfDualModeScale(name)` is true.
   - In `quickReconnect` and any code path that loads `getStoredDeviceInfo()` to auto-reconnect over BLE, bail out early when the stored `deviceName` is the BLE half: log `[BT][scale] stored device is BLE half of dual-mode scale (HC-04BLE) — clearing and requiring Classic SPP pairing`, call `clearStoredDevice()`, return `{ success: false, error: 'BLE_HALF_BLOCKED' }`.
   - In the BLE scan result handler that surfaces devices to the picker UI, filter out names where `isBleHalfOfDualModeScale(name)` is true.

2. `src/services/bluetoothClassic.ts` (`getPairedScales`)
   - When listing paired devices for the Classic BT picker, **keep** `HC-04` (the SPP half) and **exclude** `HC-04BLE`. Same `isBleHalfOfDualModeScale` check.
   - When the user has `HC-04BLE` paired but not `HC-04`, surface a soft hint in the returned list metadata (e.g. add a synthetic `note` field) so the UI can show: *"Pair the SPP port 'HC-04' with PIN 1234 in Android Bluetooth settings — the BLE half does not transmit weight."* (UI string only; no behavior change if the field is unused.)

3. `src/hooks/useScaleConnection.ts`
   - In `autoReconnect`, after the existing printer-collision guard, add: if `storedDevice.deviceName` is the BLE half, call `clearStoredDevice()`, set `scaleConnected=false`, do not retry. One-shot, idempotent.

4. `src/services/btConnectionManager.ts`
   - In the scale reconnect branch (`role === "scale"`), if `getStoredDeviceInfo()` returns a BLE-half device, skip scheduling further BLE retries (prevents the 2s/4s loop seen in logs) and emit a single `btlog("warn", "scale", "BLE half of dual-mode scale blocked — pair Classic SPP port")`.

5. Version bump (per workspace rules):
   - `src/constants/appVersion.ts` → `APP_VERSION='2.10.99'`, `APP_VERSION_CODE=121`
   - `public/sw.js` → `CACHE_VERSION='v46'`
   - `android/app/build.gradle` → `versionCode 121`, `versionName "2.10.99"`

## Out of scope

- No changes to transaction creation, sync, receipts, photos, reports, device auth, or backend `server.js`.
- No changes to BLE notification/parsing for legitimate BLE-only scales (BTM/DR series without the `BLE` suffix continue to work).
- No new UI screens — only filtering of existing pickers and one toast/log message.

## Validation

- Logs should show: on app start with `HC-04BLE` stored → one `BLE half blocked` warn, no reconnect storm.
- BLE scan in Settings → `HC-04BLE` no longer appears; `HC-04` appears under Classic BT paired list.
- Connecting via Classic BT to `HC-04` → existing weight stream and `scaleConnectionChange(true)` fire normally.
- Verify other scales (BTM0304…, DR-series) still scan and connect via BLE as before.

