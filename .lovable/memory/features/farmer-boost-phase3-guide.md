---
name: Farmer Boost Phase 3.5 — guide + onboarding UX
description: v2.11.2 operator guide + typeahead pickers. Enrollment loads members from cached farmers store (cm_members scoped by ccode via device auth). Merchant fields typeahead on mcode OR name.
type: feature
---
**Version:** v2.11.2 (code 144), tag `boost-onboarding`

**Frontend-only changes:**
- `src/components/boost/FarmerEnrollCombobox.tsx` — reads IndexedDB `farmers` store (populated by existing members sync). Filters to M-prefix, supports numeric padding (1 → M00001), matches on ID or name, excludes already-enrolled IDs.
- `src/components/boost/MerchantCombobox.tsx` — typeahead across `mcode` OR `name`, status badges, optional `activeOnly` gate.
- `src/pages/BoostPanel.tsx` — Accounts enrol row, Purchase (member + merchant), Farmer 360 all use the new combos. Purchase submit hard-blocks when the typed mcode isn't in the ACTIVE merchants list.

**New docs:** `docs/FARMER_BOOST_GUIDE.md` — full table/column reference, endpoint reference, six operator playbooks, troubleshooting, rollback.

**No backend, schema, sync, reference generator, receipt, or auth changes.** Feature remains dormant unless `psettings.boost_enabled = 1`.

**Data source contract:** enrollment and Farmer 360 pull members from the app's IndexedDB `farmers` store, which is populated by the existing members sync and already scoped to the operator's coop via device auth on the backend. No new endpoint added; works offline.
