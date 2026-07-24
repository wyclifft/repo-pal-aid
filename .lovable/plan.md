
## Diagnosis (confirmed from files)

The device in the screenshot is **Android 7.0, model CS10** — its bundled WebView is v52. The current `capacitor.config.ts` has:

```
android: { minWebViewVersion: 55, ... }
server:  { hostname: 'app', androidScheme: 'https', errorPath: '/offline.html' }
```

When Capacitor starts and finds a WebView **below** `minWebViewVersion`, it refuses to load the bundled app and instead navigates the WebView to the configured `errorPath`. Because the app is served from `https://app/`, that resolves to exactly the URL the user sees:

```
https://app//offline.html   ← "webpage not available"
```

Wi-Fi has nothing to do with it — the app never tries to reach the network. The block is entirely client-side because of the version gate. This also directly contradicts the project rule **"Legacy Android POS Compatibility — Android 7.0 / WebView 52 must be supported."**

(Secondary note: `offline.html` itself uses modern CSS/JS that WebView 52 could also render poorly, but that's not what's producing this screen — the WebView never gets past the version gate.)

## Fix (single-file change)

**Edit `capacitor.config.ts`** in the `android` block:

- Change `minWebViewVersion: 55` → `minWebViewVersion: 52`
  (matches the documented legacy-POS floor; keeps the guard for anything older, e.g. WebView 51 which is known-broken for POSTs and already handled via the native HTTP bridge).

No other files change. `offline.html`, service worker, `server.hostname`, and `errorPath` all stay as-is — they're correct for the production Capacitor bundle.

## Version bump

Per workspace rule: increment app version (bug fix).

- `src/constants/appVersion.ts` → bump patch (e.g. `2.11.6` → `2.11.7`, tag `legacy-webview-52-support`)
- `android/app/build.gradle` → bump `versionCode` and `versionName` to match

## Rebuild & reinstall steps for the user

1. `git pull`
2. `npm run build`
3. `npx cap sync android`
4. `npx cap run android` (or rebuild the APK and reinstall on the CS10)

After this, the CS10 (WebView 52) will load the bundled app instead of being redirected to the Capacitor error page.

## Verification checklist (post-install on CS10)

- App opens to Login (not `https://app//offline.html`).
- Transaction create / receipt / sync flows still work on modern devices (no regression from lowering the floor).
- Existing legacy-Android HTTP bridge and SW-bypass paths remain untouched.

## What this plan explicitly does NOT change

- No changes to `server.js`, payments, sync, cumulative logic, IndexedDB schema, or SW cache version.
- No change to `errorPath` or `offline.html` content.
- No change to `androidScheme` / `hostname` (changing those on an installed production app would break returning users per the PWA/installed-app caveat).
