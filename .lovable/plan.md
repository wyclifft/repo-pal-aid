# Android 7 (WebView 51) / CS10 720×1280 UI & Receipt Output Pass — v2.11.30

Presentation-layer only. No changes to transaction creation, reference generation, sync, IndexedDB schema, APIs, or workflows.

## What I verified in the code first

- Internal printing goes `printToInternalPrinter()` → `PosApi.printReceipt({lines})` → native `PosApi.java:228`, which runs `PrintOpen → PrintInit(2, 24, 24, 0) → PrintStr(line) → PrintStr("\n\n\n") → PrintStart()`. Font height/width are hardcoded at 24, and the only bottom clearance is three text newlines (no paper step/feed), which is why the last lines sit under the tear bar.
- The top gap is not in the text builders — `printReceipt()` in `src/services/bluetooth.ts` starts directly with the company name line. It comes from the printer head start offset, which the SDK exposes via `Lib_PrnStep` / left-indent / line-space settings that we never call.
- `PhotoCapture.tsx` renders inside `DialogContent` with a `aspect-[4/3] min-h-[300px]` preview and a fixed control bar, and `src/components/ui/dialog.tsx:43` sets no `max-height` — so on a short viewport the Retake / Use Photo row is pushed past the screen edge.
- The Periodic Report date pickers (`src/pages/PeriodicReport.tsx:294` and `:327`) use uncontrolled `Popover`s, so the calendar stays open after a date is picked and covers the fields below. These are the only `PopoverTrigger` usages in the app outside the UI primitive.

## 1. Printer output (all receipt types)

Single shared change point, so every receipt/report benefits at once (milk, store/AI, Z-Report, device Z-Report, periodic report — all funnel through the same print helpers).

- `PosApi.java` / `PosApiPlugin.java`: replace the hardcoded `printReceipt` sequence with a parameterised one:
  - larger font — `PrintInit(gray, 32, 24, 0)` (taller glyphs, same 32-column width so alignment and paper width are unchanged),
  - explicit `Lib_PrnSetLineSpace` and `Lib_PrnSetLeftIndent(0)` so lines are tight and start at column 0,
  - drop the leading head offset by not emitting any pre-content feed and by issuing `Lib_PrnStep`/`Lib_PrnFeedPaper` only *after* `PrintStart()`,
  - replace the 3 blank `PrintStr("\n")` lines with a real post-print paper feed so nothing is clipped and the tear line clears.
  - Accept optional `{ fontHeight, fontWidth, lineSpace, feedDots }` in the plugin call, defaulted so existing callers keep working.
- `src/plugins/pos-api/definitions.ts` + `web.ts`: extend the `printReceipt` signature with those optional options.
- `src/services/bluetoothClassic.ts`: pass the CS10 defaults from `printToInternalPrinter`.
- Character-width builders in `src/services/bluetooth.ts` stay at `W = 32` — alignment, column padding, and content are untouched.

## 2. Camera capture screen

`src/components/PhotoCapture.tsx`:
- Constrain the dialog to the viewport (`max-h-[92vh]`, flex column) and let the preview area flex/shrink instead of forcing `min-h-[300px]`.
- Pin the action row as a non-shrinking footer so **Retake / Use Photo / Cancel** are always on screen; the preview scrolls or scales down instead.
- Bump the buttons to POS-friendly touch targets (`h-12`, wider hit area) and add an explicit **Cancel** button next to Retake/Use Photo in the captured state.

## 3. Date pickers

`src/pages/PeriodicReport.tsx`:
- Make both `Popover`s controlled and close them in `onSelect` right after a date is chosen.
- Add `collisionPadding` / `avoidCollisions` so the calendar never renders off-screen on 720×1280, and cap it with `max-h-[70vh] overflow-auto`.
- Z-Report uses `ZReportPeriodSelector`; I'll audit it in the same pass and apply the same close-on-select behaviour if it exposes a calendar popover, otherwise leave its native input alone.

## 4. Viewport-fit pass

- `src/components/ui/dialog.tsx`: add `max-h-[92vh] overflow-y-auto` and a small viewport margin to the shared `DialogContent` — one change that fixes every modal in the app (farmer search, reprint, receipt, duplicate delivery, cow details, add member, session expired).
- `src/components/ui/popover.tsx`: add collision padding and a max-height so dropdowns never overflow.
- Walk the primary screens at a 360×640 CSS viewport (Dashboard, Buy, Sell/Store, AI, Settings, Z-Report, Periodic Report, Payments, receipts) and fix clipping with flex/`min-w-0`/wrapping — no `dvh` units, no `gap`-only layouts, no `backdrop-filter` reliance (WebView 51 constraints already established in this project).
- Ensure primary action buttons stay reachable (sticky footers where a screen is taller than the viewport) and touch targets are ≥44px.

## Technical notes

- Version bump to `2.11.30` in `src/constants/appVersion.ts` with a changelog block, and `versionCode 172` in `android/app/build.gradle`.
- The native printer changes require a rebuild: `git pull` → `npm install` → `npm run build` → `npx cap sync` → rebuild the APK.
- The exact CS10 font height is firmware-dependent; the plugin options make it tunable from JS without another native build if 32 proves too tall for the 32-column layout.
- Verification: typecheck + production build (with the existing ES5 guard), plus a Playwright pass at 360×640 capturing each screen to confirm nothing is clipped.
