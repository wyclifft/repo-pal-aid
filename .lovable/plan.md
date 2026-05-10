## Goal

Keep the current ID NO / SIGN spacing exactly as it is on the printed Store/AI receipt, but **move the `ID NO:` and `SIGN:` labels to the far left** (flush against the left edge of the paper), matching the handwritten labels in the photo. The underscore lines and blank-line spacing stay unchanged.

## Why the labels look centered today

In `src/services/bluetooth.ts` (line 2338, 2341), the labels are emitted as plain `'ID NO:\n'` and `'SIGN:\n'` immediately after a `formatLine(...)` call for `Clerk` / `Del.By`. `formatLine` right-pads its value, and on some printers/firmwares the previous line's trailing spaces wrap onto the start of the next short line, pushing `ID NO:` and `SIGN:` toward the middle.

## Change

In `src/services/bluetooth.ts`, lines 2335–2342 of `printStoreAIReceipt`, force each label line to be exactly the printer width by left-padding the label with spaces only at the END (so the label text itself sits on column 0). Keep the underscore lines and the single blank line between blocks exactly as they are today.

Replace:

```ts
const writeLine = '_'.repeat(W);
receipt += 'ID NO:\n';
receipt += writeLine + '\n';
receipt += '\n';
receipt += 'SIGN:\n';
receipt += writeLine + '\n';
```

with:

```ts
// v2.10.81: Force ID NO / SIGN labels to print flush-left (column 0).
// Pad each label line to the full printer width so prior right-aligned
// values cannot bleed/wrap and visually center the label.
const writeLine = '_'.repeat(W);
receipt += 'ID NO:'.padEnd(W) + '\n';
receipt += writeLine + '\n';
receipt += '\n';
receipt += 'SIGN:'.padEnd(W) + '\n';
receipt += writeLine + '\n';
```

Result: `ID NO:` and `SIGN:` print at the left edge, the long underscore line stays directly beneath each, and the existing blank line between the two blocks is preserved — exactly as the photo shows. No other section of the receipt is modified.

## Versioning

Per workspace rule, bump:
- `src/constants/appVersion.ts` → `2.10.81` (version code 103)
- `android/app/build.gradle` → `versionName 2.10.81`, `versionCode 103`
- `public/sw.js` cache → `v28`

## Verification

- Reprint a Store/AI receipt and confirm:
  - `ID NO:` sits flush-left directly under `Clerk`.
  - The full-width underscore line remains directly beneath it.
  - One blank line separates ID NO from SIGN.
  - `SIGN:` sits flush-left, with the underscore line directly beneath.
- Reprint a milk Periodic/standard receipt to confirm it is unaffected.

## Files touched

- `src/services/bluetooth.ts` (only `printStoreAIReceipt`, lines ~2335–2342)
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`