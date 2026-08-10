-- v2.12.13 — Cumulative scan indexes (Contabo MariaDB / MyISAM)
--
-- Goal: make the single grouped cumulative scan in computeCumulativeBatch()
-- use an index range instead of a full table scan.
--
-- Query shape (server.js, computeCumulativeBatch):
--   SELECT TRIM(memberno), TRIM(icode), SUM(weight), MAX(id)
--     FROM transactions
--    WHERE ccode = ?                       -- sargable equality
--      AND CAST(Transtype AS UNSIGNED) = 1 -- Transtype is VARCHAR(20): kept as
--                                          -- a post-filter, NOT indexed
--      AND transdate BETWEEN ? AND ?       -- sargable range (transdate is DATE)
--      AND UPPER(TRIM(route)) = ?          -- optional, post-filter
--    GROUP BY TRIM(memberno), TRIM(icode)
--
-- Leading equality on ccode + range on transdate is what the index must serve.
-- `route` is appended so the (rarely selective) route filter can still be
-- resolved from the index rather than the data file.
--
-- NOTE: transactions.icode is TEXT and cannot participate in a composite index
-- without a prefix length, so it is deliberately excluded.
--
-- Run once on the Contabo server. Safe to re-run: drop statements are guarded
-- by hand (MariaDB has no CREATE INDEX IF NOT EXISTS on all versions).

-- Drop the earlier, unusable attempt if it exists.
-- ALTER TABLE transactions DROP INDEX idx_tx_cum_group;

ALTER TABLE transactions
  ADD INDEX idx_tx_cum_scan (ccode, transdate, route(20));

-- fm_items is now read once per company (60 s cache) instead of being joined
-- inside the scan. This index keeps that lookup instant.
ALTER TABLE fm_items
  ADD INDEX idx_fm_items_ccode (ccode);

-- Verify afterwards:
--   SHOW INDEX FROM transactions;
--   EXPLAIN SELECT TRIM(memberno), TRIM(icode), SUM(weight), MAX(id)
--     FROM transactions
--    WHERE ccode = 'C003' AND CAST(Transtype AS UNSIGNED) = 1
--      AND transdate BETWEEN '2026-01-01' AND '2026-06-30'
--    GROUP BY TRIM(memberno), TRIM(icode);
-- Expect: key = idx_tx_cum_scan, type = range.
