
# v2.11.12 — WebView 51 Full UI Compatibility + Classic-BT Default

Scope confirmed with user: **targeted compatibility pass** (no rewrite), **force light theme everywhere**, **Classic Bluetooth default for both scale and printer**. No changes to business logic, APIs, DB, sync engine, cumulative logic, reference generator, or receipt content — only rendering layer + BT default routing.

## Why the CS10 renders broken (root cause)

WebView 51.0.2704.91 (mid-2016 Chromium) is missing several CSS features that the current build uses everywhere:

| Feature | Added in Chrome | Where we use it |
|---|---|---|
| `gap` on flexbox | 84 | ~60+ components (`gap-2`, `gap-4`, …) |
| `gap` on grid | 66 | grid layouts |
| `backdrop-filter` | 76 | modals, splash overlay |
| `aspect-ratio` | 88 | photo capture, audit viewer |
| `dvh` / `svh` units | 108 | `src/index.css:111` |
| `:is()` / `:where()` | 88 | Tailwind reset |
| `color-mix()`, `oklch()` | 111 | (none currently — safe) |
| `prefers-color-scheme` | 76 | `.dark` auto-applied → **dark dashboard on CS10** |
| `position: sticky` | 56 | headers |
| CSS logical props (`inset-*`, `-inline-*`) | 87 | Tailwind utilities |

The v2.11.11 build already parses JS correctly on WebView 51 (SyntaxError gone). What remains is purely CSS/layout: `gap` silently becomes 0 so flex children collide (visible in the Z-Report modal where "SUMMARY", "COFFEE", "SEASON" overlap), `backdrop-filter` leaves modals transparent (visible in Photo Audit Viewer and menu overlay), and `prefers-color-scheme: dark` on the CS10 firmware triggers the `.dark` class making the dashboard black.

## The fix — 5 layers, all additive, zero business-logic touch

### 1. Force light theme on native + web (user's choice)

- `src/App.tsx`: on mount, `document.documentElement.classList.remove('dark')` and set `color-scheme: light` on `<html>`. Remove any `prefers-color-scheme` listener.
- `index.html` `<head>`: add `<meta name="color-scheme" content="light">` and inline `<style>html{color-scheme:light !important;background:#fff}</style>` so the very first paint on WebView 51 is white, not the OS default.
- `src/index.css`: keep `.dark` block for future use but stop auto-applying it via `@media (prefers-color-scheme: dark)` (currently inherited from shadcn defaults through Tailwind — verify and neutralize).

### 2. Replace CSS `gap` with a Tailwind-compatible polyfill

Two-part fix, no component edits needed:

- **`tailwind.config.ts`**: add a Tailwind plugin that overrides the `gap`, `gap-x`, `gap-y` utilities to emit equivalent `margin` on children using the classic `> * + *` selector (works in every browser since IE10):
  ```
  .gap-4 > * + * { margin-left: 1rem; }   /* flex-row */
  .flex-col.gap-4 > * + * { margin-top: 1rem; margin-left: 0; }
  ```
  Emitted for the same spacing scale Tailwind already uses (0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12). For CSS Grid layouts the plugin keeps the native `gap` property (grid `gap` works in WebView 51 — it's only flex-`gap` that's missing).
- Load the plugin only when `process.env.WEBVIEW_LEGACY !== 'false'` so a future modern build can opt out.

This single change fixes every overlapping-text bug visible in the Z Report, Recent Receipts menu, Periodic Report menu, and Device Settings screenshots without editing any component.

### 3. Strip / polyfill remaining unsupported CSS via PostCSS

Add two PostCSS plugins to `postcss.config.js`:

- `postcss-preset-env` with `stage: 2` and `browsers: 'chrome >= 51'` — down-levels `:is()`, `:where()`, logical properties, `inset` shorthand, `clamp()`/`min()`/`max()` where possible.
- A tiny custom plugin (or `postcss-discard-unsupported`) that strips declarations WebView 51 can't parse and would otherwise invalidate the whole rule: `backdrop-filter`, `aspect-ratio`, `content-visibility`, `container-type`, unit `dvh`/`svh`/`dvw`/`svw` (replace with `vh`/`vw`).
- Manual edit `src/index.css:111`: `100dvh` → `100vh`.
- Modal backdrops: replace `backdrop-blur-*` classes with a solid `bg-black/60` fallback (drop-in Tailwind swap, no layout change).

### 4. `aspect-ratio` polyfill for photo capture / audit viewer

Replace the ~6 usages of `aspect-square` / `aspect-video` / `aspect-[4/3]` with the padding-bottom trick wrapped in a `.aspect-fixed` utility that already exists at `src/index.css:270`. One utility class swap per file; no component logic changes.

### 5. Bluetooth Classic as default (both roles)

- `src/services/btConnectionManager.ts`: change the connection strategy order in `ensureConnected(role)` from `BLE → Classic fallback` to `Classic → BLE fallback` for both `scale` and `printer`. The plugin (`BluetoothClassicPlugin.kt`) is already registered and working on native.
- `src/hooks/useScaleConnection.ts` + `src/hooks/useDirectPrint.ts`: same reorder — try `quickReconnectClassicScale` / `quickReconnectClassicPrinter` first, fall back to BLE only if Classic returns `unavailable`.
- `src/components/BluetoothConnectionDialog.tsx` + `PrinterConnectionDialog.tsx`: default the dialog tab to "Classic (SPP)" instead of "BLE". User can still switch tabs manually.
- Web build: keep the v2.11.1 behavior (no auto-connect on web). No change needed.
- Persistence: existing `getStoredClassicDevice` / `getStoredClassicPrinter` already survive reload. No storage schema change.

### 6. Versioning

- `src/constants/appVersion.ts`: `2.11.12`, `APP_FIX_TAG='webview51-css-compat'`.
- `android/app/build.gradle`: `versionCode 154`, `versionName "2.11.12"`.

## What does NOT change

- `server.js`, KCB payments, cumulative logic (v2.10.121 hold intact), reference generator (`transrefno = devcode + clientFetch + padded_trnid`), IndexedDB schema, farmer sync engine, receipt content, Z-Report/Periodic Report SQL, `psettings` handling, offline-first flow, session/route/product selectors' behavior.
- No component is rewritten. Screenshots will look identical on modern browsers; only WebView 51 rendering is repaired.
- BluetoothClassicPlugin.kt is untouched — only the JS-side default preference flips.

## Verification checklist (post-rebuild on CS10)

1. Dashboard renders **light mint** background matching your other screenshots — no black theme.
2. Z Report modal: "SUMMARY / COFFEE / SEASON / DATE / CENTER / PRODUCE" render on separate rows with visible whitespace between them (proves gap polyfill worked).
3. Recent Receipts and Periodic Report menus: dropdown items no longer overlap the dashboard content behind them (proves solid backdrop replaced `backdrop-filter`).
4. Photo Audit Viewer: photo tile is a proper square (proves `aspect-ratio` polyfill).
5. Device Settings → "Connect Scale (BLE/Classic)" and "Connect Printer": tapping opens the Classic (SPP) picker by default and lists the paired ACS-SB1 / thermal printer; connection succeeds and captures weight / prints a test receipt.
6. Regression: milk transaction create → receipt print → farmer sync → cumulative correctness (M01859 / M02957 remain held per v2.10.121); farmer search in Buy portal returns results; Store list populated; camera intent still launches.
7. `grep -c "flex.*gap-" dist/assets/*.css` → still present (fine), but `dist/assets/*.css` also contains the `> * + *` margin fallbacks.

## Rebuild command

```
npm run build
npx cap sync android
# reinstall DeliCoop101.v2.11.12 on CS10
```

## Technical file list (for reference)

- `tailwind.config.ts` — add gap-polyfill plugin
- `postcss.config.js` — add `postcss-preset-env` + strip-unsupported plugin
- `src/index.css` — remove `100dvh`, remove any dark auto-media
- `index.html` — light color-scheme meta + inline first-paint style
- `src/App.tsx` — remove `.dark` on mount
- `src/services/btConnectionManager.ts` — Classic-first strategy
- `src/hooks/useScaleConnection.ts`, `src/hooks/useDirectPrint.ts` — Classic-first reconnect order
- `src/components/BluetoothConnectionDialog.tsx`, `src/components/PrinterConnectionDialog.tsx` — default tab = Classic
- ~6 files using `aspect-*` — swap to `.aspect-fixed` wrapper
- Modal wrappers using `backdrop-blur-*` — swap to solid `bg-black/60`
- `src/constants/appVersion.ts`, `android/app/build.gradle` — version bump
