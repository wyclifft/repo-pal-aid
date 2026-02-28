# App Bug Audit and Improvement Plan

## Critical Bugs Found

### 1. Hardcoded stale version in Dashboard "About" button

**File:** `src/components/Dashboard.tsx` (line 409)
The About button shows `"Milk Collection App v1.5"` -- this is hardcoded and out of date (actual version is 2.5). Should read the version dynamically from `build.gradle` or a shared constant.

**Fix:** Create a shared `APP_VERSION` constant and use it in both Dashboard and `build.gradle`.

### 2. Memory leak: IndexedDB cleanup closes shared singleton

**File:** `src/hooks/useIndexedDB.ts` (lines 158-163)
The `useEffect` cleanup calls `dbInstance.close()` and nullifies the singleton. Since multiple components use `useIndexedDB()`, unmounting one component closes the DB for ALL other components, causing "InvalidStateError: database connection is closing" crashes.

**Fix:** Remove the cleanup function entirely -- the `dbInstance` singleton should live for the app lifetime. Only close on full app teardown.

### 3. `saveSale` uses `await store.put()` incorrectly

**File:** `src/hooks/useIndexedDB.ts` (line 393)
`store.put()` returns an `IDBRequest`, not a `Promise`. Using `await` on it won't actually wait for the operation to complete. The sale may silently fail without error handling.

**Fix:** Wrap in a proper Promise like `saveReceipt` does.

### 4. `useEffect` dependency array issue in `useAppSettings`

**File:** `src/hooks/useAppSettings.ts` (line ~237)  
The splash timeout `useEffect` in `App.tsx` (line 237) references `showSplash` in the callback but not in the dependency array, causing the timeout to potentially fire with a stale `showSplash` value.

### 5. Excessive debug logging in production

**File:** `src/pages/Index.tsx` (lines 1419, 1458)
`console.log('📋 Dashboard - User supervisor value:...')` runs on EVERY render of the Index component (it's outside `useEffect`). Since `getCaptureMode` is called in the render body, this logs on every single re-render, flooding the console and slowing down the app.

**Fix:** Move inside `useMemo` or remove.

### 6. `useSessionBlacklist` makes N sequential API calls

**File:** `src/hooks/useSessionBlacklist.ts` (lines 83-99)
For each `multOpt=0` farmer, the code makes a sequential API call (`for...of` loop with `await`). With many farmers, this blocks the UI thread for seconds.

**Fix:** Batch the API calls using `Promise.all` with a concurrency limit, or use a single batch endpoint.

---

## Potential Crash Causes

### 7. Non-null assertion on `activeSession` when rendering collection screens

**File:** `src/pages/Index.tsx` (lines 1484, 1521)
`session={activeSession!}` uses non-null assertion. If `activeSession` is null (e.g., session expires between render cycles), this passes `null` to child components that don't guard against it, potentially causing crashes.

**Fix:** Add a null guard: return to dashboard if `activeSession` is null.

### 8. `saveZReport` and `savePeriodicReport` use `await store.put()` incorrectly

**File:** `src/hooks/useIndexedDB.ts` (lines 476, 510)
Same issue as `saveSale` -- `store.put()` returns `IDBRequest`, not a Promise.

### 9. No error boundary around lazy-loaded pages

**File:** `src/App.tsx` (lines 157-167)
If a lazy-loaded page fails to load (chunk error), the `Suspense` fallback shows but no recovery mechanism exists beyond the global `ErrorBoundary`. The chunk error handler in line 261 tries to reload, but this creates an infinite reload loop if the chunk is persistently unavailable (e.g., new deployment with cache mismatch).

**Fix:** Add retry logic with a max-attempt counter stored in `sessionStorage`.

---

## Improvements Needed

### 10. `useDataSync` `syncAllData` dependency array is incomplete

**File:** `src/hooks/useDataSync.ts` (line 542)
`syncAllData` depends on `syncOfflineReceipts` but the memo doesn't list it, which could lead to stale closures.

### 11. `currentUser` accessed without null check in capture

**File:** `src/pages/Index.tsx` (line 698)
`getCaptureMode(currentUser?.supervisor)` is safe, but `currentUser?.user_id || 'unknown'` at line 793 could mean receipts get saved with `user_id: 'unknown'`, which would be hard to trace in the database.

### 12. Dashboard renders inside conditional without early return

**File:** `src/pages/Index.tsx` (lines 1414-1451)
The `if (!showCollection)` block doesn't use `return` consistently -- the `return` is inside a block that's easy to accidentally break with future edits. The pattern `if (!showCollection) { ... return (...); }` is fragile.

---

## Implementation Plan

### Phase 1: Critical Bug Fixes

1. **Fix IndexedDB singleton cleanup** -- remove the `useEffect` cleanup that closes the shared `dbInstance` in `useIndexedDB.ts`
2. **Fix `saveSale`/`saveZReport`/`savePeriodicReport**` -- wrap `store.put()` in proper Promises
3. **Add null guard for `activeSession**` -- check before rendering collection screens in `Index.tsx`
4. **Remove render-time console.log calls** -- move debug logging out of the render path in `Index.tsx`

### Phase 2: Stability Improvements

5. **Fix stale version string** -- create `APP_VERSION` constant, use in Dashboard About button
6. **Add chunk load retry counter** -- prevent infinite reload loops in `App.tsx`
7. **Batch blacklist API calls** -- use `Promise.all` with concurrency limit in `useSessionBlacklist.ts`
8. `If no coffee/milk type is selected and there is one to be selected disable new session/season button`

### Phase 3: Version Bump

8. **Update version** to 2.6 (versionCode 17) in `android/app/build.gradle`

---

## Files to Modify


| File                               | Changes                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `src/hooks/useIndexedDB.ts`        | Remove singleton cleanup, fix `saveSale`/`saveZReport`/`savePeriodicReport`             |
| `src/pages/Index.tsx`              | Add `activeSession` null guard, remove render-time logging, add shared version constant |
| `src/components/Dashboard.tsx`     | Use dynamic version string                                                              |
| `src/App.tsx`                      | Add chunk reload retry counter                                                          |
| `src/hooks/useSessionBlacklist.ts` | Batch API calls                                                                         |
| `android/app/build.gradle`         | Version bump to 2.6                                                                     |
