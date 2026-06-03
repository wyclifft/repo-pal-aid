## Diagnosis — M00389

Backend totals are correct (29th=1701.8, 30th=1805.0, 1st=1911.8). The receipt is printing a **stale** cumulative computed from in-memory state, not the backend value.

Decoding the printed numbers:

```
29th: printed 1701.8  = 1612 + 89.8       ✓ correct
30th: printed 1715.2  = 1612 + 103.2      ← lost the 89.8 from the 29th
1st : printed 1805.0  = 1701.8 + 103.2    ← lost the 106.8 captured today
```

Each wrong receipt = **stale base + previous transaction's weight**. That signature points squarely at the "race-condition guard" in `src/pages/Index.tsx`.

### Where it goes wrong

`src/pages/Index.tsx` (two paths, identical pattern):
- lines 1359–1396 (`printCopies === 0`, on-screen receipt)
- lines 1431–1476 (background print path)

Both do:

```ts
const freqResult = await Promise.race([getMonthlyFrequency(...), timeout(1500/2000)]);
let cloudCumulative = freqResult.data.cumulative_weight ?? 0;
if (cloudCumulative < prevCum + justSubmitted) {
  cloudCumulative = prevCum + justSubmitted;          // ← THE BUG
}
```

`prevCum` is `cumulativeFrequency?.total` captured at submit time. It is assumed to already include all *prior* successful days. In practice it can lag by 1+ days when:

1. The dashboard `cumulativeFrequency` for this farmer was last loaded **before** the previous day's sync caught up (e.g. printer-on-receipt path resets it to `undefined` at line 1408 and then writes it again only after the next click — meanwhile `farmer_cumulative.baseCount` cache may not have been re-read).
2. The cloud `getMonthlyFrequency` call returns a **stale read-replica value** (lower than reality), the guard fires, and the floor `prevCum + justSubmitted` clobbers reality with a number that omits whatever the cloud read was missing AND whatever `prevCum` was missing.

Net effect: if both `prevCum` and the cloud read are missing yesterday's delivery, the printed total silently drops yesterday's weight and prints today minus one — exactly the pattern seen for M00389 and the "several other farmers" the user reports.

The `farmer_cumulative` IndexedDB cache (`baseCount`) is more reliable than `cumulativeFrequency` in memory, because it is updated by every successful sync, post-sync refresh, and the route-wide pre-warm. It already has the v2.10.104 "zero confirmation" protection. We should use it as the trust anchor.

## Fix (v2.10.106)

Replace the race guard with a **trustworthy floor** that uses the cached `baseCount + unsynced + justSubmitted` instead of trusting the in-memory `prevCum`, and **retry the cloud read once** when it looks low.

### New helper

`src/hooks/useIndexedDB.ts` — add a tiny read-only helper:

```ts
const getCachedBaseCount = async (farmerId, route?): Promise<number>
```
Returns `farmer_cumulative[cacheKey].baseCount` for the current month, or `0`. Pure read, no writes, never throws.

Export it alongside `getFarmerTotalCumulative`.

### Replace both guard blocks in `src/pages/Index.tsx`

For each of the two paths (lines 1359–1396 and 1431–1476), new behaviour:

```text
1. cloud = await getMonthlyFrequency(...) with the existing timeout
2. cachedBase = await getCachedBaseCount(farmer, route)
3. trustedFloor = max(cachedBase, prevCum) + justSubmitted
4. if cloud < trustedFloor:
     // Likely read-replica lag. Retry ONCE after 700 ms.
     cloud2 = await getMonthlyFrequency(...) with 1500 ms cap
     if cloud2 >= trustedFloor: use cloud2
     else                      : use trustedFloor   (and emit CUM:LAG-FALLBACK)
   else:
     use cloud
5. unsynced = await getUnsyncedWeightForFarmer(...)   // unchanged
6. printedTotal = chosenCloud + unsynced.total        // unchanged
7. updateFarmerCumulative(...) ONLY if chosenCloud >= cachedBase
   (mirrors the v2.10.94 BUG 4 / v2.10.104 zero-guard philosophy:
    never let the cache go backwards from a single stale read)
```

Key properties:

- `trustedFloor` includes the cached `baseCount`, so a fresh-on-the-day reading can never drop a prior-day delivery.
- A single stale cloud read no longer wins — it must be confirmed by a second read (consistent with the existing two-read patterns the project already uses).
- If both reads lag, we still print a value that includes all known prior days (via `cachedBase`) plus today's just-submitted weight. The worst case becomes "prints up to but not above the truth" instead of "silently drops a day".
- The IndexedDB cache is never lowered by an unconfirmed stale read.

### Observability

Add structured log rows via `plog` so /debug can verify on the next field report:

- `CUM:LAG-FALLBACK` (warn, pinned) — emitted when cloud read is below `trustedFloor` and the floor wins. Payload: `{ farmerId, route, cloud, cloud2, cachedBase, prevCum, justSubmitted, trustedFloor, used }`.
- `CUM:LAG-RECOVERED` (info) — emitted when the second read catches up. Same payload.
- Existing `CUM:FOCUS` rows continue to fire for focused farmers (no change).

No new tags introduced outside the existing `CUM:` taxonomy.

### Version bump

`src/constants/appVersion.ts` → `2.10.106`. `android/app/build.gradle` versionName + versionCode bump. `public/sw.js` cache key string bump. (Standard alignment per project memory.)

## Out of scope

- No backend / `server.js` changes. Backend totals are already correct.
- No schema or migration changes.
- No UI changes — receipt layout, dashboard, /debug tabs all unchanged.
- No change to offline-only paths (`getFarmerTotalCumulative`) — those already use cached `baseCount + unsynced` and were not implicated.
- No change to the post-sync `farmer_cumulative` refresh inside the sync transaction (v2.10.72 fix) — that protection stays as is.

## Files touched

- `src/pages/Index.tsx` — replace the two race-guard blocks (~lines 1359–1396 and ~lines 1431–1476).
- `src/hooks/useIndexedDB.ts` — add `getCachedBaseCount` helper + export.
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — version alignment to `2.10.106`.
- `.lovable/plan.md` — record decision.
- Memory update: extend `mem://features/cumulative-regression-protection` with the trusted-floor rule, or add a new `mem://features/cumulative-print-trusted-floor` entry (single short memory + index link).

## Verification

1. Manual: with `localStorage.cum_debug_focus = "M00389"` on BA01, submit two consecutive days' captures and confirm receipts now match backend (1805, 1911.8). The CUM:FOCUS rows will show the chosen path each time.
2. Regression: simulate a lagging cloud read by temporarily delaying `/api/farmer/monthly-frequency` (sync-service) by 3 s — expect `CUM:LAG-FALLBACK` rather than a backwards receipt.
3. No-network: offline path is unchanged; reprints from `addMilkReceipt` still match the printed cumulative.
