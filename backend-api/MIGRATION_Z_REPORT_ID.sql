-- Migration: Add z_report_id column to transactions table
-- This column locks transactions after Z Report generation
-- Prevents re-use or editing of transactions already included in a Z Report
-- Date: 2026-01-25

-- Add z_report_id column to transactions table
ALTER TABLE transactions 
ADD COLUMN z_report_id VARCHAR(50) DEFAULT NULL 
COMMENT 'Z Report ID that locked this transaction (NULL = not yet reported)';

-- Add index for faster Z Report queries
CREATE INDEX idx_z_report_id ON transactions(z_report_id);

-- Add index for device-based Z Report filtering
CREATE INDEX idx_deviceserial_transdate ON transactions(deviceserial, transdate);

-- This will:
-- 1. Track which transactions are included in each Z Report
-- 2. Prevent transactions from being included in multiple Z Reports
-- 3. Allow filtering of "unreported" transactions (z_report_id IS NULL)
-- 4. Improve query performance for device-based Z Report generation
