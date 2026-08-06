# Yetu Sacco Member Payments — Onboarding & Troubleshooting Guide

Applies to app **v2.12.1** (backend files: `yetuRoutes.js`, `yetuService.js`,
`yetuAuth.js`, `MIGRATION_YETU_SACCO.sql`; frontend: `src/modules/sacco/`).

---

## 1. Webhook authentication (CONFIRMED: HTTP Basic)

Yetu Sacco calls the webhook with a standard Basic header:

```
POST /api/yetu/callback
Authorization: Basic base64(username:password)
Content-Type: application/json
```

Server configuration (environment variables on the API host):

```bash
YETU_AUTH_MODE=basic          # optional: auto-selected when the two below are set
YETU_BASIC_USER=yetu_sacco
YETU_BASIC_PASS=<strong-random-password>
```

Rules:

- Credentials are compared in constant time; a mismatch returns HTTP 401 with
  `{"result":"1","response":"failed","message":"Unauthorized"}` and the attempt
  is written to `yetu_webhook_logs` with `outcome='invalid'`.
- Never commit the password. Generate one with `openssl rand -base64 24` and
  share it with Yetu over a secure channel.
- Rotate by updating both env vars and restarting the API, then having Yetu
  update their side. During rotation you may temporarily keep the old value by
  running a second endpoint host — do **not** set `YETU_AUTH_MODE=none` in
  production.
- `YETU_AUTH_MODE=none` exists for staging tests only.

Accepted payload (field names are read tolerantly, camelCase or snake_case):
transaction timestamp, payer name, payer mobile, member/account number, amount,
unique transaction reference. Every accepted or duplicate call answers:

```json
{ "result": "0", "response": "success", "message": "Request received successfully" }
```

---

## 2. Onboarding a new Sacco (one-time per company)

1. **Run the migration** on the MySQL database:
   `mysql -u <user> -p <db> < backend-api/MIGRATION_YETU_SACCO.sql`
2. **Set the org type**: `UPDATE psettings SET orgtype='S', payments_active=1
   WHERE ccode='<CCODE>';`
3. **Set the env vars** (`YETU_BASIC_USER`, `YETU_BASIC_PASS`) and restart the API.
4. **Give Yetu the callback URL**: `https://<your-api-host>/api/yetu/callback`
   plus the Basic credentials.
5. **Smoke test** (see §4) and confirm a row lands in `sacco_transactions`.

---

## 3. Onboarding a new member

A member needs two things: a Sacco account record, and a login linked to it.

**Step 1 — create the member record**

```sql
INSERT INTO sacco_members (ccode, account_number, full_name, mobile, national_id, status)
VALUES ('C003', 'S00123', 'JANE WANJIKU', '0712345678', '12345678', 'active');
```

- `account_number` must match exactly what the payer types at Yetu (it is the
  key used to allocate deposits). It is unique per `ccode`.
- Normalise to upper case, no spaces.

**Step 2 — create / link the login**

```sql
UPDATE user
   SET can_access_payments = 1,
       link_account = 'S00123'
 WHERE userid = 'jane' AND ccode = 'C003';
```

The portal will only show data for `user.link_account`; a member can never read
another member's rows — scoping is enforced server-side.

**Step 3 — back-fill any deposits that arrived before the member existed**

Deposits with an unknown account are stored with `member_id = NULL` and
`allocation_status='unallocated'`. After creating the member:

```sql
UPDATE sacco_transactions t
  JOIN sacco_members m
    ON m.ccode = t.ccode AND m.account_number = TRIM(t.account_number_raw)
   SET t.member_id = m.member_id, t.allocation_status = 'allocated'
 WHERE t.allocation_status = 'unallocated' AND t.ccode = 'C003';
```

**Step 4 — verify**: the member logs in on the device; the app enters portal
mode (`/sacco`) and the summary cards plus history load.

---

## 4. Smoke test the webhook

```bash
curl -i -u "$YETU_BASIC_USER:$YETU_BASIC_PASS" \
  -X POST https://<api-host>/api/yetu/callback \
  -H 'Content-Type: application/json' \
  -d '{
        "transactionDate": "2026-08-01 10:15:00",
        "payerName": "JANE WANJIKU",
        "payerMobile": "0712345678",
        "accountNumber": "S00123",
        "amount": "1500.00",
        "transactionReference": "TEST-0001"
      }'
```

Expected: HTTP 200 and the standard success envelope. Repeat the same command —
it must return 200 again and create **no** second row (idempotent by
`transaction_reference`).

---

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `401 Unauthorized` from the callback | Wrong Basic user/pass, or env vars not loaded after deploy | Compare `YETU_BASIC_USER`/`YETU_BASIC_PASS` with what Yetu sends; restart the API after changing env vars |
| Log says `auth_not_configured` | `YETU_AUTH_MODE=basic` but one credential env var is empty | Set both vars and restart |
| `400` with a field list | Payload missing amount / reference / account | Ask Yetu to include the named fields; the raw body is in `yetu_webhook_logs.raw_body` |
| Deposit accepted but member sees nothing | `allocation_status='unallocated'` — account number mismatch | Check `SELECT account_number_raw FROM sacco_transactions ORDER BY txn_id DESC LIMIT 5;` and correct `sacco_members.account_number`, then run the back-fill in §3 |
| Portal not visible / normal dashboard shows | `orgtype <> 'S'` or `payments_active = 0` | `SELECT orgtype, payments_active FROM psettings WHERE ccode='<CCODE>';` |
| "Payment permission denied" | `user.can_access_payments = 0` | Set it to 1 for that user |
| "No Sacco account is linked to this user" | `user.link_account` empty | Set it to the member's `account_number` (use `&&` for multiple accounts) |
| "Device not authorized" | Device fingerprint not approved | Approve the device in the existing device-approval screen |
| Portal shows the offline message | The portal needs connectivity (no offline cache by design) | Restore network |
| Duplicate deposits appear | Yetu sent two different references for one payment | Reconcile manually; the dedupe key is `transaction_reference` |

Useful queries:

```sql
-- last 20 webhook calls with outcome
SELECT received_at, outcome, http_status, transaction_reference, error_message
  FROM yetu_webhook_logs ORDER BY log_id DESC LIMIT 20;

-- unallocated deposits
SELECT txn_id, account_number_raw, amount, transaction_date
  FROM sacco_transactions WHERE allocation_status='unallocated';
```

Server logs are tagged `[YETU][AUTH]`, `[YETU][CALLBACK]`, `[YETU][TXNS]` for
quick grepping.
