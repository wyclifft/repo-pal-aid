---
name: W3 Cumulative Reconfirm + Same-Connection Batch
description: Backend batch endpoint reads totals + per-product on one connection (READ COMMITTED) and returns snapshot_max_id; frontend reconfirms stale-rejected W3 farmers via individual endpoint with 2s timeout, healing up when safe.
type: feature
---
Backend `/api/farmer-monthly-frequency-batch` acquires a single pooled connection, sets SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED, runs totals SUM + per-product SUM + MAX(id) probe on it, returns `snapshot_max_id` (additive field; older clients ignore).

Frontend `loadCumulativeBatch` (src/pages/Index.tsx): when `updateFarmerCumulative` for W3 prewarm returns persisted > incoming (stale-reject signature), the farmer is queued. After the main batch, a capped (≤25) async pass calls `/api/farmer-monthly-frequency` per farmer with 2s timeout:
- individual > persisted → heal up (free increase) tagged `CUM:W3-RECONFIRM-HEAL-UP`
- individual ≤ persisted but == batch → `CUM:W3-RECONFIRM-PERSISTENT-GAP`
- individual ≥ persisted (different from batch) → `CUM:W3-RECONFIRM-OK`
- timeout/error → `CUM:W3-RECONFIRM-TIMEOUT`

Surfaces in `/debug` Cumulative tab via existing CUM taxonomy. v2.10.119.
