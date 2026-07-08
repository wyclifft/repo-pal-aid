-- =====================================================================
-- MIGRATION: Farmer Boost — Phase 1 Foundations
-- Version:   v2.11.0
-- Purpose:   Additive-only tables for credit financing. No existing table
--            is altered. All rows carry ccode for multi-tenant isolation.
--            Feature is dormant until psettings.boost_enabled = 1.
--
-- Safety:    - Additive: no ALTER on existing tables.
--            - Rollback: DROP the four tables below; no data loss elsewhere.
--            - Idempotent: uses IF NOT EXISTS.
-- =====================================================================

-- 1) Approved input suppliers (agrovets, coop store as merchant, etc.)
CREATE TABLE IF NOT EXISTS merchants (
  mcode         VARCHAR(20)  NOT NULL,
  ccode         VARCHAR(20)  NOT NULL,
  name          VARCHAR(200) NOT NULL,
  kra_pin       VARCHAR(30)  NULL,
  phone         VARCHAR(20)  NULL,
  till_paybill  VARCHAR(30)  NULL,
  bank_name     VARCHAR(100) NULL,
  bank_acc      VARCHAR(50)  NULL,
  status        ENUM('PENDING','ACTIVE','SUSPENDED') NOT NULL DEFAULT 'PENDING',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (mcode, ccode),
  KEY idx_merchants_ccode (ccode),
  KEY idx_merchants_status (ccode, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Per-farmer credit account (one row per farmer per ccode).
--    outstanding = principal owed. hold = amount reserved during pending purchase.
CREATE TABLE IF NOT EXISTS boost_accounts (
  farmer_id     VARCHAR(30)  NOT NULL,
  ccode         VARCHAR(20)  NOT NULL,
  credit_limit  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  outstanding   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  hold_amount   DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status        ENUM('INACTIVE','ACTIVE','FROZEN','WRITEOFF') NOT NULL DEFAULT 'INACTIVE',
  score         INT          NULL,
  set_by        VARCHAR(50)  NULL,          -- officer username who set the limit
  notes         VARCHAR(500) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (farmer_id, ccode),
  KEY idx_boost_accounts_ccode (ccode),
  KEY idx_boost_accounts_status (ccode, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Append-only ledger. Every credit movement writes ONE row. Corrections
--    are new REVERSAL/ADJUST entries — never UPDATE, never DELETE.
CREATE TABLE IF NOT EXISTS boost_ledger (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ccode                VARCHAR(20)  NOT NULL,
  farmer_id            VARCHAR(30)  NOT NULL,
  entry_type           ENUM(
                         'DISBURSE',  -- credit granted (cash advance)
                         'PURCHASE',  -- input bought on credit from merchant
                         'RECOVER',   -- deducted from payout
                         'SETTLE',    -- merchant paid out
                         'ADJUST',    -- manual correction (+/-)
                         'WRITEOFF',  -- bad debt cleared
                         'REVERSAL'   -- undo of prior entry
                       ) NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,     -- signed: +increases outstanding, -decreases
  ref_no               VARCHAR(50)  NOT NULL,      -- unique per entry (device-generated)
  mcode                VARCHAR(20)  NULL,          -- for PURCHASE / SETTLE
  related_transrefno   VARCHAR(50)  NULL,          -- link to sales/milk_collection when relevant
  payout_run_id        VARCHAR(50)  NULL,          -- for RECOVER / SETTLE
  reverses_id          BIGINT UNSIGNED NULL,       -- for REVERSAL entries
  device_code          VARCHAR(30)  NULL,
  operator             VARCHAR(50)  NULL,
  notes                VARCHAR(500) NULL,
  ts                   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_boost_ledger_ref (ccode, ref_no),
  KEY idx_boost_ledger_farmer (ccode, farmer_id, ts),
  KEY idx_boost_ledger_type (ccode, entry_type, ts),
  KEY idx_boost_ledger_run (ccode, payout_run_id),
  KEY idx_boost_ledger_merchant (ccode, mcode, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Per-coop policy. Stored as JSON so we can evolve without further ALTERs.
--    Default: recovery_cap_pct=70, manual limit assignment, boost disabled.
CREATE TABLE IF NOT EXISTS boost_limits_policy (
  ccode              VARCHAR(20)  NOT NULL,
  boost_enabled      TINYINT(1)   NOT NULL DEFAULT 0,
  recovery_cap_pct   DECIMAL(5,2) NOT NULL DEFAULT 70.00,   -- % of gross payout
  limit_mode         ENUM('MANUAL','AUTO_90D','AUTO_SEASON','HYBRID') NOT NULL DEFAULT 'MANUAL',
  policy_json        JSON         NULL,                     -- reserved for future scoring rules
  updated_by         VARCHAR(50)  NULL,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ccode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- End of Phase 1 migration. Phase 2 will add: boost_purchases, payout_runs,
-- payout_lines, merchant_settlements.
