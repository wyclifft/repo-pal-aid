

## Fix: Route Filtering Fails Due to Trailing Whitespace in `tcode`

### Root Cause
The backend returns `tcode` with trailing whitespace (e.g., `"T001      "`). When stored in `selectedRouteCode` or `activeRoute`, comparisons against farmer `route` fields (which are trimmed, e.g., `"T001"`) fail because `"T001      " !== "T001"`.

This causes:
1. **FarmerSyncDashboard**: `f.route === activeRoute` always fails when route is selected → shows 0 farmers
2. **Index.tsx `selectedRouteCode`**: Stored untrimmed, passed to backend APIs (which handle it) but local comparisons in `getUnsyncedWeightForFarmer` already use `.trim()` so that part works
3. **Cumulative on receipts**: The batch API call passes untrimmed route, but local unsynced weight filtering uses trimmed comparison — the mismatch between stored `selectedRouteCode` and farmer routes causes inconsistent results

### Fix
Trim `tcode` at the two entry points where it enters app state:

**`src/pages/Index.tsx`** (line 598): Trim on store
```typescript
setSelectedRouteCode(selectedRoute.tcode.trim());
```

**`src/components/FarmerSyncDashboard.tsx`** (line 30-31): Trim in `getActiveRoute` and trim in the filter comparison
```typescript
// getActiveRoute: trim the return value
return (parsed?.route?.tcode || '').trim();

// Line 131: use trimmed comparison
filteredFarmers = filteredFarmers.filter((f: Farmer) => f.route.trim() === activeRoute);
```

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Trim `selectedRoute.tcode` on line 598 |
| `src/components/FarmerSyncDashboard.tsx` | Trim `tcode` in `getActiveRoute()`; trim `f.route` in filter comparison |

### No version bump needed — this is a bugfix within 2.8.4.

