---
name: Farmer Boost Phase 2+3
description: v2.11.1 officer panel + merchant CRUD + credit-funded purchases + Sell outstanding chip. psettings.boost_enabled is authoritative flag.
type: feature
---
**Version:** v2.11.1 (code 143), tag `boost-phase2`

**Feature flag:** `psettings.boost_enabled` is authoritative (Core rule); `boost_limits_policy.boost_enabled` is fallback. Server helper `isBoostEnabledForCoop(ccode)` checks both.

**Device gating:** All boost writes require an approved device via `resolveBoostDevice(uniquedevcode)` (same pattern as milk/store writes).

**New backend endpoints** (backend-api/server.js):
- GET  /api/boost/accounts — list enrolled farmers
- POST /api/boost/limit — upsert credit_limit + ADJUST ledger entry on change
- POST /api/boost/disburse — cash advance (DISBURSE ledger + outstanding+=)
- POST /api/boost/purchase — merchant purchase (PURCHASE ledger + boost_purchases + outstanding+=)
- GET  /api/boost/merchants
- POST /api/boost/merchants — upsert by (ccode, mcode)

**Idempotency:** ref_no unique on boost_ledger; pref_no unique on boost_purchases. Duplicate posts return 200 with `duplicate: true`.

**Transactions:** every write acquires a pooled connection with `beginTransaction`, does account SELECT ... FOR UPDATE, then ledger + account UPDATE, then commit. Rollback on any failure.

**New tables:** `boost_purchases` (pref_no PK); `psettings.boost_enabled` column added defensively.

**Frontend:**
- `/boost` route → `src/pages/BoostPanel.tsx` — 4 tabs: Accounts, Merchants, Purchase, Farmer 360°
- `<BoostOutstandingChip farmerId />` on SellProduceScreen — silently hidden when flag off / not enrolled / outstanding==0
- Services: `src/services/merchants.ts`, extended `boostLedger.ts` (listBoostAccounts, setCreditLimit, disburseCredit, postBoostPurchase, generatePrefNo)

**Not implemented yet:** Store `BuyProduceScreen` boost-tender integration (deliberately deferred — dedicated /boost/purchase screen used instead to keep sensitive Store flow untouched); payout auto-recovery is Phase 4.

**Rollback:** DROP boost_purchases; ALTER TABLE psettings DROP COLUMN boost_enabled. Phase 1 tables remain intact.
