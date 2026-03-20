

## Problem

Store sales saved offline are invisible in the pending receipts UI because:

1. **`getUnsyncedReceipts` (useIndexedDB.ts, line ~422)** filters to exclude `type === 'sale'` records — this was added in the recent fix to align with milk sync, but it also hides store sales from all pending indicators.

2. **`updatePendingCount` (useDataSync.ts, line ~458)** also explicitly excludes `type === 'sale'`.

3. **`OfflineIndicator`** uses `getUnsyncedReceipts`, so store sales are excluded there too.

4. **Store page** has no pending sales indicator at all — the `ReceiptList` component exists but is never rendered.

Store sales are synced separately via `useSalesSync` / `Store.syncPendingSales`, but the user has no visibility that they exist.

## Fix

### 1. Add store/AI sales to pending count (useDataSync.ts)

In `updatePendingCount`, also query `getUnsyncedSales()` and combine both counts:

```javascript
const updatePendingCount = useCallback(async () => {
  if (!isReady) return;
  try {
    const unsynced = await getUnsyncedReceipts();
    const receiptsOnly = unsynced.filter((r: any) => {
      if (r.orderId === 'PRINTED_RECEIPTS') return false;
      return true;
    });
    
    // Also count pending store/AI sales
    const unsyncedSales = await getUnsyncedSales();
    const salesCount = unsyncedSales.length;
    
    if (mountedRef.current) {
      setPendingCount(receiptsOnly.length + salesCount);
    }
  } catch (err) {
    console.error('Pending count error:', err);
  }
}, [isReady, getUnsyncedReceipts, getUnsyncedSales]);
```

This requires importing `getUnsyncedSales` from the existing `useIndexedDB` hook in `useDataSync.ts`.

### 2. Add store/AI sales to OfflineIndicator count

Same approach: also call `getUnsyncedSales()` in `OfflineIndicator.tsx` and add to `pendingCount`.

### 3. Add pending sales banner to Store page

Add a small pending count indicator in the Store page header showing how many offline sales are queued, using `getUnsyncedSales` count with a "Sync Now" action.

### Files changed
- `src/hooks/useDataSync.ts` — add `getUnsyncedSales` to combined pending count
- `src/components/OfflineIndicator.tsx` — include sales in pending count
- `src/pages/Store.tsx` — add pending sales indicator in header
- `src/constants/appVersion.ts` — bump to v2.10.4

