

## Transaction-Driven Farmer Sync Dashboard

### Problem
The dashboard currently fetches ALL farmers from cm_members (via `fetchFarmerList`), then tries to match them against transactions. This causes farmers who transacted on a route different from their registration route to be missed, and loads unnecessary data.

### Current State
The code already uses the batch cumulative API (transaction-based) as the **primary** source when a route is selected (lines 125-208). However, it still:
1. Fetches the full cm_members list (`fetchFarmerList`) every time, even when the batch API already provides the farmer list
2. Falls back to cm_members filtering when offline or no route is selected
3. Merges cm_members route-registered farmers back in (lines 171-193), which re-introduces the registration-based logic

### Design
Make the batch cumulative API the **sole driver** of the farmer list. cm_members is only used as a name lookup, never for filtering.

### Changes: `src/components/FarmerSyncDashboard.tsx`

**1. Simplify the route-selected path (lines 113-208)**
- Remove `fetchFarmerList()` from the main flow when online and a route is selected
- Use only the batch API results as the farmer list
- For name resolution: fetch cm_members lazily as a lookup map only (no filtering)
- Remove the "merge fm_tanks registered farmers" block (lines 171-193) -- if they have no transactions on this route, they should not appear

**2. Simplify the no-route path (lines 210-264)**
- When no route is selected but online: call the batch API without a route parameter (returns all farmers with transactions for this device's ccode)
- Use batch results directly instead of filtering cm_members by `currqty === 1`
- Still use cm_members as a name lookup

**3. Offline fallback (keep existing)**
- When offline, use IndexedDB cached farmers + cumulative data (unchanged)
- This is the only path that relies on cm_members data

**4. Remove `fetchFarmerList` from the critical path**
- Only call it once for building the name lookup map, not for determining which farmers to show
- The batch API determines the farmer list; cm_members provides display names

### Simplified Flow

```text
Online + Route selected:
  batchAPI(route) → farmer list with cumulative data
  cm_members → name lookup only
  Display: farmers from batch API

Online + No route:
  batchAPI(no route) → all farmers with transactions
  cm_members → name lookup only  
  Display: farmers from batch API

Offline:
  IndexedDB farmers + cumulative cache (unchanged)
```

### Technical Detail

The key change in `loadData`:
- Move the batch API call to be the **first and primary** data source for both route and no-route online paths
- The cm_members fetch becomes optional (for names only)
- Remove the `currqty === 1` filter entirely from the online path since it's irrelevant when using transaction data
- Remove the fm_tanks merge-back block since it contradicts the transaction-driven approach

| File | Change |
|------|--------|
| `src/components/FarmerSyncDashboard.tsx` | Restructure `loadData` to use batch API as sole farmer source (online); cm_members only for name lookup; remove currqty filter and fm_tanks merge |
| `src/constants/appVersion.ts` | Version bump |

