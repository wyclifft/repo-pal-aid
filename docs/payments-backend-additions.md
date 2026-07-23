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

---

## 6. v2.11.6 — KCB BUNI Funds Transfer integration

The mock SACCO service is replaced by real KCB Funds Transfer. Isolated
behind `backend-api/services/kcbPaymentService.js` so future providers
(Co-op / Equity) can be added as sibling files without touching
`server.js` beyond the require line.

### 6.1 Environment variables (set on the host, never committed)

```
KCB_CONSUMER_KEY
KCB_CONSUMER_SECRET
KCB_TOKEN_URL          # default https://accounts.buni.kcbgroup.com/oauth2/token
KCB_TRANSFER_URL       # default https://uat.buni.kcbgroup.com/fundstransfer/1.0.0/api/v1/transfer
KCB_COMPANY_CODE
KCB_DEBIT_ACCOUNT
KCB_CALLBACK_SECRET    # shared secret required on inbound callbacks
```

### 6.2 Schema additions

Additive columns on `payments` — run once on the production DB:

```sql
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS kcb_merchant_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_retrieval_ref VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_ft_reference VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_transaction_message VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS kcb_transaction_date DATETIME NULL;
```

No changes to `cm_members` — the routing lookup uses existing columns
(`descript`, `tel`, `bankcode`, `bnumber`, `payment_method`).

### 6.3 Payout routing (derived server-side from `cm_members`)

| payment_method | transactionType | beneficiaryBankCode | creditAccountNumber |
|---|---|---|---|
| `MPESA`        | `MO`  | `MPESA`   | `tel`     |
| `BANK`, bankcode = `01` | `IF` | `01` | `bnumber` |
| `BANK`, any other bankcode | `EF` | `bankcode` | `bnumber` |

If a required field is missing (MPESA without `tel`, BANK without
`bnumber`/`bankcode`, or an unknown `payment_method`) the payment is
marked `failed` and the source transactions are rolled back to
`payment_status='failed'` — no KCB call is made.

### 6.4 `/api/payments/process` behaviour change

- On KCB **accept** the payment row stays `status='pending'` with
  `external_transaction_id = retrievalRefNumber`, and the source
  transactions stay `payment_status='pending'`.
- The frontend already renders `status: 'pending'` (existing UI state)
  as "awaiting confirmation" — no client change.
- On KCB **decline** (HTTP 4xx/5xx, timeout, or non-success statusCode)
  behaviour matches today: payment `failed`, transactions `failed`.

### 6.5 Callback endpoint

```
POST /api/payments/kcb/callback
Header:  x-kcb-callback-secret: <KCB_CALLBACK_SECRET>
Body:    {
  transactionReference,   // must equal the payment_reference we sent
  statusCode,             // "0" / "00" / "SUCCESS" / "PAID" → success; else failed
  statusDescription,
  merchantID,
  retrievalRefNumber,
  ftReference,
  transactionMessage,
  transactionDate
}
```

- Wrong / missing header → `401 unauthorized`.
- Unknown `transactionReference` → `404 unknown reference`.
- Idempotent: replaying a callback for a settled payment returns
  `200 { success: true, already: true }` with no writes.
- On success flips `payments.status → success` and all locked
  transactions to `payment_status = 'paid'`, invalidates the payable
  cache for the ccode.
- On failure flips `payments.status → failed` and transactions to
  `payment_status = 'failed'` so operators can retry after fixing the
  farmer's payout details.

### 6.6 OAuth token cache

`kcbPaymentService.getAccessToken()` caches the bearer token in-process
until 60 s before its `expires_in`. Concurrent callers share a single
in-flight token exchange (no stampede). On any `401` from the transfer
call the token is invalidated and the request is retried once.

### 6.7 Log tags

- `[PAY][TOKEN] issued expiresIn=<sec>`
- `[PAY][TRANSFER] farmer=<code> ref=<ref> type=<MO|IF|EF> amount=<net>`
- `[PAY][TRANSFER] declined ref=<ref> http=<n> code=<s> desc=<...>`
- `[PAY][CALLBACK] ref=<ref> status=<success|failed> merchant=<id>`
- `[PAY][CALLBACK] unauthorized` / `unknown ref=<ref>` / `already ref=<ref>`

Beneficiary PII (phone, account number, full name) is never logged.

### 6.8 Out of scope for v2.11.6

- No status-poll endpoint (callback-driven only). If KCB never calls
  back, a stuck-pending sweeper is a future addition.
- No change to `/payable`, `/history`, calculation, permissions, or the
  frontend.
