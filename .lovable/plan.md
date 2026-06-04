
# v2.10.107 — Stop double-counting the just-submitted receipt at print time

## What the logs say

The export contains only two cumulative rows for the two farmers in question:

| line | time (EAT) | tag | farmer | message |
|------|------------|-----|--------|---------|
| 618 | 2026-06-03 15:54:20 | `CUM:OFFLINE-MISS` | **M00013** | "Cumulative empty at print time" — `online:true`, `reason:"no-baseCount-cached"`, route `T002`, icode `S002` |
| 720 | 2026-06-03 15:51:55 | `CUM:RECALC` | **M00012** | `unchanged @ 84.05` (route ALL, tcode T001, icode S001) |

There are **no** `CUM:LAG-FALLBACK`, `CUM:LAG-RECOVERED`, `CUM:REGRESSION`, or `CUM:RECONTEXT` rows for either farmer, and no per-`monthly-frequency` API rows are logged. The persistent logger only writes the tagged `CUM:*` events, so the actual values returned by `getMonthlyFrequency` for these two captures are not recoverable from this export.

What we can confirm:
- Device was **online** at both capture times (M00013 row says `online:true`; surrounding `SYNC` rows show successful POSTs).
- The first M00013 print used the offline fallback path (`no-baseCount-cached`) because the farmer's `farmer_cumulative` cache had never been seeded for route `T002`. After that submit, the cache **was** seeded with the post-submit cloud total.
- Background sync was firing `receiptSaved event — refreshing pending counts` after every capture, confirming each receipt is persisted to the IndexedDB pending queue **immediately on submit**, regardless of whether the live API call succeeded.

## Math of the overcount

Both reports show an extra exactly-equal-to-just-submitted weight on the **second** capture:

```text
M00013: base 67 + 10 = 77 ✓     then 77 + (5.8+4.2=10) = 87 expected, got 97 → +10 (=second capture weight)
M00012: base 11.7 + (3+5=8) = 19.7 ✓   then 19.7 + 10 = 29.7 expected, got 39.7 → +10 (=second capture weight)
```

## Root cause

`src/pages/Index.tsx` — both the on-screen path (lines 1359–1418) and the background-print path (lines 1460–1515) compute the printed cumulative as:

```ts
computedCumulative.total = cloudCumulative + unsynced.total
```

By the time these blocks run, the just-submitted receipt is in **both** sides of that sum:

1. The submit POST has already returned successfully, so the backend's `getMonthlyFrequency` (`cloudCumulative`) **includes** the new row.
2. The offline-first writer added the receipt to the IndexedDB pending queue at submit time, and the sync engine has not yet flushed/deleted it, so `getUnsyncedWeightForFarmer` (`unsynced.total`) **also** includes the same row's weight.

Result: the just-submitted weight is added twice on every online capture where the API races ahead of pending-queue cleanup. The v2.10.106 `trustedFloor = max(cachedBase, prevCum) + justSubmitted` does not save us, because `cloudCumulative` is already at or above the floor (no `CUM:LAG-FALLBACK` fires, no retry runs) — the code simply trusts cloud and then adds unsynced on top.

This is independent of the v2.10.106 stale-receipt bug (which dropped prior-day deliveries). That fix solved under-counting; this one fixes over-counting on same-session repeat captures.

## Last server cumulative update

- **M00013 / route T002 / S002**: first sighting in this log is the `OFFLINE-MISS` at 15:54:20 — the row had **never** been written before, so the first server-derived cache write happened immediately after the 15:58:02 submit (10 kg) and would have stored `baseCount = 77`. We have no later `CUM:RECALC`/`CUM:REGRESSION` row, so the post-15:58:46 cache write (`97`) is the most recent value persisted. Backend value returned at print time was almost certainly **87** (true monthly total); printed 97 = 87 + 10 duplicate.
- **M00012 / route ALL / S001 (route T001)**: last cache touch in this log is `CUM:RECALC unchanged @ 84.05` at 15:51:55, well before the reported captures — so the 19.7 / 39.7 numbers come from a different route+icode pair (T001/S001 cache key, post-submit). Expected backend return for the second capture was **29.7**; printed 39.7 = 29.7 + 10 duplicate.

Neither stale data nor duplicate sync caused the issue — the receipt POST itself was processed correctly **once** on the server. The duplication is purely on the client, inside the print-time cumulative composition.

## Fix (v2.10.107)

Stop adding `unsynced.total` to a cloud value that already includes the just-submitted record. The simplest correct rule is: **the unsynced bucket should never include receipts that have just been confirmed online.**

Two coordinated changes:

1. **`src/pages/Index.tsx`** (both guard blocks ~1359–1418 and ~1460–1515):
   - Capture the list of `transrefno`s being submitted (`submittedRefs = capturedCollections.map(c => c.transrefno)`).
   - Pass them into the unsynced lookup: `getUnsyncedWeightForFarmer(cleanId, route, { excludeRefs: submittedRefs })`.
   - When the API call returned success (`cloudCumulative` came from cloud, not fallback), do **not** add any unsynced contribution from those exact refs.
   - When falling back to `trustedFloor` (cloud lag), keep current behaviour — floor already excludes unsynced.

2. **`src/hooks/useIndexedDB.ts`** — extend `getUnsyncedWeightForFarmer` signature:
   ```ts
   getUnsyncedWeightForFarmer(farmerId, routeFilter?, opts?: { excludeRefs?: string[] })
   ```
   Skip any pending receipt whose `transrefno` (normalized, trimmed) is in `excludeRefs`. Keep all existing transtype/month/route filters intact. Default `opts` to `{}` so no other caller changes behaviour.

3. **Observability**:
   - New `CUM:DOUBLE-GUARD` (info, sampled) row when `excludeRefs` removes a non-zero weight at print time. Payload: `{ farmerId, route, cloudCumulative, removedWeight, refs }`. This lets us see the bug class go to zero in production without re-shipping logging later.

4. **Defensive cap (belt-and-braces)**:
   - After computing the final number, if `final - cachedBase > justSubmittedWeight + smallEpsilon`, log `CUM:DOUBLE-DETECTED` (warn, pinned) with all inputs and clamp to `cachedBase + justSubmittedWeight`. This catches any other path we miss.

5. **Versioning**:
   - `src/constants/appVersion.ts` → `2.10.107`
   - `android/app/build.gradle` → `versionCode 128`, `versionName "2.10.107"`
   - `public/sw.js` → `CACHE_VERSION = 'v53'`
   - New memory: `mem://features/cumulative-print-no-double-count` + index entry under "Sync & Idempotency".

## Out of scope

- No backend / `server.js` change. Backend already returns the correct cumulative.
- No change to sync engine, idempotency matrix, offline path, Bluetooth, receipt rendering, or auth.
- No change to the v2.10.106 trusted-floor / lag-retry logic — it stays as the under-count guard.

## Verification

1. Capture two back-to-back submits for the same farmer online; printed cumulative must equal `cachedBase + sum(today's submits)` exactly. New `CUM:DOUBLE-GUARD` rows should appear and show `removedWeight > 0`.
2. Submit while throttled offline → re-online; first online capture's printed cumulative must still equal backend; `CUM:DOUBLE-DETECTED` must never fire.
3. Reproduce M00013/M00012 sequence on a dev backend; expect 87 and 29.7 respectively.
4. Existing v2.10.106 lag-recovery still works (artificial 3 s delay on `monthly-frequency` → `CUM:LAG-FALLBACK` row, correct printed total).

