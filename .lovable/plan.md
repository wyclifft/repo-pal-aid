## What I checked

I focused only on things that happen before React can render.

Confirmed from the current project files:

- `capacitor.config.ts` uses `webDir: 'dist'` and serves native Android from Capacitor local origin `https://app`.
- The current checkout does not show a packaged Capacitor web asset folder at `android/app/src/main/assets/public`, and `dist` is not present in the sandbox checkout right now. That means the Android project currently available here does not contain the copied Vite build assets.
- `index.html` contains its own pre-React spinner via `#root:empty::after`. If React never mounts, that spinner will run forever.
- `index.html` also registers `/sw.js` directly, outside the Capacitor guard in `src/main.tsx`.
- `src/main.tsx` has a Capacitor guard around its service worker registration, but that guard does not protect the inline service worker script in `index.html`.
- `public/sw.js` can serve `/offline.html` as a navigation fallback.
- Android uses `AppTheme.NoActionBarLaunch` with `Theme.SplashScreen`, but the theme only sets `android:background`; it does not explicitly define a post-splash theme handoff.

## Most likely causes to verify first

### 1. Vite build assets were not copied into Android

Why it matches:

- If `dist` was not built or `npx cap sync android` was not run after the Vite build, Android can launch the WebView but fail to load the real app bundle.
- React would never execute.
- The pre-React spinner from `index.html` can remain forever.
- A missing/fallback asset path can also explain screens like `https://app//offline.html`.

How to verify:

```bash
npm run build
npx cap sync android
ls android/app/src/main/assets/public
ls android/app/src/main/assets/public/assets
cat android/app/src/main/assets/public/index.html
```

Expected:

- `android/app/src/main/assets/public/index.html` exists.
- `android/app/src/main/assets/public/assets/*.js` exists.
- The script paths in `index.html` point to files that actually exist under `assets/`.

How to eliminate:

- Rebuild and sync before producing the APK.
- Confirm the APK is built after sync, not from stale Android assets.

### 2. JavaScript bundle fails before `createRoot(...).render()`

Why it matches:

- `#root:empty::after` in `index.html` is a CSS spinner shown before React mounts.
- If the JS file is missing, has unsupported syntax for the WebView, or crashes at module evaluation time, React never fills `#root`.
- This exactly produces an endless spinner even when `App.tsx` is reduced to static text.

How to verify:

Use Android logs while launching the APK:

```bash
adb logcat | grep -iE "chromium|capacitor|console|Uncaught|SyntaxError|net::|ERR_|Failed to load"
```

Also inspect the packaged `index.html` and bundle references:

```bash
grep -n "script" android/app/src/main/assets/public/index.html
ls android/app/src/main/assets/public/assets
```

Expected failure signs:

- `net::ERR_FILE_NOT_FOUND`
- `Failed to load module script`
- `Uncaught SyntaxError`
- `Unexpected token`
- `Cannot use import statement outside a module`
- `Refused to execute script`

How to eliminate:

- Ensure the built files exist in Android assets.
- Keep `vite.config.ts` target compatible with the device WebView.
- Add a temporary inline marker in `index.html` before the module script and a first-line `console.log` in `main.tsx` to prove whether module execution starts.

### 3. Inline service worker registration in `index.html`

Why it matches:

- `main.tsx` skips service worker registration on Capacitor native, but `index.html` still registers `/sw.js` before/independently of React.
- `public/sw.js` contains an offline fallback that can serve `/offline.html`.
- The earlier observed `https://app//offline.html` strongly points to pre-React navigation/fallback behavior, not React logic.

How to verify:

Search the packaged Android HTML:

```bash
grep -n "serviceWorker" android/app/src/main/assets/public/index.html
```

Check WebView logs for service worker install/fetch/offline messages:

```bash
adb logcat | grep -iE "Service Worker|offline.html|sw.js|Using cached|Precached"
```

How to eliminate:

- Remove the inline service worker registration from `index.html`.
- Keep service worker registration only in a guarded runtime module that refuses native Capacitor.
- For native builds, unregister any app-shell worker if present.

### 4. Capacitor config local origin / asset path issue

Why it matches:

- The native app loads from Capacitor’s local origin, here configured as `https://app`.
- If the local server cannot resolve bundled files, navigation may fall back to an offline page or blank/spinner state.
- The double slash in `https://app//offline.html` suggests path construction/fallback behavior around the local origin.

How to verify:

Inspect generated native config after sync:

```bash
cat android/app/src/main/assets/capacitor.config.json
```

Expected:

- `webDir` source has been copied into `android/app/src/main/assets/public`.
- `server.hostname` and schemes are exactly what the app expects.

How to eliminate:

- Keep `webDir: 'dist'`.
- Run build before sync.
- Avoid adding `server.url` for production APKs unless intentionally hot-loading from a remote URL.

### 5. Native launch/splash theme not handing off cleanly

Why it matches:

- Android starts with `AppTheme.NoActionBarLaunch` using `Theme.SplashScreen`.
- If the splash theme or Capacitor splash plugin is misconfigured, native splash can appear to stay forever.
- This can be confused with the HTML spinner, especially if both use loading imagery.

How to verify:

Temporarily change the HTML spinner color/text or remove `#root:empty::after` and rebuild.

- If the visible spinner changes/disappears, it is `index.html`, not native splash.
- If the same spinner remains before WebView content appears, it is native splash/theme.

Also check logs:

```bash
adb logcat | grep -iE "SplashScreen|BridgeActivity|Capacitor|WebView"
```

How to eliminate:

- Define the splash theme with an explicit post-splash app theme.
- Ensure Capacitor’s splash plugin is not configured to wait forever.
- Keep `launchAutoHide` behavior consistent between native config and JS.

### 6. WebView version/runtime incompatibility

Why it matches:

- The production target includes Android 7 / WebView 52 support.
- If the built JS contains syntax unsupported by WebView 52, the module can fail before React mounts.
- `vite.config.ts` currently targets `es2015`, which is generally helpful, but dependencies and module output still need runtime verification on that specific WebView.

How to verify:

On the affected device:

```bash
adb shell dumpsys package com.google.android.webview | grep versionName
adb logcat | grep -iE "SyntaxError|Unexpected token|chromium"
```

How to eliminate:

- Confirm the actual WebView version.
- If syntax errors appear, lower/adjust the build target or transpilation strategy for the failing syntax.

## Proposed fix plan after approval

1. **Remove duplicate pre-React service worker registration**
   - Delete the inline `navigator.serviceWorker.register('/sw.js')` block from `index.html`.
   - Leave service worker control in `main.tsx`, with native Capacitor excluded.

2. **Add a native-safe startup diagnostic marker**
   - Add a minimal first-line startup log before imports that can crash.
   - Add a visible fallback message if the module script fails to start within a short timeout, replacing the endless spinner with actionable text.

3. **Harden native splash handoff**
   - Review Android splash theme and Capacitor splash config.
   - Add explicit post-splash theme settings if needed.

4. **Add a build/sync verification checklist**
   - Document the required release sequence:
     ```bash
     npm run build
     npx cap sync android
     cd android && ./gradlew assembleRelease
     ```
   - Include commands to verify `android/app/src/main/assets/public/index.html` and JS bundles exist before APK build.

5. **Increment app version**
   - Bump `src/constants/appVersion.ts` and `android/app/build.gradle` for the native startup fix, per project version rules.

No React component, hook, router, Suspense, or context debugging will be included.