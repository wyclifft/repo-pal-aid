-- v2.12.19 — Scalability & Performance Indexes
--
-- Goal: Optimize the most frequent/heavy queries to support higher concurrent user counts.

-- 1. Optimize milk collection sync and reports
-- Combined index for (ccode, transtype, transdate) to speed up range scans
ALTER TABLE transactions
  ADD INDEX IF NOT EXISTS idx_scalability_sync (ccode, Transtype, transdate);

-- 2. Optimize individual farmer cumulative queries (Frequency lookup)
-- Helps /api/farmer-monthly-frequency and Farmer Detail reports
ALTER TABLE transactions
  ADD INDEX IF NOT EXISTS idx_farmer_scan (memberno, ccode, Transtype, transdate);

-- 3. Optimize farmer downloads with route filtering
ALTER TABLE cm_members
  ADD INDEX IF NOT EXISTS idx_ccode_route (ccode, route);

-- 4. Optimize item lookups for joins
ALTER TABLE fm_items
  ADD INDEX IF NOT EXISTS idx_icode_ccode (icode, ccode);

-- 5. Optimize device identity resolution
ALTER TABLE approved_devices
  ADD INDEX IF NOT EXISTS idx_ssaid_approved (ssaid, approved);
