

## Fix: Sync Store/AI Sales from Dashboard — v2.10.21

### Problem

The `useSalesSync` hook (which syncs store/AI sales) is only mounted inside `Store.tsx` and `AIPage.tsx`. When the user is on the Dashboard or any other page, pending store sales sit in IndexedDB unsent. The user must navigate to the Store page to trigger sync.

Meanwhile, `useDataSync` (used on the Dashboard) syncs milk receipts, farmers, items, routes, sessions, and reports — but **never calls** `syncPendingSales` for store/AI transactions.

### Fix

**`src/hooks/useDataSync.ts`** — Add store/AI sales sync to `syncAllData`:

1. Import `mysqlApi` batch sale functions and `generateDeviceFingerprint` (already imported).
2. After step 1 (milk receipt sync, ~line 503), add a new step that reads unsynced sales from IndexedDB (`getUnsyncedSales`), groups by `uploadrefno`, and syncs them using the same logic as `useSalesSync` — batch for store, individual for AI.
3. This means store sales sync on app launch, on periodic background sync, and on the `online` event — all from the Dashboard without visiting the Store page.

To avoid duplicating the batch sync logic, extract the core sync function from `useSalesSync` into a shared utility (`src/utils/salesSyncEngine.ts`) and call it from both `useDataSync.syncAllData` and `useSalesSync.syncPendingSales`.

**Alternative (simpler)**: Just import and call `useSalesSync` couldn't work (hooks can't call hooks). Instead, add the sales sync directly into `syncAllData` after milk sync:

```
// After milk receipt sync in syncAllData:
const unsyncedSales = await getUnsyncedSales();
const salesOnly = unsyncedSales.filter(r => r.type === 'sale' || r.type === 'ai');
// ... batch and sync using same logic as useSalesSync
```

But this duplicates ~150 lines. Better approach:

**Extract `syncSalesFromDB` as a standalone async function** in `src/utils/salesSyncEngine.ts` that takes `getUnsyncedSales` and `deleteSale` as parameters. Both `useDataSync` and `useSalesSync` call it.

### Files Changed

| File | Change |
|------|--------|
| `src/utils/salesSyncEngine.ts` | **New** — extracted sales batch sync logic (store batching + AI individual sync) |
| `src/hooks/useDataSync.ts` | Call `syncSalesFromDB` inside `syncAllData` after milk receipt sync |
| `src/hooks/useSalesSync.ts` | Delegate to `syncSalesFromDB` instead of inline logic |
| `src/constants/appVersion.ts` | Bump to v2.10.21 |

### Safety
- No API changes — same endpoints, same payload format
- `useSalesSync` online handler still works as before (for instant sync on Store/AI pages)
- `useDataSync` adds sales sync to the existing sync flow — no new timers or listeners
- Global sync lock prevents concurrent runs between the two hooks
- Existing `route_tcode` preference and duplicate handling preserved

