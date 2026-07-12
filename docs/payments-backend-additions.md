# v2.11.2 — Payments module backend additions

The web/APK frontend ships a Payments module backed by the existing native
Node `http.createServer()` backend in `backend-api/server.js`. These additions
are additive and keep legacy APKs compatible.

---

## 1. SQL requirements

These database objects are expected to exist:

```sql
-- psettings: per-company activation flag
ALTER TABLE psettings
  ADD COLUMN IF NOT EXISTS payments_active TINYINT(1) NOT NULL DEFAULT 0;

-- user: per-user permission gate. The production table is `user`, not `users`.
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS can_access_payments TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payments (
  payment_id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  payment_reference       VARCHAR(40)  NOT NULL UNIQUE,
  ccode                   VARCHAR(20)  NOT NULL,
  farmer_code             VARCHAR(40)  NOT NULL,
  amount                  DECIMAL(14,2) NOT NULL,
  status                  ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  payment_date            DATETIME     NOT NULL,
  external_transaction_id VARCHAR(80)  NULL,
  created_by              VARCHAR(40)  NULL,
  created_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pay_ccode_farmer (ccode, farmer_code),
  INDEX idx_pay_ccode_status (ccode, status),
  INDEX idx_pay_ccode_date   (ccode, payment_date)
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  ADD INDEX idx_txn_payment_lookup (ccode, payment_status, memberno);
```

Existing rows default to `unpaid`; no destructive migration is required.

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
