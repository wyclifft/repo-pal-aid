-- ============================================
-- MIGRATION: Add store_print_copies to psettings
-- ============================================

-- Add store_print_copies column if it doesn't exist
-- Default to NULL or 0 to allow fallback to global printOptions
ALTER TABLE psettings
ADD COLUMN IF NOT EXISTS store_print_copies INT DEFAULT 0;

-- Verify the changes
SELECT
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'psettings'
  AND COLUMN_NAME = 'store_print_copies'
  AND TABLE_SCHEMA = DATABASE();

-- ============================================
-- DONE!
-- ============================================
