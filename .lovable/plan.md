# v2.10.104 — Stale-Write Guard: Two-Read Confirmation + Reversal Visibility

## Problem (from log analysis)

The `[CUM] Refusing stale backend write … incoming=0 vs cached=N` warning fired 183 times across 17 farmers in 3 days. Investigation confirmed every case was legitimate, not read-replica lag:

- **5 farmers** (M00160, M00301, M01517, M01618, M02413) — a manual negative-value transaction reversed the original delivery, so the backend correctly returns `0`. The cache holding `>0` is the stale side, and the guard is *preventing* the correct value from being written.
- **7 farmers** (M01503, M01224, M03299, M00783, M03669, M03273, M00216) — first-ever delivery; backend has nothing prior, so `0` is correct.

The current guard treats any `incoming=0 vs cached>0` as suspicious and refuses the write outright. We need to keep protection against true read-replica lag while accepting confirmed zeros.

## Approach

Mirror the same two-read confirmation pattern already used by `observeBaseChange` in `cumulativeMonitor.ts`: stash the first `incoming=0` sighting, and only accept the overwrite (or refuse it permanently) after a second backend read within an 8 s TTL confirms `0` is real. Also surface negative transactions as a clean info row in `/debug` so reversals are recognisable on sight.

## Changes (UI / state / monitor only — no backend, no schema)

### 1. `src/utils/cumulativeMonitor.ts`

Add a small **zero-confirmation cache** (parallel to the existing `pending` map):

```text
zeroPending: Map<key, { firstSeenAt: number, existingBase: number }>
TTL = 8000ms, max 500 entries (LRU evict like pending)
key = farmerId|route (same shape as pendingKey)
```

New exported helpers:

- `observeIncomingZero(farmerId, route, existingBase) → 'stash' | 'confirm' | 'expired-restash'`
  - First sighting → stash, return `'stash'`
  - Second sighting within TTL → delete entry, return `'confirm'` (caller may overwrite)
  - Sighting after TTL → re-stash, return `'expired-restash'`
- `clearZeroPending(farmerId, route)` — called when a non-zero backend value arrives, so a later real zero starts fresh.

Both wrapped in try/catch — never throw into the caller.

New tag emitted by `recordRowFingerprint` (or a new tiny helper called from sync) when a transaction with `weight < 0` is observed for the first time:

- `CUM:REVERSAL-DETECTED` (info, sampled or one-per-transrefno) — payload: `{ farmerId, transrefno, weight, transdate }`. Lets `/debug` show reversals at-a-glance and explains downstream zero-cumulatives.

### 2. `src/hooks/useIndexedDB.ts` (`updateFarmerCumulative`, ~lines 892–915)

Replace the unconditional refusal block with the two-read flow:

```text
if (existingBase > 0 && incomingIsEmpty) {
  result = observeIncomingZero(cleanId, routeKey, existingBase)
  if (result === 'stash' || result === 'expired-restash') {
    // First sighting — keep cached value, log as info (not warn)
    plog.info('CUM:ZERO-PENDING', `${cleanId} route=${routeKey} backend=0 cached=${existingBase} awaiting confirmation`, {...})
    resolve(); return;
  }
  // result === 'confirm' — second read confirms zero is real (reversal or wipe)
  plog.info('CUM:ZERO-CONFIRMED', `${cleanId} route=${routeKey} accepting backend=0 (was ${existingBase})`, {...})
  // fall through to normal write path
}

// Non-zero backend path also clears any pending entry:
if (!incomingIsEmpty) clearZeroPending(cleanId, routeKey)
```

Also detect negatives on the *local* write path (the `else` branch around line 937) — if `count < 0`, emit `CUM:REVERSAL-DETECTED` once per `transrefno` (dedupe via a small in-memory Set, capped at 500).

`console.warn` line removed; new logs go through `plog` so they show up in `/debug`.

### 3. Versioning

- `src/constants/appVersion.ts` → `APP_VERSION = '2.10.104'`, `APP_VERSION_CODE = 126`, add changelog entry summarising the guard change + new tags.
- `android/app/build.gradle` → `versionCode 126`, `versionName "2.10.104"`.
- `public/sw.js` → `CACHE_VERSION = 'v51'`.

## Out of scope (explicitly untouched)

- `backend-api/server.js` — no backend changes, production-safe.
- IndexedDB schema, DB_VERSION, migrations.
- Sync engine, idempotency matrix, reference generator.
- Receipt rendering, photo upload, auth, Bluetooth.
- `FarmerSyncDashboard.tsx` (the v2.10.103 UI work stays as-is).
- `cumulativeMonitor.observeBaseChange` regression detection — its own two-read flow is unchanged; we only add a parallel zero-confirmation flow.

## Verification

1. **Reversal case** (M00160 type): cache=12.5, backend=0 twice within 8 s → first read keeps cache (`CUM:ZERO-PENDING`), second read overwrites to 0 (`CUM:ZERO-CONFIRMED`). Reprinting after the second read shows the corrected cumulative.
2. **First delivery** (M01503 type): existingBase already 0, so the guard never triggers — write proceeds as today.
3. **True read-replica lag**: cache=12.5, first read=0, second read=12.5 (recovered) → first sighting stashed, second read clears it via `clearZeroPending`, no data loss, no false alarm.
4. **Negative transaction**: a local entry or synced record with `weight < 0` emits exactly one `CUM:REVERSAL-DETECTED` info row per `transrefno`.
5. **/debug page**: `CUM:ZERO-PENDING`, `CUM:ZERO-CONFIRMED`, `CUM:REVERSAL-DETECTED` visible and filterable; old noisy `console.warn` gone.
6. **Regression suite**: receipts still print correct cumulatives; sync dashboard counts unchanged; legacy Android 7 / WebView 52 unaffected (no new APIs used).
