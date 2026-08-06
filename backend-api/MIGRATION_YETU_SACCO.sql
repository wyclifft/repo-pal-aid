-- v2.12.0 — Yetu Sacco Member Payments Module.
-- Fully additive. Nothing existing is altered destructively.
-- Run once on the production MySQL database.

-- ---------------------------------------------------------------------------
-- 1. Sacco members (independent of cm_members)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sacco_members (
  member_id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  ccode           VARCHAR(20)  NOT NULL,
  account_number  VARCHAR(60)  NOT NULL,
  full_name       VARCHAR(160) NULL,
  mobile          VARCHAR(30)  NULL,
  national_id     VARCHAR(40)  NULL,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sacco_member_account (ccode, account_number),
  KEY idx_sacco_member_mobile (ccode, mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 2. Sacco transactions (webhook deposits)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sacco_transactions (
  txn_id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  ccode                 VARCHAR(20)   NOT NULL,
  member_id             BIGINT        NULL,
  account_number_raw    VARCHAR(60)   NOT NULL,
  transaction_reference VARCHAR(80)   NOT NULL,
  amount                DECIMAL(14,2) NOT NULL,
  payer_name            VARCHAR(160)  NULL,
  payer_mobile          VARCHAR(30)   NULL,
  transaction_date      DATETIME      NOT NULL,
  channel               VARCHAR(40)   NOT NULL DEFAULT 'YETU',
  txn_type              VARCHAR(20)   NOT NULL DEFAULT 'deposit',
  allocation_status     ENUM('allocated','unallocated') NOT NULL DEFAULT 'unallocated',
  raw_payload           TEXT          NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sacco_txn_ref (transaction_reference),
  KEY idx_sacco_txn_member (ccode, member_id, transaction_date),
  KEY idx_sacco_txn_date (ccode, transaction_date),
  KEY idx_sacco_txn_account (ccode, account_number_raw)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 3. Webhook request audit log (written before validation — nothing is lost)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yetu_webhook_logs (
  log_id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  received_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_ip             VARCHAR(60)  NULL,
  endpoint              VARCHAR(120) NOT NULL,
  http_status           INT          NULL,
  outcome               ENUM('received','accepted','duplicate','invalid','error') NOT NULL DEFAULT 'received',
  transaction_reference VARCHAR(80)  NULL,
  raw_body              TEXT         NULL,
  raw_headers           TEXT         NULL,
  error_message         VARCHAR(255) NULL,
  KEY idx_yetu_log_ref (transaction_reference),
  KEY idx_yetu_log_time (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- 4. Link an application login to a sacco member account
-- ---------------------------------------------------------------------------
-- MySQL 8+: ADD COLUMN IF NOT EXISTS. On 5.7 drop the IF NOT EXISTS clause
-- and skip the statement when the column already exists.
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS link_account VARCHAR(60) NULL;

-- ---------------------------------------------------------------------------
-- 5. Organisation type 'S' (Sacco). psettings.orgtype is already a varchar,
--    so no schema change is required — only data:
--      UPDATE psettings SET orgtype = 'S', payments_active = 1 WHERE ccode = '<CCODE>';
--      UPDATE user SET can_access_payments = 1, link_account = '<ACCOUNT>' WHERE userid = '<USER>';
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. v2.12.8 — multi-account members + truly unallocated deposits
--    Additive and safe to re-run.
-- ---------------------------------------------------------------------------
-- Deposits for an unknown account are stored with member_id AND ccode NULL,
-- so they are never attributed to another Sacco's books.
ALTER TABLE sacco_transactions
  MODIFY COLUMN ccode VARCHAR(20) NULL;

-- A member may own several account numbers separated by '&&'
--   e.g. 77136#T001&&77137#T002&&77138#T003
ALTER TABLE sacco_members
  MODIFY COLUMN account_number VARCHAR(255) NOT NULL;

-- A login may be linked to several accounts separated by '#'
--   e.g. UPDATE Users SET link_account = '77136#T001&&77137#T002' WHERE userid = '<USER>';
ALTER TABLE Users
  MODIFY COLUMN link_account VARCHAR(255) NULL;
