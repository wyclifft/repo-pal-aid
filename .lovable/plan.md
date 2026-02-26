

# Improving Cumulative Sync Reliability

## Current State

The cumulative sync has these weak points:
1. **10-minute periodic refresh** -- external transactions (manual entries) can take up to 10 minutes to appear
2. **No refresh after each capture** -- after submitting a transaction, the cumulative only updates from local cache, not from the server
3. **Refresh button in FarmerSyncDashboard** dispatches `syncStart` but doesn't explicitly trigger a cumulative re-fetch from the batch API
4. **No event-driven refresh** when the app returns to foreground (visibility change)

## Proposed Improvements

### 1. Reduce periodic refresh interval (server.js -- no change needed, frontend only)
- Change the 10-minute interval to **3 minutes** in `Index.tsx` so external transactions are picked up faster

### 2. Refresh cumulative after each capture
- In `Index.tsx`, after a successful milk collection submission, dispatch a `syncComplete` event (or call the refresh directly) so the cumulative cache updates immediately from the server batch API

### 3. Refresh on app visibility change
- In `Index.tsx`, add a `visibilitychange` listener that triggers a cumulative refresh when the app returns to the foreground -- this catches external transactions entered while the app was backgrounded

### 4. Enhance the FarmerSyncDashboard Refresh button
- After syncing offline receipts and reloading local data, also call the batch API to update IndexedDB cumulative values so the dashboard shows server-accurate numbers

### 5. Refresh cumulative on `syncStart` event too
- Currently only `syncComplete` triggers a refresh. Adding `syncStart` listener ensures pre-sync state is also updated

---

## Technical Details

### File: `src/pages/Index.tsx`

**Change 1 -- Reduce periodic interval** (line ~250):
- Change `10 * 60 * 1000` to `3 * 60 * 1000`

**Change 2 -- Add visibility change listener** (inside the same `useEffect` block, lines ~245-259):
- Add a `visibilitychange` handler that calls `refreshCumulativesBatch('visibility')` when `document.visibilityState === 'visible'`

**Change 3 -- Post-capture refresh** (find the capture success handler):
- After a successful capture, call `refreshCumulativesBatch` or dispatch `syncComplete` to trigger the existing listener

### File: `src/components/FarmerSyncDashboard.tsx`

**Change 4 -- Refresh button calls batch API** (inside `loadData`, after syncing offline receipts):
- After the existing `syncStart` dispatch + wait, call `mysqlApi.farmerFrequency.getMonthlyFrequencyBatch` and write results to IndexedDB via `updateFarmerCumulative`, so the dashboard entries reflect actual server state
- Import `mysqlApi` and `useIndexedDB`'s `updateFarmerCumulative`

### File: `backend-api/server.js`
- No changes needed -- the batch endpoint already uses the correct `BETWEEN sessions.datefrom AND sessions.dateto` logic with `TRIM()` and `CAST()`

### Safety
- All changes are additive (new event listeners, shorter interval, extra API call on refresh)
- No existing logic is modified or removed
- Offline behavior unaffected -- all new refreshes check `navigator.onLine` first
- The `__cumulativeSyncRunning` guard prevents duplicate concurrent fetches

