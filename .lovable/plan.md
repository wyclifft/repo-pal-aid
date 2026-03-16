

## Fix: clientFetch Not Available Offline

### Root Cause
`clientFetch` is fetched from the routes API (`/api/routes/by-device/:fingerprint`) on Store page load. When offline, this API call fails (line 239), and `clientFetch` stays `undefined`. The reference generator then produces `BB0100000004` instead of `BB01200000004`.

### Fix

**File: `src/pages/Store.tsx`** (2 changes)

1. **Persist clientFetch to localStorage** when successfully fetched from the API (line 226-228):
```javascript
if (storeRoute?.clientFetch) {
  setClientFetch(storeRoute.clientFetch);
  localStorage.setItem('store_clientFetch', String(storeRoute.clientFetch));
}
```

2. **Restore clientFetch from localStorage** when the API call fails (offline) in the catch block (line 239-241):
```javascript
} catch (err) {
  setHasRoutes(true);
  setStoreEnabled(true);
  // Restore clientFetch from cache for offline use
  const cached = localStorage.getItem('store_clientFetch');
  if (cached) setClientFetch(parseInt(cached, 10));
}
```

Also restore on the 404 fallback path (line 205-207) where clientFetch is never set.

**File: `src/constants/appVersion.ts`** — Version bump

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Cache `clientFetch` to localStorage on fetch; restore from cache when offline |
| `src/constants/appVersion.ts` | Version bump |

