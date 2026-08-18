# Fix Stuck Pending Sync Walkthrough

Refactored the synchronization logic to resolve the "Stuck Pending" loop where receipts would remain in the local database even after successful server processing.

### 1. Trust-First Sync Policy (`useDataSync.ts`)
- **Issue**: The sync engine was performing a mandatory `getByReference` check *after* every successful record creation. If the server was busy or the read-replica hadn't updated yet, this check would fail, marking the sync as "failed" and keeping the record in the pending list.
- **Fix**: The engine now treats a primary `success: true` response from the server as authoritative. The secondary verification check is now **diagnostic only** and does not block the cleanup of the local row.

### 2. Non-Blocking Auxiliary Refreshes
- **Issue**: Previously, if the cumulative weight refresh (`getMonthlyFrequency`) failed due to high load or network timeout, the entire sync for that record would be rolled back to "Pending".
- **Fix**: Cumulative refresh is now treated as an **optional auxiliary task**. If it fails, the app logs a warning but continues with the local record cleanup. The UI will eventually catch up during the next background batch refresh.

### 3. Robust Idempotency
- **Optimized Branching**: Responses indicating a record "already exists" are now always treated as successful syncs. This ensures that even if a previous attempt was interrupted mid-response, the subsequent retry will correctly clear the local row.

### 4. Verification Results
- **Success Path**: Primary server success → Local record deleted → Count dropped.
- **Idempotent Path**: Server says "already exists" → Local record deleted → Count dropped.
- **Error Path**: Server busy/unreachable → Record kept for retry.
- **Build Status**: Production build successfully verified.
