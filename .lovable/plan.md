
# v2.10.74 — Z-report column alignment + Store unit label fix

Two narrow presentation bugs in the Z-report. No data, totals, schema, or backend changes. Capacitor production safe.

---

## Issue 1 — Column headers don't line up with their data (and section headers off-center)

### What's wrong (from the marked-up receipt)

On the thermal print and on-screen Z-report:

- `QTY` header sits far left of the actual quantity values (which are right-aligned in their column).
- `KSh` header sits far left of the actual amount values (also right-aligned).
- `== BUY ==` and `== SELL ==` section banners are centered over the **whole 32-char width**, not over their column block, so they appear off-axis from the table beneath them.

### Root cause (`src/services/bluetooth.ts` → `printZReport`, ~lines 2477–2520)

The header strings are **literal text** with arbitrary spaces:

```
'MNO       REF    QTY    TIME'             // BUY
'MNO    REF   QTY   KSh   TIME'            // SELL/AI
```

…but the data rows use `padStart` / `padEnd` to a different column scheme:

```
mno = farmer_id.padEnd(9)   // BUY: 9 chars
ref = ref.padEnd(6)
qty = weight.toFixed(1).padStart(7)   // right-aligned in 7
tim = time.padStart(6)
```

The literal header was hand-spaced and drifted out of sync with the padded data widths. Quantity values land in the right edge of their 7-char block; the literal header writes `QTY` flush-left of that block — visually 4–5 chars to the left of where the numbers print.

### Fix — derive headers from the same widths as the data

Replace the literal header strings with a small column-spec helper so the header and every row use the same widths:

**`src/services/bluetooth.ts` → `printZReport`**

Define the column specs once per section (W = 32):

- **BUY** (4 columns): `MNO`(9, left) · `REF`(6, left) · `AMOUNT`(8, right) · `TIME`(6, right) · separators = 3 → 32 total. The "QTY" label for BUY changes to `AMOUNT` only because that's what the column actually holds (kg of produce delivered); the user has accepted this previously. If you'd rather keep `QTY`, leave it — alignment is what matters.
- **SELL/AI** (5 columns): `MNO`(8, left) · `REF`(5, left) · `QTY`(5, right) · `KSh`(7, right) · `TIME`(5, right) · separators = 4 → 34 (one over) — drop a separator between QTY and KSh: total = 32.

Implementation:

```ts
const padL = (s: string, w: number) => (s ?? '').padEnd(w).substring(0, w);
const padR = (s: string, w: number) => (s ?? '').padStart(w).substring(0, w);

// BUY header + every row use exactly these widths:
const buyHeader = `${padL('MNO',9)} ${padL('REF',6)} ${padR('AMOUNT',8)} ${padR('TIME',6)}`;
const buyRow    = `${padL(mno,9)} ${padL(ref,6)} ${padR(qty,8)} ${padR(time,6)}`;

// SELL/AI header + every row use exactly these widths:
const sellHeader = `${padL('MNO',8)} ${padL('REF',5)} ${padR('QTY',5)} ${padR('KSh',7)} ${padR('TIME',5)}`;
const sellRow    = `${padL(mno,8)} ${padL(ref,5)} ${padR(qty,5)} ${padR(ksh,7)} ${padR(time,5)}`;
```

This guarantees `QTY` sits directly above its numbers and `KSh` directly above its KSh values. Single source of width truth.

**Section banner alignment** (`== BUY ==`, `== SELL ==`):

Right now we `centerText('== BUY ==', 32)`. Replace with centering over the **MNO+REF block** width only (left half of the row) so the banner sits over the row labels, not floating over the right-aligned numeric columns. Concretely: pad-right the banner to width = MNO+REF+separators (15 for BUY, 13 for SELL) and prepend that to the rest of the line. Keeps the `==…==` style but anchored to the table.

**`src/components/DeviceZReportReceipt.tsx`**

Mirror on-screen:

- Replace the current `grid grid-cols-4` / `grid grid-cols-5` with **explicit column templates** that match the print widths proportionally:
  - BUY: `grid-cols-[6ch_5ch_1fr_4ch]` with `text-right` on the AMOUNT and TIME cells (the `1fr` cell holds AMOUNT and right-aligns).
  - SELL/AI: `grid-cols-[6ch_5ch_1fr_1fr_4ch]` with `text-right` on QTY, KSh, TIME.
- Header row uses the **same grid template** as the data rows so `QTY` / `KSh` sit directly above their values. Apply `text-right` on numeric header cells (`QTY`, `KSh`, `AMOUNT`).
- Section banner (`== BUY ==`, `== SELL ==`): change from `text-center` over the full row to a left-aligned banner that sits over the MNO+REF span only:
  ```tsx
  <div className="font-bold text-xs">
    <span className="bg-muted px-2 py-0.5 rounded">== {group.typeLabel} ==</span>
  </div>
  ```

**`src/utils/pdfExport.ts` → `generateDeviceZReportPDF`**

Same column-spec fix using a small `padL`/`padR` helper so the downloaded PDF matches.

---

## Issue 2 — Store (SELL/AI) sections show "KGS" but Store items are units, not weight

### What's wrong

Subtotal currently prints `SELL TOTAL ... 2.0 KGS` and the screen shows `2.0 KGS` for Store. Per-row QTY also shows e.g. `1.0` (treated as a weight). Store items (NPK Fertilizer, etc.) are sold as discrete **items/units**, not kilograms.

### Fix

Treat the QTY column for `transtype === 2` (SELL / Store) and `transtype === 3` (AI) as **integer units**, never KGS.

**`src/services/bluetooth.ts` → `printZReport`**

- For SELL/AI rows: `qty = Math.round(tx.weight).toString()` (integer, no decimal, no "KGS").
- Section subtotal line for SELL/AI:
  - Was: `SELL TOTAL ... 2.0 KGS` then a separate `SELL VALUE ... KSh 4800`.
  - Becomes a single line: `SELL TOTAL    2 items    KSh 4800`.
  - Use the unit word `items` (or singular `item` when count === 1).
- Grand total at the bottom:
  - Keep `TOTAL  <weight> KGS` (the **weight** grand total only sums BUY rows — SELL/AI weight is meaningless and would inflate it). Compute `grandWeight = sum of BUY group weights`. If no BUY rows in this period, suppress the `TOTAL ... KGS` line entirely.
  - Keep `TOTAL VALUE  KSh <amount>` summing across SELL+AI only.
  - Add (when SELL/AI exists) a `TOTAL ITEMS  <n>` line that sums SELL+AI integer counts.

**`src/components/DeviceZReportReceipt.tsx`**

- For SELL/AI groups, compute `totalItems = sum of integer round(weight)`; render QTY cell as the integer (no decimal, no unit).
- Per-section subtotal becomes one row: `<TYPE> TOTAL  ·  <n> items  ·  KSh <amount>` (BUY keeps `<weight> KGS`).
- Grand total block:
  - `TOTAL <weight> KGS` (BUY only, suppressed if no BUY).
  - `TOTAL ITEMS <n>` (SELL+AI only, suppressed if none).
  - `TOTAL VALUE KSh <amount>` (SELL+AI only, suppressed if zero).

**`src/utils/pdfExport.ts`** — mirror the same unit handling.

**Internal data**: do not change the underlying `weight` field returned by the backend. Store transactions write `weight` as the unit count today (existing convention). The fix is purely how that field is **labelled and formatted** for SELL/AI.

---

## Version & docs

- `src/constants/appVersion.ts`: `2.10.73` → `2.10.74`, code `95` → `96`. Comment: "Z-report alignment fix (header columns share widths with data rows, banners left-anchored). Store/AI subtotals show 'items' instead of 'KGS'. Grand total splits into KGS (BUY), ITEMS (SELL/AI), and VALUE."
- `android/app/build.gradle`: `versionCode 95` → `96`, `versionName "2.10.73"` → `"2.10.74"`.
- `public/sw.js`: bump cache `v20` → `v21`.

## Memory updates

- New `mem://design/z-report-column-alignment`:
  > Z-report column headers MUST be generated from the same width spec as the data rows (single `padL`/`padR` helper). Never hand-space header strings — they drift out of sync with `padStart`/`padEnd` data widths.
  > Section banners (`== BUY ==`, `== SELL ==`) anchor to the left (over MNO+REF), not centered over the full row.
- New `mem://features/z-report-store-units`:
  > Store (transtype 2) and AI (transtype 3) sections render QTY as **integer items**, never KGS. Per-section subtotal: `<TYPE> TOTAL  <n> items  KSh <amount>`. Grand total breaks into three independent lines: `TOTAL <kg> KGS` (BUY only), `TOTAL ITEMS <n>` (SELL+AI only), `TOTAL VALUE KSh <n>` (SELL+AI only). Suppress any line whose subtotal is zero.

## Safety / regression checklist

- No backend changes (server.js untouched).
- No DB schema change (still IndexedDB v12).
- No change to `weight` storage, sync, or reference generation — only how SELL/AI weight is **rendered**.
- BUY-only flows (dairy/coffee) unchanged in totals or labels.
- Reprint history, photo upload, transaction creation, sync, device auth all untouched.
- Capacitor: no plugin/manifest/permission changes.
- Web + native render the same Z-report from the same code paths.
