# Fix Automatic Sync Engine

The sync engine is successfully detecting pending records but failing to initiate the upload process automatically. This plan will ensure that detected pending records immediately trigger an automatic sync when the device is online, without requiring manual intervention.

## User Review Required

> [!IMPORTANT]
> The sync engine will now automatically start a background sync whenever pending records are detected and the device is online. This may increase network activity immediately after record capture or app launch.

## Proposed Changes

### Sync Logic & Hooks

#### [MODIFY] [useDataSync.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useDataSync.ts)
- Modify `updatePendingCount` to trigger `syncAllData(true, false)` if `pendingCount > 0` and the device is online.
- Add comprehensive logging following the trace: `pending detected → auto-sync started → upload attempted → response → mark synced → remaining pending count`.
- Ensure the automatic trigger is throttled and respects the `syncInProgressRef` to avoid duplicate jobs.
- Refine the discrepancy detection between native and IndexedDB to ensure native records are accounted for in the auto-sync trigger.

### Native Storage Plugin

#### [MODIFY] [OfflineStoragePlugin.kt](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/android/app/src/main/java/app/delicoop101/storage/OfflineStoragePlugin.kt)
- Enhance logging for `markAsSynced`, `markSyncFailed`, and `getUnsyncedRecords`.
- Ensure `markAsSynced` provides clear feedback on whether the record was found and updated.

### API & Services

#### [MODIFY] [offlineStorage.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/offlineStorage.ts)
- Add logging to `markNativeRecordSynced` and `markNativeRecordFailed` to trace the flow back to the native layer.

## Verification Plan

### Manual Verification
1. **Offline Capture**: Disable network, capture a milk collection record (`OFFICE00000010`).
2. **Observe Detection**: Verify logs show `getUnsyncedRecords` detecting the pending record.
3. **Enable Network**: Turn on Wi-Fi/Data.
4. **Observe Auto-Sync**: Verify logs show `auto-sync started` immediately without manual trigger.
5. **Verify Completion**: Confirm logs show `upload attempted → response → mark synced`.
6. **Check DB State**: Verify `remaining pending count` becomes `0` and record is marked as synced in native SQLite.
7. **Concurrency Test**: Attempt to capture another record while sync is in progress to verify `Prevent duplicate simultaneous sync jobs` works (no double upload).
