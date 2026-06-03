# v2.10.106 — Trusted-Floor Cumulative Print Guard

## Problem
M00389 printed cumulatives lost prior-day deliveries:
- 29th: 1701.8 ✓
- 30th: 1715.2 (should be 1805 — lost 89.8 from 29th)
- 1st:  1805   (should be 1911.8 — lost today's 106.8)

Pattern = stale base + previous transaction's weight. Backend totals are correct; only the printed receipt is wrong. Multiple other farmers affected.

## Root cause
`src/pages/Index.tsx` race-guard in both receipt paths used:
```
if (cloud < prevCum + justSubmitted) cloud = prevCum + justSubmitted
```
`prevCum` = in-memory `cumulativeFrequency.total` at click time, which can lag by days if the dashboard card was loaded before a prior-day sync caught up. Combined with a stale cloud read-replica response, the floor `prevCum+just` silently dropped prior-day deliveries.

## Fix
Floor anchored to cached `farmer_cumulative.baseCount` (updated by every sync) instead of `prevCum`:
- `trustedFloor = max(cachedBase, prevCum) + justSubmitted`
- On `cloud < floor`: retry once after 700 ms; if still low, use floor + emit `CUM:LAG-FALLBACK` (warn pinned).
- On retry success: emit `CUM:LAG-RECOVERED` (info).
- Never lower cached baseCount from an unconfirmed stale read.

Applied to both paths in `src/pages/Index.tsx`:
- On-screen receipt (`printCopies===0`)
- Background-print path

## Out of scope
No backend, schema, sync engine, receipt rendering, Bluetooth, photo, or auth changes.

## Files changed
- `src/pages/Index.tsx` (two guard blocks)
- `src/constants/appVersion.ts` → 2.10.106, code 127
- `android/app/build.gradle` → versionName 2.10.106, versionCode 127
- `public/sw.js` → CACHE_VERSION v52
- `mem://features/cumulative-print-trusted-floor` + index entry

## Verification
1. Set `localStorage.cum_debug_focus = "M00389"` on BA01 → next two days' captures should print correct totals matching backend; `CUM:FOCUS` rows show chosen path.
2. Artificially delay `/api/farmer/monthly-frequency` by 3 s → expect `CUM:LAG-FALLBACK` instead of a backwards receipt.
3. Offline path unchanged (uses `getFarmerTotalCumulative`).
