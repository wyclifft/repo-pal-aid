-- ============================================
-- MIGRATION: Add milkid, storeid, aiid counters to devsettings
-- Purpose: Track type-specific transaction IDs for uploadrefno
-- Date: 2025-12-28
-- ============================================

-- Add milkid, storeid, aiid columns to devsettings table
-- Each tracks the last used ID for that transaction type per device
ALTER TABLE devsettings 
ADD COLUMN IF NOT EXISTS milkid INT DEFAULT 0 COMMENT 'Last used milk transaction ID',
ADD COLUMN IF NOT EXISTS storeid INT DEFAULT 0 COMMENT 'Last used store transaction ID',
ADD COLUMN IF NOT EXISTS aiid INT DEFAULT 0 COMMENT 'Last used AI transaction ID';

-- If MySQL version doesn't support IF NOT EXISTS, use these instead:
-- ALTER TABLE devsettings ADD COLUMN milkid INT DEFAULT 0;
-- ALTER TABLE devsettings ADD COLUMN storeid INT DEFAULT 0;
-- ALTER TABLE devsettings ADD COLUMN aiid INT DEFAULT 0;

-- ============================================
-- EXPLANATION
-- ============================================
-- 
-- Transaction Reference Flow:
-- 1. transrefno = devcode + trnid (e.g., AG0500000001) - unique identifier for traceability
-- 2. uploadrefno = milkID/storeID/aiID (e.g., 12345) - type-specific approval workflow ID
--
-- Example for a milk transaction:
--   transrefno: AG0500000042 (device AG05, transaction 42)
--   uploadrefno: 108 (108th milk collection for this device)
--
-- This allows:
-- - Same transrefno links physical receipt to database record
-- - uploadrefno provides clean sequential numbering per transaction type
-- - Both IDs persist across offline/online sync and retries
--
-- ============================================
-- VERIFICATION
-- ============================================
-- Run after migration to verify columns exist:
-- DESCRIBE devsettings;
--
-- Check values:
-- SELECT uniquedevcode, devcode, trnid, milkid, storeid, aiid FROM devsettings;
-- ============================================
