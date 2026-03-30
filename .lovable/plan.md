

## Fix: Store transactions.route Using Wrong Value

### Problem

Store transactions save "L001" (or similar default) in the `route` column. The current server code queries `fm_tanks` with `LIMIT 1`, which may return the wrong tcode when multiple store-enabled routes exist, or may fall back to `body.route` (which is `selectedFarmer.route` from `cm_members`, not the user-selected fm_tanks.tcode).

The Store page sends `selectedFarmer.route` (the farmer's member route) as `body.route` — it never sends the Dashboard-selected fm_tanks.tcode.

### Root Cause (Two-Part)

1. **Frontend (`Store.tsx` line 642)**: sends `selectedFarmer.route` (farmer's cm_members.route) as `body.route`, not the Dashboard-selected fm_tanks.tcode
2. **Server (`server.js` line 1700)**: picks `LIMIT 1` from fm_tanks — arbitrary if multiple store routes exist; falls back to `body.route` if tcode is empty

### Fix

**Approach**: Pass the user-selected fm_tanks.tcode from frontend → server, then validate it server-side. This requires a minimal frontend change (reading from localStorage where Dashboard already saves it) and a server-side validation.

#### 1. Frontend: Send selected route tcode (`src/pages/Store.tsx`)

The Dashboard already saves the selected route to localStorage. Store.tsx will read it and send as `route_tcode` in the batch/single request — separate from `body.route` so the farmer route is preserved for other uses.

- Read the Dashboard-selected route tcode from localStorage at component mount
- Add `route_tcode` field to both the batch request and offline sale objects
- Keep `body.route` as `selectedFarmer.route` for backward compatibility

```javascript
// Read Dashboard-selected route tcode
const dashboardSession = JSON.parse(localStorage.getItem('delicoop_session_data') || '{}');
const selectedRouteTcode = dashboardSession?.route?.tcode || '';

// In batch request:
const batchRequest = {
  ...existing fields,
  route_tcode: selectedRouteTcode, // User-selected fm_tanks.tcode
};
```

#### 2. Server: Validate and use route_tcode (`backend-api/server.js`)

In both store endpoints (single-item ~line 1698 and batch ~line 1936):

```javascript
// If frontend sends route_tcode, validate it against fm_tanks for this ccode
let storeRoute = '';
if (body.route_tcode) {
  const [matchedRoute] = await conn.query(
    'SELECT tcode FROM fm_tanks WHERE ccode = ? AND tcode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
    [ccode, body.route_tcode, requiredClientFetch]
  );
  if (matchedRoute.length > 0) {
    storeRoute = matchedRoute[0].tcode.toString().trim();
  }
}
// Fallback: use first available tcode (existing behavior)
if (!storeRoute) {
  storeRoute = (allowedRoutes[0].tcode || '').toString().trim() || (body.route || '');
}
```

This is safe because:
- Old APKs that don't send `route_tcode` fall back to existing `LIMIT 1` behavior
- The server validates `route_tcode` against fm_tanks — no spoofing
- No existing functionality is affected

#### 3. Also fix AIPage.tsx (same issue)

AI page has the same problem at line 440: `route: selectedFarmer.route`. Apply the same localStorage read + `route_tcode` pattern.

#### 4. Version bump

`src/constants/appVersion.ts` → v2.10.11

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Accept `body.route_tcode`, validate against fm_tanks, use if valid (2 locations) |
| `src/pages/Store.tsx` | Read Dashboard route tcode from localStorage, send as `route_tcode` |
| `src/pages/AIPage.tsx` | Same localStorage read + `route_tcode` |
| `src/services/mysqlApi.ts` | Add `route_tcode` to `BatchSaleRequest` and `Sale` interfaces |
| `src/hooks/useSalesSync.ts` | Pass `route_tcode` through in sync payloads |
| `src/constants/appVersion.ts` | Bump to v2.10.11 |

### Safety

- Old APKs without `route_tcode` → existing fallback behavior (no break)
- Server validates `route_tcode` against fm_tanks — can't set arbitrary route
- `body.route` (farmer route) still sent for any legacy use
- No database schema changes needed

