-- =====================================================================
-- MIGRATION: Farmer Boost — Phase 3 (Auto-enrollment + Merchants v2)
-- Version:   v2.10.123-boost
-- Purpose:
--   1) Auto-enroll farmers via cm_members flags
--   2) Universal credit pricing + limit % on psettings
--   3) Rename merchant code (mcode -> mercode) everywhere
--   4) Company binding + role-gated merchant creation
--   5) Scope items to merchants via fm_items.mercode
-- Safety:    Additive + guarded renames. Re-runnable (idempotent guards).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. cm_members: auto-enrollment flags
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cm_members'
    AND COLUMN_NAME='farmer_boost_active');
SET @s := IF(@c=0,
  'ALTER TABLE cm_members ADD COLUMN farmer_boost_active TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cm_members'
    AND COLUMN_NAME='limit_percentage');
SET @s := IF(@c=0,
  'ALTER TABLE cm_members ADD COLUMN limit_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- Helpful index for the enrolled-farmer listing on the Accounts tab
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cm_members'
    AND INDEX_NAME='idx_cm_boost_active');
SET @s := IF(@c=0,
  'CREATE INDEX idx_cm_boost_active ON cm_members (ccode, farmer_boost_active)',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- ---------------------------------------------------------------------
-- 2. psettings: universal boost pricing & limit
--    - boost_price_per_kg : produce price used to convert cumulative Kgs -> KES
--    - boost_limit_pct    : universal cap; if 0 fall back to cm_members.limit_percentage
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='psettings'
    AND COLUMN_NAME='boost_price_per_kg');
SET @s := IF(@c=0,
  'ALTER TABLE psettings ADD COLUMN boost_price_per_kg DECIMAL(10,2) NOT NULL DEFAULT 0.00',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='psettings'
    AND COLUMN_NAME='boost_limit_pct');
SET @s := IF(@c=0,
  'ALTER TABLE psettings ADD COLUMN boost_limit_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- ---------------------------------------------------------------------
-- 3. users: role-gated merchant creation
--    can_manage_merchants=1 lets a user open the /boost Merchants tab.
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'
    AND COLUMN_NAME='can_manage_merchants');
SET @s := IF(@c=0,
  'ALTER TABLE users ADD COLUMN can_manage_merchants TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- Merchant login binding — when approving a merchant user we store the mercode
-- (not ccode) so the merchant sees only their scoped screens.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'
    AND COLUMN_NAME='mercode');
SET @s := IF(@c=0,
  'ALTER TABLE users ADD COLUMN mercode VARCHAR(20) NULL',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users'
    AND COLUMN_NAME='orgtype');
SET @s := IF(@c=0,
  "ALTER TABLE users ADD COLUMN orgtype CHAR(1) NULL COMMENT 'C=coffee, D=dairy, M=merchant'",
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- ---------------------------------------------------------------------
-- 4. merchants: rename mcode -> mercode (guarded), add company link
--    Phase 2 created the boost_merchants / merchants table with `mcode`.
--    We rename to `mercode` if the old column still exists.
-- ---------------------------------------------------------------------
SET @has_old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants'
    AND COLUMN_NAME='mcode');
SET @has_new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants'
    AND COLUMN_NAME='mercode');
SET @s := IF(@has_old=1 AND @has_new=0,
  'ALTER TABLE merchants CHANGE COLUMN mcode mercode VARCHAR(20) NOT NULL',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- Ensure orgtype='M' marker exists on merchants (used by UI to hide Buy/Sell/Route).
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants'
    AND COLUMN_NAME='orgtype');
SET @s := IF(@c=0,
  "ALTER TABLE merchants ADD COLUMN orgtype CHAR(1) NOT NULL DEFAULT 'M'",
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- ccode already stored on merchants (from Phase 2). Add an FK-style index so
-- the "company selector" resolves fast on the create-merchant form.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='merchants'
    AND INDEX_NAME='idx_merchants_ccode');
SET @s := IF(@c=0,
  'CREATE INDEX idx_merchants_ccode ON merchants (ccode)',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- ---------------------------------------------------------------------
-- 5. Rename mcode -> mercode on downstream tables
-- ---------------------------------------------------------------------
-- boost_ledger.mcode -> mercode
SET @has_old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='boost_ledger'
    AND COLUMN_NAME='mcode');
SET @has_new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='boost_ledger'
    AND COLUMN_NAME='mercode');
SET @s := IF(@has_old=1 AND @has_new=0,
  'ALTER TABLE boost_ledger CHANGE COLUMN mcode mercode VARCHAR(20) NULL',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- boost_purchases.mcode -> mercode
SET @has_old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='boost_purchases'
    AND COLUMN_NAME='mcode');
SET @has_new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='boost_purchases'
    AND COLUMN_NAME='mercode');
SET @s := IF(@has_old=1 AND @has_new=0,
  'ALTER TABLE boost_purchases CHANGE COLUMN mcode mercode VARCHAR(20) NOT NULL',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- Rebuild the merchant index name on boost_purchases if the old one exists
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='boost_purchases'
    AND INDEX_NAME='idx_bp_merchant');
SET @s := IF(@c=1, 'DROP INDEX idx_bp_merchant ON boost_purchases', 'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;
CREATE INDEX IF NOT EXISTS idx_bp_merchant
  ON boost_purchases (ccode, mercode, created_at);

-- ---------------------------------------------------------------------
-- 6. fm_items: scope items to a merchant (mirrors ccode isolation)
-- ---------------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fm_items'
    AND COLUMN_NAME='mercode');
SET @s := IF(@c=0,
  'ALTER TABLE fm_items ADD COLUMN mercode VARCHAR(20) NULL',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fm_items'
    AND INDEX_NAME='idx_fm_items_mercode');
SET @s := IF(@c=0,
  'CREATE INDEX idx_fm_items_mercode ON fm_items (ccode, mercode)',
  'SELECT 1');
PREPARE q FROM @s; EXECUTE q; DEALLOCATE PREPARE q;

-- =====================================================================
-- END Phase 3 migration.
-- Rollback (manual, destructive — run only if reverting the whole phase):
--   ALTER TABLE merchants        CHANGE COLUMN mercode mcode VARCHAR(20) NOT NULL;
--   ALTER TABLE boost_ledger     CHANGE COLUMN mercode mcode VARCHAR(20) NULL;
--   ALTER TABLE boost_purchases  CHANGE COLUMN mercode mcode VARCHAR(20) NOT NULL;
--   ALTER TABLE cm_members       DROP COLUMN farmer_boost_active, DROP COLUMN limit_percentage;
--   ALTER TABLE psettings        DROP COLUMN boost_price_per_kg, DROP COLUMN boost_limit_pct;
--   ALTER TABLE users            DROP COLUMN can_manage_merchants, DROP COLUMN mercode, DROP COLUMN orgtype;
--   ALTER TABLE fm_items         DROP COLUMN mercode;
-- =====================================================================
