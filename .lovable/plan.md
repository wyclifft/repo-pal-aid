# Farmer Sync Dashboard — respect active Product (icode) & Season (scode)

## Problem
The dashboard currently only filters by the active **route** (`tcode`). The cumulative figures it shows are the *combined* monthly totals across every product the farmer delivered. When the operator has selected `S001` on the dashboard, they expect the Farmer Sync card to show the per-`S001` slice that matches the Receipts/Z-Report view — and to drop rows whose only activity is on a different product or season.

The data we need is already available:
- `mysqlApi.farmerFrequency.getMonthlyFrequencyBatch` already returns `by_product: [{ icode, product_name, weight }]` per farmer.
- `farmer_cumulative` IndexedDB rows already persist `by_product` (written by `updateFarmerCumulative`).
- Unsynced receipts in IndexedDB already carry `icode` and `scode/season`.

So this is a pure presentation/filtering fix — no backend, schema, or sync-engine changes.

## Scope
Frontend only. Touch only `src/components/FarmerSyncDashboard.tsx` plus the standard version bump trio.

## Changes

### 1. `src/components/FarmerSyncDashboard.tsx`
- Add `getActiveProduct()` and `getActiveSeason()` helpers next to existing `getActiveRoute()`, reading `active_session_data.product.icode` and `active_session_data.session.SCODE` with the same `.trim().toUpperCase()` normalization used elsewhere.
- Capture `activeIcode` and `activeScode` in the component, include both in the `loadData` dependency array so changes re-run the load.
- **Online path (`loadFromBatchAPI`)**:
  - When `activeIcode` is set, compute each farmer's displayed total from the matching `by_product[]` entry instead of `cumulative_weight`:
    - `baseCount = matchingEntry?.weight ?? 0`
    - Drop farmers whose matching entry is `0` and who have no unsynced receipts for that icode.
  - When `activeIcode` is empty, keep current combined behaviour.
- **Offline path (`loadFromOfflineCache`)**:
  - Read `by_product` off each `farmer_cumulative` row; when `activeIcode` is set, use the matching slice for `baseCount`, else use the row's combined `baseCount`.
  - Apply `activeIcode` + `activeScode` filters to the unsynced-receipts loop (normalized compare on `r.icode`, and `r.scode || r.season`). Receipts that don't match are excluded from `unsyncedByFarmer`.
  - Keep the existing route filter, the `transtype === 1` (BUY-only) guard, and the "drop zero-weight farmers" rule.
- **`localCount` semantics**: keep using `Math.max(localCount, unsyncedWeight)` so the on-card `+X local` badge reflects only the filtered unsynced weight.
- **Header / footer copy**: extend the route chip to include the active product + season when present, e.g. `Route: T001 · Product: S001 · Season: S0001`. Update the empty-state message similarly.
- Pass `activeIcode`/`activeScode` along to the batch-refresh log line via the existing context enrichment (already wired in v2.10.95).

### 2. Version bump (mandatory per workspace rule)
- `src/constants/appVersion.ts` → `2.10.96`
- `public/sw.js` → cache `v43`
- `android/app/build.gradle` → versionCode `118`, versionName `2.10.96`

## Out of scope / explicit non-goals
- **No backend changes.** The monthly batch API stays per-route; we filter client-side. Season is intrinsically monthly on the backend, so for `baseCount` we cannot retroactively isolate a different scode — we only filter *unsynced* deltas by scode and use it for context labelling. This matches how Z-Report and Receipts treat scode today.
- No edits to `useIndexedDB`, sync engine, IndexedDB schema, or cumulative recompute logic.
- No changes to `FarmerCumulative` storage shape — `by_product` is already persisted.
- No new UI components, just chip text + filtered rows.

## Verification checklist
1. Select `T001` + `S001` + `S0001` on the dashboard → Sync Status card lists only farmers with `S001` activity on `T001`, totals match the per-product values seen in receipts (e.g. M00003 = 32.1 kg, M00001 = 5040.1 kg, M00007 = 91.9 kg from the recent test batch).
2. Switch product to a different icode → list re-loads with that slice; farmers with no activity for it disappear.
3. Clear product selection → behaviour returns to today's combined totals.
4. Offline mode (airplane on): same filtering applied from IndexedDB cache + unsynced receipts.
5. Unsynced receipt count unchanged (it's a global indicator, not per-icode).
6. No regression to transaction creation, receipt printing, sync, or device auth.
