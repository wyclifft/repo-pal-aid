-- Migration: Add entry_type column to transactions table
-- This column tracks whether a transaction was entered via 'scale' or 'manual' input
-- Date: 2025-11-20

ALTER TABLE transactions 
ADD COLUMN entry_type VARCHAR(10) DEFAULT 'manual' 
COMMENT 'Entry type: scale or manual';

-- Update existing records to have default 'manual' value
UPDATE transactions 
SET entry_type = 'manual' 
WHERE entry_type IS NULL;
