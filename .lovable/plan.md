
# Fix 3 issues – v2.10.73 (Version Code 95)

In this codebase, "factory" = the **route/center** (`route` / `tcode`) the device is currently delivering to (e.g. KIPKELION, BOMET). Each device is locked to one `ccode` (company), and within that company a member can deliver to multiple routes/factories. The bugs below are all confined to how route is (or isn't) used.

---

## Issue 1 — Cumulative not filtered by selected factory (route)

### Root cause
The backend already accepts `route` on `/api/farmer-monthly-frequency` and `/api/farmer-monthly-frequency-batch` and the frontend already passes `selectedRouteCode`. The data returned IS factory-scoped.

The bug is in the **offline cache key** in `src/hooks/useIndexedDB.ts`:

```
cacheKey = `${farmerId}_${YYYY-MM}`   // ❌ no route
```

When farmer `M0123` delivers to factory A (route `KPL`) the route-scoped total is written under key `M0123_2026-05`. If the device is later switched to factory B (route `BMT`), the route-scoped total for B overwrites the same key — and the displayed cumulative on factory B silently includes/excludes A's data depending on which route last wrote.

`getUnsyncedWeightForFarmer` already supports a `routeFilter` param but `getFarmerCumulative` / `updateFarmerCumulative` ignore route entirely.

### Fix
Make the cache key route-aware and route-aware throughout the read/write path.

1. **`src/hooks/useIndexedDB.ts`**
   - Bump DB version 11 → 12. Add `route` field to `farmer_cumulative` records.
   - Change `getFarmerCumulative(farmerId, route?)` and `updateFarmerCumulative(farmerId, count, fromBackend, byProduct, route?)` signatures to accept a route.
   - New cache key: `${cleanId}__${route ? UPPER(TRIM(route)) : 'ALL'}__${YYYY-MM}` (double underscore to avoid collisions with farmer IDs containing `_`).
   - Migration on upgrade: clear the `farmer_cumulative` store (data is recoverable from backend on next sync — no transaction loss).
   - Update the `farmer_month` index to `farmer_route_month` over `[farmer_id, route, month]`.

2. **`src/hooks/useDataSync.ts`** (lines 348, 360, 443, 455)
   - Determine the active route at sync time (from the receipt being synced: `receipt.route` / `receipt.tcode`) and pass it to both `getMonthlyFrequency(..., route)` and `updateFarmerCumulative(..., route)`. This way each route's cache row is refreshed independently.

3. **`src/pages/Index.tsx`** (~7 call sites listed above)
   - Pass `selectedRouteCode` (already in scope) into every `getFarmerCumulative` and `updateFarmerCumulative` call.
   - In the batch prefetch path, when the batch API was called with `selectedRouteCode`, persist each farmer under that route key (not the global key).

4. **`src/components/FarmerSyncDashboard.tsx`** (lines 144, 301)
   - Pass `activeRoute` into `getFarmerCumulative` / `updateFarmerCumulative`.

5. **No backend changes needed** — `/api/farmer-monthly-frequency*` already does `UPPER(TRIM(route))` filtering since v2.10.72.

### Result
Switching factories instantly shows that factory's independent cumulative. A member who delivers to two factories sees two totals, never merged.

---

## Issue 2 — Z-Report Store/AI sections show quantity only, no KSh value

### Root cause
The backend `/api/z-report/device` already returns `price` and `amount` per transaction (server.js line 1642–1643). The frontend `DeviceZReportTransaction` type already declares them. They simply aren't rendered for `transtype === 2` (SELL/Store) and `transtype === 3` (AI).

### Fix
Render an extra `KSh` column for transtype 2 and 3 in both the on-screen receipt and the thermal print output. Buy (transtype 1) keeps the existing 4-column layout (no money column).

1. **`src/components/DeviceZReportReceipt.tsx`**
   - In `renderTypeSection`, when `group.transtype !== 1`:
     - Header row: `MNO | REF | QTY | KSh | TIME` (5 cols).
     - Each row: append `tx.amount.toFixed(0)`.
     - Subtotal row: add `Σ KSh: <total amount>` next to the weight subtotal.
   - Compute `group.totalAmount` alongside `group.totalWeight` in the `typeGroups` `useMemo`.

2. **`src/services/bluetooth.ts` → `printZReport`**
   - Extend the `transactions` parameter type with optional `price?: number; amount?: number; transtype?: number`.
   - For SELL/AI groups, switch the column header to `MNO...:REF.:QTY.:KSh.:TIME` and print rows accordingly. Keep BUY layout unchanged.
   - Add a `KSh: <total>` line to the subtotal for SELL/AI.
   - Caller (`DeviceZReportReceipt.handlePrint`) must include `price` and `amount` when mapping `filteredTransactions` (currently dropped).

3. **`src/utils/pdfExport.ts` → `generateDeviceZReportPDF`**
   - Mirror the column change for SELL/AI sections so the downloaded PDF matches.

### Result
Z-report (screen, thermal, PDF) shows KSh per Store/AI line and per group subtotal. BUY/produce sections look identical to today.

---

## Issue 3 — Z-Report receipt layout overly centered, hard to read

### Cause
On-screen receipt uses tiny font (`text-[9px]` / `text-[10px]`), heavy `text-center`, dotted dividers between every cell, and the dialog is `max-w-md` which squeezes everything. The thermal output is also centered-heavy with no spacing between sections.

### Fix (readability pass — no functional change)

1. **`src/components/DeviceZReportReceipt.tsx`**
   - Widen dialog: `max-w-md` → `max-w-lg`.
   - Bump base text from `text-xs` to `text-sm` for header lines; transaction rows go from `text-[10px]` to `text-[11px]`; column headers from `text-[9px]` to `text-[10px]` and bold.
   - Replace cell-level vertical dotted separators with simple column spacing (`grid-cols-* gap-2`) — keep only the row-bottom dotted divider.
   - Left-align MNO and REF columns (currently center). Right-align QTY, KSh. Center only TIME.
   - Increase vertical rhythm: section header `mt-3 mb-1`, row `py-1` instead of `py-0.5`.
   - Header block: keep company name centered, but left-align the metadata block (`SUMMARY / SESSION / DATE / CENTER / PRODUCE`) with a 2-col `[label][value]` grid for alignment.
   - Increase the transactions scroll area: `max-h-60` → `max-h-80`.

2. **`src/services/bluetooth.ts` → `printZReport`** (32-char thermal)
   - Add a single blank line between BUY / SELL / AI groups and before TOTAL.
   - Replace `'MNO......:REF..:QTY.:TIME'` style headers with space-padded fixed-width columns and a single dashed underline.
   - Left-pad MNO to 8, REF 5, QTY 6 right-aligned, TIME 5 (and KSh 6 right-aligned for SELL/AI).
   - Section separator: one `-` line above each `== LABEL ==` and a blank line after the subtotal.
   - Keep header (company, period, date, center) centered — that is intentional thermal style.

3. **`src/utils/pdfExport.ts`**
   - Mirror spacing improvements: more line height between sections, left-align tabular columns.

No data, totals, or grouping logic change — purely presentation.

---

## Version & docs

- `src/constants/appVersion.ts`: `2.10.72` → `2.10.73`, code `94` → `95` with changelog comment.
- `android/app/build.gradle`: `versionCode 94` → `95`, `versionName "2.10.72"` → `"2.10.73"`.
- `public/sw.js`: bump cache `v19` → `v20`.

## Memory updates

- New `mem://features/cumulative-route-scoping` — "Cumulative cache MUST be keyed by `farmerId__route__month`. Never share a key across routes/factories."
- Update `mem://index.md` Core to add: "Cumulative is per-route. Cache key includes route."

## Safety / regression checklist

- IndexedDB upgrade clears only `farmer_cumulative` (rebuilt from backend on next online sync). No receipts or unsynced transactions touched.
- All API call sites already pass `selectedRouteCode` — only the cache layer changes.
- Z-report numeric totals (weight, entries, farmers) remain unchanged; only presentation + a new money column for SELL/AI.
- Coffee/dairy, BUY-only flows, and existing PDF download all preserved.
- Increment version per workspace rule; transrefno generator, sync, photo upload, device auth untouched.
