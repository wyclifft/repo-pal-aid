

## Fix: Company Name from psettings + Photo Filter by Route — v2.10.34

### Change 1: Use `psettings.cname` for company name in periodic report

**Location**: `backend-api/server.js` line ~1200-1213

Currently the query only selects from `devsettings` and falls back to `ccode` as the company name. Other endpoints (e.g. Z-report at line 1396) already JOIN `psettings` to get `cname`.

**Fix**: Change the device lookup query to JOIN `psettings` on `ccode` and select `p.cname as company_name`, matching the pattern used by the Z-report endpoint. Fall back to `ccode` only if `cname` is null.

### Change 2: Filter audit photos by `devcode` (route/center) instead of `deviceserial`

**Location**: `backend-api/server.js` line ~3100-3111

Currently photos are filtered by `t.deviceserial = ?` (the device fingerprint), which is too strict — it excludes photos from other devices at the same center. The correct filter is by `devcode`, which represents the center/route and is the prefix of every `transrefno`.

**Fix**:
- After looking up the device, also fetch `devcode` from `devsettings`
- Replace `AND t.deviceserial = ?` with `AND t.transrefno LIKE ?` using `${devcode}%` pattern
- This shows all photos from the same center/route regardless of which device captured them

### Version bump

`src/constants/appVersion.ts` → v2.10.34 (Code 56)

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` (~line 1200) | JOIN `psettings` to get `cname` for periodic report company name |
| `backend-api/server.js` (~line 3100) | Replace `deviceserial` filter with `devcode`-based `transrefno LIKE` filter |
| `src/constants/appVersion.ts` | Bump to v2.10.34 |

