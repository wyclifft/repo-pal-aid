# Farmer Boost — Phase 3.5: Operator Guide + Enrollment/Merchant UX polish

Goal: ship a complete operator guide and tighten the two onboarding surfaces (farmer enrollment, merchant CRUD) so users can find records fast by typing either the code or the name/description. Additive only — no changes to milk/store/receipt/sync paths.

## 1. Deliverables

### A. Operator guide document
Location: `docs/FARMER_BOOST_GUIDE.md` (new, plus a link from `README.md`).

Contents:
- **Overview** — what Farmer Boost is, when to enable it (`psettings.boost_enabled=1`), and what stays off when disabled.
- **End-to-end flow diagram** (ASCII) covering: enroll → set limit → disburse OR purchase → outstanding chip on Sell → future payout recovery.
- **Table & column reference** — one section per table, plain-English purpose for every column, populated from the Phase 1/2 migration files:
  - `merchants` (mcode, ccode, name, kra_pin, phone, till_paybill, bank_name, bank_acc, status, timestamps)
  - `boost_accounts` (farmer_id, ccode, credit_limit, outstanding, hold_amount, status, score, set_by, notes, timestamps)
  - `boost_ledger` (id, entry_type enum, amount sign convention, ref_no idempotency, mcode, related_transrefno, payout_run_id, reverses_id, device_code, operator, notes, ts)
  - `boost_limits_policy` (boost_enabled fallback, recovery_cap_pct, limit_mode, policy_json)
  - `boost_purchases` (pref_no, items_json, total, status, ledger_id linkage)
  - `psettings.boost_enabled` — authoritative flag.
- **Endpoint reference** — the 7 `/api/boost/*` routes with request/response shape and idempotency notes.
- **Operator playbooks** (step-by-step with screenshots):
  1. Enable Boost for a coop (SQL snippet + psettings toggle).
  2. Onboard a merchant (Merchants tab).
  3. Enroll a farmer & set a credit limit (Accounts tab).
  4. Record a credit-funded input purchase (Purchase tab).
  5. Read a farmer's 360° history (Farmer 360 tab).
  6. Reverse an entry (ADJUST/REVERSAL pattern — no deletes).
- **Screenshots** — captured from the running `/boost` panel via Playwright at 1280×1800, saved to `docs/images/boost/` (`01-accounts.png`, `02-merchants.png`, `03-purchase.png`, `04-farmer360.png`, `05-sell-chip.png`, `06-flag-off.png`).
- **Troubleshooting** — flag off, device not approved, duplicate ref_no, offline behaviour.
- **Rollback** — drop the 5 boost tables + drop `psettings.boost_enabled` column.

### B. Farmer enrollment sourced from `cm_members`
Today the Accounts tab likely relies on already-existing boost_accounts rows. Change to:
- Add an **Enroll farmer** control in the Accounts tab that opens a searchable picker backed by the existing member cache (`cm_members` for the operator's `ccode`, resolved server-side via `uniquedevcode` — never trust a client-supplied ccode).
- Reuse `useFarmerResolution` semantics (M-prefix, numeric padding, `.trim().toUpperCase()`) so `1` → `M00001`, and typing part of the name filters live.
- Enrollment = upsert into `boost_accounts` with `status='ACTIVE'`, `credit_limit=0`, `set_by=<operator>`. No ledger entry (limit change ADJUST fires only when limit>0 is later saved, matching current `/api/boost/limit` behaviour).
- No new endpoint needed for member lookup — use the existing members list already available to the app; filter client-side against the coop's cached members.

### C. Merchant typeahead
In the Merchants tab and Purchase tab:
- Replace the plain mcode text input with a combobox that suggests as the user types. Match is a case-insensitive `includes` on **either** `mcode` **or** `name` (description). Show `mcode — name` in the list, with `status` badge.
- Purchase tab: selecting a suggestion auto-fills `mcode` and shows the merchant name inline; block submit if the chosen merchant's status ≠ `ACTIVE`.
- Merchants tab: same combobox on the "edit existing" path; the "add new" path stays a free-text input so new mcodes can be created.
- Data source: existing `listMerchants(uniquedevcode)` result already scoped to ccode server-side. No new endpoint.

### D. Version + memory
- Bump to `v2.11.2` (code `144`) in `src/constants/appVersion.ts`.
- Update `mem://features/farmer-boost-phase2` with a short note pointing at the new guide + typeahead changes (or add `mem://features/farmer-boost-phase3-guide`).

## 2. Files touched

New:
- `docs/FARMER_BOOST_GUIDE.md`
- `docs/images/boost/*.png` (6 screenshots)
- `src/components/boost/FarmerEnrollCombobox.tsx`
- `src/components/boost/MerchantCombobox.tsx`

Edited (surgical):
- `src/pages/BoostPanel.tsx` — wire the two comboboxes into Accounts / Merchants / Purchase tabs; add "Enroll farmer" button.
- `src/constants/appVersion.ts` — bump.
- `README.md` — one-line link to the guide.
- `.lovable/memory/features/farmer-boost-phase2.md` — append v2.11.2 note.

Not touched: backend `server.js`, migrations, milk/store/receipt/sync code, `SellProduceScreen` chip, `BuyProduceScreen`.

## 3. Safety & compatibility

- Feature stays dormant until `psettings.boost_enabled=1`; every new UI element continues to short-circuit when the flag is off.
- No schema changes — Phase 1 + 2 migrations already cover the tables.
- Member data is read from the app's existing cached members list (already scoped by ccode via device auth), so no new query surface on `cm_members`.
- All lookups are client-side against already-cached data → works offline exactly like the rest of the app.
- Idempotency and device-approval contracts on write endpoints remain unchanged.

## 4. Verification checklist

- [ ] With `boost_enabled=0`: `/boost` still renders a "feature disabled" state; Sell chip stays hidden; guide renders correctly.
- [ ] With `boost_enabled=1`: enroll a farmer by typing `1` (resolves to `M00001`); enroll another by typing part of the name; both appear in Accounts.
- [ ] Merchant typeahead matches on both `mcode` and `name`; suspended merchants blocked in Purchase.
- [ ] Screenshots captured headless, no PII, saved under `docs/images/boost/`.
- [ ] `markitdown` / manual read of the guide shows every table + column documented.
- [ ] Existing txn creation, receipts, sync, and device auth verified unaffected.
