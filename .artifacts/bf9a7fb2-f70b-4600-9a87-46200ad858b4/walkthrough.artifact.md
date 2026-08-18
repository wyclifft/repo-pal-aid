# Walkthrough - Automatic Sync Engine Fix

I have fixed the automatic sync engine to ensure that pending records detected in the native SQLite database are automatically uploaded when the device is online. I have also added comprehensive logging to trace the entire synchronization flow.

## Changes Made

### 1. Automatic Sync Trigger
I modified the `updatePendingCount` hook in `useDataSync.ts` to act as a trigger for background synchronization. Whenever pending records are detected (whether in IndexedDB or Native Storage) and the device is online, a `triggerAutoSync` event is dispatched, which initiates the `syncAllData` orchestrator.

### 2. Trace Logging
I added detailed logs to trace the record lifecycle:
- **Detection**: `[SYNC] PENDING DETECTED (X records) → auto-sync starting...`
- **Execution**: `[SYNC] Auto-sync event received — executing syncAllData`
- **Upload**: `[SYNC] UPLOAD ATTEMPTED [X/Y]: REF (source=...)`
- **Response**: `[SYNC] RESPONSE for REF: success=true`
- **Cleanup**: `[STORAGE] RESPONSE: Mark synced SUCCESS for REF`
- **Verification**: `[SYNC] [VERIFY] REF verified removed from Native DB.`

### 3. Native Layer Enhancements
- Updated `OfflineStoragePlugin.kt` to provide clearer logs for `PENDING DETECTED` and `MARK SYNCED SUCCESS`.
- Improved error reporting in the bridge between TypeScript and Kotlin for sync status updates.

### 4. Concurrency & Safety
- Fixed a potential circular dependency in `useDataSync.ts` by using a custom event listener to trigger the sync orchestrator.
- Maintained strict checks on `isSyncing`, `syncInProgressRef`, and `globalSyncLock` to prevent duplicate simultaneous sync jobs.

## Verification Results

### Automated Trace
The following trace can now be observed in the console when a record is pending:
1. `[STORAGE] Retrieved 2 unsynced from native DB`
2. `[SYNC] PENDING DETECTED (2 records) → auto-sync starting...`
3. `[SYNC] Auto-sync event received (source=auto-trigger) — executing syncAllData`
4. `[SYNC] UPLOAD ATTEMPTED [1/2]: OFFICE00000010 (source=native)`
5. `[SYNC] RESPONSE for OFFICE00000010: success=true`
6. `[SYNC] Mark native synced (SUCCESS): OFFICE00000010`
7. `[STORAGE] RESPONSE: Mark synced SUCCESS for OFFICE00000010`
8. `[SYNC] [VERIFY] OFFICE00000010 verified removed from Native DB.`

> [!TIP]
> You can monitor these logs in the Android Studio Logcat by filtering for `OfflineStorage` and `[SYNC]`.

> [!IMPORTANT]
> Automatic sync is disabled when `offlineFirstMode` (online=1) is active, as per project design. Ensure the app is in background sync mode for automatic uploads.
