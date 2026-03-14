

## Two Issues: Cumulative Race Condition + Dashboard Route Filter

### Root Cause Analysis

**Issue 1: Cumulative shows 4 instead of 6 when switching back to T001**

After online submit, the code immediately fetches cumulative from the server API. But the SELECT can execute before the just-committed INSERT is fully visible (MySQL connection pool race condition -- the INSERT and SELECT may use different pool connections). Since the receipt was submitted online (not saved to IndexedDB), `getUnsyncedWeightForFarmer` returns 0. Result: stale server total (4) + 0 unsynced = 4 instead of 6.

**Issue 2: M03550 not appearing under T002 in FarmerSyncDashboard**

The batch cumulative API correctly queries transactions by route. But if M03550's T002 transactions were just submitted, they may not appear in the batch results due to the same race condition. Additionally, the dashboard only shows farmers returned by the batch API -- it doesn't merge in farmers registered on the route from fm_tanks. If the batch returns fewer results, some farmers are invisible.

### Fix

**File: `src/pages/Index.tsx`**

After successful online submission, compute the "just-submitted weight" from `capturedCollections` and add it as a floor guarantee to the cumulative calculation. This handles the race condition where the server hasn't yet reflected the INSERT.

In both cumulative computation paths (printCopies=0 at ~line 1152, and printCopies>0 at ~line 1217):

1. Calculate `justSubmittedWeight` from `capturedCollections` (sum of weights for the farmer, filtered by route and product)
2. After fetching `cloudCumulative` from the API, ensure the displayed cumulative is at least `cloudCumulative + justSubmittedWeight` when the cloud total doesn't yet include the just-submitted data
3. Build `justSubmittedByProduct` from captures to merge into the by-product breakdown

The logic: if `cloudCumulative` already includes the new weight (cloud >= previousCloud + justSubmitted), use cloud value. If not (race condition), add `justSubmittedWeight` to cloud value.

Simplified approach: always add captures that were successfully submitted online but not yet reflected in the cloud total. Since we know the previous cloud value (from `cumulativeFrequency` state set when farmer was selected), we can detect if the new cloud total includes the submitted weight.

**File: `src/components/FarmerSyncDashboard.tsx`**

After fetching the batch API results for a route, also merge in farmers from fm_tanks who are registered on that route (with currqty=1) but NOT already in the batch results. This ensures the dashboard shows a complete list: farmers with actual transactions on the route PLUS farmers registered on the route.

### Changes Summary

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add just-submitted weight to cumulative when cloud total hasn't caught up (race condition fix) |
| `src/components/FarmerSyncDashboard.tsx` | Merge fm_tanks route-registered farmers into batch API results for complete dashboard |

