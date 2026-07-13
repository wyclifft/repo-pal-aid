
# Payments module — production performance fix

## Problem

`GET /api/payments/payable` runs a single aggregate over `transactions` (>200k rows) with `CAST`, `TRIM`, `UPPER`, and a `LEFT JOIN cm_members`. On the shared MySQL host the query exceeds `wait_timeout`/packet limits and the pool reports `PROTOCOL_CONNECTION_LOST`. Every page load pays this full-scan cost.

Fix in three layers: (1) make the query index-friendly, (2) add the supporting indexes, (3) cache the result briefly and add a safe retry so a dropped socket does not surface as a 500.

Scope: `backend-api/server.js` payments endpoints only + one SQL migration file. No frontend behavior change, no schema-shape change. Version bumps to `v2.11.3`.

## 1. SQL migration (new file `backend-api/MIGRATION_PAYMENTS_INDEXES.sql`)

Run once on the production DB. All additive, all `IF NOT EXISTS`-guarded via a small procedure wrapper (MySQL 5.7 compatible) or plain `CREATE INDEX` if already known missing.

```sql
-- Hot path: unpaid transtype=1 rows per ccode within a date window
CREATE INDEX idx_tx_pay_scan
  ON transactions (ccode, transtype, payment_status, transdate);

-- Farmer grouping / joins by memberno
CREATE INDEX idx_tx_pay_member
  ON transactions (ccode, memberno, transtype, payment_status);

-- cm_members lookup used by payable + history
CREATE INDEX idx_cm_ccode_mcode
  ON cm_members (ccode, mcode);
```

These are the only indexes needed. No column changes.

## 2. Rewrite `/api/payments/payable` (server.js ~4318)

Goals: let MySQL use `idx_tx_pay_scan`, drop the `LEFT JOIN` from the aggregate, avoid per-row `CAST/UPPER/TRIM` on the driving table.

Steps in the handler:

1. Resolve `ccode` once (already canonical from `resolvePaymentsAccess` — pass it through as-is, no `UPPER(TRIM(?))` on the indexed column).
2. Aggregate first, join later:

   ```sql
   SELECT memberno AS farmer_code,
          SUM(weight)         AS total_qty,
          COUNT(*)            AS unpaid_count
     FROM transactions
    WHERE ccode = ?
      AND transtype = 1
      AND payment_status = 'unpaid'
      AND transdate >= ? AND transdate < ?   -- half-open, sargable
    GROUP BY memberno
   HAVING total_qty > 0
   ```

   - Uses `idx_tx_pay_scan` for range scan.
   - No `CAST(t.transdate AS DATE)` — pass `range.start` / `range.end + 1 day` and rely on the raw column.
   - No `TRIM/UPPER` on `ccode` — depends on data already being canonical. `resolvePaymentsAccess` returns the canonical value; add a one-time `UPPER(TRIM(...))` in JS before the query if needed.
3. If the row count is 0 → return `[]` immediately.
4. Second query, small and bounded by the aggregated farmer list:

   ```sql
   SELECT mcode AS farmer_code, descript AS farmer_name, crbal
     FROM cm_members
    WHERE ccode = ? AND mcode IN (?, ?, …)
   ```

   Chunk `IN (...)` at 500 codes to keep the packet size safe.
5. Merge in JS (existing gross/deductions/net math is fine; keep `parseCrbalTotal`).

## 3. Short-lived response cache

Use the existing `backend-api/lib/lruCache.js` (already in the repo).

- Key: `payable:${ccode}:${period}:${range.start}:${range.end}:${pricePerKg}`
- TTL: 60s.
- Invalidate on successful `/api/payments/process` for that `ccode` — call `cache.delete` for every key prefixed `payable:${ccode}:`.

This turns a burst of dashboard opens into one aggregate query per minute per company.

## 4. Connection-loss resilience

Wrap the two payable queries in a tiny retry helper (server.js local, ~10 lines):

- Retry once on `PROTOCOL_CONNECTION_LOST` / `ECONNRESET` / `ER_QUERY_INTERRUPTED`.
- Log `[PAY][PAYABLE][RETRY]` with `requestId` so the pattern is observable.
- No retry on POST `/process`.

## 5. Version + docs

- `src/constants/appVersion.ts` → `2.11.3`, code `145`, tag `payments-perf`.
- `android/app/build.gradle` → matching bump.
- Update `docs/payments-backend-additions.md` with the migration file name, the new query shape, and the cache/retry notes.

## Verification

- `EXPLAIN` the new aggregate on production and confirm `idx_tx_pay_scan` is used with `Using index condition` and rows examined ≪ 200k.
- Hit `/api/payments/payable?period=season` twice within 60s; second call logs a cache hit and returns <50ms.
- Kill a MySQL connection mid-request in staging; endpoint retries once and returns 200.
- Frontend Payments screen loads unchanged across all four periods.

## Out of scope

- No table partitioning, no materialized totals table, no background worker. Those are the next tier if index+cache is not enough; revisit after we see the `EXPLAIN` plan and p95 latency in production.
- No changes to `/process` beyond cache invalidation.
