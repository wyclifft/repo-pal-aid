

## Fix: Periodic Report Table Name + Photo Audit Route Filtering — v2.10.33

### Bug 1: `cm_companys` table doesn't exist

**Location**: `backend-api/server.js` line 1201-1203

The periodic report farmer-detail endpoint JOINs `cm_companys` to get the company name, but this table doesn't exist. Since the company name is only used for display and the `ccode` is already available from `devsettings`, the fix is to remove the JOIN entirely and fall back to using `ccode` as the company identifier. This avoids needing to guess the correct table name.

**Fix**: Replace the query at line 1200-1206 with a simpler query that only selects from `devsettings` without the `cm_companys` JOIN. Set `company_name` to `ccode` (or a default string).

### Bug 2: Photo audit viewer shows photos from all routes/centers

**Problem**: The `/api/transaction-photos` endpoint filters by `ccode` only, not by the device's route. Users at one center see photos from all centers in the same company.

**Fix — server-side**: Add `deviceserial` filtering to the photo query. The `transactions` table already stores `deviceserial` (the device fingerprint). Add `AND t.deviceserial = ?` to the WHERE clause, using the same `deviceFingerprint` parameter already passed from the frontend. This ensures strict device isolation consistent with how all other reports work.

**Fix — frontend**: No changes needed — `PhotoAuditViewer` already sends `device_fingerprint` in the query params.

### Version bump

`src/constants/appVersion.ts` → v2.10.33 (Code 55)

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` (line ~1200) | Remove `LEFT JOIN cm_companys` from periodic-report farmer-detail query |
| `backend-api/server.js` (line ~3113) | Add `AND t.deviceserial = ?` to transaction-photos WHERE clause |
| `src/constants/appVersion.ts` | Bump to v2.10.33 |

