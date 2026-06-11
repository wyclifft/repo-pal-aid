-- ============================================
-- v2.10.111 — Cleanup duplicate device rows
-- ============================================
-- After a device cleared data / reinstalled, the app registered a NEW
-- pending row with a fresh fingerprint while the ORIGINAL approved row
-- still exists. The v2.10.111 fix prevents new duplicates, but existing
-- ones must be cleaned up manually.
--
-- IMPORTANT: review with SELECT before running the DELETE/UPDATE.
-- ============================================

-- 1) Find duplicate rows: same ssaid but more than one row
SELECT ssaid, COUNT(*) AS rows, GROUP_CONCAT(id ORDER BY id) AS ids
FROM approved_devices
WHERE ssaid IS NOT NULL AND ssaid <> ''
GROUP BY ssaid
HAVING COUNT(*) > 1;

-- 2) For each ssaid group, inspect the rows. Keep the APPROVED row.
--    Example for ssaid 'b4d7e02f1500f505':
SELECT id, device_fingerprint, user_id, approved, ccode, last_seen_at, created_at
FROM approved_devices
WHERE ssaid = 'b4d7e02f1500f505'
ORDER BY approved DESC, id ASC;

-- 3) Merge the duplicate's fingerprint into the approved row's history,
--    then delete the pending duplicate.
--    Replace KEEP_ID and DROP_ID with values from step (2).
--
-- UPDATE approved_devices
--   SET fingerprint_history = CASE
--         WHEN fingerprint_history IS NULL
--           THEN (SELECT device_fingerprint FROM (SELECT device_fingerprint FROM approved_devices WHERE id = DROP_ID) x)
--         WHEN INSTR(fingerprint_history,
--           (SELECT device_fingerprint FROM (SELECT device_fingerprint FROM approved_devices WHERE id = DROP_ID) x)) > 0
--           THEN fingerprint_history
--         ELSE CONCAT(fingerprint_history, ',',
--           (SELECT device_fingerprint FROM (SELECT device_fingerprint FROM approved_devices WHERE id = DROP_ID) x))
--       END,
--       last_seen_at = NOW()
--   WHERE id = KEEP_ID;
--
-- DELETE FROM approved_devices WHERE id = DROP_ID AND approved = 0;
