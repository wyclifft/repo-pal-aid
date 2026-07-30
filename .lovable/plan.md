# v2.11.33 — three CS10 fixes

## 1. Receipt: remove the big blank band at the top
The gap is not part of the receipt body (the body starts directly with the company name). It comes from the *previous* receipt's tail padding: `printToInternalPrinter` in `src/services/bluetoothClassic.ts` appends 5 blank lines at 32-dot glyph height (~170 dots) **and** requests a 160-dot post-print feed — roughly 4 cm of paper before the next receipt starts.

Change:
- Reduce trailing blank lines from 5 to 2 and `feedDots` from 160 to 90. That still clears the print head/tear bar (the head offset is ~60–70 dots) without leaving a large void, so content sits evenly on the slip.
- Same trim for the SPP path (`printToClassicPrinter`): `'\n\n\n\n\n'` → `'\n\n'` before the cut command.
- No change to receipt text, columns, or font geometry.

## 2. Printer / Scale status indicators show nothing
The dots use `animate-[blink_...]` (keyframes drop opacity to 0.4) plus Tailwind palette classes. On WebView 51 the dots read as invisible in practice, and the labels never change ("Printer"/"Printer" are identical in both branches), so the user sees no status at all.

Change in `src/components/Dashboard.tsx` (presentation only):
- Drop the blink animation from both dots; render a solid, always-opaque dot using inline `style` (`width/height: 10px`, `borderRadius: 9999px`, `backgroundColor: '#16a34a'` connected / `'#dc2626'` disconnected) so it can't depend on Tailwind class resolution or animation support.
- Make the label state-explicit: `Printer: ON`/`Printer: OFF`, `Scale: ON`/`Scale: OFF`, colored to match.
- Keep the existing 1.5 s polling + event listeners exactly as they are (already real-time).

## 3. Member No. field must open the numeric keypad
In `src/components/BuyProduceScreen.tsx` the member input is `type="text" inputMode="text"`, which opens the alphabetic keyboard (as in the screenshot).

Change:
- Set `type="tel"` with `inputMode="numeric"`, `pattern="[0-9]*"`, `autoComplete="off"`. `type="tel"` is the reliable numeric-keypad trigger on Android 7/WebView 51 (where `inputmode` alone is ignored) and, unlike `type="number"`, it keeps the value a plain string so the existing member-lookup logic and `M`-prefix normalisation are untouched.
- No change to `onChange`, `onKeyDown`, or the lookup flow.

## Version
Bump to `2.11.33` in `src/constants/appVersion.ts` and `versionName`/`versionCode` (→ 175) in `android/app/build.gradle`, with a changelog comment.

## Compatibility notes
- All three edits are presentation/config level; no sync, reference-generator, IndexedDB or backend logic touched.
- No `dvh`, no CSS `gap`-dependent layout added; inline styles used for the dots to avoid WebView 51 class/animation quirks.
