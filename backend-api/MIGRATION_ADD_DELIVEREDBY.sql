-- Migration: Add deliveredby column to transactions table
-- This column tracks who delivered the goods (default: 'owner')
-- Used only in Buy (transtype=1) and Sell (transtype=2) portals

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS deliveredby VARCHAR(100) DEFAULT 'owner';

-- Update existing records to have 'owner' as default
UPDATE transactions SET deliveredby = 'owner' WHERE deliveredby IS NULL OR deliveredby = '';
