

## Bug Report — 10 Bugs Found in Codebase

### Bug 1: DB_VERSION mismatch in referenceGenerator.ts
**File:** `src/utils/referenceGenerator.ts` line 27
**Issue:** `DB_VERSION` is hardcoded to `10`, but `useIndexedDB.ts` uses version `11`. When `referenceGenerator.ts` opens the DB with version 10, it will fail if the DB was already opened at version 11 (or silently open the old version without the latest stores). This can cause `device_config` reads/writes to fail intermittently.
**Fix:** Change `DB_VERSION = 10` → `DB_VERSION = 11` (or ideally import from a shared constant).

---

### Bug 2: FarmerSearch 5-min poll bypasses route/mprefix filtering
**File:** `src/components/FarmerSearch.tsx` lines 168-188
**Issue:** The 5-minute polling interval calls `mysqlApi.farmers.getByDevice(deviceFingerprint)` without any route or mprefix parameters, then calls `saveFarmers(response.data)` which clears the farmer store and writes ALL farmers. This overwrites route-filtered data, so the next time the user opens search, they may see farmers from other routes until the cache-load effect re-filters.
**Fix:** Pass `routeParam` and `mprefixParam` to the poll call, or skip the `saveFarmers` call in the poll and only update in the main sync effect.

---

### Bug 3: Credentials stored in plain text in localStorage
**File:** `src/contexts/AuthContext.tsx` line 75
**Issue:** Raw password is stored in `localStorage` under `cachedCredentials`. localStorage is not encrypted on web and is accessible to any JS on the page. On Capacitor/Android this is slightly better but still not ideal. This is a security risk.
**Fix:** Hash the password before storing, or use a compare-hash approach for offline login validation.

---

### Bug 4: `onFarmersLoaded` in useEffect dependency causes infinite re-render loop
**File:** `src/components/FarmerSearch.tsx` line 66
**Issue:** `onFarmersLoaded` is a callback prop that is likely not memoized by every parent. Including it in the dependency array of `useEffect` (line 38-66) causes the effect to re-run every render if the parent doesn't wrap `onFarmersLoaded` in `useCallback`. This triggers repeated IndexedDB reads and potentially infinite state loops.
**Fix:** Remove `onFarmersLoaded` from the dependency array, or use a ref to store the latest callback.

---

### Bug 5: `saveFarmers` clears store then writes — no atomicity guarantee
**File:** `src/hooks/useIndexedDB.ts` lines 208-216
**Issue:** `store.clear()` followed by `forEach(put)` in the same transaction is technically atomic (IDB transactions are all-or-nothing), BUT if the app crashes or the tab closes between clear and the last put, the transaction may be partially committed in some browser implementations. More critically, if `saveFarmers` is called with a subset of farmers (route-filtered), it wipes ALL farmers and saves only the filtered subset — destroying farmers from other routes.
**Fix:** Only clear+write when saving the full unfiltered dataset. The 5-min poll (Bug 2) and the main sync both call `saveFarmers` which clears all data even when saving partial data.

---

### Bug 6: `Ban` import unused
**File:** `src/components/FarmerSearch.tsx` line 7
**Issue:** `Ban` is imported from `lucide-react` but never used in the component. Minor but adds to bundle size.
**Fix:** Remove the unused import.

---

### Bug 7: Password visible in `.htaccess` committed to repo
**File:** `backend-api/.htaccess` line 9
**Issue:** The MySQL password `0741899183Mutee` is hardcoded in the `.htaccess` file committed to version control. This is a critical security vulnerability — anyone with repo access has full database credentials.
**Fix:** Use environment variables set at the server level, not in committed files. Add `backend-api/.htaccess` to `.gitignore` or use a template.

---

### Bug 8: `saveRoutes` and `saveSessions` accumulate stale data
**File:** `src/hooks/useIndexedDB.ts` lines 698-708, 733-743
**Issue:** Unlike `saveFarmers` which clears before writing, `saveRoutes` and `saveSessions` only do `store.put()` without clearing old entries. If a route or session is deleted/renamed on the backend, the old entry persists forever in IndexedDB, leading to phantom routes/sessions appearing in offline mode.
**Fix:** Add `store.clear()` before writing fresh data (with the same empty-array guard as `saveFarmers`).

---

### Bug 9: `saveItems` accumulates stale items
**File:** `src/hooks/useIndexedDB.ts` lines 503-509
**Issue:** Same as Bug 8 — `saveItems` only does `store.put()` without clearing. Deleted or deactivated items persist in the offline cache indefinitely, allowing users to select items that no longer exist.
**Fix:** Clear before writing, with an empty-array guard.

---

### Bug 10: PhotoAuditViewer `fetchPhotos` not triggered on search button when page is 1
**File:** `src/components/PhotoAuditViewer.tsx` lines 95-104
**Issue:** The `useEffect` on line 95 triggers `fetchPhotos` when `currentPage` changes. The search button resets `currentPage` to 1 (line 103). If the page is already 1, setting it to 1 again is a no-op — the effect doesn't re-fire, and the search with the new query is never executed. The "Search" button (line 170) calls `fetchPhotos` directly so that path works, but typing + Enter on the search input only calls `fetchPhotos` directly too. The real issue is that the `searchQuery` dependency is in the page-reset effect but NOT in the fetch effect — so changing the search query resets the page but doesn't trigger a re-fetch if already on page 1.
**Fix:** Add `searchQuery` to the fetch effect's dependency array, or trigger `fetchPhotos` explicitly when `searchQuery` changes.

---

### Summary

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | **High** | referenceGenerator.ts | DB_VERSION mismatch (10 vs 11) |
| 2 | **High** | FarmerSearch.tsx | 5-min poll overwrites route-filtered farmers |
| 3 | **Critical** | AuthContext.tsx | Plain-text password in localStorage |
| 4 | **Medium** | FarmerSearch.tsx | `onFarmersLoaded` causes potential infinite loop |
| 5 | **High** | useIndexedDB.ts | `saveFarmers` clears ALL farmers even for partial saves |
| 6 | **Low** | FarmerSearch.tsx | Unused `Ban` import |
| 7 | **Critical** | .htaccess | Database password committed to repo |
| 8 | **Medium** | useIndexedDB.ts | Stale routes/sessions never cleared |
| 9 | **Medium** | useIndexedDB.ts | Stale items never cleared |
| 10 | **Medium** | PhotoAuditViewer.tsx | Search doesn't re-fetch when already on page 1 |

### Recommended Fix Priority
1. Bug 7 (security — password in repo)
2. Bug 3 (security — plain-text password)
3. Bug 1 (DB version mismatch — causes reference generation failures)
4. Bug 2 + 5 (farmer cache corruption)
5. Bug 4 (infinite loop risk)
6. Bugs 8, 9, 10 (stale data + UX)
7. Bug 6 (cleanup)

### Files to Modify
- `src/utils/referenceGenerator.ts` — fix DB_VERSION
- `src/components/FarmerSearch.tsx` — fix poll, dependency array, unused import
- `src/contexts/AuthContext.tsx` — hash password before caching
- `src/hooks/useIndexedDB.ts` — add clear() to saveRoutes/saveSessions/saveItems
- `src/components/PhotoAuditViewer.tsx` — fix search re-fetch
- `backend-api/.htaccess` — remove hardcoded credentials
- `src/constants/appVersion.ts` — bump to v2.10.37 (Code 59)

