---
name: Cumulative W3 reconfirm + heal-down
description: Two-stage W3 reconfirm pass that heals confirmed over-counts (cache > backend) when two independent backend reads agree and no unsynced local rows exist. Stage A handles in-session candidates; Stage B replays sticky pins from earlier sessions.
type: feature
---

# W3 reconfirm + heal-down (v2.10.119 → v2.10.120)

## Why
The stale-reject guard correctly refuses single backend reads that are lower than the cache (read-replica lag / unsynced rows / transient errors), but once a cache is genuinely poisoned (sync double-count, manual reversal, etc.) nothing reverses it. Production logs (BA01, 2026-06-17) showed M03561 stuck at cache=79.1 while backend reported 52.1 consistently across 2+ hours, plus M01859/M03544/M02957/M00385/M03284 from prior sessions never re-evaluated.

## Pipeline (src/pages/Index.tsx → loadCumulativeBatch)

1. **W3 batch prewarm** writes every farmer's cumulative via `updateFarmerCumulative(..., verifySource:'W3:prewarm-batch')`. The writer returns `baseCount` after the put. If `baseCount > incomingWeight` → stale-reject signature → push to `reconfirmCandidates` AND `addRegressionPin(...)`.
2. If `baseCount ≈ incomingWeight` → `clearRegressionPin(...)` (cache and backend agree, any prior pin is resolved).

## Reconfirm pass (fire-and-forget, capped, online-only)

### Stage A — in-session candidates (≤25)
- Hit `/api/farmer-monthly-frequency` per farmer with 2s timeout.
- `individual > persisted` → free heal-up (existing behaviour) → `CUM:W3-RECONFIRM-HEAL-UP` (pinned log) + clear pin.
- `individual == batch` AND `individual < persisted`:
  - Read unsynced bucket via `getUnsyncedWeightForFarmer`.
  - If `unsyncedTotal === 0` → **HEAL-DOWN**: `updateFarmerCumulative(..., allowDecrease:true, verifySource:'W3:reconfirm-heal-down')` + clear pin + `CUM:W3-RECONFIRM-HEAL-DOWN` (pinned warn).
  - Otherwise (unsynced rows present OR fetch error) → log `CUM:W3-RECONFIRM-PERSISTENT-GAP` (pinned info, with `reason`) and keep cache.
- Else → `CUM:W3-RECONFIRM-OK`.

### Stage B — sticky-pin replay (≤25, NOT covered by today's batch)
Pulls from `cumulativeRegressionPins` (localStorage). Two consecutive individual reads (150ms apart):
- `v1 ≥ currentPersisted` → pin resolved naturally (heal-up if strictly greater) → `CUM:W3-PIN-RESOLVED`.
- `v1 < currentPersisted` AND `v2 == v1` → same unsynced gate → HEAL-DOWN or PERSISTENT-GAP.
- Reads disagree → `CUM:W3-PIN-DRIFT`, pin kept.
- Any timeout → `CUM:W3-PIN-TIMEOUT`, pin kept.

## Required pre-conditions for heal-down (ALL must hold)
1. `navigator.onLine === true`
2. Two independent backend reads agree
3. Both reads strictly less than persisted cache
4. `getUnsyncedWeightForFarmer().total === 0` for that route
5. Caller is the reconfirm pass (only place that passes `allowDecrease:true` + `verifySource:'W3:reconfirm-heal-down'`)

## Why heal-down is safe here
- Two reads on the read-replica eliminate single-read lag artefacts.
- Backend now returns `snapshot_max_id` (v2.10.119 backend change) so the reads are observably from the same or later snapshot.
- Zero unsynced rows means there is no legitimate explanation for cache > backend.
- The default stale-reject path for every other caller is untouched.

## Logging — all reconfirm verdicts use `plog.pinned(...)`
Pinned log entries bypass the persistent logger's 50/s rate cap, so heal-down evidence is never dropped during a prewarm burst. Affected tags: `CUM:W3-RECONFIRM-HEAL-UP`, `CUM:W3-RECONFIRM-HEAL-DOWN`, `CUM:W3-RECONFIRM-PERSISTENT-GAP` (and their stage-B siblings on the same tags).

## Out of scope / unchanged
- Backend (`snapshot_max_id` already shipped in v2.10.119).
- Single-read stale-reject behaviour everywhere else.
- Zero-confirmation guard (backend=0 vs cached>0) — backend=0 is NOT a heal-down trigger.
- Print-time floor / no-double-count guards (v2.10.106 / v2.10.107).
- IndexedDB schema, sync engine, reference generator, receipts, Bluetooth, auth.
