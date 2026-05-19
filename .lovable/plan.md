# Cumulative Monitoring in Debug Console

Add a focused "Cumulative" view inside `/debug` plus a thin helper layer so every cumulative-related event (recalc, edit, manual insert, sync change, regression) is captured durably without bloating storage or slowing sync.

## What the user will see

In `/debug`, a new tab/filter **Cumulative** sits beside the existing log list:

- **Top summary strip**
  - Last sync: `3455/3455 synced · 0 errors · 12s` (per route/factory)
  - Pending regressions: `2 farmers showed backward totals in last 24h`
  - Storage used by CUM logs, total CUM rows
- **Regressions panel (highest priority, never auto-pruned)**
  - Each row: farmer id, route, product, `before → after (Δ)`, suspected cause tag (`ccode-reassigned`, `date-shifted`, `route-changed`, `transtype-changed`, `manual-insert`, `duplicate-sync`, `out-of-order`, `offline-stale`), timestamp, expandable raw before/after JSON.
- **Events list** (filterable by level + sub-tag)
  - Sub-tags: `CUM:RECALC`, `CUM:EDIT`, `CUM:INSERT`, `CUM:SYNC`, `CUM:REGRESSION`, `CUM:DUPLICATE`, `CUM:ORDER`, `CUM:OFFLINE`.
- **Actions**: Copy / Export NDJSON / Export CSV (already wired) scoped to current filter.

## Detection rules (what triggers a log)

The helper wraps `updateFarmerCumulative` and the cumulative refresh path. For each `(farmer, route, product)` it compares the incoming backend total vs the last cached `baseCount`:

| Condition | Sub-tag | Level |
|---|---|---|
| `newBase < oldBase` | `CUM:REGRESSION` | error |
| `newBase === oldBase` and incoming sync replaced it anyway | `CUM:RECALC` (debug, sampled) | debug |
| Local insert recorded but transrefno matches an already-synced ref | `CUM:DUPLICATE` | warn |
| Local row transdate < newest server transdate for same farmer | `CUM:ORDER` | warn |
| Offline buffer flushed > 1h after capture | `CUM:OFFLINE` | info |
| Backend row appeared with `ccode`, `route`, `transdate`, or `Transtype` different from previously observed for the same `transrefno` | `CUM:EDIT` (cause auto-classified) | warn |
| Backend row with no matching local transrefno appears mid-month | `CUM:INSERT` | warn |
| Any thrown error in cumulative path | `CUM:ERROR` | error |

Each regression entry stores: `{ farmer, route, icode, beforeBase, afterBase, delta, lastTransrefno, suspectedCause, evidence }` where `evidence` lists the small set of rows that changed since last refresh (capped to 5).

## Optimization rules

- **Per-farmer success during bulk sync is NEVER persisted.** A new `plog.summary(tag, totals)` accumulates `{ok, fail, total}` in memory and writes a single row when the batch closes:
  `CUM:SYNC route=R1 · 3455/3455 ok · 0 err · 12.4s`.
- Reuse existing `persistentLogger` infra (dedupe 2s, 50/s rate cap, 5k rows, 7d age, quota recovery).
- **Two-tier retention**: keep generic CUM logs under the global 5k cap, but pin `CUM:REGRESSION` and `CUM:ERROR` rows so the age/row prune never deletes them until a separate higher cap is hit (default 500 pinned rows, 30 d age). Implemented by skipping pinned rows in `pruneOld`/`pruneToHalf` cursors.
- **Sampling for noisy debug**: `CUM:RECALC` debug rows are sampled 1-in-50 to avoid flooding during bulk refreshes.
- All comparisons happen synchronously against the existing IndexedDB cache; no extra network calls.

## Files to add / change

- `src/utils/cumulativeMonitor.ts` (new) — pure helper with:
  - `observeBaseChange(prev, next, ctx)` → emits the right `CUM:*` row
  - `startBatch(label)` / `endBatch(label, totals)` for summarized sync
  - `recordRowFingerprint(transrefno, {ccode, route, transdate, transtype, weight})` (in-memory map, capped at 5k entries, LRU) used to detect edits
- `src/utils/persistentLogger.ts` — add:
  - optional `pinned: 1` flag on entries
  - `pruneOld` / `pruneToHalf` skip rows with `pinned=1`
  - `plog.pinned(level, tag, msg, data)` convenience
  - bump store `DB_VERSION` to 2 with an `onupgradeneeded` adding a `pinned` index (preserves existing rows)
- `src/hooks/useIndexedDB.ts` — call `observeBaseChange` inside `updateFarmerCumulative` (backend path only) before writing, and `startBatch/endBatch` around the bulk refresh loop. No behavior change to cumulative math.
- The farmer-cumulative sync caller (the loop that iterates farmers) — replace per-farmer `console.log` success lines with `summary.ok++`; keep individual `console.error` only for actual failures.
- `src/pages/DebugConsole.tsx` — add a **Cumulative** tab:
  - filter rows whose `tag` starts with `CUM:`
  - render top summary strip from the latest `CUM:SYNC` row + count of `CUM:REGRESSION` rows in last 24h
  - regression panel renders pinned regression rows first, expandable
  - reuses existing Copy/Export buttons (scoped to current filter)
- `src/constants/appVersion.ts` — bump to `2.10.88` / version code `110`; `public/sw.js` CACHE_VERSION → `v35`.

## Technical details

```text
flow on every cumulative refresh
────────────────────────────────
backend SUM ──▶ observeBaseChange(prev=cached.baseCount, next=newSum, ctx)
                │
                ├─ next < prev   → plog.pinned('error','CUM:REGRESSION',…)
                ├─ next == prev  → sampled debug
                └─ next > prev   → silent (normal growth)
                │
                ▼
        updateFarmerCumulative (unchanged math)
```

Edit/insert detection uses a small in-memory `Map<transrefno, fingerprint>` rebuilt lazily from the latest backend rows; when a fingerprint differs from the stored one we classify the cause:

```text
ccode      differs → 'ccode-reassigned'
route      differs → 'route-changed'
transdate  differs → 'date-shifted'
Transtype  differs → 'transtype-changed'
no prior fingerprint, transdate < today → 'manual-insert'
```

Backwards-compatible: the helper is a no-op if `persistentLogger` is not yet initialized; existing cumulative math, sync, and reference generation are untouched.

## Verification

- Confirm `/debug` Cumulative tab renders, regressions persist across logout / app restart.
- Force a regression by editing a row's `ccode` in the test DB → next refresh emits one `CUM:REGRESSION` with cause `ccode-reassigned`, pinned and not pruned.
- Run a 3,000-farmer bulk refresh → exactly one `CUM:SYNC … 3000/3000 ok` row written, no per-farmer rows.
- Verify storage stays under the 5k generic cap with regressions preserved.
