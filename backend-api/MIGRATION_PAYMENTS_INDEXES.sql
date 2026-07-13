-- v2.11.3 — Payments performance indexes.
--
-- Runs once on production. All additive: no column changes, no data changes.
-- The Payments module aggregates `transactions` per farmer within a period.
-- Without these indexes the query full-scans (>200k rows) and the shared
-- MySQL host closes the socket ("PROTOCOL_CONNECTION_LOST").
--
-- Safe to re-run: wrap in a defensive check if the target MySQL is < 8.0.
-- On MySQL 8+, use `CREATE INDEX IF NOT EXISTS ...` directly.

-- Hot path: unpaid transtype=1 rows per ccode within a date window.
-- Drives /api/payments/payable and the lock-to-'pending' UPDATE in /process.
CREATE INDEX idx_tx_pay_scan
  ON transactions (ccode, transtype, payment_status, transdate);

-- Farmer grouping / lookups by memberno within a company.
CREATE INDEX idx_tx_pay_member
  ON transactions (ccode, memberno, transtype, payment_status);

-- cm_members join used to attach farmer_name + crbal after the aggregate.
CREATE INDEX idx_cm_ccode_mcode
  ON cm_members (ccode, mcode);

-- Optional verification:
--   EXPLAIN SELECT memberno, SUM(weight)
--     FROM transactions
--    WHERE ccode = 'YOUR_CCODE'
--      AND transtype = 1
--      AND payment_status = 'unpaid'
--      AND transdate >= '2025-01-01' AND transdate < '2025-02-01'
--    GROUP BY memberno;
-- Expect: key = idx_tx_pay_scan, Extra = "Using index condition".
