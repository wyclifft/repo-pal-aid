-- ============================================
-- MIGRATION: Add sackTare and sackEdit columns to psettings table
-- Date: 2026-01-28
-- Purpose: Configurable coffee sack tare weight and edit permissions
-- ============================================

-- Add sackTare column (default 1 kg)
-- This defines the fixed tare weight per sack for coffee weighing
ALTER TABLE psettings ADD COLUMN IF NOT EXISTS sackTare DECIMAL(5,2) DEFAULT 1.00;

-- Add sackEdit column (default 0 = fixed/backend-controlled)
-- 0 = sack weight is fixed and cannot be edited from frontend
-- 1 = users can modify sack weight from the frontend UI
ALTER TABLE psettings ADD COLUMN IF NOT EXISTS sackEdit TINYINT(1) DEFAULT 0;

-- ============================================
-- NOTES:
-- ============================================
-- 1. sackTare: Default value of 1.00 kg is used when column doesn't exist
-- 2. sackEdit: When set to 0, the sack weight input is locked in the UI
-- 3. These settings are included in the device fingerprint API response
-- 4. Changes take effect immediately through psettings polling
-- ============================================

-- Verify columns exist after migration
-- SELECT ccode, sackTare, sackEdit FROM psettings LIMIT 5;
