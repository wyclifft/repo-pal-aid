-- ============================================
-- MIGRATION: v2.10.109
-- Stable Device Identity Across Reinstalls
-- ============================================
-- Adds hardware fingerprint columns to approved_devices so the server can
-- recognize a physical device after uninstall/reinstall/clear-data and
-- return its original (devcode, uniquedevcode, trnid, milkid, storeid, aiid)
-- instead of issuing a fresh identity that risks TRNID/MILKID mixups.
--
-- Strictly additive. All columns are nullable; no defaults; no existing
-- behavior changes. Safe to run on production while old APKs are live.
-- ============================================

ALTER TABLE approved_devices
  ADD COLUMN ssaid               VARCHAR(64)  NULL,
  ADD COLUMN device_model        VARCHAR(128) NULL,
  ADD COLUMN device_manufacturer VARCHAR(128) NULL,
  ADD COLUMN os_version          VARCHAR(64)  NULL,
  ADD COLUMN fingerprint_history TEXT         NULL,
  ADD COLUMN last_seen_at        DATETIME     NULL,
  ADD INDEX idx_ccode_ssaid (ccode, ssaid),
  ADD INDEX idx_ssaid (ssaid);

-- NOTE: fingerprint_history is TEXT (JSON-encoded array). TEXT chosen over
-- JSON for compatibility with older MySQL/MariaDB versions on shared cPanel.
