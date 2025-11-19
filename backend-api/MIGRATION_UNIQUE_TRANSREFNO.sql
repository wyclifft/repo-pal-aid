-- Migration: Add unique constraint to transrefno field
-- This ensures that each transaction reference number is unique across the entire system
-- Run this on your MySQL database

-- Add unique index to transrefno column
ALTER TABLE transactions ADD UNIQUE INDEX idx_transrefno_unique (transrefno);

-- This will:
-- 1. Ensure no duplicate transaction reference numbers can be created
-- 2. Improve query performance when searching by reference number
-- 3. Provide database-level integrity for the reference numbering system

-- Note: If you have existing duplicate transrefno values, this will fail.
-- In that case, you'll need to clean up duplicates first before adding the constraint.
