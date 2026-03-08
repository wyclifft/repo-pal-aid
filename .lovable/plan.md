

## Filter Cumulative List in Settings by Selected Route/Center

### Problem
The Farmer Sync Dashboard on the Settings page shows cumulative totals for **all** routes/centers. You want it filtered to only show data for the currently selected center (e.g., T001).

### Approach
The selected route is already persisted in `localStorage` under `active_session_data` (includes the full route object with `tcode`). The `FarmerSyncDashboard` just needs to read it and use it for filtering.

### Changes

**1. `src/components/FarmerSyncDashboard.tsx`**
- Read the active route `tcode` from `localStorage` (`active_session_data`)
- Filter the farmer list by route — only show farmers whose `route` matches the selected `tcode`
- Pass route to the batch API call (for future backend filtering)
- Display the active route in the card header

**2. `src/services/mysqlApi.ts`**
- Add optional `route` parameter to `getMonthlyFrequencyBatch` and `getMonthlyFrequency`, appending `&route=...` to the URL

**3. `backend-api/server.js`**
- Accept optional `route` query param in `/api/farmer-monthly-frequency-batch` and `/api/farmer-monthly-frequency` endpoints
- Add `AND TRIM(t.route) = TRIM(?)` to SQL when route is provided

This ensures both the displayed farmer list and the cumulative totals fetched from the server are scoped to the selected center.

### Files Changed
| File | Change |
|------|--------|
| `backend-api/server.js` | Add optional `route` filter to cumulative SQL queries |
| `src/services/mysqlApi.ts` | Add `route?` param to frequency API functions |
| `src/components/FarmerSyncDashboard.tsx` | Read active route from localStorage, filter farmers by route, pass route to API |

