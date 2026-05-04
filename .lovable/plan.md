# v2.10.75 — Two surgical bug fixes

## Issue 1: Z-Report — first product header missing

### Root cause
In both Z-report renderers, the product divider (`-- RAHA FLOUR --`) is printed **only when transitioning** from one product to a different one. The first product in the section never gets a header because there is no previous product to compare against.

- `src/services/bluetooth.ts` lines 2510–2518 — only prints divider when `prevProductCode !== undefined && prevProductCode !== current`.
- `src/components/DeviceZReportReceipt.tsx` lines 288–304 — same pattern (`prevTx && prevTx.product_code !== tx.product_code`).

So when a section has multiple products (e.g. SELL: Raha then Jogoo), only Jogoo gets a header. Raha's transactions sit headerless under the section banner.

### Fix
Print the product label **before the first transaction of every product group** (when `showProductDividers === true`), not just on transitions. Logic becomes: "show label whenever the current product differs from the previous product, treating `undefined` previous as different".

Apply the same one-line change in both files:
- `src/services/bluetooth.ts` — change `if (showProductDividers && prevProductCode !== undefined && prevProductCode !== ...)` to `if (showProductDividers && prevProductCode !== (tx.product_code || ''))`.
- `src/components/DeviceZReportReceipt.tsx` — change `showItemSeparator` to `showProductDividers && (!prevTx || prevTx.product_code !== tx.product_code)`. For the very first row of the section, suppress the top dotted border so it doesn't sit awkwardly directly under the column header — only render the centered product label.

No changes to single-product sections (still suppressed by `distinctProducts > 1`). No changes to subtotals, grand totals, or column widths.

## Issue 2: Farmer Sync — offline route filter ignores transaction route

### Root cause
`src/components/FarmerSyncDashboard.tsx` `loadFromOfflineCache` (~lines 184–270):

1. Reads **every** record from the `farmer_cumulative` IndexedDB store via `store.getAll()` and builds the farmer set from `r.farmer_id` only.
2. Filters by route using `meta?.route` from the `cm_members` lookup — but that is the farmer's **home/registration route**, not the route they actually delivered to.

Result: when offline and switching routes, farmers from other factories still appear (their cm_members home route happens to match) and per-factory totals are mixed because the cumulative records for ALL routes are loaded.

The `farmer_cumulative` store is already correctly keyed by `farmer+route+month` (v2.10.73, see `useIndexedDB.ts` `buildCumulativeKey`), so each record carries its own `route` field. We just aren't using it.

### Fix
In `loadFromOfflineCache`:

1. When iterating `farmer_cumulative.getAll()` results, capture each row's `route` (already stored as upper-cased route key, falling back to `'ALL'`).
2. If `activeRoute` is set, **drop any cumulative row whose `route` does not equal the normalized active route key**. Do not fall back to cm_members route for filtering.
3. For unsynced receipts, keep the existing route filter on `r.route` (already normalized via `.trim().toUpperCase()` consistently).
4. Build the union set from the route-filtered cumulative rows + route-filtered unsynced receipts only.
5. Remove the cm_members-route-based exclusion (`farmerRoute !== cleanActiveRoute`) — it was the wrong source. Keep cm_members lookup only for display name/route label.
6. When `activeRoute` is empty (no active session), keep current behaviour (show all).

Also tighten the dashboard description to clarify the data is scoped to the selected route when offline (already partially in place).

No changes to the online path (`loadFromBatchAPI`) — backend already filters by route.

## Version bump

- `src/constants/appVersion.ts` → `2.10.75`, code `97`.
- `android/app/build.gradle` → `versionCode 97`, `versionName "2.10.75"`.
- `public/sw.js` → cache `v22`.

## Memory updates

- Update `mem://features/cumulative-route-scoping` to record the offline dashboard fix (filter by stored cumulative `route` key, never by cm_members home route).
- Add `mem://design/z-report-product-header-rule` — "When section has >1 product, every product group must show its label header, including the first."

## Files to edit

- `src/services/bluetooth.ts`
- `src/components/DeviceZReportReceipt.tsx`
- `src/components/FarmerSyncDashboard.tsx`
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`
- `mem://features/cumulative-route-scoping.md`
- `mem://design/z-report-product-header-rule.md`
- `mem://index.md`

## Out of scope (preserved)

- Backend (`server.js`) untouched — production safety.
- Online sync logic, cumulative cache schema, transaction sync engine — unchanged.
- Z-report column widths, totals, section banners — unchanged.
