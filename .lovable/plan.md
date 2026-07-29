## What is happening

- The Android 7 warnings for `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` are not the main failure. Those permissions only exist on newer Android versions, so Android 7 logs them as unknown and ignores them.
- The paired scale list is empty because the app is still calling the Capacitor `BluetoothClassic` proxy first. On the CS10 WebView 51 device, that proxy exists in JavaScript but dispatches native calls as `UNIMPLEMENTED`, so `getPairedDevices()` never reaches Android's bonded-device list.
- The internal CS10 printer is not a normal Bluetooth printer. It uses the device vendor POS printer SDK (`PosApiHelper` / `libPosApi.so`), so looking for it in paired Bluetooth devices or connecting to placeholder MAC addresses cannot print to the built-in printer.

## Plan

1. **Make Android 7 use the direct Bluetooth bridge first**
   - On native Android, prefer the existing `BluetoothClassicAndroid` WebView JS interface immediately instead of waiting for the broken Capacitor plugin call to fail.
   - Keep the Capacitor plugin as a secondary path for newer devices.
   - This makes `isAvailable()` and `getPairedDevices()` read directly from `BluetoothAdapter.bondedDevices` on CS10.

2. **Fix paired scale/printer visibility**
   - Keep the JS-interface fallback active for connect, disconnect, write, and connection status.
   - Improve logs so the APK shows whether bonded devices were loaded through the direct bridge or Capacitor.
   - Do not change transaction, sync, cumulative, receipt, or IndexedDB logic.

3. **Add a real CS10 internal printer bridge**
   - Add the CS10 vendor printer SDK jar/native library files to the Android app.
   - Create a small native `Cs10PrinterJsBridge` that exposes:
     - `isAvailable()`
     - `printText(text)`
     - `status()`
   - Register it as `window.Cs10PrinterAndroid` in `MainActivity` before the app uses printer functions.

4. **Route print jobs correctly**
   - In `bluetoothClassic.ts`, add `printToInternalPrinter()` and auto-detect the CS10 internal printer bridge before Bluetooth print output.
   - If the internal printer is available, print receipts through the vendor SDK path.
   - If not available, fall back to the existing Classic Bluetooth printer path.

5. **Update the printer dialog**
   - Change the “Direct” printer option so it no longer asks for fake/placeholder MAC addresses as the normal path.
   - Add an “Internal CS10 Printer” action that uses the native printer bridge.
   - Keep manual MAC entry only as a fallback for real external Bluetooth printers.

6. **Version bump and notes**
   - Bump app version to `2.11.22`, Android `versionCode` to `164`, and set the fix tag to `cs10-bt-printer-native`.
   - Add a short changelog comment stating this is a Bluetooth/printer plumbing fix only.

## Verification

- Confirm the code compiles for Android after adding the native bridge.
- Expected CS10 logcat after reinstall:
  - `[BT][JS] Found N paired devices`
  - `[INIT] Registered BluetoothClassicAndroid JS fallback bridge`
  - `[INIT] Registered Cs10PrinterAndroid JS bridge`
  - `[CS10-PRINTER] Print started successfully` when printing internally

## After implementation

You will need to rebuild and sync native files before installing the APK:

```bash
npm run build
npx cap sync android
```

Then reinstall the APK on the CS10 and test:

1. Open printer/scale selector.
2. Confirm paired scale devices appear.
3. Select the scale via Classic.
4. Print a receipt using the internal CS10 printer option.