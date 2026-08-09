# v2.12.12 — Fix printed cumulative stuck at 0, and stop losing 95% of debug logs

## What the trace shows (verified against the code)

- `getFarmerTotalCumulative` composes the printed total as `cachedBase + unsynced`, where
  `cachedBase` comes from `getFarmerCumulative(farmerId, route)`.
- That cache is keyed `farmerId__ROUTE__YYYY-MM` (`buildCumulativeKey`), so the
  route-scoped bucket (`M00003__F001__…`) and the all-route bucket
  (`M00003__ALL__…`) are completely separate rows. A value written to one is
  invisible to the other.
- Every print for M00003 read the F001 bucket while only the ALL bucket held a
  value (300 at 13:10:08). The F001 row was not written until the sync-dashboard
  run at 13:24:29 (148.1) — after all ten prints. So `cachedBase=0` is a
  route-bucket cache miss, not a write failure. This matches the trace exactly.
- The `printed=0` rows in `CUM:PRINT` are emitted inside `getFarmerTotalCumulative`,
  i.e. before the caller applies its trusted floor. So the log understates what
  went on paper on some paths — but the floor itself (9) was also computed from
  the same empty `cachedBase`, so the receipt was still far below 148.1.
- The two resets (25→0, 8→0) are the unsynced bucket clearing on sync without the
  route-scoped base absorbing it.

## Changes

### 1. Never read a route bucket in isolation (`src/hooks/useIndexedDB.ts`)

- `getFarmerCumulative(farmerId, route)`: on a route-bucket miss (or a zero
  `baseCount`), also read the `ALL` bucket for the same farmer/month and, when the
  route bucket has nothing, return the ALL value with a `fallbackScope: 'ALL'`
  marker. Never overwrite a non-zero route value with the ALL value — route data
  stays authoritative when present. This preserves the per-route isolation rule
  while removing the "prints 0 because this bucket was never warmed" failure.
- Emit `CUM:SCOPE-FALLBACK` when the ALL bucket is used, so the substitution is
  auditable in `/debug`.
- `getFarmerTotalCumulative`: include `scope`/`fallbackScope` in the
  `CUM:CAPTURE-READ` and `CUM:PRINT` payloads.

### 2. Log the value actually printed, not the intermediate read

- Add an explicit `logPrintFinal` call (`CUM:PRINT-FINAL`) at the point each print
  path settles on `computedCumulative` in `src/pages/Index.tsx` (on-screen path and
  background-print path), recording `cachedBase`, `trustedFloor`, `cloud`,
  `unsynced` and the final printed number. This closes the gap where the log said
  `printed=0` but a floor was applied downstream.

### 3. Seed the route bucket eagerly on farmer selection

`Index/onFarmerSelect` (`W4:on-select-fetch`) already fetches the cloud value, but
when that fetch times out nothing is written. Add: on a route-bucket miss, copy the
ALL-bucket value into the route bucket as the starting base (marked
`verifySource: 'W4:scope-seed'`), so the very first receipt of a session has a
non-zero floor even if the backend is slow.

### 4. Stop the logger dropping the tags we debug with (`src/utils/persistentLogger.ts`)

- Exempt `CUM:*` and print-path tags from the 50/s rate cap and the 2s dedupe
  window (they carry distinct payloads, so dedupe is wrong for them anyway).
- Keep a cap for everything else, and when entries are dropped record the dropped
  count per tag rather than a single global counter, so a future export shows what
  was lost.

### 5. Version

Bump to v2.12.12 (versionCode 188), update `sw.js` cache version, add a changelog
entry in `src/constants/appVersion.ts`.

## Not in scope

No backend changes — the backend values (300 / 148.1) verified correct in the
trace. No change to the cumulative formula, reference generation, sync, or the
existing decrease guards.

## Verification

- Select a farmer on route F001 with no prior route-bucket data and capture: the
  receipt must show the ALL/backend-confirmed base plus the new weight, never a
  bare delta.
- `/debug` must show `CUM:SCOPE-FALLBACK` followed by a `CUM:PRINT-FINAL` whose
  value equals the printed receipt.
- After a background sync clears the unsynced bucket, the next receipt must not
  drop below the previous printed value.
- Export logs from a busy session and confirm no `CUM:*` entries were dropped.
