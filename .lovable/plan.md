## Root cause

In `src/services/bluetooth.ts` (the thermal-print Z-report formatter), the SELL/AI section truncates the REF column to 4 characters even though the source uses a 5-digit short ref:

```ts
// line 2525
const shortRef = (tx.refno || '').slice(-5);   // 5 chars, e.g. "02981"
...
// line 2533 (SELL/AI branch)
const ref = padL(shortRef, 4);                  // padEnd(4).substring(0, 4) → "0298"
```

`padL` is defined as `padEnd(w).substring(0, w)`, so any string longer than `w` gets chopped from the right — losing the **last digit**. That's exactly what the receipt photo shows: every SELL row prints `0298` / `0299` instead of `02981`, `02982`, etc., making distinct refs look identical.

The BUY branch is fine because it uses `padL(shortRef, 6)` (line 2541), which preserves all 5 chars of the short ref.

The on-screen `DeviceZReportReceipt.tsx` and `pdfExport.ts` already allocate ≥5 chars for REF, so they are not affected. Only the thermal print output is broken.

## Fix

Widen the SELL/AI REF column from 4 → 5 characters in `src/services/bluetooth.ts`, keeping the total row width at 32 by trimming MNO from 8 → 7 (max real MNO width is 6, e.g. `M00012`, so 7 is still safe).

New SELL/AI column spec:

```text
MNO(7) REF(5) QTY(4 R) KSh(7 R) TIME(5 R)
total: 7+1+5+1+4+1+7+1+5 = 32 ✓
```

Apply the change in both places that reference the old widths:

- Header row (~line 2494): `padL('MNO',7) padL('REF',5) padR('QTY',4) padR('KSh',7) padR('TIME',5)`
- Data row (~lines 2532–2537): `padL(tx.farmer_id,7) padL(shortRef,5) padR(qty,4) padR(ksh,7) padR(time,5)`
- Update the inline `// SELL/AI: ...` width comments to match the new spec.

No changes needed to `DeviceZReportReceipt.tsx` (REF column already 5ch) or `pdfExport.ts` (REF column is 8 wide).

## Versioning + memory

- Bump `APP_VERSION` to `2.10.76`, `APP_VERSION_CODE` to `98` (in `src/constants/appVersion.ts` and `android/app/build.gradle`), and the service worker cache to `v23` in `public/sw.js` — per workspace versioning rule.
- Update memory `mem://design/z-report-column-alignment` to record the corrected SELL/AI width spec (REF=5, MNO=7) so a future edit doesn't reintroduce the truncation.

## Files to change

- `src/services/bluetooth.ts` (header + data row + comments in the SELL/AI branch only)
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`
- `mem://design/z-report-column-alignment.md`

## What this does NOT change

- BUY section formatting (already correct).
- On-screen Z-report (`DeviceZReportReceipt.tsx`) — REF already shows 5 chars.
- PDF export — REF already shows 5 chars.
- Reference generator, transaction creation, sync, IndexedDB schema, or any backend API.
