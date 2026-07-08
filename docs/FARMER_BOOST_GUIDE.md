# Farmer Boost — Operator Guide

**Version:** v2.11.2  ·  **Feature flag:** `psettings.boost_enabled` (per coop)

Farmer Boost is the Farm Input Credit Financing feature. It lets the cooperative extend a credit limit to a member, disburse cash advances, and record credit-funded input purchases from approved merchants. The credit is designed to be recovered automatically from the farmer's next coffee payout (recovery cap default 70%). The feature is **dormant by default** — no farmer-facing screen changes until an admin flips the flag on for a coop.

---

## 1. How it works — end-to-end

```
        ┌──────────────────┐
        │  ADMIN (SQL)     │
        │  psettings       │
        │  boost_enabled=1 │
        └────────┬─────────┘
                 │
                 ▼
     ┌───────────────────────┐        ┌──────────────────────────┐
     │  OFFICER  (/boost)    │        │  MEMBER (Sell screen)    │
     │  ─────────────────    │        │  ────────────────────    │
     │  1. Merchants tab     │        │  Silent chip appears     │
     │     Onboard suppliers │        │  when outstanding > 0    │
     │  2. Accounts tab      │        │                          │
     │     Enroll member     │◀──────▶│  Farmer chooses to buy   │
     │     Set credit limit  │        │  inputs on credit at an  │
     │  3. Purchase tab      │        │  approved merchant.      │
     │     Post PURCHASE     │        │                          │
     │     (or DISBURSE cash)│        │                          │
     │  4. Farmer 360 tab    │        │                          │
     │     View ledger       │        │                          │
     └───────────┬───────────┘        └──────────────────────────┘
                 │
                 ▼
     ┌────────────────────────────────────────────────┐
     │  boost_ledger (append-only, ccode-scoped)      │
     │  DISBURSE / PURCHASE   → outstanding ↑         │
     │  RECOVER / SETTLE      → outstanding ↓ (P4)    │
     │  ADJUST / REVERSAL     → correction (no edits) │
     └────────────────────────────────────────────────┘
```

Every write is:

- **Device-gated** — the operator's tablet must appear in `approved_devices` (same rule as milk/store writes). Unapproved devices get 401.
- **Coop-gated** — the endpoint short-circuits when `psettings.boost_enabled = 0`.
- **Idempotent** — duplicates of the same `ref_no` (ledger) or `pref_no` (purchases) return the original row instead of double-posting.
- **Transactional** — the ledger row and the account's `outstanding` update in a single MySQL transaction with `SELECT … FOR UPDATE`. They can never drift.

---

## 2. Database — table & column reference

Boost adds **five** tables and **one** column. No existing table structure is changed. Rollback is `DROP` the five tables + `ALTER TABLE psettings DROP COLUMN boost_enabled`.

### 2.1 `psettings.boost_enabled` (column)

| Column          | Type            | Purpose                                                                 |
|-----------------|-----------------|-------------------------------------------------------------------------|
| `boost_enabled` | `TINYINT(1)`    | Master switch, **authoritative**. `1` = feature live for this coop, `0` = dormant. `psettings` is the app-wide config source of truth; `boost_limits_policy.boost_enabled` acts as fallback only. |

Enable per coop:

```sql
UPDATE psettings SET boost_enabled = 1 WHERE ccode = 'YOUR_CCODE';
```

### 2.2 `merchants` — approved input suppliers

Onboarded from the **Merchants** tab. One row per (mcode, ccode). Never delete — a merchant that has been paid a settlement must stay resolvable for audit.

| Column         | Type                             | Meaning                                                             |
|----------------|----------------------------------|---------------------------------------------------------------------|
| `mcode`        | `VARCHAR(20)`  (PK part)         | Merchant code — free text, uppercase convention (e.g. `AGRO01`).    |
| `ccode`        | `VARCHAR(20)`  (PK part)         | Cooperative code (multi-tenant isolation).                          |
| `name`         | `VARCHAR(200)`                   | Business name / description. Shown in typeahead.                    |
| `kra_pin`      | `VARCHAR(30)` nullable           | KRA PIN for tax records.                                            |
| `phone`        | `VARCHAR(20)` nullable           | Contact number.                                                     |
| `till_paybill` | `VARCHAR(30)` nullable           | M-Pesa till or paybill for settlement.                              |
| `bank_name`    | `VARCHAR(100)` nullable          | Settlement bank.                                                    |
| `bank_acc`     | `VARCHAR(50)` nullable           | Settlement account number.                                          |
| `status`       | `ENUM('PENDING','ACTIVE','SUSPENDED')` | Only `ACTIVE` merchants accept new purchases.                 |
| `created_at`   | `DATETIME`                       | When onboarded.                                                     |
| `updated_at`   | `DATETIME`                       | Auto-updated on every change.                                       |

### 2.3 `boost_accounts` — per-member credit position

One row per (farmer_id, ccode). Created the first time an officer sets a limit for that farmer.

| Column         | Type                                | Meaning                                                  |
|----------------|-------------------------------------|----------------------------------------------------------|
| `farmer_id`    | `VARCHAR(30)` (PK part)             | Normalised member ID (e.g. `M00123`).                    |
| `ccode`        | `VARCHAR(20)` (PK part)             | Cooperative code.                                        |
| `credit_limit` | `DECIMAL(12,2)`                     | Officer-set ceiling. `0` = enrolled but no credit yet.   |
| `outstanding`  | `DECIMAL(12,2)`                     | Principal currently owed (sum of DISBURSE + PURCHASE − RECOVER − WRITEOFF ± ADJUST/REVERSAL). |
| `hold_amount`  | `DECIMAL(12,2)`                     | Reserved amount during a pending purchase (Phase 4 pre-auth).   |
| `status`       | `ENUM('INACTIVE','ACTIVE','FROZEN','WRITEOFF')` | `ACTIVE` = can transact. `FROZEN` = read-only. `WRITEOFF` = bad debt cleared. |
| `score`        | `INT` nullable                      | Future auto-limit signal (reserved).                     |
| `set_by`       | `VARCHAR(50)` nullable              | Officer username who last touched the limit.             |
| `notes`        | `VARCHAR(500)` nullable             | Free-text remarks.                                       |
| `created_at`   | `DATETIME`                          | First enrolment.                                         |
| `updated_at`   | `DATETIME`                          | Auto-updated on every write.                             |

Available credit at print time:
`available = max(0, credit_limit − outstanding − hold_amount)`

### 2.4 `boost_ledger` — append-only movement log

**Never** updated or deleted. Corrections are new `ADJUST` or `REVERSAL` rows. This is what audit relies on.

| Column               | Type                                                                                  | Meaning                                                                |
|----------------------|---------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| `id`                 | `BIGINT UNSIGNED` (PK, auto-increment)                                                | Ledger row ID (referenced by `reverses_id`).                           |
| `ccode`              | `VARCHAR(20)`                                                                         | Cooperative code.                                                      |
| `farmer_id`          | `VARCHAR(30)`                                                                         | Member the entry applies to.                                           |
| `entry_type`         | `ENUM('DISBURSE','PURCHASE','RECOVER','SETTLE','ADJUST','WRITEOFF','REVERSAL')`       | See sign convention below.                                             |
| `amount`             | `DECIMAL(12,2)`                                                                       | **Signed.** `+` increases outstanding, `−` decreases it.               |
| `ref_no`             | `VARCHAR(50)`                                                                         | Idempotency key — unique per (ccode, ref_no). Duplicate posts are no-ops. |
| `mcode`              | `VARCHAR(20)` nullable                                                                | Merchant, populated on `PURCHASE` / `SETTLE`.                          |
| `related_transrefno` | `VARCHAR(50)` nullable                                                                | Links to a sales/milk `transrefno` when the entry stems from a receipt.|
| `payout_run_id`      | `VARCHAR(50)` nullable                                                                | Populated by Phase 4 payout engine on `RECOVER` / `SETTLE`.            |
| `reverses_id`        | `BIGINT UNSIGNED` nullable                                                            | Set on `REVERSAL` rows — points at the original entry being undone.    |
| `device_code`        | `VARCHAR(30)` nullable                                                                | Device that captured the entry.                                        |
| `operator`           | `VARCHAR(50)` nullable                                                                | Officer username.                                                      |
| `notes`              | `VARCHAR(500)` nullable                                                               | Free-text (visible in Farmer 360°).                                    |
| `ts`                 | `DATETIME`                                                                            | Business timestamp.                                                    |
| `synced_at`          | `DATETIME`                                                                            | When the row landed on the server.                                     |

**Sign convention (amounts stored as-signed):**

| Entry type | Sign | Effect on `outstanding` |
|------------|------|-------------------------|
| DISBURSE   | `+`  | ↑ (cash advance to farmer)  |
| PURCHASE   | `+`  | ↑ (bought inputs on credit) |
| RECOVER    | `−`  | ↓ (deducted from payout — Phase 4) |
| SETTLE     | `0`  | Merchant leg only, no farmer impact |
| ADJUST     | `±`  | Manual correction, either direction |
| WRITEOFF   | `−`  | ↓ (bad debt cleared)       |
| REVERSAL   | opposite of the row it reverses | undoes a prior entry |

### 2.5 `boost_limits_policy` — per-coop rules

| Column             | Type                                                    | Meaning                                                             |
|--------------------|---------------------------------------------------------|---------------------------------------------------------------------|
| `ccode`            | `VARCHAR(20)` (PK)                                      | One row per cooperative.                                            |
| `boost_enabled`    | `TINYINT(1)`                                            | **Fallback** flag; `psettings.boost_enabled` wins.                  |
| `recovery_cap_pct` | `DECIMAL(5,2)` default `70.00`                          | Max % of a payout that can be diverted to Boost recovery.           |
| `limit_mode`       | `ENUM('MANUAL','AUTO_90D','AUTO_SEASON','HYBRID')`      | v2.11.x is **MANUAL** only — officer sets every limit.              |
| `policy_json`      | `JSON` nullable                                         | Reserved for future scoring rules.                                  |
| `updated_by`       | `VARCHAR(50)` nullable                                  | Last admin to change the policy.                                    |
| `updated_at`       | `DATETIME`                                              | Auto-updated.                                                       |

### 2.6 `boost_purchases` — merchant-side purchase record

Human-readable snapshot of the purchase. Each row is paired with exactly one `boost_ledger.PURCHASE` via `ledger_id`.

| Column               | Type                                       | Meaning                                                          |
|----------------------|--------------------------------------------|------------------------------------------------------------------|
| `pref_no`            | `VARCHAR(50)` (PK part)                    | Purchase reference (idempotency key). Client-generated `BP-…`.   |
| `ccode`              | `VARCHAR(20)` (PK part)                    | Cooperative.                                                     |
| `farmer_id`          | `VARCHAR(30)`                              | Buyer.                                                           |
| `mcode`              | `VARCHAR(20)`                              | Merchant.                                                        |
| `items_json`         | `JSON` nullable                            | Optional itemised basket `[{name, qty, unit_price}]`.            |
| `total`              | `DECIMAL(12,2)`                            | Purchase total (must equal the paired ledger PURCHASE amount).   |
| `status`             | `ENUM('PENDING','POSTED','VOID')`          | v2.11.x posts as `POSTED` directly (no pre-auth flow yet).       |
| `device_code`        | `VARCHAR(30)` nullable                     | Capturing device.                                                |
| `operator`           | `VARCHAR(50)` nullable                     | Officer username.                                                |
| `related_transrefno` | `VARCHAR(50)` nullable                     | Original store txn, if any.                                      |
| `ledger_id`          | `BIGINT UNSIGNED` nullable                 | FK-in-spirit to `boost_ledger.id`.                               |
| `notes`              | `VARCHAR(500)` nullable                    | Free text.                                                       |

---

## 3. Endpoint reference

All endpoints live under `/api/boost/*` and require `uniquedevcode` (device fingerprint). The server resolves the coop's `ccode` from `approved_devices` / `devsettings` — clients never send `ccode`.

| Method | Path                                    | Purpose                              | Idempotency          | Writes device-gated? |
|--------|-----------------------------------------|--------------------------------------|----------------------|----------------------|
| GET    | `/api/boost/policy`                     | Read feature flag + recovery cap     | —                    | —                    |
| GET    | `/api/boost/account/:farmerId`          | One farmer's account snapshot        | —                    | —                    |
| GET    | `/api/boost/ledger/:farmerId?limit=N`   | Ledger, newest first, capped at 500  | —                    | —                    |
| GET    | `/api/boost/accounts`                   | List enrolled farmers                | —                    | —                    |
| POST   | `/api/boost/limit`                      | Upsert `credit_limit` + ADJUST row on change | (ccode, ref_no) auto-generated | Yes |
| POST   | `/api/boost/disburse`                   | Cash advance (DISBURSE + `outstanding +=`) | (ccode, ref_no)      | Yes                  |
| POST   | `/api/boost/purchase`                   | Merchant purchase (PURCHASE + boost_purchases) | (ccode, pref_no) | Yes                  |
| GET    | `/api/boost/merchants`                  | List merchants                       | —                    | —                    |
| POST   | `/api/boost/merchants`                  | Upsert merchant by (ccode, mcode)    | natural PK           | Yes                  |

---

## 4. Operator playbooks

The screenshots referenced below live under `docs/images/boost/`. When the feature is not yet enabled for your coop the guide's screenshots may be blank — the app renders a "Farmer Boost is not enabled" card at `/boost` until an admin runs the SQL in step 1.

### Playbook 1 — Enable Boost for a coop (one-time, admin)

1. Apply the migrations, in order:
   - `backend-api/MIGRATION_BOOST_PHASE1.sql`
   - `backend-api/MIGRATION_BOOST_PHASE2.sql`
2. Set the flag:

   ```sql
   UPDATE psettings SET boost_enabled = 1 WHERE ccode = 'YOUR_CCODE';
   ```

3. (Optional) Adjust the recovery cap:

   ```sql
   INSERT INTO boost_limits_policy (ccode, boost_enabled, recovery_cap_pct, limit_mode)
   VALUES ('YOUR_CCODE', 1, 70.00, 'MANUAL')
   ON DUPLICATE KEY UPDATE recovery_cap_pct = VALUES(recovery_cap_pct);
   ```

4. Open the app on an **approved** device → sidebar → **Farmer Boost** → the four tabs appear.

*Screenshot: `docs/images/boost/06-flag-off.png` — "Farmer Boost is not enabled" placeholder shown before step 2 runs.*

### Playbook 2 — Onboard a merchant (Merchants tab)

1. Open `/boost` → **Merchants** tab → **+ New merchant**.
2. Fill in:
   - **Merchant code** — free text, uppercase (e.g. `AGRO01`).
   - **Business name** — this is the description shown in the typeahead when officers post a purchase.
   - Optional: KRA PIN, phone, till/paybill, bank details.
3. **Status** — start with `PENDING` if paperwork is still incomplete, or `ACTIVE` to allow purchases immediately.
4. Save.

To edit an existing merchant, click **Edit** on the row. The `mcode` is locked (it is part of the primary key and appears on prior ledger rows). Suspending a merchant flips `status` to `SUSPENDED` — new purchases are blocked, historical rows stay resolvable.

*Screenshot: `docs/images/boost/02-merchants.png`.*

### Playbook 3 — Enrol a member & set a credit limit (Accounts tab)

The **Enroll member / set limit** card at the top of Accounts uses a live picker fed by your cooperative's member directory (`cm_members`, filtered by ccode via device auth, cached in the app's IndexedDB `farmers` store — works offline).

1. Type either the ID or part of the member's name:
   - `1` → resolves to `M00001`.
   - `M02` → shows all members whose ID starts with `M02`.
   - `mary` → shows every member with `mary` in the name.
2. Pick a suggestion. The `farmer_id` field fills with the normalised, uppercase ID.
3. Enter the initial credit limit in KSh (`0` is allowed — it enrols the member with no credit yet).
4. **Save**.

The member appears in the table below with `Outstanding = KSh 0.00`, `Available = <limit>`, `Status = ACTIVE`. Only members already in the cooperative directory are suggested; enrolled members are hidden from the picker to prevent duplicates.

To change a limit later, click **Adjust / Disburse** on the row — this opens a modal where you can raise/lower the limit or record a cash advance (DISBURSE).

*Screenshot: `docs/images/boost/01-accounts.png`.*

### Playbook 4 — Record a credit-funded input purchase (Purchase tab)

1. **Member** field — same typeahead as enrolment; type ID or name, pick.
2. Click **Load** — the card shows the member's Limit / Outstanding / Available. If the picker shows *"Farmer not enrolled — set a credit limit first"* head back to Accounts.
3. **Merchant** field — type the merchant code (e.g. `AGRO01`) **or** part of the merchant's name (e.g. `agrovet`). Suggestions include a status badge. Only `ACTIVE` merchants can be selected here; `SUSPENDED` merchants are filtered out of the dropdown and blocked on submit.
4. Enter the **Amount (KSh)**. Must not exceed **Available** credit.
5. Add optional notes (item list, receipt number, etc.).
6. **Post purchase**.

The server generates a unique `pref_no` (`BP-…`) client-side. If the tablet is offline the button stays disabled — Phase 4 will add an offline queue.

*Screenshot: `docs/images/boost/03-purchase.png`.*

### Playbook 5 — Farmer 360° view

1. Open the **Farmer 360** tab.
2. Type an ID or name → **Load**.
3. Cards show `Limit / Outstanding / Available`.
4. Ledger table below lists every entry (newest first) with type badge, signed amount, ref number, merchant, notes.

Read-only — this is the audit surface. On the Sell screen a small `<BoostOutstandingChip />` shows the same outstanding balance next to the member's name whenever it's > 0 (silently hidden otherwise).

*Screenshots: `docs/images/boost/04-farmer360.png`, `docs/images/boost/05-sell-chip.png`.*

### Playbook 6 — Reverse an entry (no deletes)

The ledger is append-only. To fix a mistake:

1. Note the incorrect entry's `id` and `amount` from Farmer 360°.
2. Post a `REVERSAL` (v2.11.x: contact backend admin — a UI action is a Phase 4 item). The reversal row carries `reverses_id = <original id>` and `amount = -<original amount>`, restoring outstanding.
3. Post a fresh, correct entry.

The original row **stays** in the ledger for audit.

---

## 5. Troubleshooting

| Symptom                                          | Likely cause                                          | Fix                                                                              |
|--------------------------------------------------|-------------------------------------------------------|----------------------------------------------------------------------------------|
| `/boost` shows "Farmer Boost is not enabled"     | `psettings.boost_enabled = 0`                         | Run the enable SQL (Playbook 1 step 2).                                          |
| Every write returns 401 / "device not approved"  | Tablet fingerprint missing from `approved_devices`    | Approve the device via the same flow as milk/store writes.                       |
| POST duplicate is silently accepted              | Same `ref_no` / `pref_no` submitted twice             | This is by design — server returns the original row (`duplicate: true`).         |
| Farmer picker shows no results                   | Members cache empty (fresh install / cache cleared)   | Open Dashboard once online so the members sync repopulates the cache.            |
| Merchant not in Purchase dropdown                | Merchant `status ≠ ACTIVE`                            | Edit the merchant in the Merchants tab and set status to `ACTIVE`.               |
| Amount blocked with "Exceeds available credit"   | `amount > credit_limit − outstanding − hold_amount`   | Increase the credit limit in Accounts, or record a smaller purchase.             |
| Nothing appears offline                          | Boost writes require a live connection in v2.11.x     | Wait for connectivity — offline queue lands in Phase 4.                          |

---

## 6. Rollback

Boost is fully additive. To remove it entirely from a coop or the whole server:

```sql
DROP TABLE IF EXISTS boost_purchases;
DROP TABLE IF EXISTS boost_ledger;
DROP TABLE IF EXISTS boost_accounts;
DROP TABLE IF EXISTS boost_limits_policy;
DROP TABLE IF EXISTS merchants;
ALTER TABLE psettings DROP COLUMN boost_enabled;
```

No other table is touched. The rest of the app — milk collection, store, receipts, sync, device auth — is completely unaffected.

---

## 7. Not yet included (Phase 4 roadmap)

- **Automatic recovery from payout runs** — `RECOVER` entries created by the payout engine, capped at `recovery_cap_pct`.
- **Merchant settlements** — `SETTLE` entries + settlement report.
- **Offline queue** for Boost writes.
- **Merchant self-service web portal** (`/m/*`).
- **Automatic credit scoring** (`limit_mode = AUTO_*`).
