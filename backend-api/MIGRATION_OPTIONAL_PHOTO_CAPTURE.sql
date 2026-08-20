-- ============================================
-- MIGRATION: Add capture_photo to psettings table
-- Makes photo capture in Store module optional
-- ============================================

-- Add capture_photo column if it doesn't exist
-- 1 = Capture required (default, backward compatible)
-- 0 = Capture optional
ALTER TABLE psettings
ADD COLUMN IF NOT EXISTS capture_photo TINYINT(1) DEFAULT 1;

-- Verify the change
SELECT
  cno as ccode,
  cname as company_name,
  capture_photo
FROM psettings
LIMIT 5;

-- ============================================
-- DONE!
-- ============================================
