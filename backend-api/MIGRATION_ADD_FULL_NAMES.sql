-- ============================================
-- MIGRATION: Add Full Names to milk_collection
-- Purpose: Store farmer name, route name, and clerk name for receipts
-- Date: 2025-10-30
-- ============================================

-- Add missing columns to milk_collection table
ALTER TABLE milk_collection 
ADD COLUMN farmer_name VARCHAR(255) AFTER farmer_id,
ADD COLUMN route_name VARCHAR(255) AFTER session,
ADD COLUMN clerk_name VARCHAR(100) AFTER weight;

-- Update reference_no column name to match frontend (if needed)
ALTER TABLE milk_collection 
CHANGE COLUMN referenceNo reference_no VARCHAR(100) UNIQUE NOT NULL;

-- Update price column name to match frontend
ALTER TABLE milk_collection 
CHANGE COLUMN price price_per_liter DECIMAL(10,2) NOT NULL;

-- ============================================
-- NOTES:
-- ============================================
-- 1. farmer_name: Full name of the farmer (from farmers table)
-- 2. route_name: Full name of the route (from farmers table)
-- 3. clerk_name: User ID of the person who collected the milk
-- 4. reference_no: Standardized column name across frontend/backend
-- 5. price_per_liter: Standardized column name across frontend/backend
-- ============================================
