## What we now know

- Active session for `C003`: `2026-01-01 → 2026-06-30` ✅ correctly covers today and all four farmers' deliveries.
- DB-truth SUM in that exact window (your earlier query):
  - M03544 = **567.8**, M01859 = **1791.4**, M00385 = **392.4**, M03284 = **106.8**
- Persisted (cached `baseCount`):
  - M03544 = 539.6, M01859 = 1601.8, M00385 = 373.0, M03284 = 106.8
- W3 batch incoming:
  - M03544 = 518.0, M01859 = 1496.6, M00385 = 330.0, M03284 = 100.2
- Your end=2026-06-15 query matches **persisted exactly** for 3 of 4 farmers.

## Conclusion

The backend SQL is correct. The **W3 batch response is dropping the most recent delivery row(s)** while still using the right session window. The two most plausible technical causes (both consistent with the pattern):

1. **MySQL read-side staleness** — MariaDB's `READ COMMITTED` + pool reuse can occasionally serve a snapshot where the most-recently-written row is not yet visible to a particular pooled connection (especially under HTTP keep-alive bursts where the batch call lands on a stale-ish session).
2. **Pool connection partial result** — the connection-pool limit (10) means a heavily concurrent moment can return a query against a connection whose session variables / transaction snapshot were started before the latest commit.

Either way, the symptom is the same: batch returns `persisted − latestDeliveryWeight`, never `persisted + latestDeliveryWeight`. The cumulative guard correctly STALE-REJECTs these, but we want to (a) heal cleanly once the truth catches up, (b) prove the cause in production logs, and (c) eliminate the silent drop at its source.

## Plan

### 1. Backend — make the batch read self-consistent (`backend-api/server.js`)

In the `/api/farmer-monthly-frequency-batch` handler:

- Acquire a single dedicated connection (`pool.getConnection()`), set `SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED`, run **both** the totals query and the per-product query on the **same connection**, then release. This guarantees both SUMs see the same snapshot — eliminates split-snapshot risk.
- Before returning, run a lightweight self-check: `SELECT MAX(id) FROM transactions WHERE ccode=? AND CAST(transdate AS DATE) BETWEEN ? AND ?` on the same connection and include it in the response as `snapshot_max_id`. The frontend can compare across calls to detect regressions.
- Add structured server log line: `[CUM:BATCH] ccode=… route=… period=…→… farmers=N snapshot_max_id=…` for every batch call.

No formula changes. No removal of existing UPPER/TRIM. Pure additive.

### 2. Frontend — per-farmer reconfirm before STALE-REJECT

In the W3 prewarm path (where `updateFarmerCumulative` rejects a decrease):

- When `verifySource === 'W3:prewarm-batch'` AND `incoming < persisted` AND no local unsynced row can heal the gap → instead of an immediate `CUM:STALE-REJECT`, schedule a single per-farmer reconfirm by calling `/api/farmer-monthly-frequency?farmer_id=…&route=…`.
- Compare:
  - `individual ≥ persisted` → keep persisted, log `CUM:W3-RECONFIRM-OK` (transient lag, no harm).
  - `individual === incoming` (both lower than persisted) → still keep persisted but raise `CUM:W3-RECONFIRM-PERSISTENT-GAP` so we can see it in `/debug` Cumulative tab.
  - `individual > incoming AND individual > persisted` → accept individual as new floor, log `CUM:HEAL-UP-VERIFIED`.
- Hard timeout 2s. On timeout/error, behave exactly like today (keep persisted).

This is the same shape as the existing "Zero-Confirmation Guard" — never lower without two independent confirmations.

### 3. Observability

- Frontend: every reconfirm decision logged via `plog.info` with full tag set: `farmerId`, `route`, `persisted`, `batchIncoming`, `individual`, `decision`, `snapshot_max_id_batch`, `snapshot_max_id_individual`.
- `/debug` → Cumulative tab automatically picks these up (existing `[CUM]` taxonomy).
- Surface `snapshot_max_id` mismatch as a dedicated tile so operators can immediately see read-replica drift if it ever happens.

### 4. Version bump

- `v2.10.108` — patch fix, "cumulative under-count protection: same-connection batch reads + W3 reconfirm".
- Updates: `src/constants/appVersion.ts`, `android/app/build.gradle` (versionName + versionCode), SW cache version in `public/sw.js`, log a one-line CHANGELOG comment in `server.js`.

### 5. Verification

- After deploy, watch `/debug` Cumulative tab on the M03544 / M01859 / M00385 devices through one prewarm cycle.
- Expectation: zero `CUM:STALE-REJECT` from W3 once read catches up; if drift recurs, a `CUM:W3-RECONFIRM-OK` line appears with the snapshot ids — that's our smoking gun for replica lag and we then move the fix into the backend's connection acquisition layer.

## Out of scope (explicitly NOT changing)

- The cumulative formula, the existing per-route / per-product cache key, IndexedDB schema, `transrefno`/`uploadrefno` generation, any auto-generated file, any other API endpoint, RLS / auth.
- Production endpoint contract: only **adds** `snapshot_max_id` (additive field — safe for older Capacitor clients that ignore unknown keys).

## Technical details

```text
backend-api/server.js  (≈ lines 3359–3475 and 3479–3590)
  - getConnection() once per request; release in finally
  - SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED
  - run totalRows, productRows, snapshot probe on same conn
  - response: { …existing…, snapshot_max_id }

src/utils/farmerCumulativeSync.ts  (the W3 prewarm consumer)
  - new helper: reconfirmFarmerCumulative(farmerId, route, ccode)
  - call before stale-reject when verifySource === 'W3:prewarm-batch'
  - new plog tags: CUM:W3-RECONFIRM-{OK|GAP|HEAL-UP|TIMEOUT}

src/constants/appVersion.ts, public/sw.js, android/app/build.gradle
  - bump to 2.10.108
```

No DB schema migration. No breaking changes. Strictly additive.
