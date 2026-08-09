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

### 1. Fall back to the ALL bucket only when the route key is absent (`src/hooks/useIndexedDB.ts`)

- `getFarmerCumulative(farmerId, route)`: distinguish **key absent** from **key
  present with `baseCount: 0`**.
  - Key absent (never warmed) → read the `ALL` bucket for the same farmer/month and
    return its value marked `fallbackScope: 'ALL'`.
  - Key present with 0 → that is a confirmed zero for this route (new to the route,
    or a decrease guard result). Return 0. No fallback.
  - Key present with a non-zero value → always authoritative; the ALL bucket never
    overrides it.
- Emit `CUM:SCOPE-FALLBACK` only in the key-absent case, so the substitution is
  auditable in `/debug`.
- `getFarmerTotalCumulative`: include `scope`/`fallbackScope`/`keyPresent` in the
  `CUM:CAPTURE-READ` and `CUM:PRINT` payloads.


### 2. Log the value actually printed, not the intermediate read

- Add an explicit `logPrintFinal` call (`CUM:PRINT-FINAL`) at the point each print
  path settles on `computedCumulative` in `src/pages/Index.tsx` (on-screen path and
  background-print path), recording `cachedBase`, `trustedFloor`, `cloud`,
  `unsynced` and the final printed number. This closes the gap where the log said
  `printed=0` but a floor was applied downstream.
- Confirmed by reading `src/pages/Index.tsx`: the offline/cloud-unavailable branch
  is **not** a parallel cache path. Both print paths compute
  `trustedFloor = Math.max(cachedBase, prevCum) + justSubmitted` where `cachedBase`
  comes from `getFarmerCumulative(farmerId, route)` (lines 1600 and 1739), and the
  local fallback total comes from `getFarmerTotalCumulative` (lines 1679, 1814) —
  both are the getters corrected in §1, so the §1 fix repairs the offline floor as
  well as the online value. While in the code, keep it that way: no new local
  reads, and the floor stays downstream of the fixed getter.


### 3. Seed the route bucket eagerly on farmer selection

`Index/onFarmerSelect` (`W4:on-select-fetch`) already fetches the cloud value, but
when that fetch times out nothing is written. Add: when the route key is **absent**
(never when it exists with 0), copy the ALL-bucket value into the route bucket as
the starting base (marked `verifySource: 'W4:scope-seed'`), so the first receipt of
a session has a non-zero floor even if the backend is slow.

### 4. Keep the diagnostic subset uncapped, cap the Δ0 noise (`src/utils/persistentLogger.ts`)

- Uncapped and never deduped — the entries the trace actually needed:
  `CUM:PRINT`, `CUM:PRINT-FINAL`, `CUM:SCOPE-FALLBACK`, `CUM:VERIFY-MISMATCH`,
  `CUM:WRITE-ABORT`, `CUM:REGRESSION`, and any `CUM:WRITE` / `CUM:STALE-CHECK`
  with a non-zero delta.
- Modest per-tag cap (target ~5/s each, tunable constant) for the repeated
  unchanged writes — `CUM:WRITE` / `CUM:STALE-CHECK` with `Δ0` from periodic
  prewarm cycles. These say only "still stable" and dominated the 2,388-entry
  volume in the trace.
- Everything outside the CUM taxonomy keeps the existing global cap.
- Record dropped counts **per tag** instead of one global counter, so an export
  states exactly what was lost and how much.


### 5. Version

Bump to v2.12.12 (versionCode 188), update `sw.js` cache version, add a changelog
entry in `src/constants/appVersion.ts`.

## Not in scope

No backend changes — the backend values (300 / 148.1) verified correct in the
trace. No change to the cumulative formula, reference generation, sync, or the
existing decrease guards.

## Verification

- Select a farmer on route F001 whose route key was never warmed and capture: the
  receipt must show the ALL/backend-confirmed base plus the new weight, never a
  bare delta.
- A farmer with a real, confirmed zero on this route (route key present, value 0)
  must still print 0 — never the ALL-bucket total.
- `/debug` must show `CUM:SCOPE-FALLBACK` followed by a `CUM:PRINT-FINAL` whose
  value equals the printed receipt.
- After a background sync clears the unsynced bucket, the next receipt must not
  drop below the previous printed value.

- Export logs from a busy session and confirm no `CUM:*` entries were dropped.
