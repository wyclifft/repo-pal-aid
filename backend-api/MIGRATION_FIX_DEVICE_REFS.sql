-- Migration: Fix Device Reference Format
-- Date: 2025-12-23
-- Description: Updates device_ref format from AE1xxxxxxx to AE01xxxxxx (2-digit slot)
-- and cleans up any duplicate entries

-- Step 1: Backup current devsettings (optional - run this first if you want a backup)
-- CREATE TABLE devsettings_backup_20251223 AS SELECT * FROM devsettings;

-- Step 2: Check for duplicate device_ref entries
SELECT device_ref, COUNT(*) as count 
FROM devsettings 
WHERE device_ref IS NOT NULL 
GROUP BY device_ref 
HAVING COUNT(*) > 1;

-- Step 3: View current device_ref assignments
SELECT uniquedevcode, device, device_ref, authorized, ccode 
FROM devsettings 
WHERE device_ref IS NOT NULL
ORDER BY device_ref;

-- Step 4: Reassign device_ref with new format (AE + 2-digit slot + 6-digit sequence)
-- This assigns sequential slots to each device

SET @slot = 0;
UPDATE devsettings 
SET device_ref = CONCAT('AE', LPAD((@slot := @slot + 1), 2, '0'), '000001')
WHERE device_ref IS NOT NULL OR uniquedevcode IS NOT NULL
ORDER BY created_at, id;

-- Step 5: Verify the new assignments
SELECT uniquedevcode, device, device_ref, authorized, ccode 
FROM devsettings 
WHERE device_ref IS NOT NULL
ORDER BY device_ref;

-- Step 6: Check that unique constraint is satisfied
SELECT device_ref, COUNT(*) as count 
FROM devsettings 
WHERE device_ref IS NOT NULL 
GROUP BY device_ref 
HAVING COUNT(*) > 1;

-- Note: After running this migration:
-- 1. Restart the Node.js server
-- 2. Users will need to refresh their app to get the new device_ref
-- 3. New devices will get slots starting from the next available number
