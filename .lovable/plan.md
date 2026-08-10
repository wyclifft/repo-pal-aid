# v2.12.13 — Fix MySQL connection retention, then cumulative query cost

## 1. Findings (from the code, before any change)

**Where the idle connections come from**

`backend-api/server.js:78` creates the single shared `mysql2` pool. It is configured with:

```
connectionLimit: MYSQL_POOL_LIMIT || 80     // no env on Contabo → 80
queueLimit:      MYSQL_QUEUE_LIMIT || 100
enableKeepAlive: true, keepAliveInitialDelay: 10000
connectTimeout:  10000
// NOT set: idleTimeout, maxIdle, acquireTimeout
```

That is the whole explanation for hours-long `Sleep` sessions: `mysql2` never
retires an idle pooled connection unless `idleTimeout`/`maxIdle` are set, and
`enableKeepAlive: true` actively pings the socket so MySQL's own `wait_timeout`
never closes it either. Once a burst of sync traffic pushes the pool to its
high-water mark, those sockets stay open forever in `Sleep`. The server log
`[POOL] limit=100 inUse=75` matches: the pool grew to its peak and stayed there.

**How many pools**

- One pool per `server.js` process. `yetuRoutes.js`, `yetuService.js`,
  `kcbPaymentService.js` all receive the pool as a parameter — no extra pools.
- `sync-service/server.js` creates its own separate pool (lazily, line 58).
- So the real multiplier is the process count: every PM2 instance/cluster worker
  of `backend-api` opens up to 80 more sockets. This needs to be confirmed on the
  box (`pm2 list`, `pm2 describe backend-api` → `instances`), plus whether Node
  connects direct to MySQL or via ProxySQL (ProxySQL keeps its own backend
  connection pool that also shows as long `Sleep` sessions from `root@localhost`).

**Real leaks (connections never returned, not just idle)**

Every `getConnection()` site except `computeCumulativeBatch` releases inline
instead of in `finally`:

- `server.js:1226` (reference generation) — `await connection.rollback()` then
  `connection.release()` inside `catch`. If `rollback()` rejects (dead socket,
  `PROTOCOL_CONNECTION_LOST`), the release never runs and that connection is
  checked out permanently.
- `server.js:1317` (same pattern, second reference path)
- `server.js:2563` `/api/sales` and `server.js:2882` `/api/sales/batch` — same
  `await conn.rollback(); conn.release();` in `catch`, several early-return
  branches each with their own manual `release()`.
- `server.js:5107` `/api/payments/process` and `5428` KCB callback are already
  correct (`finally { conn.release() }`).

**Work done while holding a connection**

`/api/sales` and `/api/sales/batch` hold an open transaction across photo
filename/base64 handling and per-item JS loops. `computeCumulativeBatch` holds
one connection for three sequential multi-minute scans.

**The expensive query**

`computeCumulativeBatch` (`server.js:404`) runs three variants of the same scan.
Every predicate is wrapped in a function, so **no index can be used at all**:

- `UPPER(TRIM(t.ccode)) = UPPER(TRIM(?))` — kills any index on `ccode`
- `CAST(t.Transtype AS UNSIGNED) = 1` — kills `Transtype`
- `CAST(t.transdate AS DATE) BETWEEN ? AND ?` — kills any date range index
- `UPPER(TRIM(t.route)) = UPPER(TRIM(?))` — kills `route`
- the `fm_items` join on `UPPER(TRIM(...))` forces a full scan of `fm_items`
  per row group

Result: full table scan of `transactions` (200k+ rows) three times per warm,
every 90s per (ccode, route, period) key — which is the ~200% MySQL CPU.

## 2. Verification to run on the server first (read-only)

Report these before/with the code change:

```
pm2 list; pm2 describe backend-api | grep -i instances
ss -tnp | grep 3306 | wc -l
SHOW PROCESSLIST;  -- group by host/user/command
SELECT @@wait_timeout, @@interactive_timeout, @@max_connections;
EXPLAIN <the cumulative product query>;   -- expect type=ALL, no key
SHOW INDEX FROM transactions;  SHOW INDEX FROM fm_items;
SHOW CREATE TABLE transactions\G  -- confirm transdate/Transtype column types + collation
```

If ProxySQL is in front, also `SELECT * FROM stats_mysql_connection_pool;`.

## 3. Fix

### A. Connection lifetime (no pool-size increase)

In `backend-api/server.js` pool config:

- add `idleTimeout: 30000` and `maxIdle: 5` so idle sockets are reaped instead
  of parked forever
- set `enableKeepAlive: false` (keep-alive is what defeats MySQL `wait_timeout`;
  with idle reaping it is no longer needed)
- lower the default `MYSQL_POOL_LIMIT` from 80 to **12** (a single-threaded Node
  process cannot use more; this is a reduction, not a workaround)
- keep `queueLimit` finite

### B. Guaranteed release

Introduce one helper and route every acquisition through it:

```js
async function withConn(fn) {
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { try { conn.release(); } catch {} }
}
async function withTx(fn) { /* withConn + begin/commit, rollback().catch(()=>{}) */ }
```

Convert the four leaky sites (1226, 1317, 2563, 2882) to `withTx`, removing the
inline `release()` calls so no path can double-release or skip release. Handler
logic, status codes, duplicate/idempotency handling and response shapes stay
byte-identical — only the acquire/release scaffolding changes.

### C. Make the cumulative query indexable

Rewrite the three scans to sargable form (values normalised in JS before
binding, so semantics are unchanged):

- `t.ccode = ?` with the ccode upper-cased in Node (columns are `utf8mb4_*_ci`,
  so comparison is already case-insensitive; `TRIM` moves to the parameter)
- `t.Transtype = 1` (bind numeric; no CAST)
- `t.transdate >= ? AND t.transdate < DATE_ADD(?, INTERVAL 1 DAY)` — no CAST
- `t.route = ?` with route normalised in Node
- drop the `fm_items` LEFT JOIN entirely: load `fm_items(icode → descript)` once
  per ccode into a small in-process map (already cached elsewhere) and attach
  `product_name` in JS after the aggregate

New migration `backend-api/MIGRATION_CUMULATIVE_INDEXES.sql`:

```sql
CREATE INDEX idx_tx_cum_scan ON transactions (ccode, Transtype, transdate, route);
CREATE INDEX idx_tx_cum_group ON transactions (ccode, Transtype, route, transdate, memberno, icode, weight);
CREATE INDEX idx_fm_items_ccode_icode ON fm_items (ccode, icode);
```

If the audit shows `transdate` is stored as VARCHAR (which the `CAST` hints at),
the range predicate stays string-comparable (`YYYY-MM-DD` sorts correctly) and
the index still applies; that is confirmed in step 2 before the migration ships.

### D. Reduce duplicate cumulative work

- collapse the three scans into **one** query (totals and per-product totals are
  derivable from the same `GROUP BY memberno, icode` result set; `max(id)` comes
  from the same pass) — 3 full scans become 1 indexed scan
- keep a single in-flight promise per warm key (dedupe concurrent
  `[CUM:BATCH] pending (warming)` requests) and skip a re-warm when
  `snapshot_max_id` is unchanged
- raise `CUM_BATCH_REWARM_MS` only for keys that showed no new `max(id)`;
  active keys keep the current cadence
- acquire the connection inside the query call rather than around the whole
  compute + map-building block

## 4. Preserved

Transaction idempotency (`ER_DUP_ENTRY` handling), reference generation format
and locking, offline sync retry/503 semantics, cumulative values, farmer/member
matching, and all response shapes are untouched — the changes are pool config,
release scaffolding, SQL predicate form, and warm scheduling.

## 5. Version

Bump to v2.12.13 (code 189); backend redeploy to Contabo + run the index
migration required for the query change to take effect.
