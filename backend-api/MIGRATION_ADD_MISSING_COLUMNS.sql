-- ============================================
-- MIGRATION: Add missing columns to approved_devices
-- Run this on your existing MySQL database
-- ============================================

-- Add updated_at column if it doesn't exist
ALTER TABLE approved_devices 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Add ccode column if it doesn't exist
ALTER TABLE approved_devices 
ADD COLUMN IF NOT EXISTS ccode VARCHAR(50) DEFAULT NULL;

-- Add index on ccode if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_ccode ON approved_devices(ccode);

-- Update existing rows to set updated_at to created_at if null
UPDATE approved_devices 
SET updated_at = created_at 
WHERE updated_at IS NULL;

-- Optionally: Try to populate ccode from devsettings for existing devices
UPDATE approved_devices a
INNER JOIN devsettings d ON a.device_fingerprint = d.uniquedevcode
SET a.ccode = d.ccode
WHERE a.ccode IS NULL AND d.ccode IS NOT NULL;

-- Verify the changes
SELECT 
  COLUMN_NAME, 
  COLUMN_TYPE, 
  IS_NULLABLE, 
  COLUMN_DEFAULT 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'approved_devices' 
  AND TABLE_SCHEMA = DATABASE()
ORDER BY ORDINAL_POSITION;

-- ============================================
-- DONE! Your table now has all required columns
-- ============================================
