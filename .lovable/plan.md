

## Fix Member Produce Statement Print Layout — v2.10.55

Four small, isolated changes, all confined to the periodic-report receipt path. No backend schema, sync, or unrelated screens are touched.

### 1. Space between DATE and REC NO columns
In `src/services/bluetooth.ts` `printMemberProduceStatement` the column widths are too tight (dateColW=10, recColW=7) so a 10-char date `28/02/2026` and a 5-char ref `00308` print with zero gap → `28/02/202600308`.

Fix:
- Increase `dateColW` from 10 → 12 (adds a 2-space gutter after the date)
- Mirror in the on-screen preview grid in `src/components/PeriodicReportReceipt.tsx` so what you see matches what prints (use a 3-column grid with explicit width classes instead of `grid-cols-3` + `text-center`).

### 2. Center "<PRODUCE> RECORD" properly
The string is being centered on a 32-char width but is currently being right-shifted because we prefix nothing; recompute with a wider visual margin so it sits visually centered (we'll use a real centerText against the 32-char width and verify – the bug is actually that the on-receipt text is correct width but the **preview** uses `text-center font-bold` with no constraints, while the **printed** version centers it. The receipt ESC/POS text is fine; the user's photo shows it printed at the right because the preview grid pushes it. Fix the preview alignment to match a centered render.)

Action: in `PeriodicReportReceipt.tsx` wrap the produce title in a flex container with `justify-center` and remove any `text-right` leakage. In `bluetooth.ts`, keep `centerText(...)` but add a sanity trim of trailing whitespace in `produceName` (e.g. `"MBUNI "` becomes `"MBUNI"`) so padding maths stay symmetric.

### 3. Company name too high — add top margin / blank line
In `printMemberProduceStatement`, prepend two blank lines (`\n\n`) before `data.companyName` so the printer feeds paper before printing the header (matches existing milk receipt convention). Also bold the company line via ESC/POS sequence already used by other receipts (or at minimum two leading newlines for printers without bold support).

### 4. Show selected Center on the receipt; fallback to `transactions.route`

Backend (`backend-api/server.js`, `/api/periodic-report/farmer-detail`):
- Already returns `farmer_route` (the member's registered route). Add a new field `transaction_route` derived from the most recent matching transaction for the same farmer in the date range:
  ```sql
  SELECT TRIM(t.route) AS route
  FROM transactions t
  WHERE t.memberno = ? AND t.Transtype = 1
    AND CAST(t.transdate AS DATE) BETWEEN ? AND ?
    AND t.ccode = ?
  ORDER BY t.transdate DESC, t.transtime DESC
  LIMIT 1
  ```
  Plus join `cm_route` (or whichever holds the route descript) to also return `transaction_route_name`.

Frontend (`src/components/PeriodicReportReceipt.tsx`):
- Read active route from `localStorage.active_session_data.route` (already used by `PeriodicReport.tsx`).
- Compute `displayRoute = activeRoute?.descript || data.transaction_route_name || data.transaction_route || data.farmer_route || ''`.
- Pass it as `centerName` into `printMemberProduceStatement`.

`printMemberProduceStatement` signature gets one new optional field:
```ts
centerName?: string;  // "<RouteDescript>"
```
Render right under the company header, before the title block:
```
<center>CENTER: <NAME></center>
--------------------------------
```
If `centerName` is empty, omit the line entirely (no blank `CENTER:` row).

Mirror the same line in the on-screen preview.

### Files Changed

| File | Change |
|---|---|
| `backend-api/server.js` | `/api/periodic-report/farmer-detail`: add `transaction_route` + `transaction_route_name` fields to response (additive — backward compatible). |
| `src/services/mysqlApi.ts` | Extend `FarmerDetailReportData` type with optional `transaction_route?: string; transaction_route_name?: string;`. |
| `src/services/bluetooth.ts` | `printMemberProduceStatement`: add `\n\n` lead, accept optional `centerName`, render `CENTER:` line, widen `dateColW` to 12, trim trailing whitespace in `produceName`. |
| `src/components/PeriodicReportReceipt.tsx` | Resolve `centerName` (active route → tx route → farmer route), pass to printer, render same in preview, fix grid spacing + center alignment for produce title. |
| `src/constants/appVersion.ts` | Bump to **v2.10.55 (Code 77)**. |

### What Does NOT Change
- Z-Reports, Buy/Sell receipts, Store/AI receipts — untouched.
- Sync engines, IndexedDB, reference generator, photo audit — untouched.
- Multi-tenant `ccode` filtering and v2.10.53 cross-device periodic-report logic — preserved; new fields are additive only.
- v2.10.54 Bluetooth coexistence fixes — untouched.

### Verification After Deploy
1. Print a Member Produce Statement → confirm a clear gap between the date and the REC NO column.
2. "<PRODUCE> RECORD" line is visually centered on the 58 mm tape.
3. Company name no longer prints at the very top edge — there is a small paper feed before it.
4. With a center selected on Dashboard → receipt shows `CENTER: <name>` between company and title.
5. Clear active route on Dashboard, reprint → `CENTER:` line shows the route resolved from the most recent matching transaction; if that's also empty it falls back to the farmer's registered route; if still empty the line is hidden.
6. Confirm preview modal layout matches printed output for spacing and alignment.

### Out of Scope
- Adding a real ESC/POS bold/large header (would require enabling raw command mode globally).
- Backfilling missing `transactions.route` rows.
- Rebuilding the periodic-report summary table.

