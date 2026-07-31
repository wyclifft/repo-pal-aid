# Yetu Sacco Member Payments Module (v2.12.0)

A new, self-contained module for Sacco organizations: Yetu Sacco pushes member deposit
transactions to our backend via webhook; members log in and view their own contribution
history in a dedicated portal.

It sits **alongside** the existing KCB payouts module and never interferes with it.

---

## 1. Gating (when the module appears)

Visible only when **all** are true:

- `psettings.orgtype = 'S'` (new Sacco organization type, joins existing D/C)
- `psettings.payments_active = 1`
- `user.can_access_payments = 1`

When active, the app switches into **portal mode**: only the Yetu Sacco Payments screen
is reachable. Dashboard tiles, Buy/Sell/Store/AI/Z-Report/Periodic navigation and routes
are hidden, and any other route redirects to `/sacco`. Dairy/Coffee installs are
completely unaffected — no existing screen changes behaviour when `orgtype != 'S'`.

---

## 2. Webhook: `POST /api/yetu/callback`

Every payload is treated as a **successful member deposit** (confirmed by Yetu IT).

Accepts JSON with: transaction timestamp, payer name, payer mobile, member/account
number, amount, unique transaction reference. Field names are read tolerantly
(camelCase/snake_case aliases) and the full raw body is always stored.

Flow:

1. Log the raw request (headers minus secrets, body, source IP) into `yetu_webhook_logs`
   **before** validation, so nothing is ever lost.
2. Validate required fields and types; reject malformed with a logged failure — still
   returning the Yetu-mandated success envelope only for accepted requests.
3. Duplicate guard: unique index on `(transaction_reference)`. A replay is a no-op and
   returns the same success envelope (idempotent).
4. Resolve the member by account number against `sacco_members`; if unknown, store the
   transaction with `member_id = NULL` and `allocation_status = 'unallocated'`.
5. Insert into `sacco_transactions`.
6. Always respond:

```json
{ "result": "0", "response": "success", "message": "Request received successfully" }
```

**Auth is deferred** — Yetu has not confirmed the mechanism. The handler is written with
a pluggable `verifyYetuRequest(req)` middleware that currently passes through and logs
the auth headers it receives, so switching to a shared secret or HMAC later is a
one-function change.

---

## 3. Database (MySQL, additive migration file)

```text
sacco_members
  member_id PK, ccode, account_number (UNIQUE per ccode), full_name,
  mobile, national_id, status, created_at, updated_at

sacco_transactions
  txn_id PK, ccode, member_id FK NULL, account_number_raw,
  transaction_reference (UNIQUE), amount DECIMAL(14,2),
  payer_name, payer_mobile, transaction_date DATETIME,
  channel, txn_type DEFAULT 'deposit', allocation_status,
  raw_payload JSON, created_at
  INDEX (ccode, member_id, transaction_date),
  INDEX (ccode, transaction_date), INDEX (account_number_raw)

yetu_webhook_logs
  log_id PK, received_at, source_ip, endpoint, http_status,
  outcome ENUM('accepted','duplicate','invalid','error'),
  transaction_reference, raw_body TEXT, error_message
```

Plus: `psettings.orgtype` gains the `'S'` value (no schema change — it is a varchar),
and a `link_account` column on `user` mapping a login to a `sacco_members.member_id`.

Delivered as `backend-api/MIGRATION_YETU_SACCO.sql`; nothing existing is altered
destructively.

---

## 4. Member-facing API

```text
GET /api/yetu/transactions   ?page=&limit=&search=&from=&to=&sort=&order=
GET /api/yetu/summary        totals: this month, this year, lifetime, last deposit
```

Both are scoped server-side to the authenticated user's `ccode` **and** their linked
member id — the client cannot request another member's rows. Pagination is capped
(max 100/page), sorting is whitelisted to known columns, and all inputs are validated.

---

## 5. Member portal UI (`/sacco`)

- Summary cards: total contributed, this month, this year, last deposit date.
- Transaction table in reverse-chronological order: date, reference, amount,
  payer name, payer mobile, channel.
- Search (reference / payer name / mobile), date-range filter, column sort, pagination.
- Row tap opens a detail sheet with the full transaction record.
- Export to CSV/PDF (reuses the existing `fileExport` / `pdfExport` utilities) and print
  via the existing thermal-print path when running on a POS device.
- Skeleton loading states, empty states ("No contributions yet" / "No results for this
  filter"), and explicit error states with retry.
- Responsive and WebView 51-safe: no `dvh`, no `gap`-only layouts, no `backdrop-filter`
  — matching the constraints already applied across the app.

---

## 6. Technical structure

```text
backend-api/
  routes/yetu.js            route registration in the existing manual router chain
  services/yetuService.js   payload normalisation, dedupe, member resolution
  middleware/yetuAuth.js    pluggable verifier (pass-through today)
  MIGRATION_YETU_SACCO.sql

src/modules/sacco/
  SaccoPortal.tsx           page shell (portal mode)
  components/               SummaryCards, TransactionTable, Filters, DetailSheet
  saccoApi.ts               typed client over resilientFetch
  useSaccoAccess.ts         orgtype 'S' + payments_active + can_access_payments
  useSaccoTransactions.ts   react-query with pagination/filter keys
```

`useAppSettings` gains `isSacco` derived from `orgtype === 'S'`; `App.tsx` adds the
`/sacco` route and, in portal mode, short-circuits all other routes. Version bumps to
**v2.11.34 → v2.12.0** in `appVersion.ts` and `android/app/build.gradle`.

## 7. Out of scope for this build

- Webhook authentication (deferred until Yetu confirms) — stub in place.
- Withdrawals / non-deposit transaction types (schema already carries `txn_type`).
- Bulk import of `sacco_members` (rows can be inserted directly for the pilot).
