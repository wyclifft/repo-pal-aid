
## Problem

On integrated POS hardware (Classic printer + native plugin sharing one RFCOMM socket), the **Dashboard scale indicator turns green** specifically after:
1. Connecting only the Classic Bluetooth printer.
2. Opening the Buy portal.

The v2.10.68 fix gated the `dataReceived` listener and stopped weight broadcasts from flipping the indicator. The remaining leaks are on the **connection-change event path** and the **Buy-portal auto-reconnect path**, both of which can spuriously emit `scaleConnectionChange { connected: true }` while only a printer is paired.

## Root cause (remaining holes)

1. **`useScaleConnection.autoReconnect`** runs on `LiveWeightDisplay` / `CoffeeWeightDisplay` mount. It calls `quickReconnect(...)` (BLE) using whatever device id is in `getStoredDeviceInfo()`. On integrated POS units, the *stored* "scale" device id can actually be the printer's MAC (saved during a prior misclassification, or because the same controller exposes both). The BLE quickReconnect succeeds, fires `broadcastScaleConnectionChange(true)`, and the dashboard turns green.

2. **`scaleConnectionChange` event has no payload identifying the source device.** Any code path that dispatches `{ connected: true }` is trusted globally. There is no guard against a printer-side reconnect surfacing as a scale event.

3. **No telemetry** on which exact dispatch is fired during the Buy-portal navigation, so the user (and us) cannot distinguish path 1 vs another path.

## Fix

### 1. `src/hooks/useScaleConnection.ts` — gate `autoReconnect` by printer state

Skip BLE auto-reconnect when:
- A Classic printer is currently connected (`isClassicPrinterConnected()`), AND
- The stored "scale" device address matches the connected printer address.

This stops the Buy portal from re-opening the printer's socket as a "scale".

```ts
const autoReconnect = useCallback(async () => {
  const storedDevice = getStoredDeviceInfo();
  if (!storedDevice || scaleConnected) return;

  // Guard: don't auto-reconnect a "scale" that is actually the printer
  if (isClassicPrinterConnected()) {
    const printerInfo = getCurrentClassicPrinterInfo?.();
    if (printerInfo && printerInfo.address === storedDevice.deviceId) {
      console.warn('🚫 Skipping scale autoReconnect — stored scale id matches connected printer');
      return;
    }
  }
  // ... existing flow
}, [...]);
```

### 2. `src/services/bluetooth.ts` — verify before broadcasting `scaleConnectionChange(true)`

In `broadcastScaleConnectionChange`, when `connected === true`, require that **either** a BLE scale `deviceId` is set on the `scale` singleton **or** `isClassicScaleConnected()` is true. Otherwise drop the event and log a warning. This makes the event impossible to fake from any future code path.

```ts
export const broadcastScaleConnectionChange = (connected: boolean) => {
  if (connected) {
    const real = (scale.isConnected && !!scale.deviceId) || isClassicScaleConnected();
    if (!real) {
      console.warn('🚫 Suppressed scaleConnectionChange(true) — no scale role active');
      return;
    }
  }
  window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected } }));
};
```

### 3. `src/services/bluetoothClassic.ts` — same guard on the direct dispatch

The `connectClassicScale` success path dispatches `scaleConnectionChange { connected: true }` directly (line ~406). Replace the direct `window.dispatchEvent` with the guarded `broadcastScaleConnectionChange(true)` so the same verification runs.

### 4. `Dashboard.tsx` — final UI-level sanity check

In the `handleScaleChange` listener, when an event arrives with `connected: true`, double-check `isScaleConnected()` before flipping the dot green. If the truth source disagrees, ignore the event and log it. This prevents any stray dispatch from any module from misleading the UI.

```ts
const handleScaleChange = (e: CustomEvent<{ connected: boolean }>) => {
  if (e.detail.connected && !isScaleConnected()) {
    console.warn('🚫 Dashboard ignored scaleConnectionChange(true) — truth source says no scale');
    return;
  }
  setScaleConnected(e.detail.connected);
};
```

### 5. Diagnostic logs

Add a single, very visible log line at each of: `autoReconnect` entry (with stored id + printer address), `broadcastScaleConnectionChange(true)` (with caller stack), and the Dashboard's `handleScaleChange`. These are guarded to native only and stripped of secrets so the user can paste them back if the issue persists.

### 6. Version bump

- `src/constants/appVersion.ts`: `APP_VERSION = '2.10.69'`, `APP_VERSION_CODE = 91`, with a changelog entry describing the four guards.
- `android/app/build.gradle`: `versionCode 91`, `versionName "2.10.69"`.

## Out of scope

- No changes to the native `BluetoothClassicPlugin.kt`. The shared-socket architecture is preserved; we are defending purely on the JS side, which is safer for the production app.
- No change to printer behavior, BLE scan logic, or receipt/sync paths.

## Verification checklist

After install of v2.10.69 (fully close + reopen):

1. No scale paired. Connect only the Classic printer.
2. Open Buy portal. Indicator must remain **red**. Console should show one of:
   - `🚫 Skipping scale autoReconnect — stored scale id matches connected printer`, or
   - `🚫 Suppressed scaleConnectionChange(true) — no scale role active`, or
   - `🚫 Dashboard ignored scaleConnectionChange(true) — truth source says no scale`.
3. Now connect a real scale. Indicator turns green normally. Live weight displays.
4. Disconnect scale, keep printer. Indicator returns to red, printer indicator unaffected.
5. Print a receipt. Printer indicator stays green throughout.

## Files to modify

- `src/hooks/useScaleConnection.ts`
- `src/services/bluetooth.ts`
- `src/services/bluetoothClassic.ts`
- `src/components/Dashboard.tsx`
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
