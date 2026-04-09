

## Fix: Photo Audit Filter by Transaction Route (tcode) — v2.10.35

### Problem

Photo audit currently filters by `transrefno LIKE 'devcode%'` (e.g., `BA01%`), which groups by the device's code prefix. The user wants filtering by the **dashboard-selected route tcode** (e.g., `L001`) using the `transactions.route` column, so only photos from that specific center appear.

### Changes

**`src/components/PhotoAuditViewer.tsx`**
- Read the dashboard-selected route tcode from `localStorage` (`active_session_data.route.tcode`)
- Pass it as a new `route` query parameter to the API

**`backend-api/server.js` (~line 3096-3116)**
- Accept new `route` query parameter
- Replace `AND t.transrefno LIKE ?` with `AND t.route = ?` using the provided route tcode
- Keep `ccode` filter for company isolation; drop `devcode` prefix filter

**`src/constants/appVersion.ts`** → v2.10.35 (Code 57)

### Files Changed

| File | Change |
|------|--------|
| `src/components/PhotoAuditViewer.tsx` | Read selected tcode from localStorage, send as `route` param |
| `backend-api/server.js` (~line 3115) | Replace `transrefno LIKE devcode%` with `t.route = ?` |
| `src/constants/appVersion.ts` | Bump to v2.10.35 |

