

## Fix: Clean Up Legacy Orphaned Records from IndexedDB — v2.10.30

### Problem

Transactions created in v2.10.4 are still showing as "pending" in v2.10.29 despite already being synced to the backend (confirmed by "Duplicate item skipped" messages). These records are stuck in IndexedDB because:

1. **Old sale records** saved before the `type: 'sale'` field was added have no `type` field — so `getUnsyncedSales()` skips them (it filters for `type === 'sale'`), and `syncSalesFromDB` never processes them
2. **Old records already synced** via the backend still exist locally because the delete-after-sync step failed (connection lost mid-sync) or never ran
3. **`updatePendingCount`** counts these orphans as pending, inflating the counter permanently

These records are stuck in a limbo: counted as pending, but no sync path picks them up for processing or cleanup.

### Fix

**`src/hooks/useDataSync.ts`** — Add a legacy record cleanup step in `syncAllData`:
- After normal receipt sync and sales sync complete, scan all unsynced records in the `receipts` store
- For records that have NO `type` field (or type is neither `'sale'` nor `'ai'`), AND have a `reference_no` or `transrefno`:
  - Check the backend to see if the record already exists (using the existing `milkCollection.getByReference` or `sales` lookup)
  - If the backend confirms it exists (duplicate), delete the local IndexedDB record
  - If the backend says it doesn't exist, attempt to sync it (determine type from fields: has `item_code` → sale, has `weight`+`farmer_id` → milk collection)
- Log all cleanup actions: `[CLEANUP] Removed orphaned record: {ref} (already on backend)`

**`src/hooks/useIndexedDB.ts`** — Add a `getAllUnsyncedRecords` helper:
- Returns ALL unsynced records from the `receipts` store (no type filtering), so the cleanup logic can find orphans

**`src/constants/appVersion.ts`** → v2.10.30 (Code 52)

### Safety notes
- Cleanup only runs during `syncAllData` (manual sync or scheduled), not on every render
- Backend verification happens before any deletion — no data loss risk
- Records that can't be verified (offline, API error) are left untouched
- Fire-and-forget: cleanup failures don't block normal sync

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useDataSync.ts` | Add legacy orphan cleanup after normal sync completes |
| `src/hooks/useIndexedDB.ts` | Add `getAllUnsyncedRecords` helper (unfiltered) |
| `src/constants/appVersion.ts` | Bump to v2.10.30 |

