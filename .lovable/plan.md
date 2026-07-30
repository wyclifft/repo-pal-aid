## v2.11.29 (version code 171) — CS10 / Android 7 (WebView 51)

Nothing below is guesswork; each item was reproduced from the actual build output and source in this repo.

### What I verified first

- I ran a production build and parsed **every** emitted JS chunk with an ES5 parser: all 60+ `*-legacy-*.js` files parse clean as ES5. The app's own bundle is **not** the syntax error.
- The built `index.html` is only **48 lines** long and contains no modern syntax.
- The real culprit: **Capacitor's own `native-bridge.js`**, which the native shell injects *inline* into the document at startup. It parses as ES2017, not ES2015:
  - `native-bridge.js:47` → `const convertFormData = async (formData) => {`
  - An ES2015 parse fails at exactly **line 47, column 45: "Unexpected token ("** — the same message the device reports, and inline injection shifts it to document **line ~54**. That is the reported `index.html:54` error.
  - Consequence: the inline bridge script dies mid-parse, so `window.Capacitor.Plugins` is never fully published — which is also why plugin calls have been returning `UNIMPLEMENTED`/empty errors.
- `PosApiPlugin.isReady()` does **not** dispatch to the worker thread (every other method does) and calls `api.isReady()` twice, each doing a live JNI version probe **on the UI thread**.
- `PosApiPlugin.load()` starts `Lib_AppInit` asynchronously; if JS probes before it completes, `ready=false` with `initError == null`, so the JS log prints `⚠️ CS10 internal printer availability check failed:` **with no detail** — exactly the reported symptom.
- `PosApiHelper.java:37` runs `getBCRService()` in a *static initializer*. It catches the exception and returns `null` (not fatal), but calls `e.printStackTrace()` → the recurring `IBCRService` stack traces. Cosmetic only.

### Changes

**1. Ship an ES5 Capacitor bridge (fixes the syntax error and the dead plugin bridge)**

Add a small build step that transpiles `node_modules/@capacitor/android/.../native-bridge.js` down to ES5 (Babel, target `chrome 51`; async → generator via the inline `_asyncToGenerator` helper, no regenerator runtime needed since Chrome 51 has generators) and writes the result to `android/app/src/main/assets/native-bridge.js`. App-module assets take precedence over the Capacitor AAR asset, so the shell injects the ES5 version — no fork of Capacitor, no patching `node_modules` at runtime.

**2. Guard against regressions**

Add an ES5 verification script (acorn, `ecmaVersion: 5`) over `dist/assets/*.js`, the generated `index.html` inline scripts, and the overridden `native-bridge.js`. It fails loudly if a non-ES5 construct ever reaches the Android build again.

**3. Internal printer detection (`PosApiPlugin.java`, `PosApi.java`)**

- Dispatch `isReady` onto the existing `PosApiWorker` handler thread like every other method; call `api.isReady()` once.
- Track init state as `pending | ok | failed`. If a probe arrives while init is pending, await/retry the init on the worker instead of returning a bare `false`.
- Always return structured detail: `{ ok, ready, state, rc, error }` so the reason is never empty.

**4. JS-side error visibility (`src/services/bluetoothClassic.ts`)**

Stringify caught errors (WebView 51 logs `Error` objects as empty) and record the returned `state`/`error` fields to the `/debug` console. Detection logic itself is unchanged apart from reading the richer payload.

**5. Silence the barcode-service noise (`PosApiHelper.java`)**

Make `mBCRService` lazily resolved and drop the `printStackTrace()` in `getBCRService()` — the CS10 firmware has no `IBCRService` and the app never uses it. Behaviour unchanged (`null` as today).

**6. Frame skipping**

Removing the main-thread JNI probe in item 3 addresses the measured cause. No unrelated UI or rendering code will be touched.

**7. Version bump**

`src/constants/appVersion.ts` → `2.11.29`, `android/app/build.gradle` → `versionCode 171`, with changelog notes.

### Out of scope

No changes to transactions, receipts, sync, IndexedDB, device auth, payments, or `server.js`. No Bluetooth Classic behaviour changes.

### After merge

`git pull` → `npm install` → `npm run build` → `npx cap sync` → rebuild the APK. The bridge asset is generated at build time, so a plain `cap sync` picks it up.
