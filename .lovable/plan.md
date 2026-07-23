
# KCB Funds Transfer integration

Isolate the payment provider behind a new service module, keep the Payments module, frontend, calculation, permission, history, and status enum untouched. Only `chargeFarmerMock` is replaced, plus one new callback endpoint. Version bump to **v2.11.5** (backend + app).

Nothing in `src/modules/payments/**` changes. `PaymentResult.status` already accepts `'pending'` so the frontend renders the new "awaiting callback" state without edits.

---

## 1. New provider service — `backend-api/services/kcbPaymentService.js`

Provider-independent shape so Co-op/Equity/etc. can be added later as sibling files.

Exports:

- `getAccessToken()` — OAuth2 client-credentials against `KCB_TOKEN_URL`. In-memory cache `{ token, expiresAt }`; refresh 60 s before `expires_in`. Concurrent callers await a single in-flight promise (no token stampede). Logs `[PAY][TOKEN] issued expiresIn=<sec>` — never logs the token or secret.
- `transferFunds(payload, { requestId })` — `POST KCB_TRANSFER_URL` with `Authorization: Bearer <token>`, 20 s axios timeout. Returns raw KCB body + HTTP status. On `401`, invalidate cached token and retry once.
- `chargeFarmerViaKCB({ ref, amount, farmerName, accountNumber, bankCode, transactionType, ccode, requestId })` — builds the KCB body, calls `transferFunds`, normalises the response to:

  ```js
  {
    success: boolean,       // true only when KCB accepted the request (HTTP 2xx + statusCode "0"/"Accepted")
    external_transaction_id, // KCB retrievalRefNumber || ftReference || requestReference
    statusCode,
    statusDescription,
    merchantID,
    retrievalRefNumber,
    raw,                     // full response, for audit
  }
  ```

`success: true` here means **accepted for processing**, not "paid" — the callback finalises status.

Dependency: `axios` (add to `backend-api/package.json` if missing).

## 2. Env / secrets

Read from `process.env` in the service — no hardcoding, no logging:

```
KCB_CONSUMER_KEY
KCB_CONSUMER_SECRET
KCB_TOKEN_URL          # default https://accounts.buni.kcbgroup.com/oauth2/token
KCB_TRANSFER_URL       # default https://uat.buni.kcbgroup.com/fundstransfer/1.0.0/api/v1/transfer
KCB_COMPANY_CODE
KCB_DEBIT_ACCOUNT
KCB_CALLBACK_SECRET    # shared secret to authenticate inbound callbacks
```

Documented in `docs/payments-backend-additions.md §6`. Ops sets them on the production host.

## 3. Rework `/api/payments/process` in `server.js` (~L4483)

Only the SACCO block changes. Per farmer, inside the existing loop:

1. Compute payable + insert `payments` row (`status='pending'`, NET amount) + flip source transactions to `payment_status='pending'` (unchanged).
2. **New lookup** — after commit, before calling KCB, fetch beneficiary from `cm_members`:

   ```sql
   SELECT descript, tel, bankcode, bnumber, payment_method
     FROM cm_members
    WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
      AND UPPER(TRIM(mcode)) = UPPER(TRIM(?))
    LIMIT 1
   ```

   Backend derives KCB routing (frontend sends nothing):

   | payment_method | transactionType | beneficiaryBankCode | creditAccountNumber |
   |---|---|---|---|
   | `MPESA` | `MO` | `MPESA` | `tel` |
   | `BANK`, bankcode=`01` | `IF` | `01` | `bnumber` |
   | `BANK`, other bankcode | `EF` | `bankcode` | `bnumber` |

   Guard: if the required field is missing (e.g. MPESA without `tel`, BANK without `bnumber`/`bankcode`), skip the KCB call, mark `payments.status='failed'` + transactions `failed`, push `{ status:'failed', error:'Missing payout details' }`.

3. Call `chargeFarmerViaKCB({ ref, amount: calc.net_amount, farmerName: descript, accountNumber, bankCode, transactionType, ccode: access.ccode, requestId })`.

4. Result handling changes:
   - `sacco.success === false` → same failure path as today (`payments.status='failed'`, transactions `failed`).
   - `sacco.success === true` → **do NOT flip to `paid`**. Update `payments` with `external_transaction_id = retrievalRefNumber` (leave `status='pending'`). Push `{ status: 'pending', ... }` to the results array. Transactions stay `payment_status='pending'` until the callback lands.

5. Keep `invalidatePayableCache(access.ccode)` at the end (pending rows are already excluded from payable).

Logs: `[PAY][TRANSFER] farmer=<code> ref=<ref> type=<MO|IF|EF> amount=<net>` (no beneficiary PII beyond farmer code).

## 4. New endpoint — `POST /api/payments/kcb/callback`

Native http route in the existing chain (same style as the other payment routes).

- Auth: require header `x-kcb-callback-secret === process.env.KCB_CALLBACK_SECRET`; reject 401 otherwise. Log `[PAY][CALLBACK] unauthorized` (no body).
- Parse JSON body via `parseBody(req)`. Expected fields: `transactionReference`, `statusCode`, `statusDescription`, `merchantID`, `retrievalRefNumber`, `ftReference`, `transactionMessage`, `transactionDate`.
- Locate payment: `SELECT payment_id, ccode, status FROM payments WHERE payment_reference = ? LIMIT 1`. If not found → 404 `{success:false,error:'unknown reference'}`.
- Idempotency: if `payments.status` already `success` or `failed`, respond `200 {success:true, already:true}` without further writes.
- Map KCB status: `success` when `statusCode` is `0` / `00` / `SUCCESS` / `Success` (case-insensitive); otherwise `failed`.
- Transaction: update `payments` row:

  ```sql
  UPDATE payments
     SET status = ?,
         external_transaction_id = COALESCE(?, external_transaction_id),
         kcb_merchant_id = ?,
         kcb_retrieval_ref = ?,
         kcb_ft_reference = ?,
         kcb_transaction_message = ?,
         kcb_transaction_date = ?
   WHERE payment_id = ?
  ```

  Then propagate to source transactions:

  ```sql
  UPDATE transactions
     SET payment_status = ?          -- 'paid' or 'failed'
   WHERE payment_id = ? AND payment_status = 'pending'
  ```

- On success invalidate `invalidatePayableCache(ccode)`.
- Log `[PAY][CALLBACK] ref=<ref> status=<paid|failed> merchant=<id>` and return `{success:true}`.

**Schema additions** (documented in `docs/payments-backend-additions.md`, run once):

```sql
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS kcb_merchant_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_retrieval_ref VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_ft_reference VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS kcb_transaction_message VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS kcb_transaction_date DATETIME NULL;
```

No changes to `cm_members` (fields already exist under the documented names).

## 5. Error normalisation

`chargeFarmerViaKCB` returns `{ success:false, statusCode, statusDescription, error }` for: 401 after retry, timeout, network error, 4xx validation, duplicate `transactionReference`, "account not whitelisted", etc. `server.js` treats every `success:false` identically (existing failure branch). No crash, no unhandled promise.

## 6. Preserved behaviour

- Payment calculation (`computeFarmerPayment`), permission checks (`resolvePaymentsAccess`), `/payable` aggregate + cache + retry, `/history`, price lookup, reference format, cache invalidation — **untouched**.
- `PaymentResult.status = 'pending'` is already a supported UI state; the screen keeps rendering results without change.
- Capacitor APK: unchanged (backend-only change).

## 7. Docs + version

- Extend `docs/payments-backend-additions.md` with: env vars, callback contract, callback secret header, new columns, provider-swap notes.
- `src/constants/appVersion.ts` → `2.11.5`, code `147`, tag `payments-kcb`.
- `android/app/build.gradle` matching bump.

## Verification

- Unit-level: hitting `/api/payments/process` with a test farmer returns `status:'pending'` (not `success`); `payments` row is `pending` with `external_transaction_id` set; source transactions remain `pending`.
- Callback with `x-kcb-callback-secret` and `statusCode:"0"` flips payment + transactions to `paid`; wrong secret → 401; replay → `already:true`.
- MPESA vs BANK-01 vs BANK-other route to the correct `transactionType`/`beneficiaryBankCode`/`creditAccountNumber` (verified by logging in a staging run).
- Token cache: two back-to-back `/process` calls issue exactly one `[PAY][TOKEN]` log line.
- Payments screen loads, lists, and submits unchanged; a submitted farmer shows the pending state until the callback lands.

## Out of scope

- No status-poll endpoint (callback-driven only). If KCB never calls back, a stuck-pending sweeper is a follow-up.
- No change to `/payable`, `/history`, or the frontend.
- No refactor of the existing loop beyond the SACCO call and the post-success status handling.
