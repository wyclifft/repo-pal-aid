# Device-Based Company-Farmer Filtering Setup

## Overview
This document describes the device-based filtering system that ensures each device only displays farmers belonging to its assigned company.

## How It Works

### 1. Device Identification
- When the PWA loads, it generates a unique device fingerprint using browser properties
- The fingerprint is sent with API requests to identify the device

### 2. Backend Filtering
- New endpoint: `GET /api/farmers/by-device/:uniquedevcode`
- The backend:
  1. Looks up the device in `devsettings` table
  2. Verifies the device is authorized (`authorized = 1`)
  3. Retrieves the device's company code (`ccode`)
  4. Returns only farmers from `cm_members` with matching `ccode`

### 3. Security
- Filtering happens **only on the backend** - frontend never accesses `ccode` directly
- Unauthorized devices receive 401 error
- Frontend displays user-friendly error messages

## Database Structure

### devsettings Table
```sql
CREATE TABLE devsettings (
  ID int(11) PRIMARY KEY AUTO_INCREMENT,
  ccode varchar(100),           -- Company code (e.g. D001, D003)
  devcode varchar(11),           -- Short device code
  uniquedevcode varchar(100),    -- Unique device identifier (device fingerprint)
  device varchar(50),            -- Device name/model
  authorized tinyint(1),         -- 1 = active, 0 = blocked
  -- ... other fields
);
```

### cm_members Table
```sql
CREATE TABLE cm_members (
  ID int(11) PRIMARY KEY AUTO_INCREMENT,
  mcode varchar(10),             -- Member/farmer code
  descript varchar(50),          -- Farmer name
  tel varchar(50),               -- Phone number
  route varchar(20),             -- Collection route
  ccode varchar(100),            -- Company code (links to devsettings)
  -- ... other fields
);
```

## Required Database Indexes

**IMPORTANT:** Add these indexes for optimal performance:

```sql
-- Index on devsettings for device lookup
CREATE INDEX idx_devsettings_uniquedevcode ON devsettings(uniquedevcode, authorized);

-- Index on cm_members for company filtering
CREATE INDEX idx_cm_members_ccode ON cm_members(ccode);

-- Composite index for farmer search within company
CREATE INDEX idx_cm_members_search ON cm_members(ccode, mcode, descript);
```

## API Endpoint

### Get Farmers by Device
```
GET /api/farmers/by-device/:uniquedevcode
```

**Parameters:**
- `uniquedevcode` (path): Device fingerprint (URL-encoded)

**Response (Success):**
```json
{
  "success": true,
  "data": [
    {
      "farmer_id": "F001",
      "name": "John Doe",
      "route": "Route A",
      "ccode": "D001"
    }
  ],
  "ccode": "D001"
}
```

**Response (Unauthorized):**
```json
{
  "success": false,
  "error": "Device not authorized or not found"
}
```
Status: 401

## Frontend Implementation

### FarmerSearch Component
- Automatically generates device fingerprint on mount
- Calls device-filtered endpoint
- Caches farmers for offline use
- Shows authorization errors to user

### Store Page
- Uses same device-filtered farmer loading
- Displays error toast if device not authorized
- Falls back to cached data when offline

## Testing

### 1. Test with Authorized Device
```bash
# In browser console, get device fingerprint
const { generateDeviceFingerprint } = await import('@/utils/deviceFingerprint');
const fingerprint = await generateDeviceFingerprint();
console.log('Device fingerprint:', fingerprint);

# Test API endpoint
curl "https://backend.maddasystems.co.ke/api/farmers/by-device/{fingerprint}"
```

### 2. Test Authorization
```sql
-- Verify device exists and is authorized
SELECT ccode, authorized FROM devsettings 
WHERE uniquedevcode = 'your-device-fingerprint';

-- Should return: ccode='D001', authorized=1
```

### 3. Test Company Filtering
```sql
-- Verify farmers are filtered by company
SELECT COUNT(*) FROM cm_members WHERE ccode = 'D001';
-- This count should match what the API returns
```

## Error Handling

| Error | Status | User Message |
|-------|--------|-------------|
| Device not found | 401 | "Device not authorized. Please contact administrator." |
| Device not authorized | 401 | "Device not authorized. Please contact administrator." |
| Network error | - | Falls back to cached farmers |
| No cached farmers | - | Empty farmer list |

## Migration Steps

### For Existing Installations

1. **Add indexes** (see above SQL commands)

2. **Verify devsettings table:**
   ```sql
   -- Check if devices are registered
   SELECT uniquedevcode, ccode, authorized FROM devsettings;
   ```

3. **Verify cm_members table:**
   ```sql
   -- Check if farmers have company codes
   SELECT COUNT(*), ccode FROM cm_members GROUP BY ccode;
   ```

4. **Register devices:**
   - Each physical device needs an entry in `devsettings`
   - Set `uniquedevcode` to the device's browser fingerprint
   - Set `ccode` to the company code
   - Set `authorized = 1` to enable

5. **Update deployment:**
   - Deploy updated backend (server.js)
   - Deploy updated frontend
   - Test with each device

## Troubleshooting

### Issue: "Device not authorized"
**Solution:** 
- Check if device exists in `devsettings` table
- Verify `authorized = 1`
- Confirm `uniquedevcode` matches device fingerprint

### Issue: No farmers showing
**Solution:**
- Verify farmers in `cm_members` have matching `ccode`
- Check if device's `ccode` is correct
- Review console logs for API errors

### Issue: Wrong farmers showing
**Solution:**
- Confirm device's `ccode` in `devsettings`
- Verify farmer's `ccode` in `cm_members`
- Check backend logs for actual query being executed

## Performance Considerations

- Indexes are **critical** for large datasets (>10,000 farmers)
- Device lookup: O(1) with index on `uniquedevcode`
- Farmer filtering: O(n) where n = farmers in company (not total farmers)
- Recommended: Monitor query performance in MySQL slow query log

## Security Notes

- ✅ All filtering happens on backend
- ✅ Frontend never sees other companies' data
- ✅ Device fingerprints are generated from browser properties
- ✅ Authorization check before returning any data
- ⚠️ Device fingerprints can change if browser settings change
- ⚠️ Consider implementing device registration workflow for production
