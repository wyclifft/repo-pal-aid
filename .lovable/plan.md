

# Fix: App Crash on Android 7.0 POS Device

## Root Cause Analysis

The screenshot shows the Android WebView error "Webpage not available" at URL `https://app//offline.html`. This happens because:

1. **Malformed error path URL** -- The Capacitor config has `errorPath: '/offline.html'` with a leading slash. Combined with `hostname: 'app'` and `androidScheme: 'https'`, the WebView resolves this to `https://app//offline.html` (double slash), which is an invalid URL.

2. **CSS incompatibility crashes rendering on old WebView** -- The `index.html` uses `100dvh` (dynamic viewport height), which is NOT supported on Chrome 51 (the default WebView on Android 7.0 POS devices). This can cause the layout to break completely, triggering the error fallback.

3. **Google Fonts blocks on no-internet POS devices** -- The `<link rel="preload">` and `<link rel="stylesheet">` for Google Fonts attempts a network fetch. On a POS device with no internet, this can block or delay page rendering significantly.

---

## Fix Plan

### 1. Fix Capacitor `errorPath` (capacitor.config.ts)

Remove the leading slash from `errorPath` so it resolves correctly:

```
errorPath: '/offline.html'  -->  errorPath: 'offline.html'
```

### 2. Add CSS fallback for `100dvh` (index.html)

Add `100vh` as a fallback before `100dvh` so older WebViews that don't understand `dvh` still get a valid height:

```css
height: 100vh;       /* fallback for old WebViews */
height: 100dvh;      /* modern browsers override */
max-height: 100vh;   /* fallback */
max-height: 100dvh;  /* modern browsers override */
```

### 3. Make Google Fonts non-blocking (index.html)

Change the font stylesheet to load asynchronously so it doesn't block rendering on offline POS devices:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/..." media="print" onload="this.media='all'" />
```

### 4. Bump version (android/app/build.gradle)

Increment to versionCode 18 / versionName "2.7".

---

## Files to Modify

| File | Change |
|------|--------|
| `capacitor.config.ts` | Fix `errorPath` to `'offline.html'` (no leading slash) |
| `index.html` | Add `100vh` CSS fallback before `100dvh`; make Google Fonts non-blocking |
| `android/app/build.gradle` | Version bump to 2.7 (versionCode 18) |
| `src/constants/appVersion.ts` | Update `APP_VERSION` to "2.7" |

No existing functionality will be broken -- these are purely additive fallbacks and a config fix.

