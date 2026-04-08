

## Fix: Dual-Write to Native SQLite + IndexedDB — v2.10.29

### Problem

The Android app has a native encrypted SQLite database (`sync_records` table via Room) specifically designed for offline data safety. However, **no transaction save path actually writes to it**. Both `Index.tsx` (milk collection) and `Store.tsx` (store/AI sales) only save to IndexedDB via `saveReceipt()` / `saveSale()`. The `saveToLocalDB()` function in `offlineStorage.ts` exists but is never called.

This means the native SQLite backup — which survives WebView cache clears and app force-stops — is empty. Users have no safety net if IndexedDB data is lost.

### Fix

Add dual-write calls to the native database alongside every IndexedDB save, without changing existing IndexedDB logic (which remains the primary sync source).

**`src/pages/Index.tsx`** — After each `saveReceipt()` call (3 locations: lines ~1066, ~1096, ~1113):
- Import `saveToLocalDB` from `offlineStorage`
- After confirmed IndexedDB save, call `saveToLocalDB(referenceNo, 'milk_collection', capture)` in a fire-and-forget try/catch (non-blocking — native save failure must not break the flow)

**`src/pages/Store.tsx`** — After the `saveSale()` loop (line ~614):
- Import `saveToLocalDB` from `offlineStorage`
- For each batch item saved, call `saveToLocalDB(transrefno, 'store_sale', sale)` in a fire-and-forget try/catch

**`src/pages/AIPage.tsx`** — Check if AI transactions also save offline; if so, add the same dual-write with `'ai_sale'` record type.

**`src/hooks/useDataSync.ts`** — After successful sync + IndexedDB delete, also call `markNativeRecordSynced(referenceNo)` (already imported but only used in `syncOfflineReceipts` — verify it covers sales too).

**`src/constants/appVersion.ts`** → v2.10.29

### Important safety notes
- Native save is **fire-and-forget**: if it fails (e.g., on web platform), the flow continues normally with IndexedDB as primary
- `saveToLocalDB` already returns `null` gracefully on non-native platforms
- No changes to sync logic — IndexedDB remains the sync source; native DB is a backup layer

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `saveToLocalDB` call after each `saveReceipt` |
| `src/pages/Store.tsx` | Add `saveToLocalDB` call after each `saveSale` |
| `src/pages/AIPage.tsx` | Add `saveToLocalDB` call if offline saves exist |
| `src/constants/appVersion.ts` | Bump to v2.10.29 |

