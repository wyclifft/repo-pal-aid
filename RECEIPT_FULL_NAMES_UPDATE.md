# Receipt Full Names Update

## Summary
Updated the milk collection system to display full names for farmer, route, and collector on receipts instead of just IDs/codes.

## Changes Made

### 1. Frontend Changes
- ✅ **ReceiptModal.tsx**: Now displays full names with IDs in parentheses
- ✅ **Index.tsx**: Added `routeName` state and populates all name fields in milk data
- ✅ **mysqlApi.ts**: Already compatible - sends full collection object to backend

### 2. Backend Changes
- ✅ **server.js**: Updated POST endpoint to extract and store `farmer_name`, `route_name`, and `clerk_name`
- ✅ **server.js**: Fixed column names to use `reference_no` and `price_per_liter` consistently
- ✅ **MYSQL_SCHEMA.sql**: Updated with new columns

### 3. Database Migration Required

Run this SQL on your MySQL database:

```sql
-- Add missing columns to milk_collection table
ALTER TABLE milk_collection 
ADD COLUMN farmer_name VARCHAR(255) AFTER farmer_id,
ADD COLUMN route_name VARCHAR(255) AFTER session,
ADD COLUMN clerk_name VARCHAR(100) AFTER weight;

-- Update column names to match frontend/backend
ALTER TABLE milk_collection 
CHANGE COLUMN referenceNo reference_no VARCHAR(100) UNIQUE NOT NULL;

ALTER TABLE milk_collection 
CHANGE COLUMN price price_per_liter DECIMAL(10,2) NOT NULL;
```

**Migration file**: See `backend-api/MIGRATION_ADD_FULL_NAMES.sql`

## Receipt Display

Receipts now show:
- **Farmer**: John Doe (F001) ← Full name with ID
- **Route**: Northern Route ← Full route name (or code if name not available)
- **Collector**: clerk123 ← Clerk's user ID (full name support added for future)

## Data Flow

1. User selects farmer → Frontend stores `farmer_id`, `farmer_name`, `route`, `route_name`
2. User saves collection → Frontend includes all fields in API call
3. Backend extracts names and stores them in database
4. Receipt displays full names for better readability

## Testing Checklist

- [ ] Apply database migration SQL
- [ ] Restart backend server
- [ ] Test creating new milk collection
- [ ] Verify receipt shows full names
- [ ] Test offline mode (names should be saved locally too)
- [ ] Test sync from offline to online (names should be uploaded)
