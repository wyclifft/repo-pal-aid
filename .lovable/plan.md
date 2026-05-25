# Fix: HC-04BLE reconnects despite HC-04 (Classic SPP) being paired

## Root cause

Two independent localStorage slots hold "last scale":

- `lastConnectedScale` — written by BLE connect path (`bluetooth.ts` → `saveDeviceInfo`)
- `lastConnectedClassicScale` — written by Classic SPP connect path (`bluetoothClassic.ts` → `saveClassicDeviceInfo`)

Neither path clears the other. After the user pairs HC-04 over Classic SPP, the stale `HC-04BLE` entry from a prior BLE scan still lives in `lastConnectedScale`. `btConnectionManager.getSavedDevice("scale")` checks BLE **first**, so the stale BLE half wins and the app reconnects to `HC-04BLE` on every restart.

## Fix (v2.10.100, connection-layer only)

1. **`src/services/bluetoothClassic.ts` → `saveClassicDeviceInfo`**
   After persisting `lastConnectedClassicScale`, call `clearStoredDevice()` from `bluetooth.ts` so any prior BLE record is invalidated.

2. **`src/services/bluetooth.ts` → `saveDeviceInfo`** (BLE scale path)
   Symmetrically clear `lastConnectedClassicScale` so the two slots can never both hold competing scale entries.

3. **`src/services/btConnectionManager.ts` → `getSavedDevice("scale")`**
   Reverse precedence — try **Classic first**, fall back to BLE only when no Classic record exists. Classic SPP is the weight-bearing transport on every dual-mode module.

4. **One-time migration on app load** (inside `installAutoReconnect`)
   If both keys exist for the scale role, drop the BLE one and log:
   `[BT][scale] migration: cleared stale BLE record in favour of Classic SPP`.

5. **Version bump**
   - `src/constants/appVersion.ts` → `APP_VERSION='2.10.100'`, `APP_VERSION_CODE=122`
   - `public/sw.js` → `CACHE_VERSION='v47'`
   - `android/app/build.gradle` → `versionCode 122`, `versionName "2.10.100"`

## Out of scope

No changes to transactions, sync, receipts, IndexedDB schema, reference generator, auth, photos, reports, or `server.js`. Printer storage untouched. Classic-only and BLE-only users see zero behavioural change.

## Validation

- Restart with HC-04 paired via Classic SPP + stale HC-04BLE record → log shows migration line, app reconnects to HC-04 (Classic), no BLE retry storm.
- Fresh BLE-only scale (e.g. BTM0304) → still reconnects via BLE.
- Manual "Forget device" → both slots cleared (already handled by `bt.forget`).
