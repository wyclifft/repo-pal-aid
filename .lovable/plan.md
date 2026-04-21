

## Fix: Scale Connection Disconnects the Printer (and vice versa) — v2.10.54

### Root Cause

The two BLE connections are sharing a single Android Bluetooth GATT client and stepping on each other. Three concrete defects in `src/services/bluetooth.ts`:

1. **Disconnect callback is wired by `deviceId` but the handler clears state blindly.**  
   When connecting the scale, we register:
   ```ts
   await BleClient.connect(scaleDeviceId, (disconnectedDeviceId) => clearScaleState());
   ```
   and the same for the printer. The Android stack also fires the scale's disconnect callback when **another** GATT client (the printer connect) opens a chooser or runs `BleClient.requestDevice`, briefly tearing down the existing GATT to renegotiate. The callback runs `clearScaleState()` / `clearPrinterState()` without verifying *which* device disconnected, so the still-alive device is marked as disconnected in the UI.

2. **`quickReconnect*` calls `BleClient.disconnect(deviceId)` unconditionally before connecting.**  
   On Android, `BleClient.disconnect` is a process-wide call. When the printer auto-reconnect runs while the scale is mid-connect (or vice versa), the stale-disconnect call resets the shared GATT client and kills the *other* device's connection. The 1.5s startup auto-reconnect timer in `PrinterSelector` makes this fire right when the user is trying to scan for a scale.

3. **`scanForPrinters` runs an LE scan while a GATT connection is active.**  
   On most Android chipsets, `requestLEScan` with `allowDuplicates:false` and a 5s window starves the active GATT link and triggers a supervision-timeout disconnect on whichever device is connected first.

### Fix

#### A. Make disconnect callbacks device-scoped (`src/services/bluetooth.ts`)
Change the four `BleClient.connect(...)` callsites so the callback only clears state if the disconnected device id matches:
```ts
await BleClient.connect(deviceId, (disconnectedDeviceId) => {
  if (disconnectedDeviceId !== scale.deviceId) {
    console.log(`ℹ️ Ignoring disconnect for ${disconnectedDeviceId} — not our scale`);
    return;
  }
  clearScaleState();
});
```
Same guard for the printer (compare against `printer.deviceId`). This is the single most important fix — it stops the "scale connects → printer reports disconnected" symptom immediately.

#### B. Stop cross-killing the other device during reconnect
- Inside `quickReconnect` (scale) and `quickReconnectPrinter`, **only** call `BleClient.disconnect(deviceId)` if `scale.deviceId === deviceId` or `printer.deviceId === deviceId` respectively. Never disconnect by raw id when we're not certain it belongs to *this* device's slot.
- Wrap with try/catch so a failed disconnect of a stale id never propagates.

#### C. Serialize BLE operations with a tiny mutex
Add a module-level `bleOperationLock` (a `Promise` chain) in `bluetooth.ts`. Wrap `connectBluetoothScale`, `connectBluetoothPrinter`, `connectToSpecificPrinter`, `quickReconnect`, `quickReconnectPrinter`, and `scanForPrinters` so only one runs at a time. This prevents the printer auto-reconnect from racing with the user's scale scan.

#### D. Pause active GATT activity during printer scan
Before `BleClient.requestLEScan` in `scanForPrinters`:
- If a scale is connected via BLE, stop its notifications (keep the GATT link), run the scan, then re-`startNotifications` after `stopLEScan`.
- Reduce the default scan window from 5000 ms to 3000 ms to shorten the contention window.

#### E. Guard the printer auto-reconnect on Settings/PrinterSelector mount
In `src/components/PrinterSelector.tsx` and `src/pages/Settings.tsx`, defer the initial `attemptAutoReconnect` if `isScaleConnected()` is currently `true` *and* the scale was connected within the last 5 seconds (treat the scale as "warming up"). This avoids the 1.5s startup-timer race when the user is mid-scale-connect on app launch.

#### F. Preserve UI state when only one side actually drops
In `Settings.tsx` and `PrinterSelector.tsx`, listen for `scaleConnectionChange` and `printerConnectionChange` separately — already done — but additionally re-verify with `verifyScaleConnection()` / `verifyPrinterConnection()` on `connected:false` events before flipping the badge. The new `verifyXxx` debounced check confirms whether the device is *really* gone (vs. a spurious callback from fix A's race window).

#### G. Version bump
Update `src/constants/appVersion.ts` to **v2.10.54 (Code 76)** with note: "Bluetooth: prevent printer/scale cross-disconnects (device-scoped callbacks, BLE op mutex, scan pauses notifications, deferred auto-reconnect)."

### Files Changed

| File | Change |
|---|---|
| `src/services/bluetooth.ts` | Device-scoped disconnect callbacks (4 sites); `quickReconnect*` stale-disconnect only if id matches current slot; module-level BLE operation mutex; `scanForPrinters` pauses scale notifications and shortens scan window. |
| `src/components/PrinterSelector.tsx` | Defer initial auto-reconnect 5s if a scale was just connected; verify on `printerConnectionChange:false` before flipping badge. |
| `src/pages/Settings.tsx` | Same verify-before-flip pattern for both scale and printer state listeners. |
| `src/constants/appVersion.ts` | Bump to v2.10.54 (Code 76). |

### What Does NOT Change

- Backend `server.js` — untouched.
- Classic SPP plugin (`bluetoothClassic.ts` / `BluetoothClassicPlugin.kt`) — untouched. Classic and BLE already coexist independently; the fix is purely on the BLE side.
- IndexedDB schema, sync engines, references, photo system — untouched.
- v2.10.51 coffee SCODE, v2.10.52 Debtors prefix, v2.10.53 Periodic Report — untouched.

### Verification After Deploy

1. **Cold start**: open app → printer auto-reconnect runs → confirm printer badge turns green.
2. **Connect scale while printer connected**: tap "Connect Scale" → BLE flow → scale connects. Printer badge **must remain green** throughout.
3. **Reverse**: with scale connected, open Printer dialog → "Scan for Printers" → connect a printer. Scale badge **must remain green**, weight stream **must keep flowing**.
4. **Print a receipt while live weight is streaming**: capture a transaction → print → confirm both devices stay connected and weight resumes after print.
5. **Force disconnect one device manually** (turn off scale): only the scale badge flips to disconnected; printer stays green.
6. **Repeat 1–5 with Classic-SPP scale + BLE printer combo** to confirm no regression to the Classic path.

### Out of Scope

- Migrating printer to Classic SPP (bigger rewrite; not needed once cross-talk is fixed).
- Replacing `@capacitor-community/bluetooth-le` with a multi-GATT-client native bridge.
- Backfill or schema changes.

