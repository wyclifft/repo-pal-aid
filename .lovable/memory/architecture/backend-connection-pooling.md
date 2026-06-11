---
name: Backend MySQL Connection Pool Sizing
description: backend-api & sync-service pools sized for cPanel max_user_connections=40 (v2.10.108)
type: architecture
---

cPanel limits the shared MySQL user (`maddasys_wycliff`) to **40 concurrent
connections**. Both Node apps (`backend-api`, `sync-service`) use the same user,
and Passenger may spawn up to 2 worker processes per app — each opens its own
pool. The worst-case math must stay within 40.

## Current sizing (v2.10.108)

| App           | Default pool | queueLimit | Worst case (2 workers) |
| ------------- | -----------: | ---------: | ---------------------: |
| backend-api   |            8 |         50 |                     16 |
| sync-service  |            5 |         30 |                     10 |
| phpMyAdmin / cron / ad-hoc | — | — |                  ~6 |
| Safety headroom            | — | — |                  ~8 |
| **Total**                  |   |   |              **≤ 40** |

## Tunables (no code change needed)

Both `.htaccess` files expose:
- `MYSQL_POOL_LIMIT` — pool size
- `MYSQL_QUEUE_LIMIT` — max queued waiters before fast-fail
- `REQUEST_TIMEOUT_MS` — per-request hard timeout (default 30000)

Lower `MYSQL_POOL_LIMIT` first if logs show `ER_USER_LIMIT_REACHED`.

## Hardening rules

- `enableKeepAlive: true`, `keepAliveInitialDelay: 10000`, `connectTimeout: 10000` on both apps.
- `queueLimit` MUST be finite (never `0`/unbounded) — backpressure prevents request pile-ups.
- Pool snapshot logged every 60s as `[POOL] limit=… inUse=… free=… queued=… total=…`.
- `isPoolPressureError()` in backend-api maps `ER_USER_LIMIT_REACHED` / `ER_CON_COUNT_ERROR` / `POOL_ENQUEUELIMIT` / `ETIMEDOUT` to a retryable **503 `{error:'db_busy', retryable:true}`** instead of a generic 500 — the client's `resilientFetch` already backs off on 5xx.
- `server.setTimeout(REQUEST_TIMEOUT_MS)` destroys idle sockets so a stuck request can't hold a pool slot indefinitely.
- `backend-api/package.json` no longer caps heap with `--max-old-space-size=96` — the cap caused GC stalls that held connections open longer.

## LRU helper

`backend-api/lib/lruCache.js` ships a zero-dependency TTL+LRU cache for opt-in
caching of hot read-only lookups (`psettings`, `cm_members`, `approved_devices`).
Not wired into call sites yet — wiring requires careful per-site TTL choices
(esp. anything touching authorization).

## Passenger .htaccess discipline (v2.10.110)

cPanel's Node Selector registers each Node app with a specific Node version
(e.g. Node 19 for `/public_html/sync-service`) and auto-manages a Passenger
header block at the top of `.htaccess`. ONLY that one block is allowed.

**Rule:** exactly ONE `PassengerNodejs`, ONE `PassengerAppRoot`, ONE
`PassengerStartupFile`, ONE `PassengerAppType` per `.htaccess`. Apache uses
the LAST directive when duplicates exist, so a second manual block (e.g.
pointing at `/opt/alt/alt-nodejs14/root/usr/bin/node`) makes Passenger spawn
the app on the wrong Node binary while the cPanel registry still expects the
original one. Both sides then fight for the same Passenger app lockfile and
the restart fails with:

```
Can't acquire lock for app: <path>
```

The API goes offline and clients see "network error" on login. Recovery: Stop
App in cPanel, `pkill -u $USER -f "<app-path>/server.js"`, remove
`<app-path>/tmp/restart.txt`, fix the duplicate block, Start App.
