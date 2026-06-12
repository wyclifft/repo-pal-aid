# v2.10.115 — Full Cumulative Audit Logging

## Why M01186's drop wasn't logged

`updateFarmerCumulative` in `src/hooks/useIndexedDB.ts` only emits a persistent row when:
- the new value goes **down** (regression path), AND
- a **second backend read confirms** it within an 8 s TTL (`PENDING_TTL_MS`) in `cumulativeMonitor.observeBaseChange`.

For M01186, backend refreshes for that farmer happen 20–60 s apart (route batch cadence), so:
1. First read sees `405.0 → 396.8` → stashed as `pending`, **no log row written**.
2. 8 s TTL expires before the next read arrives.
3. Next read (also 396.8) is treated as a brand-new sighting vs. cached 396.8 → no drop, no log.

Result: the regression is silently absorbed. Increases, equal writes, and same-value re-writes are also unlogged (RECALC is sampled 1-in-50). The cumulative monitor was designed to suppress noise — that suppression is now hiding real issues.

## Goal

Every single cumulative cache write — backend refresh, local increment, sync-driven refresh, print-time refresh — must emit one structured `CUM:WRITE` row containing `before`, `after`, `delta`, `source`, `route`, `icode-bucket-diff`, and `transrefno` (when applicable). Regression classification stays, but it becomes an **enrichment** on top of the always-on write log, not a gatekeeper.

## Changes

### 1. `src/utils/cumulativeMonitor.ts`
- Add `logWrite(prev, next, ctx)` that **always** emits `plog.info('CUM:WRITE', ...)` with:
  - `farmerId`, `route`, `icode`, `scode`, `ccode`, `devcode` (via existing `getActiveContext`)
  - `before`, `after`, `delta`, `source` (`backend` | `local` | `sync` | `print`)
  - `prevByProductSum`, `nextByProductSum`, per-icode diff map
  - `transrefno` when caller provides it
- Keep `observeBaseChange` for regression classification, but:
  - Lower `PENDING_TTL_MS` floor: if no confirmation arrives within TTL, emit `CUM:REGRESSION-UNCONFIRMED` (pinned warn) instead of silently dropping the candidate. Schedule a single `setTimeout` per pending entry to flush it on expiry.
  - Increases now also log a sampled `CUM:GROWTH` debug row (1-in-20) for trend visibility.
- Remove the 1-in-50 `CUM:RECALC` sampler — `CUM:WRITE` supersedes it.

### 2. `src/hooks/useIndexedDB.ts` — `updateFarmerCumulative`
- Call `cumulativeMonitor.logWrite(existing?.baseCount, count, { source: 'backend', ... })` before the `put` for the backend branch.
- Call `cumulativeMonitor.logWrite(prevTotal, prevTotal + count, { source: 'local', increment: count, transrefno })` for the local branch (signature gets an optional `transrefno` param; callers pass it where known, otherwise `undefined`).
- Add a `getFarmerCumulative` read-side log when the focus list is active OR when this is the first read since app start for a farmer (so we always see the value the receipt/print path consumed).

### 3. Call sites (pass `transrefno` where available)
- `src/pages/Index.tsx` lines 341, 528, 594, 712, 1407, 1533 — backend refresh paths get `source: 'sync'` or `source: 'print'` via a new optional 6th arg.
- `src/hooks/useDataSync.ts` lines 360, 455 — post-sync refresh gets `source: 'post-sync'` plus the just-synced `transrefno`.
- `src/components/FarmerSyncDashboard.tsx` line 415 — batch path gets `source: 'batch-dashboard'`.

### 4. Print-time floor logging (`Index.tsx` ~1478 / `useIndexedDB.ts` `getCumulativeWithFloor`)
- Emit one `CUM:PRINT` row with `cached.baseCount`, `cached.localCount`, `unsyncedWeight`, `finalPrinted`, list of `excludedTransrefnos`. This catches the exact case where the printed value diverges from the cached value (the user's M01186 scenario).

### 5. Version bump
- `src/constants/appVersion.ts`: `2.10.115`, `APP_FIX_TAG = 'cum-full-audit-log'`, code 136.
- `android/app/build.gradle`: `versionCode 136`, `versionName "2.10.115"`.

## Volume safeguards
`persistentLogger` already has 2 s dedupe + 50/s rate cap + age prune (v2.10.78), so emitting one row per cache write is safe. Bulk sync still uses `startBatch`/`endBatch` summaries; per-row `CUM:WRITE` rows during sync will be naturally throttled by the rate limiter and quota pruner.

## Verification
1. Set `localStorage.cum_debug_focus = 'M01186'`, reload, capture a receipt.
2. `/debug` → Cumulative tab should now show: `CUM:WRITE backend 405.0→396.8 Δ-8.2`, `CUM:PRINT cached=396.8 unsynced=0 final=396.8`, and (after second read) either `CUM:REGRESSION confirmed` or `CUM:REGRESSION-UNCONFIRMED`.
3. Export logs, search `M01186` → every cumulative touchpoint visible with before/after.

No changes to backend, schemas, sync logic, receipt math, or UI.
