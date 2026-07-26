## Diagnosis (confirmed from logs + cert probe)

The APK actually loads and React mounts fine on the CS10:
- `[BOOT] main.tsx module started`
- `[BOOT] React render requested`
- Login screen renders (favicon fetched, login-bg image loaded)

The user's real symptom is that **every API call fails**:
```
X509Util: Failed to validate the certificate chain, error:
  java.security.cert.CertPathValidatorException:
  Trust anchor for certification path not found.
chromium: SSLHandshakeError:-202
```
…on `/api/version`, `/api/routes/by-device/…`, `/api/sessions/…`, `/api/farmers/…`, `/api/items`, `/api/z-report`, `/api/periodic-report`.

Cert probe of `2backend.maddasystems.co.ke`:
```
issuer  = C=US, O=Let's Encrypt, CN=YR1
subject = CN=2backend.maddasystems.co.ke
```
`YR1` chains to **ISRG Root X1**. Android 7.0 (API 24) / WebView 51 does **not** ship ISRG Root X1 in its system trust store (it was added in 7.1.1/API 25). That is why every HTTPS call to the backend fails on this specific device while working on newer devices and the browser.

Nothing in the endless-spinner theory turned out to be right for this device — the app started; it just couldn't talk to the backend, so it sits on the login/sync screen with no data.

Side note (not the cause, still worth logging): Capacitor prints `Specified minimum webview version is too low, defaulting to 55` — Capacitor floors it to 55 internally, but it still let the app boot, so the v2.11.7 lowering is effectively a no-op on this Capacitor version. We can leave that for a later cleanup; it is not what is breaking API calls.

## What to change

Ship a bundled trust anchor for ISRG Root X1 via Android Network Security Config so WebView 51 on Android 7.0 can validate the Let's Encrypt chain. Scope the trust anchor to the API host only.

### 1. Add `android/app/src/main/res/raw/isrg_root_x1.pem`
The published ISRG Root X1 PEM (self-signed root, expires 2035). Bundled as a raw resource.

### 2. Add `android/app/src/main/res/xml/network_security_config.xml`
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system"/>
        </trust-anchors>
    </base-config>

    <!-- Backend uses a Let's Encrypt cert chaining to ISRG Root X1,
         which Android 7.0 (API 24) / WebView 51 does not ship. -->
    <domain-config>
        <domain includeSubdomains="true">maddasystems.co.ke</domain>
        <trust-anchors>
            <certificates src="system"/>
            <certificates src="@raw/isrg_root_x1"/>
        </trust-anchors>
    </domain-config>
</network-security-config>
```

### 3. Reference it from `AndroidManifest.xml`
Add `android:networkSecurityConfig="@xml/network_security_config"` to the `<application>` element. Nothing else in the manifest changes.

### 4. Version bump (per project rule)
- `src/constants/appVersion.ts` → `2.11.9`, tag `android-ssl-trust-anchor`.
- `android/app/build.gradle` → versionName `2.11.9`, versionCode `151`.

### 5. Docs
Append a short "Android 7 / WebView 51 SSL trust" section to `CAPACITOR_BUILD_GUIDE.md` noting that the ISRG Root X1 PEM is bundled and where to rotate it if Let's Encrypt migrates the API host to a different root in the future.

## What I am NOT changing

- No changes to backend, server.js, KCB payment code, cumulative logic, IndexedDB, or any React/business logic.
- No changes to `capacitor.config.ts` (min WebView remains 52; Capacitor floors internally, and the app already boots).
- No changes to service worker or startup boot diagnostics — logs prove those are already fine.
- Trust anchor is scoped to `maddasystems.co.ke` only; all other origins keep the default system-only trust store.

## Verification checklist (after build)

1. `npm run build && npx cap sync android`
2. Rebuild APK, install on the CS10 (Android 7.0, WebView 51).
3. Open app, watch `adb logcat`:
   - Expect **no more** `SSLHandshakeError:-202` on `2backend.maddasystems.co.ke`.
   - Expect `/api/version`, `/api/routes/by-device/…`, `/api/farmers/…` to return `200`.
4. Confirm login screen accepts credentials and dashboard loads farmer/route data.
5. Confirm receipt sync no longer sits in "pending" from the SSL failure.
