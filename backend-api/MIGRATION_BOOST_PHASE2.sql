-- =====================================================================
-- MIGRATION: Farmer Boost — Phase 2 + 3 (writes)
-- Version:   v2.11.1
-- Purpose:   Adds boost_purchases table and mirrors the feature flag onto
--            psettings (the authoritative company config source). No
--            existing table structure is changed destructively.
-- Safety:    Additive-only. Column-add is guarded so re-runs are safe.
-- =====================================================================

-- 1) Mirror boost_enabled onto psettings if the column is not already there.
--    psettings is the app-wide config source of truth; boost_limits_policy
--    keeps recovery_cap_pct / limit_mode.
SET @has_col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'psettings'
    AND COLUMN_NAME  = 'boost_enabled');
SET @sql := IF(@has_col = 0,
  'ALTER TABLE psettings ADD COLUMN boost_enabled TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Boost purchases — a durable record of every credit-funded input sale.
--    Idempotent by (ccode, pref_no). The ledger PURCHASE row it produces is
--    linked via ledger_id so we can trace money movement end-to-end.
CREATE TABLE IF NOT EXISTS boost_purchases (
  pref_no             VARCHAR(50)  NOT NULL,
  ccode               VARCHAR(20)  NOT NULL,
  farmer_id           VARCHAR(30)  NOT NULL,
  mcode               VARCHAR(20)  NOT NULL,
  items_json          JSON         NULL,
  total               DECIMAL(12,2) NOT NULL,
  status              ENUM('PENDING','POSTED','VOID') NOT NULL DEFAULT 'POSTED',
  device_code         VARCHAR(30)  NULL,
  operator            VARCHAR(50)  NULL,
  related_transrefno  VARCHAR(50)  NULL,
  ledger_id           BIGINT UNSIGNED NULL,
  notes               VARCHAR(500) NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (pref_no, ccode),
  KEY idx_bp_farmer   (ccode, farmer_id, created_at),
  KEY idx_bp_merchant (ccode, mcode, created_at),
  KEY idx_bp_status   (ccode, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of Phase 2/3 migration. Phase 4 (payout engine) adds payout_runs /
-- payout_lines / merchant_settlements.
