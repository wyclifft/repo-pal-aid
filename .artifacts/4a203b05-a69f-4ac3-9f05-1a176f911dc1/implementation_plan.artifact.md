# Fix Farmer Cumulative Sync Issues

The user reported that "the frontend cannot sync farmer cumulative". Based on research, there are several inconsistencies and bugs in the cumulative synchronization logic between `Index.tsx`, `FarmerSyncDashboard.tsx`, and the backend.

## Findings

1.  **ID Mapping Mismatch**: In `Index.tsx`, the batch pre-fetch logic cleans farmer IDs (stripping `#` prefix) when updating IndexedDB but DOES NOT clean them when putting them into a temporary lookup map (`batchMap`). This causes lookups to fail for farmers with `#` prefixes, resulting in the app seeing "0" from the server and blocking the update due to `ZERO-PENDING` guards.
2.  **Dashboard Sync Incompleteness**: The "Refresh" button in `FarmerSyncDashboard.tsx` dispatches a `syncStart` event but does not actually call the sync logic. It then fetches cumulatives from the server, which may not include just-captured work, and incorrectly resets `localCount` to 0 in IndexedDB, causing the UI to temporarily "lose" weight from unsynced receipts.
3.  **Downward Update Blocking**: `updateFarmerCumulative` blocks backend updates that would lower the local total to protect against stale reads. While correct, `FarmerSyncDashboard` has no mechanism to "heal" these values (unlike `Index.tsx` which has a two-read confirmation pass).
4.  **Redundant API Calls**: `FarmerSyncDashboard` calls the heavy batch cumulative API twice during a manual refresh.

## Proposed Changes

### [Frontend]

#### [MODIFY] [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx)
- Clean farmer IDs when building the `batchMap` in `prefetchCumulatives` to ensure lookups succeed regardless of `#` prefix in the database.

#### [MODIFY] [FarmerSyncDashboard.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/FarmerSyncDashboard.tsx)
- Import and use `useDataSync` to perform a real data sync when the "Refresh" button is clicked.
- Fix ID cleaning consistency.
- Ensure `cumulativeTotal` correctly accounts for unsynced weight by using `getUnsyncedWeightForFarmer` instead of relying on the reset-to-zero `localCount`.

#### [MODIFY] [useIndexedDB.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useIndexedDB.ts)
- Add `SyncDash` to `HEAL_SOURCES` (or similar) to allow the dashboard to participate in reconciliation if we decide to implement two-read confirmation there too. *Actually, let's stick to Index.tsx for healing to keep complexity low, but ensure Dashboard doesn't show misleading data.*

### [Backend]

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- Consider stripping `#` prefix from `memberno` in the batch cumulative endpoint to match frontend expectations, though fixing it in the frontend is safer for backward compatibility.

## Verification Plan

### Automated Tests
- N/A (Unit tests for IndexedDB hooks if available).

### Manual Verification
1.  Open Farmer Sync Dashboard.
2.  Capture a receipt for a farmer with a `#` prefix (if available in test data).
3.  Verify the "Local" weight shows correctly.
4.  Click "Refresh" and verify:
    - Sync starts (receipts are uploaded).
    - Cumulatives are updated.
    - The "Local" weight is merged correctly or cleared after sync.
5.  Check `/debug` console for `CUM:STALE-REJECT` or `CUM:ZERO-PENDING` to ensure mapping is working.
