

## Fix: Cached Members Disappearing When Offline — v2.10.36

### Root Causes

**1. API failure clears farmers even when offline (line 142-153)**
When `FarmerSearch` mounts while online and the API call fails (timeout, server error), `!response.success` triggers `saveFarmers([])` and `setCachedFarmers([])` — wiping IndexedDB and UI state. Even the `else` branch at line 152 sets `setCachedFarmers([])` when the API returns empty data. If the user then goes offline, the cache is already gone.

**2. Sync effect runs before cache-load effect completes**
Both effects run on mount. The sync effect (line 96) checks `navigator.onLine` — if the device is in a flaky connectivity state (common on Capacitor), it may attempt the API call, fail, and clear farmers before the IndexedDB load (line 38) has populated the UI.

**3. `saveFarmers` never clears old entries**
`saveFarmers` only does `store.put()` — it never removes farmers. This means stale entries accumulate. But critically, when `saveFarmers([])` is called (on error), it does nothing (empty forEach), so the IndexedDB data survives. However `setCachedFarmers([])` wipes the **in-memory** state, making farmers invisible until the component remounts.

**4. No guard against empty array saves in other files**
`PeriodicReport.tsx` and `useDataSync.ts` also call `saveFarmers([])` on certain error paths.

### Changes

**`src/components/FarmerSearch.tsx`**
- On API failure (`!response.success` that is NOT a 401 auth error): keep existing cached farmers, don't call `saveFarmers([])` or `setCachedFarmers([])`
- On the `else` branch (API success but empty data): don't clear cached farmers — keep what's in IndexedDB
- On `catch`: keep cached farmers (already does this, but add explicit IndexedDB fallback)
- Ensure IndexedDB load runs and completes before any API result can overwrite state

**`src/hooks/useIndexedDB.ts`**
- Add guard in `saveFarmers`: skip if array is empty — prevents accidental wipe from any caller

**`src/pages/PeriodicReport.tsx`**
- Remove `saveFarmers([])` call on report authorization error — report errors should not wipe farmer cache

**`src/hooks/useDataSync.ts`**
- Add guard: don't call `saveFarmers` with empty array during sync

**`src/constants/appVersion.ts`** → v2.10.36 (Code 58)

### Files Changed

| File | Change |
|------|--------|
| `src/components/FarmerSearch.tsx` | Only clear farmers on explicit 401 auth errors; keep cache on all other failures |
| `src/hooks/useIndexedDB.ts` | Guard `saveFarmers` against empty arrays |
| `src/pages/PeriodicReport.tsx` | Remove `saveFarmers([])` on report error |
| `src/hooks/useDataSync.ts` | Guard against saving empty farmers |
| `src/constants/appVersion.ts` | Bump to v2.10.36 (Code 58) |

