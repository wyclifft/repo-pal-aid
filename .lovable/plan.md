
# v2.11.11 — WebView 51 (Chromium 51) Full Compatibility Build

## Diagnosis (confirmed from logs)

The user's CS10 runs **WebView 51.0.2704.91** (Chromium 51, mid‑2016). The fatal line in the logcat is:

```
E/Capacitor/Console: File: https://app/ - Line 54 - Msg: Uncaught SyntaxError: Unexpected token (
```

Everything else in the report is a **downstream cascade** of that single parse failure:

- `Cannot read property 'triggerEvent' of undefined` — the JS runtime never finished evaluating, so `window.Capacitor` was never populated by Capacitor's `native-bridge.js`. The polyfill added in v2.11.10 protects the bridge FROM Java, but a SyntaxError higher up still kills every plugin proxy.
- `Device.getId() failed`, `Haptics unavailable`, `BluetoothLe plugin is not implemented on android`, `Failed to connect to printer` — every plugin returns the web shim because plugin registration executes JS that already threw.
- `Settings fetch failed: Network error` — `useAppSettings` retries because the offline/native detection path never returned; the backend is reachable (v2.11.9 SSL trust anchor holds).
- Buy portal shows "farmer not found" and the Store list is empty — IndexedDB reads live in modules that never evaluated after the SyntaxError, so `farmers` cache is never queried; nothing is broken about the data itself.
- Camera fails for the same reason: `@capacitor/camera` proxy is on the web shim.

So the fix is **exactly one thing**: make the JS that ships to WebView 51 parseable by Chromium 51. The rest of the symptoms disappear on their own.

### Why the current build still emits un-parseable syntax

Chromium 51 supports basic ES6 (arrow, `const/let`, classes, template literals) but does **not** support:

- `async` / `await`  (Chrome 55)
- Object rest/spread `{ ...a }` (Chrome 60)
- Dynamic `import(...)`  (Chrome 63)
- Optional chaining `?.` (Chrome 80)
- Nullish coalescing `??` (Chrome 80)

The current pipeline has three gaps that let those tokens through:

1. **`tsconfig.app.json` → `target: "ES2020"`** and **`vite.config.ts` → `build.target: 'es2015'`** disagree. `@vitejs/plugin-react-swc` compiles TSX using the tsconfig target, so React app code lands as ES2020 (async/await, optional chaining) **before** the legacy plugin sees it. `es2015` in `build.target` only tells esbuild's minifier what to *preserve*; it does not down‑level async/await.
2. **`@vitejs/plugin-legacy`** in v5 emits **both** a modern chunk (`<script type="module">`) and a legacy chunk (`<script nomodule>`), plus an inline **module‑detection script** that uses dynamic `import()` (`Uncaught SyntaxError: Unexpected token (` at index.html around line 54 — matches the report exactly). On a WebView that speaks neither modules nor dynamic import, this detection script crashes the page before either bundle runs.
3. **`legacy.targets: ["Android >= 5"]`** maps via browserslist to Chrome 60‑ish, still above WebView 51.

### Verification the diagnosis is right

- Line 54 of the SERVED index.html is inside plugin-legacy's injected detection block (not the CSS we author). Confirmed by rebuilding locally and inspecting `dist/index.html`.
- `Uncaught SyntaxError: Unexpected token (` at that offset matches the `import(` keyword — dynamic import.
- Once that script throws, the browser aborts subsequent `<script>` tags on the same page load; the polyfill we added in v2.11.10 is fine but never runs late enough to matter, because `Bridge.java` calls `triggerEvent` on `window.Capacitor` that was never constructed.

## Fix strategy (single, targeted change)

Ship ES5‑only bundles and stop emitting the modern/detection scripts entirely. WebView 51 then parses and runs the app; every downstream failure resolves as a cascade.

### Files to change

**1. `vite.config.ts`** — force ES5 output and single‑bundle legacy delivery.

- `build.target: 'es5'` (was `'es2015'`).
- `esbuild: { target: 'es5', supported: { 'async-await': false, 'object-rest-spread': false, 'optional-chain': false, 'nullish-coalescing': false } }` — makes esbuild's minifier refuse to keep those tokens even in third‑party deps.
- Replace the current `legacy(...)` call with:
  ```ts
  legacy({
    targets: ['chrome >= 51', 'Android >= 5.0'],
    renderModernChunks: false,       // stop emitting the type="module" bundle AND the dynamic-import detection block
    modernPolyfills: true,
    additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
  })
  ```
- Remove `optimizeDeps.exclude: ['@capacitor/core']` — excluding it from prebundle bypasses the down‑level pass and re‑introduces optional chaining in `@capacitor/core`'s ESM entry.

**2. `tsconfig.app.json`** — align TypeScript with the runtime it must serve.

- `target: "ES5"` (was `"ES2020"`).
- `lib: ["ES2020", "DOM", "DOM.Iterable"]` stays — `lib` is compile‑time only; keeping the lib types avoids editor red squigglies while the emit target down‑levels.
- Leave `useDefineForClassFields: true` alone (SWC handles it independently).

**3. `index.html`** — the inline scripts we author use only `var`/`function()`; keep them as is. The polyfill from v2.11.10 stays; it becomes a belt‑and‑braces guard that is no longer strictly needed once the SyntaxError is gone.

**4. `src/constants/appVersion.ts`** — bump to `2.11.11`, tag `webview51-es5`.

**5. `android/app/build.gradle`** — `versionCode 153`, `versionName "2.11.11"`.

### What deliberately does NOT change

- No changes to `server.js`, KCB payments, cumulative logic (v2.10.121 hold intact), reference generator, IndexedDB schema, sync engine, receipt rendering, farmer resolution, `useAppSettings` behaviour, or any Kotlin plugin code.
- `MainActivity.kt` keeps the explicit `BluetoothLe` registration from v2.11.10.
- Web preview behaviour is unaffected: modern browsers now receive the legacy ES5 bundle too. Load size grows slightly and there is no code‑splitting between "modern" and "legacy", but for a Capacitor‑first app the tradeoff is correct.

## Verification checklist (post‑rebuild on CS10)

1. `grep -c "async function\|await \|import(" dist/assets/*.js` → **0**.
2. `dist/index.html` contains no `<script type="module">` and no dynamic `import(`.
3. First launch on CS10: logcat shows no `Uncaught SyntaxError`, no `Cannot read property 'triggerEvent' of undefined`.
4. Dashboard shows the real company name within 5 s (psettings populated).
5. Settings → **Search Printer** / **Search Scale** opens the BluetoothLe device picker (no "plugin is not implemented" toast).
6. Buy portal loads the farmer list from IndexedDB; searching by member number resolves; Store screen lists farmers.
7. Camera capture launches the native camera intent.
8. No regression: milk transaction create → receipt print → farmer sync → cumulative correctness (M01859/M02957 remain held per v2.10.121).

## Rebuild command for the user

```
npm run build
npx cap sync android
# reinstall the DeliCoop101.v2.11.11 APK on the CS10
```
