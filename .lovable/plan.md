# Tier 1 Backend Hardening — Stay Within 40 MySQL Connections

## Goal
Make `backend-api` and `sync-service` safely handle more concurrent users **without ever exceeding the cPanel `max_user_connections = 40` cap** on the shared MySQL user (`maddasys_wycliff`). No host ticket, no infra migration, no API contract changes.

## Connection Budget

Assumption (safest): both Node apps use the **same** MySQL user, and Passenger may spawn **up to 2 worker processes per app**. Each Node process opens its own pool, so the worst case is `2 procs × pool_size` per app.

```text
Per-user MySQL cap            : 40
─────────────────────────────────
backend-api : 2 procs × pool 8 = 16
sync-service: 2 procs × pool 5 = 10
phpMyAdmin / cron / ad-hoc    :  ~6
Safety headroom               :  ~8
─────────────────────────────────
Worst-case total              : ≤ 40 ✅
```

If later you confirm Passenger runs only 1 instance per app, pools can be doubled safely (backend 15, sync 10) without code changes beyond the `.htaccess`/env values.

## Changes (Tier 1 only)

### 1. `backend-api/server.js` — pool & resilience
- `connectionLimit`: `2` → **`8`** (configurable via `MYSQL_POOL_LIMIT` env)
- `queueLimit`: `0` (unbounded) → **`50`** — fast-fail instead of piling up forever
- Add `enableKeepAlive: true`, `keepAliveInitialDelay: 10000`
- Add `connectTimeout: 10000`
- Add a per-request timeout: `server.setTimeout(30000)` and return `503 {error:'request_timeout'}` instead of hanging
- Catch pool-exhaustion errors (`ER_USER_LIMIT_REACHED`, `PROTOCOL_CONNECTION_LOST`) → respond `503 {error:'db_busy', retryable:true}` so the client's `resilientFetch` can back off

### 2. `sync-service/server.js` — pool tighten
- `connectionLimit`: `5` (keep) or drop to **`5`** confirmed, add `queueLimit: 30`
- Same keepalive + connectTimeout settings
- Same `ER_USER_LIMIT_REACHED` graceful 503

### 3. `.htaccess` env vars (both apps)
Add tunables so future changes don't require code edits:
```
SetEnv MYSQL_POOL_LIMIT 8
SetEnv MYSQL_QUEUE_LIMIT 50
SetEnv REQUEST_TIMEOUT_MS 30000
```

### 4. In-process LRU caches (read-only hot tables)
Cache the three tables that are hit on almost every request and rarely change. This is the single biggest connection saver.
- `psettings` by `ccode` — TTL 120 s
- `cm_members` by `(ccode, mcode)` — TTL 60 s
- `approved_devices` by `device_fingerprint` — TTL 60 s

Tiny hand-rolled `Map`-based LRU (≤30 LOC, no new dependency). Expected DB-query reduction on hot paths: **~50–70%**, which is the equivalent of doubling pool capacity for free.

### 5. Heap cap
Remove the `--max-old-space-size=96` flag in `backend-api/package.json` (raise to default, ~512 MB on Node 19). The 96 MB cap was a defensive guess; it actively causes GC stalls that hold connections open longer. Sync-service keeps its current heap.

### 6. Observability
- Log pool snapshot every 60 s: `{ inUse, free, queued }` to stdout
- Log every `ER_USER_LIMIT_REACHED` with the timestamp and current pool stats — gives you a clean signal if 40 is actually being hit

## Out of Scope (explicitly NOT in this plan)
- API contract changes / new endpoints / removed endpoints
- Schema changes, migrations, new indexes
- Rate limiting (per project rule — separate effort)
- Anything in the Capacitor app, frontend, sync engine, cumulative logic, auth, or Bluetooth
- Moving off cPanel, `pm2 cluster`, read replicas (Tier 5/6 — future)
- Raising `max_user_connections` with the host (you chose to skip)

## Expected Capacity After Tier 1

| Metric | Before | After Tier 1 |
|---|---|---|
| Safe concurrent in-flight DB calls | ~2 | ~16 (or 8 if 1 worker) |
| Safe concurrent active POS users | ~20–40 | **~60–90** |
| Behavior at overload | Silent hang | Fast-fail 503 → client retries |
| Risk of hitting `max_user_connections=40` | Low (pool too small) | Bounded by design |

## Rollout
1. Edit `server.js`, `package.json`, `.htaccess` for both apps.
2. Upload to cPanel, restart each Node app from cPanel UI.
3. Hit `/api/health` and watch the new 60-second pool log line.
4. If `ER_USER_LIMIT_REACHED` ever appears in logs → lower `MYSQL_POOL_LIMIT` to 6 via `.htaccess` (no code change, just restart).

## Files Touched
- `backend-api/server.js`
- `backend-api/package.json`
- `backend-api/.htaccess`
- `sync-service/server.js`
- `sync-service/.htaccess`
- New: `backend-api/lib/lruCache.js` (tiny, no dependency)

Production-safety: all changes are additive or numeric tuning. No endpoint signature, response shape, auth flow, or DB query result changes — the live Capacitor app sees identical behavior on the happy path, and gets explicit 503s (which it already handles via `resilientFetch` retry) instead of silent hangs on overload.
