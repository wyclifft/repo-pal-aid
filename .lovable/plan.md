

## Bugs Found — v2.10.20

### Bug 1: Duplicate sync race condition (Store.tsx vs useSalesSync hook)

**Problem**: `Store.tsx` lines 331-432 contain an **inline `syncPendingSales` function** that reads from the same IndexedDB store as the `useSalesSync` hook (which auto-syncs on `online` events). Both run concurrently, causing the backend to receive duplicate submissions and return `⚠️ Duplicate item skipped` warnings.

Additionally, the inline version (line 364) uses `route: String(firstSale.route || '')` — it does NOT prefer `route_tcode`, bypassing the fix already in the hook.

**Fix**: Delete the inline `syncPendingSales` function (lines 331-432). Destructure `syncPendingSales` from the existing `useSalesSync()` hook and call it in the mount effect (line 158). Remove the now-unused `deleteSale` from the `useIndexedDB` destructure.

### Bug 2: `useDataSync` still filters for `PRINTED_RECEIPTS` string key

**Problem**: `useDataSync.ts` line 458 still checks `r.orderId === 'PRINTED_RECEIPTS'`. Since v2.10.16 migrated printed receipts to a dedicated store, this filter is dead code — but more importantly, it would silently hide a real receipt if its `orderId` somehow matched (edge case). It should be removed for clarity.

**Fix**: Remove the `PRINTED_RECEIPTS` filter line from `updatePendingCount` (line 458).

### Bug 3: `useSalesSync` hook missing `route_tcode` field in batch request

**Problem**: In `useSalesSync.ts` line 119, the batch request sets `route_tcode` but the Store inline sync at line 364 doesn't. With the inline sync removed (Bug 1 fix), this is resolved. However, the hook itself should also verify `route_tcode` is passed as a top-level field — currently it does (line 119), so this is confirmed correct.

### Changes

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Remove inline `syncPendingSales` (lines 331-432); use hook's version; remove unused `deleteSale` |
| `src/hooks/useDataSync.ts` | Remove stale `PRINTED_RECEIPTS` orderId filter (line 458) |
| `src/constants/appVersion.ts` | Bump to v2.10.20 (Code 43) |

### Safety
- No API changes
- No schema changes
- The `useSalesSync` hook handles all sync edge cases (duplicates, batching, route_tcode, online handler)
- Store offline save path unchanged
- Removing dead `PRINTED_RECEIPTS` filter has no functional impact

