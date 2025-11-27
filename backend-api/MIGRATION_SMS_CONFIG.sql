-- ============================================
-- MIGRATION: Add SMS Configuration Table
-- Purpose: Track which company codes have SMS enabled
-- Date: 2025-11-27
-- ============================================

-- Create sms_config table
CREATE TABLE IF NOT EXISTS sms_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ccode VARCHAR(50) NOT NULL UNIQUE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ccode (ccode),
  INDEX idx_sms_enabled (sms_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- NOTES:
-- ============================================
-- 1. sms_enabled: Controls whether SMS notifications are sent for this company
-- 2. ccode: Company code from psettings table
-- 3. One row per company code
-- ============================================
