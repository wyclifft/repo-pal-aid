# Transactions Table Migration

## Summary
Updated the milk collection system to save receipts to the existing `transactions` table instead of the `milk_collection` table.

## Changes Made

### 1. Backend Changes (server.js)

#### POST `/api/milk-collection`
- Now inserts into `transactions` table with field mapping:
  - `transrefno` ← reference_no
  - `userId` ← clerk_name
  - `clerk` ← clerk_name
  - `deviceserial` ← device_fingerprint
  - `memberno` ← farmer_id
  - `route` ← route
  - `weight` ← weight
  - `session` ← session
  - `transdate` ← collection_date (date part: YYYY-MM-DD)
  - `transtime` ← collection_date (time part: HH:MM:SS)
  - `time` ← Unix timestamp
  - `Transtype` ← 'MILK' (hardcoded)
  - `processed` ← 0 (default)
  - `uploaded` ← 0 (default)
  - `ccode` ← '' (empty)
  - `ivat` ← 0 (default)
  - `iprice` ← 0 (default)
  - `amount` ← 0 (default)
  - `icode` ← '' (empty)
  - `capType` ← 0 (default)

#### GET `/api/milk-collection`
- Reads from `transactions` table
- Maps fields back to expected format for frontend compatibility

#### PUT `/api/milk-collection/:ref`
- Updates `transactions` table using `transrefno`

#### DELETE `/api/milk-collection/:ref`
- Deletes from `transactions` table using `transrefno`

### 2. Z-Report Changes
- Now reads from `transactions` table
- Filters by `Transtype = 'MILK'`
- Maps fields appropriately for report generation

### 3. Frontend Changes

#### Index.tsx
- Added device fingerprint generation on save
- Passes `device_fingerprint` to API when creating collections

#### ReceiptList.tsx
- Added device fingerprint generation during sync
- Includes `device_fingerprint` when syncing offline receipts

## Field Mapping Reference

| Frontend/API Field | Transactions Table Column | Type | Notes |
|-------------------|---------------------------|------|-------|
| reference_no | transrefno | varchar(50) | Transaction reference |
| clerk_name | userId + clerk | varchar | Both set to same value |
| device_fingerprint | deviceserial | varchar(100) | Device identifier |
| farmer_id | memberno | varchar(30) | Farmer member number |
| route | route | varchar(20) | Route code |
| weight | weight | float(18,2) | Weight in Kg |
| session | session | varchar(10) | AM or PM |
| collection_date | transdate | varchar(20) | Date (YYYY-MM-DD) |
| collection_date | transtime | varchar(20) | Time (HH:MM:SS) |
| collection_date | time | bigint(11) | Unix timestamp |
| - | Transtype | varchar(20) | Always 'MILK' |
| - | processed | tinyint(4) | Always 0 |
| - | uploaded | tinyint(4) | Always 0 |

## Testing Checklist

- [x] Backend API updated to use `transactions` table
- [x] Field mapping implemented correctly
- [x] Frontend sends device fingerprint
- [x] Offline sync includes device fingerprint
- [x] Z-Report reads from correct table
- [ ] Test creating new milk collection online
- [ ] Test creating milk collection offline and syncing
- [ ] Test Z-Report generation
- [ ] Verify data appears correctly in transactions table

## Database Notes

The `transactions` table includes many fields for future expansion:
- CAN, Uploadrefno, ccode, icode: Empty strings (reserved for future use)
- ivat, iprice, amount: Set to 0 (can be populated later)
- cowname, cowbreed, noofcalfs, aibreed, milk_session_id, c_route: NULL (not used for milk collection)

## Backward Compatibility

The API endpoints remain the same (`/api/milk-collection`), ensuring frontend compatibility. Only the backend storage location changed from `milk_collection` to `transactions`.
