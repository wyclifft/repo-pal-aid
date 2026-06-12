# v2.10.116 — Verify-After-Write for Cumulative Refresh

## Bug
M01186: sync log claimed `✅ Refreshed cumulative for M01186: 405.4 kg`, but next capture printed 352.4 + 44.4 = **396.8** instead of 449.8. The baseCount in IndexedDB was still **352.4** — the success log lied.

## Root cause (inspection)
`updateFarmerCumulative` in `src/hooks/useIndexedDB.ts` resolved its promise on `putRequest.onsuccess`, which fires when the write is **queued in the tx**, not when the tx commits. Any `tx.onabort` (quota error, version error, parallel readwrite collision) silently rolled back the write — but the caller had already logged success and moved on.

## Fix shipped
1. **`updateFarmerCumulative` rewritten** — resolves on `tx.oncomplete` (durable commit). `tx.onabort` now emits pinned `CUM:WRITE-ABORT` (error) and the caller never sees a false success. Returns the verified `readBack` value from a separate readonly tx. One retry on mismatch. New optional `options.transrefno` + `options.verifySource` for log correlation.
2. **Verify-after-write** — every backend write is followed by a fresh readonly read of the same `cacheKey`. Match → `CUM:VERIFY` (info). Mismatch → pinned `CUM:VERIFY-MISMATCH` (error) + one retry.
3. **`useDataSync.ts` log lines** — both post-sync (line 466) and collision-retry (line 361) now log `fetched=X persisted=Y` using the value returned by `updateFarmerCumulative`. No more false success.
4. **`CUM:CAPTURE-READ`** — `getFarmerTotalCumulative` emits the exact `baseCount` / `localCount` / `unsyncedWeight` the capture/print path consumed. Combined with `CUM:VERIFY` (write side) and `CUM:PRINT` (final), one farmer's slice in `/debug` now shows the full chain: fetched → written → readBack → captureRead → printed.
5. **Additive `writeSeq` + `lastWriteSource`** — every record carries a monotonic write sequence so future race-clobber checks have ordering. No schema migration (IndexedDB is schemaless on values).

## Files changed
- `src/utils/cumulativeMonitor.ts` — added `logVerify`, `logCaptureRead`, `logRaceClobber`.
- `src/hooks/useIndexedDB.ts` — `updateFarmerCumulative` full rewrite; `getFarmerTotalCumulative` emits `CUM:CAPTURE-READ`.
- `src/hooks/useDataSync.ts` — both refresh log lines now print verified persisted value.
- `src/constants/appVersion.ts` — `2.10.116`, code 137, tag `cum-verify-after-write`.
- `android/app/build.gradle` — versionCode 137 / versionName "2.10.116".

## Untouched
Backend, MySQL schema, IndexedDB schema/version, sync engine, reference generator, receipt math, photo, Bluetooth, auth, Z-report.

## Verification
Set `localStorage.cum_debug_focus = 'M01186'`, sync, then capture. Expected in `/debug → Cumulative`:
```
CUM:WRITE  backend 352.4→405.4
CUM:VERIFY backend fetched=405.4 readBack=405.4 match=true
CUM:CAPTURE-READ base=405.4 local=0 unsynced=44.4
CUM:PRINT final=449.8
```
If `CUM:VERIFY-MISMATCH` or `CUM:WRITE-ABORT` ever appears, we've caught the silent failure red-handed and the retry/log makes it actionable.
