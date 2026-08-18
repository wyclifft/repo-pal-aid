-- Migration: Supervisor Role, Device Security, and Transrefno Integrity
-- Date: 2026-08-12

-- 1. Add userId column to devSettings to tie devices to specific users
ALTER TABLE devSettings ADD COLUMN userId VARCHAR(50) DEFAULT NULL;
CREATE INDEX idx_devsettings_userid ON devSettings(userId);

-- 2. Clean up duplicate transrefno records in transactions table
-- We keep the record with the minimum ID (earliest insert)
DELETE t1 FROM transactions t1
INNER JOIN transactions t2
WHERE t1.ID > t2.ID AND t1.transrefno = t2.transrefno;

-- 3. Add database-level unique constraint to prevent future duplicates
-- This ensures that transrefno is globally unique as intended
ALTER TABLE transactions ADD UNIQUE INDEX idx_transrefno_unique (transrefno);

-- 4. Update devSettings for existing approved devices (best effort)
-- Link them to the last user who logged in on that device
UPDATE devSettings d
JOIN (
    SELECT device_fingerprint, user_id, MAX(last_sync) as latest
    FROM approved_devices
    WHERE approved = 1
    GROUP BY device_fingerprint, user_id
) a ON d.uniquedevcode = a.device_fingerprint
SET d.userId = a.user_id
WHERE d.userId IS NULL;

-- 5. Ensure Transtype index exists for supervisor queries
CREATE INDEX idx_transactions_supervisor ON transactions(Transtype, ccode, transdate);
