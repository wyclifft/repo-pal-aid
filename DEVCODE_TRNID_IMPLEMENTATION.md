# Devcode + TrnId Transaction Reference Implementation

## Overview

Each device is uniquely identified by `devcode` and `uniquedevcode`. Transaction references are generated using:

```
transrefno = devcode + padded(trnid, 8)
```

Example: `AG05` + `00000001` = `AG0500000001` (12 chars total)

## Database Schema (devSettings table)

The `devsettings` table must have these columns:
- `devcode` - Device code prefix (e.g., AG05)
- `trnid` - Last used transaction ID for this device (INT, default 0)
- `uniquedevcode` - Device fingerprint (unique identifier)

**Note:** `device_ref` column has been deprecated and removed from all code.

## Reference Generation Flow

### Frontend (Offline Mode)
1. On device authorization, `devcode` and `trnid` are synced from backend
2. `devcode` stored in localStorage for quick access
3. `trnid` stored in IndexedDB for atomic increment
4. Each capture: `reference = devcode + padded(trnid++, 8)`

### Backend (Online Mode)
1. Query transactions table for highest `transrefno` matching `devcode%`
2. Generate next reference: `devcode + padded(next_trnid, 8)`
3. Update `trnid` in `devsettings` ONLY after successful insert

### Duplicate Prevention
- **Retry Logic**: On `ER_DUP_ENTRY`, regenerate reference by querying actual DB state
- **Atomic Increment**: `trnid` only updated after successful transaction insert
- **Row Locking**: `FOR UPDATE` used when querying last reference
- **GREATEST()**: Uses `GREATEST(trnid, new_value)` to never decrement

## API Endpoints Updated

- `GET /api/devices/fingerprint/:fingerprint` - Returns `devcode` and `trnid` (not `device_ref`)
- `POST /api/devices` - No longer generates `device_ref`
- `GET /api/milk-collection/next-reference` - Uses `devcode + trnid`
- `POST /api/milk-collection/reserve-batch` - Uses `devcode + trnid`
- `POST /api/milk-collection` - Updates `trnid` after successful insert

## Sync Logic

When device authorizes or syncs:
1. Backend queries `SELECT trnid FROM devsettings WHERE uniquedevcode = ?`
2. Also queries `MAX(transrefno)` from transactions for fallback
3. Frontend syncs local counter to match backend

## Code Files Modified

- `src/utils/referenceGenerator.ts` - Uses devcode + trnid
- `src/components/Login.tsx` - Stores devcode, syncs trnid
- `src/components/DeviceAuthStatus.tsx` - Stores devcode, syncs trnid
- `src/services/mysqlApi.ts` - Interface uses devcode/trnid instead of device_ref
- `backend-api/server.js` - All endpoints updated

## Migration Notes

If upgrading from device_ref system:
1. Ensure `trnid` column exists in `devsettings` (should already exist)
2. Deploy new backend code
3. Devices will sync new devcode/trnid on next authorization check
