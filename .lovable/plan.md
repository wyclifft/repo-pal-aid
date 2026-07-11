## Plan: Payments menu + native `server.js` payment endpoints

### What will be fixed
1. **Payments menu not showing**
   - Change the frontend permission wording/logic from `users.can_access_payments` to the real table: `user.can_access_payments`.
   - Update `/api/auth/login` in `backend-api/server.js` so the login response includes `can_access_payments` from the `user` table.
   - Update `/api/psettings` response so `payments_active` is returned from `psettings`; this is required because the frontend already reads `app_settings.payments_active`.
   - Keep the menu hidden unless both are true:
     - `psettings.payments_active = 1`
     - `user.can_access_payments = 1`

2. **Rewrite payment backend for native Node HTTP routing**
   - Add the three routes directly inside the existing `http.createServer(async (req, res) => { ... })` routing chain.
   - Do **not** use Express, `app.get`, `app.post`, `authenticateJWT`, or middleware.
   - Use existing helpers already in `server.js`: `parseBody`, `sendJSON`, `pool`, `parsedUrl.query`, `path`, and `method`.

### Endpoint design
Add routes before the final 404:

```text
GET  /api/payments/payable?period=day|week|month|season&uniquedevcode=...&userid=...
POST /api/payments/process
GET  /api/payments/history?uniquedevcode=...&userid=...&farmer_code=&from=&to=
```

For POST body:

```json
{
  "farmer_codes": ["M01859"],
  "period": "month",
  "device_fingerprint": "...",
  "userid": "..."
}
```

### Access and isolation rules
- Resolve `ccode` from `devsettings.uniquedevcode` / `device_fingerprint` and require `authorized = 1`.
- Check `psettings.payments_active = 1` for that `ccode`.
- Check `user.can_access_payments = 1` for the same `ccode` and `userid`.
- All SQL stays strictly filtered by `ccode`.
- Use the real table name `user`, not `users`.

### Payment logic
1. **Payable list**
   - Aggregate unpaid transactions from `transactions` by `memberno`.
   - Join farmer names from `cm_members` using `mcode/mmcode` compatibility where safe.
   - Use `payment_status = 'unpaid'` and period date filters.
   - Return `{ farmer_code, farmer_name, total_payable, unpaid_count, payment_status }`.

2. **Process payment**
   - Server recomputes amounts; it will not trust client totals.
   - Insert one row per farmer into `payments` with `status='pending'`.
   - Use an inline mock SACCO function/boundary in `server.js` or a small service file if already appropriate for this native backend.
   - On mock success: update `payments.status='success'`, set `external_transaction_id`, and update matching unpaid `transactions` rows to `payment_status='paid'` + `payment_id` inside a DB transaction.
   - On failure: mark payment row as `failed`; leave transactions unpaid.

3. **History**
   - List payment records filtered by `ccode`, optional `farmer_code`, `from`, and `to`.

### Frontend API change
- Update `src/modules/payments/paymentsApi.ts` to send the device fingerprint and logged-in user id with all payment calls, matching the existing backend security style.
- Keep offline behavior unchanged: processing requires online.

### Version and documentation
- Bump app version from `2.11.0` to `2.11.1` as a bug fix/backend integration correction.
- Update comments/docs that currently say `users.can_access_payments` so they correctly say `user.can_access_payments`.
- Do not touch Capacitor native Bluetooth code.

### Verification
- Confirm `server.js` contains no Express-style payment route code.
- Confirm `/api/auth/login` returns `can_access_payments`.
- Confirm `/api/psettings` returns `payments_active`.
- Confirm frontend calls include `uniquedevcode/device_fingerprint` and `userid`, so the backend can enforce company/user access.