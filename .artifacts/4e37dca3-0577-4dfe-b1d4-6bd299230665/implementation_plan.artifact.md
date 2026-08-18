# Fix Pending Receipts Count Not Reducing After Idempotent Sync

The frontend pending receipts count does not decrease when the backend returns an idempotent success response (e.g., "already exists with matching payload"). This happens because the sync engine fails to correctly identify these responses as successful sync events, leading to local records remaining in IndexedDB or Native Storage.

## User Review Required

> [!IMPORTANT]
> The fix involves broadening the criteria for "idempotent success" in the sync engine. This ensures that if the backend confirms a record exists (even if it returns a 409 or a custom success flag), the frontend will clean up the local copy and reduce the pending count.

## Proposed Changes

### Sync Engine Improvements

#### [MODIFY] [useDataSync.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useDataSync.ts)
- Update `processReceiptSync` to robustly handle idempotent success responses.
- Fix logic that was picking `result.error || result.message`, which could skip the "already exists" string if a generic error like "Conflict" was present.
- Expand the idempotent check strings to include "idempotent".
- Ensure `markNativeRecordSynced` and IndexedDB deletion are consistently triggered for all successful sync paths (new insert or idempotent retry).
- Normalize reference numbers (trim/uppercase) during local cleanup to prevent mismatches.

#### [MODIFY] [offlineStorage.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/offlineStorage.ts)
- Add more logging to `markNativeRecordSynced` to help trace failures in production.

### Pending Count Accuracy

#### [MODIFY] [useDataSync.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useDataSync.ts)
- Update `updatePendingCount` to use normalized reference number comparisons when checking for discrepancies between IndexedDB and Native Storage.

## Verification Plan

### Manual Verification
1.  Capture a receipt while offline.
2.  Trigger a sync.
3.  Verify the backend log shows "already exists with matching payload (true idempotent retry)".
4.  Confirm the "Pending Receipts" count on the dashboard drops to 0.
5.  Verify no errors are shown in the toast/logs regarding sync failure for these records.
