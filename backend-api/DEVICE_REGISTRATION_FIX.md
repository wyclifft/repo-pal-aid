# Device Registration Issue - Root Cause & Fix

## Problem Identified

New devices stopped being properly registered in the `approved_devices` table due to:

1. **Missing Database Columns**
   - `updated_at` column was missing
   - `ccode` column was missing
   
2. **Table Mismatch**
   - System uses TWO device tables:
     - `approved_devices` - For device registration/approval workflow
     - `devsettings` - For production device configuration and authorization
   - Recent code changes queried `devsettings` for authorization but still inserted into `approved_devices`
   - Data wasn't being synchronized between the two tables

## What Was Fixed

### 1. Database Schema (`backend-api/MYSQL_SCHEMA.sql`)
- ✅ Added `updated_at TIMESTAMP` column with auto-update
- ✅ Added `ccode VARCHAR(50)` column to link devices to companies
- ✅ Added index on `ccode` for query performance

### 2. GET `/api/devices/fingerprint/:fingerprint` Endpoint
- ✅ Now queries BOTH `approved_devices` AND `devsettings`
- ✅ Combines registration data from `approved_devices` with authorization from `devsettings`
- ✅ Retrieves company name from `psettings` using `ccode`
- ✅ Returns complete device information with authorization status

### 3. POST `/api/devices` Endpoint
- ✅ Checks `devsettings` to get `ccode` for new devices
- ✅ Inserts all required columns: `device_fingerprint`, `user_id`, `approved`, `device_info`, `last_sync`, `ccode`, `created_at`, `updated_at`
- ✅ Updates `last_sync` and `updated_at` when device already exists

### 4. PUT `/api/devices/:id` Endpoint
- ✅ Now updates `updated_at` timestamp along with `last_sync`

## Migration Steps

Run the migration SQL on your existing database:

```bash
mysql -u your_user -p your_database < backend-api/MIGRATION_ADD_MISSING_COLUMNS.sql
```

This will:
1. Add missing `updated_at` and `ccode` columns
2. Create index on `ccode`
3. Populate `ccode` from `devsettings` for existing devices
4. Set `updated_at` to `created_at` for existing rows

## How Device Registration Now Works

1. **New Device Login**:
   - Device generates fingerprint
   - Calls `POST /api/devices` with fingerprint and user_id
   - Backend checks if device exists in `devsettings` and gets `ccode`
   - Creates record in `approved_devices` with `approved=FALSE`, includes `ccode`
   - User sees "Device Pending Approval" message

2. **Authorization Check**:
   - Calls `GET /api/devices/fingerprint/:fingerprint`
   - Backend queries both `approved_devices` and `devsettings`
   - Returns combined data with authorization status and company name
   - Frontend displays company name in header badge

3. **Device Approval** (Admin):
   - Admin approves device in `approved_devices`
   - Device also needs to be configured in `devsettings` with `authorized=1`
   - Both tables must have device authorized for full access

## Verification

Check that devices are being inserted:

```sql
SELECT 
  id,
  device_fingerprint,
  user_id,
  approved,
  ccode,
  created_at,
  updated_at,
  last_sync
FROM approved_devices
ORDER BY created_at DESC
LIMIT 10;
```

Verify company names are displayed:

```sql
SELECT 
  a.device_fingerprint,
  a.user_id,
  a.approved,
  a.ccode,
  d.authorized,
  p.cname as company_name
FROM approved_devices a
LEFT JOIN devsettings d ON a.device_fingerprint = d.uniquedevcode
LEFT JOIN psettings p ON a.ccode = p.cno
ORDER BY a.created_at DESC;
```
