# Fix cumulative sync flood + coffee item loading (v2.12.5)

## What the logs actually show

- The device is calling `/api/farmer-monthly-frequency` **once per farmer**, hundreds of times in the same second. In `src/pages/Index.tsx` that per-farmer path only runs when the batch call failed (`batchSuccess === false`) — it is the fallback, not the normal path.
- Each of those requests takes a pooled connection, so the server reports `[POOL] limit=100 inUse=75 free=0`. Under that pressure further requests are refused/aborted, which is why the client prints `API request failed: /farmer-monthly-frequency?...` with an empty error message (aborted request, no response body).
- So the visible flood is a symptom. The unverified part is **why the batch call failed** — it must be measured before changing the query. The batch endpoint runs three full-season `GROUP BY` scans over `transactions` on one connection; on the new Contabo server that can exceed the client's 30s timeout.
- Coffee produce not loading: `/api/items` returns rows with `sellable = 1` and the client keeps only `invtype = '01'`. Under the same pool exhaustion this request also fails; separately the new `fm_items` table defaults `invtype` to `'05'`, so coffee rows may simply not be tagged `'01'`. Which of the two applies has not been confirmed yet.

## Plan

### 1. Stop the flood (client, safe regardless of cause)

In `src/pages/Index.tsx`:
- Cap the individual-fallback concurrency from 25 to 4 and add a small inter-wave delay, so a failed batch can never saturate the server pool.
- Skip the fallback entirely when the batch failed due to a server-side 5xx/503 (pool pressure) — retry the batch with backoff instead. Only fall back to individual calls when the batch endpoint is genuinely unavailable (404/network).
- Keep every existing cumulative guard (`W3` two-read reconfirm, heal-down rules, pins) unchanged.

### 2. Make the batch endpoint survive the new server (backend)

In `backend-api/server.js`, `/api/farmer-monthly-frequency-batch`:
- Add timing logs around each of the three queries (`[CUM:BATCH] totals=Xms products=Yms snapshot=Zms`) so the real bottleneck is recorded on Contabo.
- Return `503 Retry-After` (instead of hanging) when the pool is already saturated, using the existing pool-pressure detector, so the client backs off rather than piling on.
- Serve the batch result from a short in-memory cache (the existing `lib/lruCache.js`, ~20s TTL keyed by `ccode|route|period`) so repeated prewarms from several devices reuse one DB scan.
- Only after the timing logs identify a slow query will an index be proposed (candidate: `transactions(ccode, Transtype, transdate)`), as a separate reviewed change.

### 3. Coffee item loading

- Add a diagnostic log to `/api/items` recording `ccode`, the requested `invtype` and the row count returned, plus a count of `sellable = 1` rows grouped by `invtype`, so it is clear whether Contabo's `fm_items` actually tags coffee as `'01'`.
- If the data shows coffee rows are not `'01'`, the fix is a data correction on `fm_items.invtype` (SQL provided, run on Contabo) rather than loosening the app filter — loosening it would make store/AI items appear in the Buy portal.

### 4. Version

`src/constants/appVersion.ts` and `android/app/build.gradle` → `2.12.5` (code 181), with changelog notes.

## Files touched

```text
src/pages/Index.tsx                     (fallback concurrency + 503 backoff)
backend-api/server.js                   (batch timings, 503 on pool pressure, short cache, items diagnostics)
src/constants/appVersion.ts, android/app/build.gradle
```

## Notes

- `backend-api/server.js` must be redeployed to Contabo for the backend parts to take effect.
- No change to reference generation, sync payloads, or the cumulative guard rules.
