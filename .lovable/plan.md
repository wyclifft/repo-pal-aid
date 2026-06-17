# Plan — Heal-down for confirmed persistent cumulative over-counts (v2.10.120)

## Problem (from BA01 logs, v2.10.119)

Several farmers have a cache that is permanently larger than backend reality, and the stale-reject guard protects the wrong number forever:

| Farmer  | Cached | Backend | Δ      | Last seen |
|---------|--------|---------|--------|-----------|
| M03561  | 79.1   | 52.1    | −27.0  | today, every prewarm |
| M01859  | 1694.2 | 1496.6  | −197.6 | yesterday, then untouched |
| M03544  | 539.6  | 518.0   | −21.6  | yesterday, then untouched |
| M02957  | 547.4  | 485.2   | −62.2  | yesterday, then untouched |
| M00385  | 373.0  | 330.0   | −43.0  | yesterday, then untouched |
| M03284  | 106.8  | 100.2   | −6.6   | yesterday, then untouched |

v2.10.119's W3 reconfirm correctly **detected** the M03561 gap with two independent backend reads (`batch=52.1`, `individual=52.1`, `snapshot_max_id=706707`), but only logged `CUM:W3-RECONFIRM-PERSISTENT-GAP`. It does not yet write the corrected value. The other five farmers were never re-evaluated today because the daily prewarm only includes farmers in today's active set.

## Goal

When two independent backend reads agree that the true total is **lower** than the cache, and we can prove it is not lag / not unsynced rows / not a transient, heal the cache **down** to the agreed backend value. Plus actively re-evaluate farmers that previously had a sticky over-count even if they aren't in today's prewarm.

## Changes

### 1. `src/pages/Index.tsx` — heal-down branch in W3 reconfirm
Currently the `CUM:W3-RECONFIRM-PERSISTENT-GAP` branch only logs. Replace with a guarded heal-down:

- Gate (all must be true):
  - `individual === batch` (two independent reads agree)
  - `individual < persisted` strictly
  - `snapshot_max_id` present and ≥ the value seen in the first batch read
  - Farmer has **zero unsynced local rows** for this route/icode (check the same unsynced bucket the print-floor path already uses)
  - No in-session write advanced `writeSeq` between the two reads
- On pass, call `updateFarmerCumulative` with `verifySource: "W3:reconfirm-heal-down"` and a new `allowDecrease: true` flag.
- Tag log `CUM:W3-RECONFIRM-HEAL-DOWN` with prev/new/snapshot_max_id/unsyncedCount.
- Cap to ≤25 heal-downs per batch (same as reconfirm pass).

### 2. `src/pages/Index.tsx` — sticky-regression replay queue
- Add a tiny per-device IndexedDB key (`cumulative_regression_pins`) recording any farmer that triggered `CUM:STALE-REJECT` or `CUM:REGRESSION-UNCONFIRMED` in the last 24h, with `{ farmerId, route, lastPersisted, lastBackend, sessions }`.
- On every successful prewarm cycle, after the normal batch finishes, take up to 25 pins **not** already covered by today's batch and run them through the same W3 reconfirm path (two reads, snapshot_max_id, heal-down gate).
- Remove a pin when either: heal-down succeeds, OR the cache and backend become equal naturally, OR pin is older than 7 days.
- This pulls M01859, M03544, M02957, M00385, M03284 back into evaluation without waiting for a farmer-specific event.

### 3. `updateFarmerCumulative` (cumulative writer)
- Add `allowDecrease?: boolean` parameter. Override only fires when **both** `allowDecrease === true` **and** `verifySource === "W3:reconfirm-heal-down"` — defence in depth so a stray flag elsewhere can't decrease values.
- Emit `CUM:STALE-OVERRIDE` log with prev/new/snapshot_max_id/unsyncedCount/caller. All other call-sites untouched, so the zero-confirmation guard stays intact for every other path.

### 4. Logger — keep observability during prewarm
- The 50/s rate cap dropped 193 entries in one second yesterday, right when reconfirm fired. Two-part fix:
  - Collapse the high-volume `CUM:STALE-CHECK accept Δ0` lines into one rollup line per batch (no info loss; today they're already noise).
  - Mark `CUM:W3-RECONFIRM-*`, `CUM:STALE-OVERRIDE`, `CUM:STALE-REJECT` as **never-drop** so they bypass the rate cap.

### 5. Version + memory
- `src/constants/appVersion.ts` 2.10.119 → 2.10.120
- `android/app/build.gradle` versionCode 140 → 141
- `public/sw.js` v54 → v55
- Update `mem://features/cumulative-w3-reconfirm.md` to document the heal-down branch and gating rules.
- Add `mem://features/cumulative-regression-pin-replay.md` for the sticky-regression queue.
- Add both as one-line entries under memory index → Sync & Idempotency.

## Out of scope
- Backend changes — `snapshot_max_id` is already returned by v2.10.119.
- BT scale reconnect, reference generator, sync engine, IndexedDB schema, receipt path — all untouched.

## Verification

After deploy and one prewarm cycle:
- M03561 cache heals 79.1 → 52.1 and stays at 52.1 on subsequent prewarms (no oscillation, no STALE-REJECT spam).
- M01859, M03544, M02957, M00385, M03284 picked up by the pin-replay pass on next prewarm; each heals to backend value if backend confirms twice.
- M01690 (cached=12, backend=0) and M00031 (cached=15.4, backend=0) **remain held** — they fail the gate (backend=0 falls under zero-confirmation, not heal-down).
- Any farmer with unsynced local rows is **not** healed (gate blocks it).
- Logger drops in CUM channel during prewarm fall to zero; `CUM:STALE-OVERRIDE` and reconfirm lines always visible in /debug.
- Existing tests for capture, reference generation, sync, receipt, photo, Z-report still pass — none of those paths are touched.

## Risk
Low. Heal-down requires (a) two backend reads agreeing, (b) snapshot proof of committed read, (c) zero unsynced rows, (d) explicit verifySource string, (e) explicit `allowDecrease` flag, (f) per-batch cap of 25. Any gate failure falls through to today's log-only behaviour.
