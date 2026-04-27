
# Stop offline cumulative regression — root cause confirmed (v2.10.72)

## You found the actual root cause

Your scenario is exactly right and is the missing piece. Here is the precise sequence that produces the 553.4 → 326.5 kg drop:

```text
Day 1 — 18:00 (online)
  ├─ User taps "Sync Now" → POST /api/milk-collection succeeds for all pending rows
  ├─ useDataSync deletes those rows from IndexedDB (they're now in the cloud)
  ├─ farmer_cumulative.baseCount for ANNE KAIMURI MURUNGI is still the OLD value
  │  (e.g. 326.5 kg from the last prefetch earlier that morning)
  ├─ prefetchCumulatives is scheduled to run in 5s (Index.tsx line 577)
  │
  └─ ⚠ Within those 5 seconds, the device loses internet (van moves, signal drops,
     operator walks indoors, modem reboots). Batch GET /farmer-cumulative fails.

Day 1 — 22:00 (offline, app killed)

Day 2 — 06:30 (still offline, OR online but farmer not yet re-prefetched)
  ├─ App reopens. IndexedDB returns:
  │     baseCount = 326.5  (stale — never refreshed after yesterday's sync)
  │     unsynced  = 0      (everything was synced & deleted)
  │     total     = 326.5 kg ← this is what the receipt prints
  │
  └─ Real cloud total: 553.4 kg. Regression: 227 kg, silent, no error.
```

The offline fallback path **does its job correctly** — the bug is that the **input it relies on (baseCount) was never refreshed** the moment sync deleted the receipts. We trusted a 5-second-delayed background prefetch to catch up, and the network died inside that 5-second window.

## Where to fix it

In `src/hooks/useDataSync.ts`, after `syncAllData` finishes a successful POST cycle, we currently:
1. Delete the local row.
2. Decrement pending count.
3. ...nothing else.

We need step 4: **before deleting any synced row, refresh `farmer_cumulative.baseCount` for every affected farmer**, while we still have proven internet (we just succeeded a POST). That single missing call is the root cause of the regression you're seeing.

## v2.10.72 — Six-layer fix

### Layer 0 (NEW — root cause) — Refresh cumulative inside the sync transaction

In `src/hooks/useDataSync.ts`, after each successful `POST /api/milk-collection` and **before** the IndexedDB delete:

1. Collect the unique `(farmer_id, route, season)` tuples from the receipts that just synced.
2. For each tuple, call `GET /api/farmer-cumulative` (or the existing batch endpoint) **synchronously within the sync loop**.
3. Write the fresh `{ baseCount, byProduct }` into `farmer_cumulative` via `updateFarmerCumulative(farmerId, total, true, byProduct)`.
4. **Only then** delete the local IndexedDB row.
5. If the cumulative GET fails (network died mid-sync), keep the local row marked `cumulative_refresh_pending = true` and retry on next sync cycle. Do NOT delete until cumulative is refreshed AND verification passed.

This guarantees: if the receipt was successfully sent to the server, the farmer's cached cumulative reflects it on this device — no matter when the network dies next.

### Layer 1 — Season-keyed cache (so month rollover doesn't void the cache)

In `src/hooks/useIndexedDB.ts` (lines 785, 828): change `cacheKey` from `${farmerId}_${YYYY-MM}` to `${farmerId}_${seasonCode}`. Read both for backwards compatibility on first hit, then write under the new key. DB version → 12.

### Layer 2 — Persistent floor-guard (last resort safety net)

New IndexedDB store `farmer_cumulative_floor` keyed by `(farmer + route + product)` storing the last-printed total. Before every print, read it and refuse to print less than `floor + justSubmittedWeight`. Show a yellow toast when the floor protects the value, so the operator knows. Survives app kills, restarts, route changes — works identically online and offline.

### Layer 3 — No more "trust on 404" silent deletion

In `src/hooks/useDataSync.ts` lines 377–387: replace the `confirmed = true` shortcut on a 404 verify lookup with retry-and-keep — retry the GET twice with backoff, and if still 404 leave the local row marked `verification_pending` rather than deleting it. Surface a persistent banner when any rows are stuck pending.

### Layer 4 — Backend SQL normalisation

In `backend-api/server.js` cumulative queries (~lines 3072 and 3190): widen `TRIM(route) = TRIM(?)` to `UPPER(TRIM(route)) = UPPER(TRIM(?))` for `route`, `memberno`, and `icode`. Strictly additive (more rows match, never fewer) — production safe.

### Layer 5 — Forensic diagnostic endpoint

Additive `GET /api/diagnostics/farmer-cumulative-trace?farmer_id=…&uniquedevcode=…` returning the full ledger inside the active season window. Read-only, device-authorised. Lets us instantly verify whether the issue is on the device or the cloud the next time it happens.

## Files to touch

| File | Change |
|---|---|
| `src/hooks/useDataSync.ts` | Layer 0 (refresh-before-delete) + Layer 3 (no trust on 404) |
| `src/hooks/useIndexedDB.ts` | Layer 1 (season key) + Layer 2 (`farmer_cumulative_floor` store), DB v12 |
| `src/pages/Index.tsx` | Layer 2 read/write floor before print + protection toast; pass `seasonCode` to cumulative get/update |
| `src/components/BackendStatusBanner.tsx` | Persistent banner when `verification_pending` or `cumulative_refresh_pending` rows exist |
| `backend-api/server.js` | Layer 4 (`UPPER(TRIM(...))`) + Layer 5 (diagnostic endpoint) |
| `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` | Bump to **v2.10.72**, version code **94**, SW cache **v19** |
| `CUMULATIVE_REGRESSION_PROTECTION.md` | Runbook documenting all six layers and the operator-visible signals |

## Why this stops it from happening again

The original bug needs **all of the following** to occur to cause a regression:
- the cumulative cache is stale, AND
- the offline fallback can't find unsynced receipts to make up the difference, AND
- nothing remembers what was previously printed.

Each of Layers 0, 1, and 2 alone breaks the chain:
- **Layer 0** keeps the cache fresh as a transactional consequence of every sync.
- **Layer 1** ensures the cache lookup hits the right row across month boundaries.
- **Layer 2** refuses to print a regression even if both above somehow fail.

Layers 3, 4, 5 add defence-in-depth: no silent deletions, no SQL drift, instant forensic visibility.

## Production-safety notes

- **Layer 0 is the lowest-risk fix possible**: we just call an existing GET endpoint inside the existing sync loop, before an existing delete. If the GET fails we keep the row, which is strictly safer than today's behaviour. Online sync throughput is unaffected (the GET piggybacks on a connection we just proved works).
- IndexedDB upgrade is purely additive (one new store + new optional fields). Legacy rows still read.
- Backend changes only widen WHERE clauses and add a new endpoint — old clients keep working unchanged.
- Legacy Android 7 POS unaffected; no new APIs used.

## Memory updates after approval

- `mem://features/cumulative-regression-protection` — six-layer rule, with Layer 0 as the **root cause** fix: cumulative cache MUST be refreshed inside the sync transaction before any synced row is deleted.
- `mem://constraints/no-trust-on-404-verify` — record the v2.10.31 shortcut as forbidden.
- Update `mem://features/farmer-cumulative-id-normalization` to reference season-keyed cache + sync-time refresh.
