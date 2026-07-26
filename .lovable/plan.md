# v2.11.10 — Native Boot & Bluetooth Recovery (CS10 / Android 7 / WebView 51.0.2704.81)

## What the logs actually show

From the attached logcat (unedited timeline):

1. **First error fired at 15:32:35.831** — before any user action:
  `Uncaught TypeError: window.Capacitor.triggerEvent is not a function`
   This comes from Capacitor Android's `Bridge.java` (verified in `node_modules/@capacitor/android/.../Bridge.java` L885/889) which evaluates
   `window.Capacitor.triggerEvent("appStateChange", "window", …)` on every lifecycle event. On WebView 52 the injected `native-bridge.js` executes **after** the legacy Vite bundle has already begun evaluating, so `window.Capacitor` exists as a stub without `triggerEvent`. Every subsequent `appStateChange` / `resume` / `pause` eval throws — this is the "Critical app error" line 32 of the log.
2. **Cascade** — because the bridge event evaluator throws, plugin proxies registered via `registerPlugin()` never receive their native handles. Calls like `BluetoothLe.requestDevice` and `BluetoothClassic.isAvailable` then fall through to the web shim, producing:
  - `"BluetoothLe plugin is not implemented on android"` (user-visible toast)
  - `"Classic Bluetooth: Native plugin not yet implemented"` (log line 121)
  - `Failed to connect to printer` and `Bluetooth connection error` (lines 113, 128)
3. `**Settings fetch failed` / `Network error - waiting for retry**` starts at 15:32:35.833 and repeats. Because the visible page still says *"Company code not assigned"*, `psettings` never populated — the loop is `useAppSettings` retrying on the very first foreground tick before the bridge/network is ready. Same root cause: bridge init errored, so `Network.getStatus()` returned a fallback and the offline path never resolved.
4. Backend TLS is fine now — `getaddrinfo … gai_error = 0` and later `Handling local request: https://app/…` succeed. v2.11.9's trust anchor is holding.

## Fix strategy

Address the root cause (bridge JS API mismatch on WebView 51.0.2704.81) first; the Bluetooth and "company code" symptoms disappear once the bridge stops throwing.

### 1. Polyfill missing bridge JS APIs in `index.html`

Add a **tiny inline script that runs before `/src/main.tsx**` (and before the legacy bundle) that guarantees `window.Capacitor.triggerEvent` exists as a no-op fallback. When the real native-bridge.js later attaches its own implementation, that one wins; when it never attaches (WebView 52 race), our stub keeps `Bridge.java`'s `evaluateJavascript` calls from throwing and poisoning plugin registration.

```text
if (!window.Capacitor) window.Capacitor = {};
if (typeof window.Capacitor.triggerEvent !== 'function') {
  window.Capacitor.triggerEvent = function () { /* no-op fallback */ };
}
```

Same guard for `Capacitor.fromNative` and `Capacitor.handleWindowError` (both called from `Bridge.java`) — verified as the only other JS-side entry points invoked via `evaluateJavascript`.

### 2. Register `BluetoothLe` explicitly in `MainActivity.kt`

`@capacitor-community/bluetooth-le` is present in `capacitor.build.gradle` and auto-registers, **but** auto-registration in Capacitor 7 depends on the bridge JS bootstrap completing. Adding an explicit `registerPlugin(BluetoothLe::class.java)` call in `MainActivity.onCreate` (mirroring how we register `BluetoothClassicPlugin`) makes registration order deterministic on WebView 52.

### 3. Guard `useAppSettings` first-tick storm

`useAppSettings` fires `👁️ App visible - refreshing psettings` 8+ times inside the first second because our `visibilitychange` listener in `src/main.tsx` and `AppPlugin.appStateChange` both dispatch on boot, and each retry logs `Network error - waiting for retry`. Add a 500 ms in-flight debounce so the initial storm collapses into a single request. This is a UX fix only — no business-logic change.

### 4. Verify no other symptoms need code

- The two stacked toasts in `image-7.png` (green "Company data refreshed: DAIRY COLLECTION" + blue "Refreshing company data…") are expected and clear on their own — nothing to change.
- The blue background on the dashboard is the normal theme, not a "black UI". Once `psettings` returns after fix #1, the header and dashboard render normally as shown in `image-8.png`.

## Files touched

- `index.html` — inline pre-bundle polyfill block (≈10 lines) before the `<script type="module">`.
- `android/app/src/main/java/app/delicoop101/MainActivity.kt` — add `registerPlugin(BluetoothLe::class.java)` and matching import.
- `src/hooks/useAppSettings.ts` — add 500 ms debounce around the `appVisible` refresh handler.
- `src/constants/appVersion.ts` — bump to `2.11.10` (code 152, tag `native-boot-bridge-polyfill`).
- `android/app/build.gradle` — matching versionCode/versionName bump.

No changes to: server.js, payments module, cumulative logic, reference generator, IndexedDB schema, or any sync path.

## Verification checklist (after rebuild + reinstall)

1. Fresh app launch on CS10 → logcat shows **no** `triggerEvent is not a function`.
2. Settings → **Search Printer** and **Search Scale** open the picker without `"BluetoothLe plugin is not implemented on android"`.
3. Dashboard header shows the real company name (not "Company code not assigned") within 5 s of first launch on Wi-Fi.
4. `useAppSettings` logs a single `Settings fetch` on visibility change, not a burst.
5. No regression: milk transaction creation, receipt print, farmer sync, cumulative correctness (v2.10.121 hold still active).

## Rebuild command for the user

```
npm run build
npx cap sync android
# reinstall APK on CS10
```

&nbsp;