# v2.11.2 — Payments module backend additions

The web/APK frontend ships a Payments module backed by the existing native
Node `http.createServer()` backend in `backend-api/server.js`. These additions
are additive and keep legacy APKs compatible.

---

## 1. SQL requirements

These database objects are expected to exist:

```sql
-- psettings: per-company activation flag + price per Kg
ALTER TABLE psettings
  ADD COLUMN IF NOT EXISTS payments_active TINYINT(1) NOT NULL DEFAULT 0;

-- v2.11.2: rename boost_price_per_kg → price_per_kg. Skip if already renamed.
ALTER TABLE psettings CHANGE COLUMN boost_price_per_kg price_per_kg DECIMAL(14,4) NOT NULL DEFAULT 0;
-- If boost_price_per_kg never existed, use instead:
-- ALTER TABLE psettings ADD COLUMN IF NOT EXISTS price_per_kg DECIMAL(14,4) NOT NULL DEFAULT 0;

-- user: per-user permission gate. The production table is `user`, not `users`.
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS can_access_payments TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payments (
  payment_id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  payment_reference       VARCHAR(40)  NOT NULL UNIQUE,
  ccode                   VARCHAR(20)  NOT NULL,
  farmer_code             VARCHAR(40)  NOT NULL,
  amount                  DECIMAL(14,2) NOT NULL, -- NET amount (gross − crbal deductions)
  status                  ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  payment_date            DATETIME     NOT NULL,
  external_transaction_id VARCHAR(80)  NULL,
  created_by              VARCHAR(40)  NULL,
  created_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pay_ccode_farmer (ccode, farmer_code),
  INDEX idx_pay_ccode_status (ccode, status),
  INDEX idx_pay_ccode_date   (ccode, payment_date)
);

-- v2.11.2: transactions.payment_status extended with pending + failed.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_id BIGINT NULL,
  MODIFY COLUMN payment_status
    ENUM('unpaid','pending','paid','failed') NOT NULL DEFAULT 'unpaid',
  ADD INDEX idx_txn_payment_lookup (ccode, payment_status, memberno);
```

Existing rows default to `unpaid`; no destructive migration is required.

### 1.1 Payment amount calculation (v2.11.2)

For each farmer, over the selected period, the backend computes:

```
total_qty     = SUM(transactions.weight)
                WHERE transtype = 1
                  AND payment_status = 'unpaid'
                  AND transdate ∈ [period.start, period.end]
                  AND ccode = <company>

gross_amount  = total_qty × psettings.price_per_kg
deductions    = MIN( SUM(parsed cm_members.crbal entries), gross_amount )
net_amount    = gross_amount − deductions
```

`cm_members.crbal` is parsed from `"CR01#2000,CR02#1000"` — comma-separated
entries of `code#amount`. Deductions are capped at `gross_amount` so net
payable never goes negative. Only `transtype = 1` (produce delivery)
transactions are considered.

### 1.2 Transaction payment_status lifecycle

- `unpaid`  — default; eligible for payment.
- `pending` — locked into a `payments` row awaiting SACCO confirmation.
- `paid`    — SACCO confirmed success.
- `failed`  — SACCO declined; eligible to be reprocessed (returned to
  `unpaid` manually or by future retry logic).

The `/api/payments/payable` aggregate strictly filters to `unpaid` — pending,
paid, and failed rows never appear as available to pay.


---

## 2. Native `server.js` routing contract

The backend is **not Express**. Payment routes are implemented directly in the
existing manual routing chain:

```text
GET  /api/payments/payable?period=day|week|month|season&uniquedevcode=...&userid=...
POST /api/payments/process
GET  /api/payments/history?uniquedevcode=...&userid=...&farmer_code=&from=&to=
```

`POST /api/payments/process` body:

```json
{
  "farmer_codes": ["M01859"],
  "period": "month",
  "device_fingerprint": "...",
  "userid": "..."
}
```

Access rules:

- Resolve `ccode` from `devsettings.uniquedevcode` / `device_fingerprint`.
- Require `devsettings.authorized = 1`.
- Require `psettings.payments_active = 1` for that `ccode`.
- Require `user.can_access_payments = 1` for the same `ccode` and `userid`.
- Every query is filtered by `ccode`.

---

## 3. Mock SACCO boundary

The current implementation uses a mock payment charge function in `server.js`
that returns `{ success, external_transaction_id }`. A real SACCO integration
must keep that same shape so the workflow and client contract do not change.

---

## 4. Rollout order

1. Confirm the SQL requirements above already exist.
2. Deploy `backend-api/server.js` v2.11.1.
3. Deploy the frontend v2.11.1.
4. Set `psettings.payments_active = 1` for the pilot company.
5. Set `user.can_access_payments = 1` for authorized operators.
6. Login again so the frontend receives the fresh `can_access_payments` value.

---

## 5. v2.11.3 — Production performance layer

Under load (>200k `transactions` rows) the original `/api/payments/payable`
aggregate scanned the full table and the shared MySQL host was closing the
socket (`PROTOCOL_CONNECTION_LOST`). Three additive changes make the endpoint
production-safe:

### 5.1 Required indexes

Run `backend-api/MIGRATION_PAYMENTS_INDEXES.sql` once:

```sql
CREATE INDEX idx_tx_pay_scan   ON transactions (ccode, transtype, payment_status, transdate);
CREATE INDEX idx_tx_pay_member ON transactions (ccode, memberno, transtype, payment_status);
CREATE INDEX idx_cm_ccode_mcode ON cm_members  (ccode, mcode);
```

`EXPLAIN` the new payable query and confirm `key = idx_tx_pay_scan` with
`Using index condition`.

### 5.2 Query shape

`/api/payments/payable` now runs two small queries:

1. Aggregate on the indexed columns only — no `LEFT JOIN`, no per-row
   `CAST/UPPER/TRIM`, half-open date window (`transdate >= start AND
   transdate < endExclusive`) so the composite index drives the scan.
2. Lookup `cm_members.descript` + `crbal` for only the farmers that
   appeared in step 1, chunked at 500 codes per `IN (...)`.

Merge and net-amount math happen in JS. The behaviour and response shape
are unchanged.

### 5.3 Cache + retry

- 60 s in-process response cache keyed by
  `payable:${ccode}:${period}:${start}:${end}:${pricePerKg}`.
  A burst of dashboard opens collapses to one aggregate per company per
  minute. Logs `[PAY][PAYABLE][CACHE] hit` on hits.
- `/api/payments/process` invalidates the cache for its `ccode` on
  success so paid farmers disappear from the list immediately.
- Both payable queries run through a single-retry wrapper that catches
  `PROTOCOL_CONNECTION_LOST` / `ECONNRESET` / `ER_QUERY_INTERRUPTED` /
  `PROTOCOL_PACKETS_OUT_OF_ORDER`. Retries log `[PAY][PAYABLE][RETRY]`.

No frontend change is required for v2.11.3.
