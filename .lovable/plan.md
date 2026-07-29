## Problem

On the CS10 (Android 7 / WebView 51) the app logs:

```
✅ [BRIDGE] BluetoothClassic plugin found in bridge
❌ Classic Bluetooth availability check FAILED:
💡 Bridge issue detected: Plugin registration failed ...
ℹ️ Classic Bluetooth: getPairedDevices requires native plugin
```

The JS-side `registerPlugin('BluetoothClassic', ...)` proxy exists, but every native method call rejects as "not implemented". No paired devices show up. Bluetooth works at the OS level (scale is paired), so this is a plugin dispatch problem, not a hardware or permission problem.

## Root cause (unconfirmed until we run the fix, but strongly supported by evidence)

In `android/app/src/main/java/app/delicoop101/bluetooth/BluetoothClassicPlugin.kt`:

- `fun disconnect(call: PluginCall? = null)` uses a **Kotlin default parameter** and a **nullable `PluginCall?`**. Capacitor's Android bridge scans `@PluginMethod` methods expecting exactly `(PluginCall)` non-null. A non-conforming signature can throw during plugin init and cause the whole plugin's method table to be dropped — which matches the "plugin found, all methods not implemented" symptom.
- Secondary risk: any unchecked exception thrown while Capacitor introspects `@PluginMethod` handlers has the same effect.

## Fix plan

1. **Normalize every `@PluginMethod` signature** in `BluetoothClassicPlugin.kt`
   - Change `fun disconnect(call: PluginCall? = null)` → `fun disconnect(call: PluginCall)` (non-null, no default). Move the "disconnect both roles when role missing" logic inside the body — behavior unchanged.
   - Audit every other `@PluginMethod` to ensure the signature is exactly `fun name(call: PluginCall)` with no defaults, no nullable, no extra params. Fix any that deviate.

2. **Wrap `load()` in try/catch** so a failed adapter lookup can never abort plugin initialization silently. Log the failure but still let Capacitor finish registering the method table. `isAvailable()` will then honestly return `{ available: false }` instead of the whole plugin looking dead.

3. **Add a first-call self-test log**
   - At the top of `isAvailable()` log `"[BT] isAvailable invoked, adapter=..., enabled=..., sdk=..."` so the next CS10 logcat immediately shows whether the method is being reached.

4. **Verify AndroidManifest permissions** in `android/app/src/main/AndroidManifest.xml`
   - Confirm `BLUETOOTH`, `BLUETOOTH_ADMIN`, and (for API 31+) `BLUETOOTH_CONNECT` / `BLUETOOTH_SCAN` are declared. Add any that are missing. On Android 7 the first two are install-time and must be present for `bondedDevices` to return anything.

5. **JS-side diagnostics upgrade** in `src/services/bluetoothClassic.ts`
   - In the `isClassicBluetoothAvailable` catch, log the raw error's `code`, `message`, and `stack` (currently only the object is dumped, which stringifies to empty on WebView 51). Same in `getPairedDevices`. This gives us a real error string next round if the fix doesn't fully land.

6. **Version + verification**
   - Bump to `v2.11.19` (code 160), `APP_FIX_TAG = 'bt-plugin-dispatch-fix'`.
   - Update `src/constants/appVersion.ts` and `android/app/build.gradle`.
   - Run `bunx tsgo` — TS-only surface; Kotlin compile happens on the user's `npx cap sync android` + APK rebuild.
   - No changes to transactions, receipts, sync, IndexedDB, reference generator, cumulative logic, or Payments.

## Files touched

- `android/app/src/main/java/app/delicoop101/bluetooth/BluetoothClassicPlugin.kt` (signature + load try/catch + isAvailable log)
- `android/app/src/main/AndroidManifest.xml` (verify/add BT perms if missing)
- `src/services/bluetoothClassic.ts` (better error logging only)
- `src/constants/appVersion.ts` and `android/app/build.gradle` (version bump)

## After you pull

```bash
npm run build && npx cap sync android
# rebuild APK, reinstall on CS10
```

Then open the Printer/Scale dialog once and share the logcat lines starting with `[BT]` and the JS `❌ Classic Bluetooth availability check FAILED` line — if the fix works you'll see `[BT] isAvailable invoked ...` in logcat and paired devices in the dialog.
