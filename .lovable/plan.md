
# Payments Module + Web Bluetooth Auto-Connect Removal

Adds a new Payments module gated by a company-level flag and per-user permission, backed by a new `payments` table and two new fields on `transactions`. Uses a mock SACCO service today so the same workflow later swaps to the real API. Also removes only the automatic Bluetooth connect on web — the Capacitor APK Bluetooth stack is left completely untouched.

Version bump: `2.10.121` → `2.11.0` (feature addition, per version rules).

---

## 1. Database changes (backend / MySQL)

All changes are additive and backward compatible — no existing column is renamed, no existing API is changed.

### `psettings`
- Add column `payments_active TINYINT(1) NOT NULL DEFAULT 0`.
- `0` = module hidden everywhere for that company. `1` = module available for that company (still gated per user).

### `users`
- Add column `can_access_payments TINYINT(1) NOT NULL DEFAULT 0`.
- Only users with this flag `= 1` see the Payments menu, even when `payments_active = 1`.

### `payments` (new)
```
payment_id              BIGINT PK AUTO_INCREMENT
payment_reference       VARCHAR(40) UNIQUE NOT NULL
ccode                   VARCHAR(20) NOT NULL          -- multi-tenant isolation
farmer_code             VARCHAR(40) NOT NULL
amount                  DECIMAL(14,2) NOT NULL
status                  ENUM('pending','success','failed') NOT NULL DEFAULT 'pending'
payment_date            DATETIME NOT NULL
external_transaction_id VARCHAR(80) NULL
created_by              VARCHAR(40) NULL
created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```
Indexes: `(ccode, farmer_code)`, `(ccode, status)`, `(ccode, payment_date)`.

### `transactions`
- Add `payment_id BIGINT NULL` (FK to `payments.payment_id`, nullable).
- Add `payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid'`.
- Index `(ccode, payment_status, farmer_code)` for the payable-list query.

Existing sync/reference logic (`transrefno`, `uploadrefno`, `reference_no`) is untouched. Legacy rows default to `unpaid` — no data migration risk.

---

## 2. Backend endpoints (`server.js`, additive only)

All endpoints strictly filter by JWT `ccode` and require `payments_active=1` + `can_access_payments=1`.

- `GET  /api/payments/payable?period=day|week|month|season` → aggregates unpaid transactions per farmer: `{ farmer_code, farmer_name, total_payable, unpaid_count }`.
- `POST /api/payments/process` → body `{ farmer_codes: [...], period }`. Server-side:
  1. Recomputes payable per farmer (never trusts client amount).
  2. Generates one unique `payment_reference` per farmer: `PMT-<ccode>-<yymmdd>-<seq>`.
  3. Inserts `payments` row with `status='pending'`.
  4. Calls **mock SACCO service** (`services/saccoPaymentService.js`, single function `chargeFarmer({ ref, amount, farmer_code })` returning `{ success, external_transaction_id }` after simulated latency; replaceable with real API without touching the route).
  5. On success: updates `payments.status='success'` + `external_transaction_id`, and updates all matching unpaid `transactions` rows for that farmer/period with `payment_id` + `payment_status='paid'` in a single transaction.
  6. On failure: `payments.status='failed'`, transactions untouched.
- `GET  /api/payments/history?farmer_code=&from=&to=` → list past payments.

No existing endpoint is modified. Production APK stays fully compatible.

---

## 3. Frontend (web) — new module

Location: `src/modules/payments/` (kept isolated to avoid disturbing existing screens).

- `src/modules/payments/PaymentsScreen.tsx` — list + filter by period (day/week/month/season), columns: Farmer Code, Farmer Name, Total Payable, Payment Status. Multi-select via checkbox + "Pay selected" button. Uses Lucide icons only.
- `src/modules/payments/PaymentConfirmDialog.tsx` — shows totals, generates request, streams status; includes `DialogDescription` for a11y.
- `src/modules/payments/PaymentHistoryScreen.tsx` — per-farmer history with reference + external id.
- `src/modules/payments/api.ts` — thin fetch wrapper using existing `nativeFetch` / `xhrFetch` resilient pattern (same rules as other POSTs).
- `src/modules/payments/useCanAccessPayments.ts` — resolves `psettings.payments_active` (from cached psettings) AND `users.can_access_payments` (from session profile). Returns `false` if either is missing.

### Menu gating
- Dashboard/menu: Payments entry rendered only when `useCanAccessPayments() === true`. When false, the route is also not registered, so deep-link `/payments` redirects to dashboard (matches existing resilient SPA routing rule).

### Offline behavior
- Payments require online (mock or real SACCO). If offline, the "Pay" action is disabled with a clear hint; browsing payable list still works from cache. No changes to receipts / capture / sync flows.

---

## 4. Mock SACCO service

- Backend: `services/saccoPaymentService.js` — pure function boundary; env-flag `SACCO_MODE=mock|live`. Mock returns success after 400–800 ms with a fake `external_transaction_id`. Swapping to live only touches this one file.
- No client-side mock — the web calls the backend route only, so the swap is invisible to the app.

---

## 5. Bluetooth — web only

- In `src/**` locate the auto-connect trigger (the on-mount effect that calls the Bluetooth Classic bridge / Web Bluetooth). Guard it with a platform check: run **only** when `Capacitor.isNativePlatform() === true`.
- The native plugin, Android manifest, and APK code paths remain byte-for-byte unchanged. Manual "Connect printer" actions on web (if any) are also left as-is; only the *automatic* connect on load is disabled for web.

---

## 6. Version, logs, memory

- `src/constants/appVersion.ts` → `2.11.0`, version code `142`, `APP_FIX_TAG='payments-module'`.
- Log tags: `[PAY][PAYABLE]`, `[PAY][PROCESS]`, `[PAY][SACCO:MOCK]`, `[PAY][BT:WEB-SKIP]`.
- Memory: add `mem://features/payments-module` (activation flag, permission column, mock swap point) and `mem://architecture/web-bluetooth-auto-disabled`. Update `mem://index.md`.

---

## 7. Safety checklist before completing

- Existing transaction creation, receipts, sync, photo capture, farmer/item sync all still pass.
- APK build unchanged (no native files touched).
- `payments_active=0` company: zero UI, zero network calls, zero risk.
- All new SQL uses `ccode` filter; new endpoints reject cross-tenant access.

---

## Open confirmations (please confirm or adjust before build)

1. **Period definitions** — day = today; week = Mon–Sun; month = calendar month; season = current season window from `psettings` (fallback: last 90 days). OK?
2. **"Paid" scope** — a payment marks *all* unpaid transactions for that farmer within the selected period as paid. OK, or should it be a manual pick per transaction?
3. **Partial payments** — not supported in v1 (full payable amount only). OK?
4. **`users` permission column name** — proposing `can_access_payments`. Any preferred name?
