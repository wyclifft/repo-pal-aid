

## Root Cause

The dashboard builds its farmer list from **fm_tanks** (the farmer registration table), then filters by `fm_tanks.route`. But farmer M00003 is **registered** under a different route in fm_tanks (likely T004) while having **transactions** on route T002. The `currqty=1` filter is not the problem here -- the route comparison is.

The batch cumulative API correctly queries the **transactions** table by route, so it finds M00003 on T002. But the dashboard never uses that data to build its display list -- it only uses fm_tanks.

In short: `fm_tanks.route != transactions.route` for some farmers who deliver to multiple centers.

## Fix

When a route is selected, use the **batch cumulative API with route filter** as the primary source for the farmer list (since it queries actual transactions), then merge with fm_tanks data for names/metadata.

### Changes to `src/components/FarmerSyncDashboard.tsx`

1. When a route is active, call the batch API with the route parameter to get farmers who actually delivered to that route
2. Build the display list from batch API results (transaction-based) instead of fm_tanks route filter
3. Look up farmer names from the full fm_tanks list (no route filter on the lookup)
4. Keep the existing no-route behavior unchanged (fm_tanks + currqty=1 filter)

```text
Flow when route selected:
  batch API (with route) → list of farmer_ids with cumulative data
       ↓
  fm_tanks (all, no route filter) → lookup names/metadata
       ↓
  merge → display list of farmers who actually delivered to that route

Flow when no route:
  (unchanged) fm_tanks filtered by currqty=1 → lookup cumulative from IndexedDB
```

### Preview fix
The preview shows a login screen. This is not a code bug -- the preview simply requires authentication. No code changes needed for this; the app works correctly when logged in.

### Files changed
| File | Change |
|------|--------|
| `src/components/FarmerSyncDashboard.tsx` | When route is active, fetch batch API with route param to build farmer list from transactions instead of fm_tanks route |

