

## Fix: Photo Audit Filter by Route (tcode) — v2.10.35

### Problem
Photos are filtered by `transrefno LIKE 'devcode%'` which groups by device code prefix. The user wants filtering by the **dashboard-selected route tcode** (e.g., `L001`) using `transactions.route`.

### Changes

**`backend-api/server.js` (line ~3114-3116)**
Replace the `transrefno LIKE devcode%` filter with an optional `route` query parameter:
```javascript
// BEFORE:
let whereClause = '... AND t.transrefno LIKE ?';
const params = [ccode, `${devcode}%`];

// AFTER:
const routeFilter = parsedUrl.query.route || '';
let whereClause = '... AND t.ccode = ?';
const params = [ccode];
if (routeFilter) {
  whereClause += ' AND t.route = ?';
  params.push(routeFilter);
}
```

**`src/components/PhotoAuditViewer.tsx` (line ~49-55)**
Read the selected route tcode from localStorage and pass it as `route` param:
```javascript
// After building URLSearchParams, add:
try {
  const sessionData = JSON.parse(localStorage.getItem('active_session_data') || '{}');
  if (sessionData?.route?.tcode) {
    params.append('route', sessionData.route.tcode);
  }
} catch {}
```

**`src/constants/appVersion.ts`** → v2.10.35 (Code 57)

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` (~line 3114) | Accept `route` param, filter `t.route = ?` instead of `transrefno LIKE devcode%` |
| `src/components/PhotoAuditViewer.tsx` (~line 49) | Read tcode from localStorage, append as `route` query param |
| `src/constants/appVersion.ts` | Bump to v2.10.35 |

