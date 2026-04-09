

## Fix: Pending Counter Not Updating After Legacy Cleanup — v2.10.32

### Problem

After sync + legacy cleanup completes and removes orphaned records, the Dashboard pending counter doesn't update to reflect the new (lower) count. The `syncComplete` event is dispatched at line 440 (inside `syncOfflineReceipts`) **before** the legacy cleanup runs, so the event-driven `updatePendingCount` reads stale data. The final `updatePendingCount` at line 770 runs much later after all the route/session/farmer fetches — but there's a gap where the counter shows stale numbers.

Additionally, a second `syncComplete` event should be dispatched after cleanup so that `OfflineIndicator` and other event listeners also refresh.

### Fix

**`src/hooks/useDataSync.ts`**:
- After the cleanup block (line ~652, after `cleaned > 0`), call `await updatePendingCount()` immediately so the counter drops right after orphans are removed — don't wait until line 770
- Dispatch a second `window.dispatchEvent(new CustomEvent('syncComplete'))` after cleanup if any records were cleaned, so `OfflineIndicator` and other event-based consumers also refresh

**`src/constants/appVersion.ts`** → v2.10.32 (Code 54)

### Reassurance on data safety

The legacy cleanup is safe — it only deletes local records after confirming the backend has the data (duplicate response) or after a successful create call. The dual-write to native SQLite provides an additional safety net. This cleanup only runs during manual sync, not automatically. Going forward, new transactions always have the `type` field set, so they won't become orphans.

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useDataSync.ts` | Add `updatePendingCount()` + `syncComplete` event dispatch immediately after cleanup |
| `src/constants/appVersion.ts` | Bump to v2.10.32 |

