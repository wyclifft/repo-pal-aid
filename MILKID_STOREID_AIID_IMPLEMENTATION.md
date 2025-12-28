# milkID, storeID, aiID Implementation

## Overview

Each transaction now has two identifiers:
1. **transrefno** = devcode + trnid (e.g., `AG0500000042`) - Unique identifier linking physical receipt to database
2. **uploadrefno** = type-specific ID (e.g., `108`) - Sequential number per transaction type for approval workflows

## Database Schema (devsettings table)

Run `backend-api/MIGRATION_ADD_TYPE_IDS.sql` to add new columns:
```sql
ALTER TABLE devsettings 
ADD COLUMN milkid INT DEFAULT 0,
ADD COLUMN storeid INT DEFAULT 0,
ADD COLUMN aiid INT DEFAULT 0;
```

## How It Works

### Transaction Flow

1. **Capture (Frontend)**
   - Generates `transrefno` using devcode + trnid
   - Generates `uploadrefno` using type-specific counter (milkId for milk collections)
   - Both values persist in IndexedDB during offline operation

2. **Submit (Frontend → Backend)**
   - Sends both `reference_no` (transrefno) and `uploadrefno` to backend
   - Backend stores `uploadrefno` in the `Uploadrefno` column of transactions table

3. **Backend Insert**
   - After successful insert, updates BOTH counters:
     - `trnid = GREATEST(trnid, new_value)`
     - `milkid = GREATEST(milkid, new_value)`

4. **Sync (Device Authorization)**
   - On login/authorization, backend returns all counters:
     - `trnid`, `milkid`, `storeid`, `aiid`
   - Frontend syncs using `Math.max(local, backend)` to never go backwards

### Duplicate Prevention

- **transrefno**: Unique index on transactions table prevents duplicates
- **uploadrefno**: Counter only increments, never decrements
- **Offline resilience**: Local counters preserved, synced on reconnect

## Files Modified

### Frontend
- `src/utils/referenceGenerator.ts` - Added type-specific ID functions
- `src/lib/supabase.ts` - Added `uploadrefno` to MilkCollection interface
- `src/services/mysqlApi.ts` - Added `uploadrefno` to API calls and interface
- `src/pages/Index.tsx` - Uses `generateReferenceWithUploadRef('milk')`
- `src/components/Login.tsx` - Syncs milkid/storeid/aiid counters
- `src/components/DeviceAuthStatus.tsx` - Syncs milkid/storeid/aiid counters
- `src/hooks/useDataSync.ts` - Includes `uploadrefno` in offline sync

### Backend
- `backend-api/server.js` - INSERT includes Uploadrefno, device endpoint returns new IDs
- `backend-api/MIGRATION_ADD_TYPE_IDS.sql` - Schema migration

## API Changes

### GET /api/devices/fingerprint/:fingerprint
Returns additional fields:
```json
{
  "devcode": "AG05",
  "trnid": 42,
  "milkid": 108,
  "storeid": 0,
  "aiid": 0
}
```

### POST /api/milk-collection
Accepts optional `uploadrefno` and returns it in response:
```json
{
  "success": true,
  "reference_no": "AG0500000042",
  "uploadrefno": 108
}
```

## Offline Behavior

1. Device goes offline with counters: trnid=42, milkid=108
2. User captures milk collection → generates trnid=43, milkid=109
3. User captures another → generates trnid=44, milkid=110
4. Device comes online
5. Sync: Backend receives transactions with their milkId values
6. Backend updates counters after successful inserts
7. Frontend syncs counters using `Math.max()` - never loses progress

## Future: Store and AI Transactions

Same pattern applies:
- Store transactions: Use `generateReferenceWithUploadRef('store')`
- AI transactions: Use `generateReferenceWithUploadRef('ai')`
