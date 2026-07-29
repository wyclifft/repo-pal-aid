## Actual issue

The internal CS10 printer crash is fixed: the app now correctly reports `CS10 internal printer available: false` and does not load the incompatible vendor SDK.

The new failure is separate: the external Classic Bluetooth printer socket is closing before/during print:

```text
[BT][JS][printer] Read error: bt socket closed, read return: -1
java.io.IOException: Broken pipe
BluetoothClassicJsBridge.write(...)
```

On Android, `BluetoothSocket.isConnected` can remain `true` even after the remote printer has closed the RFCOMM stream. The bridge then keeps stale printer state, and the next write hits `Broken pipe`.

## Plan (v2.11.24, versionCode 166, fixTag `classic-printer-broken-pipe-recovery`)

### 1. Fix stale socket state in the direct Android bridge

`android/app/src/main/java/app/delicoop101/bluetooth/BluetoothClassicJsBridge.kt`

- When the reader gets `IOException` or `read()` returns `< 0`, clear only that role's socket/input stream/device immediately.
- Emit `BluetoothClassic:connectionStateChanged` with `connected:false`, role, address, and error.
- In `write()`:
  - Catch `IOException` such as `Broken pipe`.
  - Close and clear only the `printer` role connection.
  - Return structured JSON error like `{ error: "printer socket closed: Broken pipe", disconnected: true, role: "printer" }` instead of leaving stale state.
- Preserve the scale role and existing paired-device behavior.

### 2. Apply the same safety to the Capacitor plugin path

`android/app/src/main/java/app/delicoop101/bluetooth/BluetoothClassicPlugin.kt`

- In both `write()` and `writeWithRole()` catch blocks, call `disconnectRole(role, notify = true)` before rejecting the call.
- In `startReading()`, treat `read() < 0` as a connection loss and clear the role.
- This keeps the fallback bridge and normal plugin behavior consistent.

### 3. Reconnect once automatically before retrying print

`src/services/bluetoothClassic.ts`

- Update the printer connection-loss listener so a verified `printer` disconnect immediately clears `classicPrinter` state.
- Add a guarded helper for `printToClassicPrinter()`:
  - If a chunk write fails with `Broken pipe`, `socket closed`, or `not connected`, disconnect/clear the printer role.
  - Reconnect once using the saved printer address/name.
  - Restart the print from the beginning once, not from the failed chunk, to avoid partial receipt corruption.
  - If retry fails, return a clear error: `Printer connection lost. Reconnect the Bluetooth printer and retry.`
- Keep receipt content and ESC/POS formatting unchanged.

### 4. Make the unavailable internal printer obvious

`src/services/bluetoothClassic.ts`

- Add `getInternalPrinterStatus()` that returns the full `Cs10PrinterAndroid.isAvailable()` payload, including `reason`, while keeping `isInternalPrinterAvailable()` as a boolean wrapper.

`src/components/PrinterConnectionDialog.tsx`

- When internal printer status is unavailable:
  - Show the internal printer button as clearly unsupported, not a silent green disabled button.
  - Show a direct explanation for `cs10-sdk-incompatible`: this CS10 Android 7 firmware does not include the required POS printer service, so the operator must use a paired Classic Bluetooth printer.
  - Add a `Use Bluetooth Printer Instead` button that switches to the CLASSIC tab.
- Do not change the behavior for devices where the internal SDK is actually available.

### 5. Version bump

`src/constants/appVersion.ts`

- `APP_VERSION = '2.11.24'`
- `APP_VERSION_CODE = 166`
- `APP_FIX_TAG = 'classic-printer-broken-pipe-recovery'`

`android/app/build.gradle`

- `versionName "2.11.24"`
- `versionCode 166`

## Not changed

No changes to transaction creation, receipt content, sync, IndexedDB, cumulative logic, farmer search, company settings, Bluetooth paired-device listing, or scale parsing.

## Verification

- Opening printer selector on CS10 shows 3 paired devices as before.
- Tapping unavailable internal printer gives visible guidance instead of appearing to do nothing.
- Printing to an external Classic printer no longer leaves stale connected state after `bt socket closed` / `Broken pipe`.
- On first broken-pipe print failure, the app reconnects once and retries the whole receipt once.
- If the printer is off/out of range, the app shows a clean recoverable error instead of repeated broken-pipe logs.