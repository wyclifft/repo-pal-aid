
# Farmer Boost — Farm Input Credit Financing

A design plan that fits into the current offline-first coop POS (routes, farmers, produce capture, Store/AI, sync engine, receipts, Z-Report, Periodic Report) with **zero regression** to production flows.

---

## 1. Guiding constraints (inherited from the running system)
- Offline-first, WebView 52 compatible, IndexedDB + SQLite dual-write.
- Strict `ccode` multi-tenancy, per-route/per-product cumulative scoping.
- "Trust the Engine" background sync — no manual sync buttons.
- No changes to reference generator, transrefno format, or existing sync matrix.
- All new tables get GRANTs; all new endpoints are **additive** in `server.js`.

---

## 2. Answers to your 12 questions

### Q1. New modules to add
- **Credit Engine** (`src/services/creditEngine.ts`) — limit calc, availability check, hold/release, recovery rules.
- **Boost Ledger** (`src/services/boostLedger.ts`) — append-only ledger of DISBURSE / PURCHASE / RECOVER / SETTLE / ADJUST / WRITEOFF entries.
- **Merchant Registry** (`src/services/merchants.ts`) — approved input suppliers + agrovets.
- **Payout Engine** (`src/services/payoutEngine.ts`) — orchestrates coffee/milk payout → credit deduction → net to farmer → merchant settlement.
- **Payment Rails** (`src/services/payments/{mpesa,bank}.ts`) — thin adapters, one interface.
- **Boost Sync Worker** — mirrors the receipts sync engine for `boost_*` stores.

### Q2. Existing modules to modify (minimal, additive only)
| Module | Change |
|---|---|
| `SellProduceScreen.tsx` | Read-only "Outstanding Boost" chip on farmer select (no capture change). |
| `Store.tsx` / `BuyProduceScreen.tsx` | New payment method: **"Boost Credit"** alongside Cash. |
| `ReceiptModal` / `TransactionReceipt` | Extra footer line "Boost balance after txn: X" when applicable. |
| `ZReport` / `PeriodicReport` | New section "Boost Activity" (disbursed, recovered, outstanding). |
| `useIndexedDB.ts` | Add object stores: `boost_accounts`, `boost_ledger`, `boost_purchases`, `merchants`, `payout_runs`. No schema change to existing stores. |
| `mysqlApi.ts` | Add `/api/boost/*` calls behind feature flag. |
| `Settings.tsx` | New "Farmer Boost" panel (enable/disable, limits policy, roles). |
| `appVersion.ts` | Version bump per phase. |

### Q3. New database tables (MySQL backend + IndexedDB mirror)

```text
merchants                (mcode PK, name, kra_pin, till/paybill, bank_acc, status, ccode)
merchant_products        (mcode, icode, unit_price, active)
boost_accounts           (farmer_id, ccode, credit_limit, outstanding, hold, status, score, updated_at)
boost_limits_policy      (ccode, policy_json)  -- % of avg cumulative, season window, caps
boost_ledger             (id PK, farmer_id, ccode, entry_type, amount, ref_no, mcode NULL,
                          related_transrefno NULL, payout_run_id NULL, ts, device_code, synced)
                          -- entry_type ∈ DISBURSE|PURCHASE|RECOVER|SETTLE|ADJUST|WRITEOFF|REVERSAL
boost_purchases          (pref_no PK, farmer_id, mcode, items_json, total, status, ts, ccode)
payout_runs              (run_id PK, ccode, period_from, period_to, product_icode, status,
                          gross_total, boost_recovered_total, net_paid_total, created_by, ts)
payout_lines             (run_id, farmer_id, gross, boost_recovered, net, payout_channel,
                          mpesa_ref NULL, bank_ref NULL, status)
merchant_settlements     (settle_id PK, mcode, run_id, gross_purchases, adjustments, net_paid,
                          channel, ref, status, ts)
```

Relationships: `boost_ledger.farmer_id → farmers`, `boost_purchases.mcode → merchants`, `payout_lines → payout_runs`, `merchant_settlements → payout_runs`. All tables carry `ccode`; RLS-equivalent filtering in every query. All follow the existing GRANT pattern.

### Q5. Coffee/Milk payout — automatic credit recovery
Payout run steps (server-authoritative, farmer-atomic):

```text
for each farmer in run:
  gross      = sum(kgs * rate) for period/product/route
  outstanding= boost_accounts.outstanding
  cap        = policy.recovery_cap_pct * gross   -- e.g. 100% or 50%
  recovered  = min(outstanding, cap)
  net        = gross - recovered
  ledger += RECOVER(recovered, run_id)
  boost_accounts.outstanding -= recovered
  payout_lines row written
```

Rules:
- Recovery happens **inside a DB transaction per farmer** — no partial state.
- If payout fails (M-Pesa/bank reject) → automatic `REVERSAL` ledger entry restores `outstanding`.
- Farmers with `outstanding = 0` bypass the recovery step entirely.
- Recovery cap % is configurable per coop in `boost_limits_policy` so no farmer is left with zero take-home unless policy says so.

### Q6. Merchant settlement flow
- Every `boost_purchases` row credits the merchant (payable) and debits the farmer's `boost_accounts.outstanding` (receivable).
- On each payout run, after recoveries are computed, group recovered amounts by originating `mcode` (join `boost_ledger.PURCHASE → RECOVER`).
- Create one `merchant_settlements` row per merchant per run:
  `net_paid = Σ purchases_recovered_this_run − adjustments (returns/disputes)`.
- Settlement is paid to merchant via same Payment Rails (bank preferred, M-Pesa B2B fallback).
- Merchants get a statement (PDF/CSV) listing farmer, date, items, amount recovered.
- Merchants are **not paid up-front** — they carry the receivable until recovery. This is what protects the coop from bad debt.

### Q7. Payment flow (Bank / M-Pesa) — farmer payout
```text
PayoutEngine
  ├─ computes payout_lines (gross, recovered, net)
  ├─ for each line where net > 0:
  │    if farmer.payout_channel = MPESA → mpesaAdapter.b2c(net, farmer.msisdn)
  │    if farmer.payout_channel = BANK  → bankAdapter.rtgs/pesalink(net, farmer.acc)
  ├─ on success → payout_lines.status = PAID, store provider ref
  └─ on fail    → status = FAILED, REVERSAL ledger entry, retry queue
```
- Idempotency: `payout_lines.run_id + farmer_id` is the natural key. Providers keyed with same idempotency ID prevent double disbursement on retry.
- All provider calls happen server-side only; device never holds M-Pesa keys.

### Q8. Bank account architecture — recommendation

**Recommended: Single Coop Collection + Disbursement Account (with virtual sub-ledger)**

```text
Buyer/Miller ──► Coop Master Account ──► M-Pesa B2C / Bank ──► Farmers (net)
                                     └─► Bank/B2B         ──► Merchants (settlement)
```

| Option | Pros | Cons |
|---|---|---|
| **A. Single coop account (recommended)** | One reconciliation source of truth; simple audit; lowest bank fees; matches existing coop treasury flow; merchants trust coop, not each other | Coop must have float discipline; single point of operational failure |
| B. Escrow / partner-bank sub-accounts per merchant | Merchant funds legally ring-fenced; faster merchant payout | Higher bank fees; complex reconciliation; needs banking partner API; overkill until volume is large |
| C. Direct farmer → merchant (no coop in loop) | No treasury load on coop | Coop loses recovery leverage — the whole point of Farmer Boost breaks; hard to enforce |

**Verdict:** start with **A**. Migrate to **B** only when merchant count > ~50 or regulator requires ring-fencing.

### Q9. User roles (add to existing role table — do NOT store on profile)
- `boost_officer` — approve credit limits, disburse, view ledger.
- `boost_viewer` — read-only dashboards.
- `merchant_user` — merchant portal login, view own settlements + statements.
- `payout_admin` — trigger/approve payout runs (two-person rule enforced for runs > threshold).
- `field_agent` (existing capture user) — sees outstanding chip only, cannot modify.

### Q10. Backend services / APIs (all additive in `server.js`)
```text
GET  /api/boost/account/:farmerId
POST /api/boost/limit/recompute            (batch, cron-triggered)
POST /api/boost/disburse                    (officer)
POST /api/boost/purchase                    (merchant or Store screen)
POST /api/boost/purchase/:pref/void
GET  /api/boost/ledger/:farmerId
GET  /api/merchants                         GET/POST/PUT
POST /api/payout/run/preview                (dry-run: shows recoveries & nets)
POST /api/payout/run/commit                 (two-step approval)
POST /api/payout/line/:id/retry
GET  /api/payout/run/:id/report
GET  /api/merchant/:mcode/statement
```
- All routes JWT + `ccode` scoped, same middleware as existing endpoints.
- Sync endpoint mirrors receipts: `POST /api/boost/sync` with the same 7-field idempotency matrix (adapted to `boost_ledger`).

### Q11. Frontend pages / dashboards / reports
- `/boost` — Farmer Boost hub (officer view): limits queue, disbursements, ledger search.
- `/boost/farmer/:id` — 360° farmer view (limit, outstanding, ledger, purchases, payout history).
- `/boost/merchants` — Merchant registry + statements.
- `/boost/purchase` — Field/merchant POS-style screen (uses existing FarmerSearchModal + ProductSelector).
- `/payouts` — Payout runs list + Preview / Commit wizard.
- `/payouts/:runId` — Line-by-line results, retries, exports.
- Extensions to existing screens: Outstanding chip on SellProduce, "Boost" tab in DebugConsole, "Boost Activity" section in Z-Report and Periodic Report.
- Merchant portal (separate lightweight route `/m/*`) — statements, disputes, payment status.

### Q12. Non-disruptive introduction
- **Feature flag** `psettings.boost_enabled = 0` by default per coop. All new UI hidden when off.
- **Additive-only DB**: no ALTER on existing tables; new stores in IndexedDB with fresh keyPaths.
- **Shadow mode first**: Phase-2 payout run can compute recoveries **without** deducting — outputs a report that finance verifies against manual books for 1–2 cycles.
- **No changes** to transrefno, sync matrix, receipt format (only additive footer line, feature-flagged).
- Rollback = flip flag off; no data loss because ledger is append-only.

---

## 3. Phased roadmap

### Phase 1 — Foundations (safe, invisible to farmers) — v2.11.x
- Migrations: `merchants`, `boost_accounts`, `boost_ledger`, `boost_limits_policy` (+GRANTs, RLS).
- Backend: `/api/boost/account`, `/api/boost/ledger`, `/api/boost/limit/recompute`.
- IndexedDB stores + sync worker skeleton.
- Settings toggle + role table entries.
- No UI in capture flow yet. Nightly job computes suggested limits from historical cumulatives.

### Phase 2 — Merchant registry & disbursement (officer-only) — v2.12.x
- Merchant CRUD + approval workflow.
- Officer disbursement UI (`/boost`, `/boost/farmer/:id`).
- Ledger entries flowing; still no farmer-facing change.
- Merchant portal MVP (read-only statements).

### Phase 3 — Input purchases on credit — v2.13.x
- `boost_purchases` table + `/boost/purchase` screen.
- Store.tsx gains "Boost Credit" payment method (behind flag).
- Outstanding chip appears on SellProduce (read-only).
- Full offline capture parity with existing Store flow.

### Phase 4 — Payout engine in **shadow mode** — v2.14.x
- Payout Preview computes recoveries and nets but commit is disabled.
- Finance team reconciles against manual books for ≥ 2 payout cycles.
- Merchant settlements computed but not paid.

### Phase 5 — Live payout with recovery — v2.15.x
- Enable Commit; wire M-Pesa B2C + Bank adapters.
- Two-person approval, idempotency, reversal on failure.
- Merchant settlements auto-paid post-run.
- Z-Report / Periodic Report "Boost Activity" section goes live.

### Phase 6 — Analytics, scoring, expansion — v2.16.x+
- Credit scoring based on delivery consistency (input to `boost_limits_policy`).
- Merchant performance dashboards, dispute workflow, write-off approvals.
- Optional: partner-bank sub-accounts (Option B) if scale demands.

---

## 4. Technical guardrails (must-hold rules)
- Ledger is **append-only**. Corrections are new `ADJUST`/`REVERSAL` entries, never UPDATEs.
- Every monetary op runs inside a DB transaction; provider calls use idempotency keys.
- All new tables carry `ccode`; every query filters by JWT `ccode`.
- No change to existing `transrefno` format or sync idempotency matrix.
- IndexedDB additions are new stores only — never migrate existing stores.
- Feature flag gates every new UI surface and every new sync route.
- Version bump per phase; changelog entry mandatory.

---

## 5. Open questions to confirm before Phase 1
1. Recovery cap policy — 100% of gross, or leave farmer a minimum take-home %?
2. Credit limit formula — % of trailing 90-day cumulative, or seasonal average?
3. Merchant onboarding — self-service portal or coop-approved only?
4. Payment provider — Daraja (M-Pesa) direct, or aggregator (Flutterwave/Cellulant)?
5. Does the coop want a merchant mobile app later, or web portal only?
