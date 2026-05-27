## Investigation — BA02 / v2.10.98 cumulative regression complaint

### Findings from the attached log (26h window, 2026-05-26 08:18 → 2026-05-27 10:02 EAT)

I parsed all 5,080 rows and tallied every cumulative-monitor signal:

| Tag | Count |
|---|---|
| `CUM:REGRESSION` | **0** |
| `CUM:RECONTEXT` | **0** |
| `CUM:TRANSIENT` (suppressed flicker) | **0** |
| `CUM:EDIT` (backend row fingerprint changed) | **0** |
| `CUM:INSERT` (back-dated row appeared) | **0** |
| `Refusing stale backend write` (v2.10.94 guard) | **0** |
| `CUM:SYNC` prefetch batches | 13 — every batch 3680/3681 ok, 0 err |
| `CUM:RECALC` (base unchanged) | 688 across 153 unique farmers |

I also reconstructed a per-farmer time series from the 688 RECALC rows: **0 farmers experienced any decrease** in `baseCount` during the window. Across 13 prefetch batches that touched every farmer on the route, not a single backend value came back lower than what was cached.

In short — for BA02 in this window, the device-side data the user is complaining about does not show a regression at the monitoring layer. The log is dominated by HC-04 Bluetooth socket failures (`read ret: -1`), which are scale-connectivity issues, not cumulative-math issues.

### Why this complaint may still be real

There are three explanations we cannot rule out from the current log:

1. **The regression happened before 2026-05-26 08:18 EAT** (the log buffer's oldest row) and the operator only noticed it later. The monitor would have logged it at the time, but those rows have already aged out of the persistent log ring.
2. **The regression is being seen on a printed receipt vs. the dashboard**, which is a display/lookup path, not a base-rewrite path — the monitor only fires when `farmer_cumulative.baseCount` actually moves. A receipt showing a lower number than the dashboard would be a `getCumulativeForFarmer` resolution bug, not a base regression.
3. **BA02 is on v2.10.98**, two versions behind BA01 (2.10.100). It's missing the two bumps in between, including the BLE/Classic pairing fix shipped today. It has all the cumulative observability up to v2.10.94 but is one minor version behind the latest monitor refinements.

### Plan — three targeted moves, no risky refactor

1. **Upgrade BA02 to the same build as BA01** (current head, 2.10.100 or whatever the next published build is). No code change required — just push the operator to install. This is the single most useful step because the field device must match the monitoring code that produced the BA01 trace we already understand.

2. **Add a focused-farmer trace mode** (small additive change, off by default).
   - Read `localStorage.cum_debug_focus` once at app start; it can hold a comma-separated list of farmer IDs (e.g. `"M01234,M00987"`).
   - In `src/utils/cumulativeMonitor.ts`, add a new helper `plogFocus(tag, msg, data)` and call it from `observeBaseChange` and from `updateFarmerCumulative` for every read/write of a focused farmer — including the **unchanged** path (which today is sampled 1-in-50 via `CUM:RECALC`).
   - Emitted tag: `CUM:FOCUS` (pinned, info). Payload: `{ farmerId, route, source, before, after, prevByProduct, nextByProduct, tcode, icode, scode, ccode, devcode }`.
   - When the focus list is empty, the helper is a no-op — zero overhead and zero log volume change for everyone else.
   - Operator workflow: set the focus list to the complaining farmer, reproduce, export `/debug` log, ship it back. Every read of that farmer's base will show up with full byProduct context so we can see exactly which icode is moving.

3. **Add a "cumulative read" trace at the resolution path** (the place receipts ask "what's this farmer's current cumulative?"). Currently the monitor only watches *writes*. A focused-farmer read trace would catch case #2 above — receipt prints a lower number than the dashboard.
   - In `src/hooks/useIndexedDB.ts`, in `getCumulativeForFarmer` (or whichever helper resolves cumulative for printing — to be confirmed during build), add `plogFocus('CUM:READ', …, { source, route, baseCount, localCount, byProduct })` when the farmer is in the focus list.
   - Same zero-overhead-when-empty contract.

4. **Version bump:** `APP_VERSION='2.10.101'`, `APP_VERSION_CODE=123`, `CACHE_VERSION='v48'`, `android/app/build.gradle` → `versionCode 123`, `versionName "2.10.101"`. Update `public/sw.js` cache version. Note this only ships if step 2/3 is implemented; if you only want the upgrade recommendation (step 1) we can hold the version bump.

### Out of scope

No backend changes, no `server.js` edits, no IndexedDB schema bump, no change to the reference generator, sync engine, receipts, printing, photos, BT, or auth. The focused-trace helper is purely additive — when the focus list is empty (the default for every device including production), behaviour is byte-identical to today.

### Verification

- Build, install on BA02, set `localStorage.cum_debug_focus = "M…"` for the farmer the operator named.
- Reproduce the workflow that shows the wrong cumulative.
- Export `/debug` log; expect to see a continuous `CUM:FOCUS` and `CUM:READ` thread for that farmer covering: prefetch read → backend GET → cache write → receipt read.
- That sequence will tell us definitively whether the issue is (a) backend returning the wrong value, (b) cache being written wrong, or (c) receipt reading the wrong cache key.

### Decision needed

Do you want me to (A) push the BA02 device upgrade only, (B) ship the focused-farmer trace tool now so the next complaint is diagnosable in one round-trip, or (C) both?
