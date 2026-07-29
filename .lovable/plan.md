## Goal

Get the APK to compile again and make the `BluetoothClassic` plugin reliably discoverable by the JS bridge on WebView 51 (CS10). Business logic untouched — Bluetooth pipeline only.

## Root causes

1. **Build failure** — `MainActivity.kt:49` calls `bluetoothClassicJsBridge.shutdown()` on a `var` in `onDestroy()`. Kotlin refuses to smart-cast a mutable field, so compilation fails.
2. **Duplicate `BluetoothLe` registration** — `BluetoothLe` is a community plugin auto-discovered from `node_modules` via the generated `capacitor.plugins.json`. Manually calling `registerPlugin(BluetoothLe::class.java)` in `MainActivity.onCreate` registers it a second time. On WebView 51 that overwrite can leave the bridge's plugin map in an inconsistent state; the "Found 6 plugins" JS report and the `UNIMPLEMENTED` responses for `BluetoothClassic` are consistent with a corrupted registration pass.
3. **Boot-time JS syntax error** — an `Unexpected token (` early in boot may abort the JS-side bridge init before diagnostics run.
4. **Bridge race on legacy WebView 51** — `isAvailable()` fires before the native plugin map is fully published, returning `UNIMPLEMENTED` once and never retrying.

## Changes

### 1. `android/app/src/main/java/app/delicoop101/MainActivity.kt`
- Fix the smart-cast error in `onDestroy()` using a local `val`:
  ```kotlin
  override fun onDestroy() {
      bluetoothClassicJsBridge?.let { it.shutdown() }
      DatabaseLogger.flush()
      super.onDestroy()
  }
  ```
- Remove the manual `registerPlugin(BluetoothLe::class.java)` line and its import — Capacitor auto-registers it from `capacitor.plugins.json`.
- After `super.onCreate(...)`, log the actual plugin map so we can see what the bridge published:
  ```kotlin
  bridge?.let { b ->
      val names = b.plugins?.keys?.joinToString(", ") ?: "none"
      Log.d(TAG, "[BRIDGE] Registered plugins: $names")
  }
  ```
- Keep `BluetoothClassicPlugin` and `OfflineStoragePlugin` manual registrations (they live in the app module and aren't in `capacitor.plugins.json`).

### 2. `src/main.tsx`
- Enhance the existing 5 s bridge diagnostic to print the full plugin name list and to flag missing `BluetoothClassic` / `OfflineStorage` explicitly (already partly there — extend to log the full array with `JSON.stringify` so WebView 51's console preserves it).
- Wrap the top-level boot code that likely emits `Unexpected token (` — the current file uses optional chaining / template literals fine because Vite transpiles `src/**`, but the inline snippet in `index.html` is not transpiled. Audit `index.html` for any ES2017+ syntax (arrow default params, `??`, etc.) and rewrite to ES5.

### 3. `index.html`
- Scan the inline `<script>` blocks for ES2016+ syntax that WebView 51 rejects (`??`, `?.`, `async`, arrow functions with default destructuring). Convert to ES5-safe equivalents. Keep behaviour identical.

### 4. `src/services/bluetoothClassic.ts`
- Add a bounded retry to the availability check to cover the WebView 51 bridge race:
  ```ts
  async function ensureBridgeReady(maxMs = 4000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const plugins = (window as any).Capacitor?.Plugins;
      if (plugins?.BluetoothClassic) return true;
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  }
  ```
  Call it before `BluetoothClassic.isAvailable()`. If still absent, fall back to the existing `BluetoothClassicAndroid` JS-interface bridge already installed in `MainActivity` (v2.11.20 fallback). No change to public API.

### 5. Version bump
- `src/constants/appVersion.ts` → `2.11.19` (tag `bt-bridge-fix`).
- `android/app/build.gradle` → `versionCode 161`, `versionName "2.11.19"`.

## Verification

- `./gradlew :app:compileDebugKotlin` succeeds.
- On CS10 after `npm run build && npx cap sync android` + reinstall:
  - Logcat shows `[BRIDGE] Registered plugins: ...BluetoothClassic, OfflineStorage, BluetoothLe...`.
  - JS console shows the full plugin list (not just "Found 6 plugins").
  - Printer/Scale dialog no longer returns `UNIMPLEMENTED`; `getPairedDevices` returns bonded devices.

## Non-goals

- No changes to `BluetoothClassicPlugin.kt` internals, connection logic, printer/scale flows, UI, farmers/store code, sync, or backend. Only build fix + registration cleanup + diagnostics + retry guard.
