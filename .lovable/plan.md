# v2.12.13 (code 189) — MySQL connection retention + cumulative query performance

Targeted performance/stability change. No business logic, response shape, status
code, reference-format, idempotency or sync-semantics change.

## 1. Confirmed state

**Pool / connections** — `backend-api` is a single PM2 **fork** process, so the
291 sockets to 3306 come from one Node pool (plus ProxySQL, which is out of scope).
`backend-api/server.js:78` builds the shared `mysql2` pool with
`connectionLimit: MYSQL_POOL_LIMIT || 80`, `enableKeepAlive: true`,
`keepAliveInitialDelay: 10000` and **no** `idleTimeout` / `maxIdle`. `mysql2`
never retires an idle pooled socket without those two options, and keep-alive
pings defeat MySQL's `wait_timeout=28800`. That is exactly the observed 139
sleeping `root` connections, oldest ~4.3 h, ending in `ERROR 1040` against
`max_connections=151`.

**Leaky release paths** — `server.js:1226`, `1317` (reference generation),
`2563` `/api/sales`, `2882` `/api/sales/batch` all do
`await conn.rollback(); conn.release();` inside `catch`. If `rollback()` rejects
(dead socket) the release never runs and the connection is checked out forever.
`/api/payments/process` (5107) and the KCB callback (5428) already use
`finally { conn.release() }` and will be left alone.

**Cumulative cost** — `computeCumulativeBatch` (server.js:404) runs **three**
scans over the same population on one connection:

- totals: `GROUP BY TRIM(memberno)`
- per-product: same rows + `LEFT JOIN fm_items` on `UPPER(TRIM(...))`
- snapshot: `MAX(id)`

Every predicate is function-wrapped (`UPPER(TRIM(ccode))`,
`CAST(Transtype AS UNSIGNED)=1`, `CAST(transdate AS DATE) BETWEEN`,
`UPPER(TRIM(route))`), so none of the existing indexes can be used — three full
MyISAM scans of a ~6.7M-auto-increment table per warm key, every 90 s.

**Schema facts that constrain the fix** — `transactions` is MyISAM, latin1;
`transdate` is already `DATE`; `Transtype` is `VARCHAR(20)`; `icode` is `TEXT`
(so it cannot go into a plain composite index); `route varchar(20)`,
`ccode varchar(100)`; PK column is `ID`. `fm_items` has only the PK on `ID`.

## 2. Pool configuration

```
connectionLimit: MYSQL_POOL_LIMIT || 12,   // was 80
queueLimit:      MYSQL_QUEUE_LIMIT || 100,
idleTimeout:     30000,
maxIdle:         5,
enableKeepAlive: false,
connectTimeout:  10000,
```

Env-var overrides keep working; the `[POOL]` snapshot logger is unchanged.

## 3. Guaranteed release

Add `withConn(fn)` (release in `finally`) and `withTx(fn)`
(`beginTransaction` → `commit`, `rollback().catch(()=>{})` on error, release
always) next to the pool declaration, and convert the four leaky sites to them,
deleting their inline `release()` calls so no path can double-release or skip
release. Handler bodies, error codes, `ER_DUP_ENTRY` handling and responses are
copied across verbatim. Note MyISAM ignores transactions — `withTx` keeps the
existing calls' shape rather than changing behaviour. Sites already using
`finally { conn.release() }` are untouched.

## 4. Cumulative: sargable predicates

Normalise in JS (`String(x).trim()`; latin1 collation is already
case-insensitive so `UPPER` is redundant) and bind plain values:

- `ccode = ?`
- `transdate BETWEEN ? AND ?` — the `CAST(... AS DATE)` is a pure no-op on a
  `DATE` column and is simply dropped (identical results, now sargable)
- `route = ?` when a route is supplied

`Transtype` needs care: it is `VARCHAR(20)`, and comparing it to a number
(`Transtype = 1`) re-introduces an implicit cast on the column, which is just as
non-sargable as `CAST(...)`. So the implementation step is: read the actual
distinct values with a one-off `SELECT DISTINCT Transtype FROM transactions`
(cheap, and reported before the change lands) and replace the cast with a
string-literal predicate covering exactly those milk-collection values, e.g.
`Transtype IN ('1','01')`. If the distinct set shows anything that only
`CAST(...)` matches, the cast stays on `Transtype` and the index leads with
`ccode, transdate, route` instead — correctness wins over the index.

## 5. Cumulative: drop the fm_items join, collapse to one scan

One scan replaces three:

```sql
SELECT TRIM(memberno) AS farmer_id,
       TRIM(icode)    AS icode,
       IFNULL(SUM(weight),0) AS weight,
       MAX(ID)        AS max_id
  FROM transactions
 WHERE ccode = ? AND <transtype predicate>
   AND transdate BETWEEN ? AND ? [AND route = ?]
 GROUP BY TRIM(memberno), TRIM(icode)
```

Then in JS, **after the connection is released**:

- per-farmer totals = sum of that farmer's product rows (same value as the old
  `GROUP BY memberno` scan)
- `snapshot_max_id` = max of `max_id` (same value as the old `MAX(id)` probe)
- `product_name` = `fm_items` lookup: load `SELECT icode, descript FROM fm_items
  WHERE ccode = ?` once per ccode, key the map on `TRIM(icode).toUpperCase()`,
  and pick the max `descript` per key to mirror the old `MAX(fi.descript)`;
  fall back to the trimmed icode exactly as `IFNULL(..., MIN(TRIM(t.icode)))`
  does today. `transactions.icode` is TEXT vs `fm_items.icode varchar(10)`, but
  the old join already compared them as trimmed/upper strings — the map uses the
  same key, so matching semantics are unchanged.

Returned object (`farmers[].farmer_id / cumulative_weight / by_product[]`,
`month_start`, `month_end`, `total_farmers`, `snapshot_max_id`) and the
`[CUM:WARM]` log line are unchanged.

## 6. Warm dedup + shorter connection hold

- one in-flight promise per warm key (`ccode:route:period`); concurrent
  `[CUM:BATCH] pending (warming)` callers await it instead of starting a second
  scan
- skip the re-warm when the cheap `MAX(ID)` probe shows `snapshot_max_id`
  unchanged; keys with no change for several ticks fall back to a longer
  interval, keys with new rows keep the current 90 s cadence
- connection acquired via `withConn` around the query only; all map building and
  cache writes happen after release
- `/api/sales` and `/api/sales/batch`: move photo filename/base64 preparation and
  payload shaping **before** the connection is acquired; the DB statements keep
  their existing order and boundaries

## 7. Migration — `backend-api/MIGRATION_CUMULATIVE_INDEXES.sql`

Only what the final SQL can actually use:

```sql
CREATE INDEX idx_tx_cum_scan ON transactions (ccode, Transtype, transdate, route);
CREATE INDEX idx_fm_items_ccode_icode ON fm_items (ccode, icode);
```

`idx_tx_cum_group` from the original proposal is **dropped**: `icode` is `TEXT`
and cannot be indexed without a prefix length, and the remaining columns are
already covered by `idx_tx_cum_scan`. Existing `idx_tx_pay_scan`
(`ccode, Transtype, payment_status, transdate`) can't serve the cumulative range
because `payment_status` sits between the equality and the range column, so
`idx_tx_cum_scan` is not redundant. Additive only — no drops.

## 8. Frontend blocker (v2.12.12 typecheck errors)

`src/pages/Index.tsx`:

- foreground receipt path (~1635) and background-print path (~1826): add
  `const cachedRow = await getFarmerCumulative(cleanId, selectedRouteCode || undefined)`
  / `... (printData.farmerIdForCumulative, printData.routeCode || undefined)` at the
  top of each `try`
- hoist `const fetchCloud = ...` and `let freqResult` out of the
  `if (cloudCumulative === undefined)` block in both paths so the lag-retry below
  can reuse them (no second fetch definition)
- background-print path: `const prevCum = printData.previousCumulativeTotal;`
  `const justSubmitted = printData.justSubmittedWeight;` — both already carried on
  `printData` (lines 1361-1362)

## 9. Version

`src/constants/appVersion.ts` → 2.12.13, Android `versionCode` 189 /
`versionName` 2.12.13, `sw.js` cache bump, backend version string.

## 10. Validation

Typecheck clean; cumulative response compared field-by-field against the current
implementation for one ccode/route/period; every converted handler exercised on
the error path to confirm release. Deploy note: `backend-api/` must be
redeployed to Contabo and the index migration run for the query change to bite.
