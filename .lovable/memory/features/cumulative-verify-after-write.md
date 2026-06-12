---
name: Cumulative Verify-After-Write
description: updateFarmerCumulative resolves on tx.oncomplete (not put.onsuccess) and re-reads to verify; sync logs report persisted value not fetched
type: feature
---
v2.10.116. `updateFarmerCumulative` in `src/hooks/useIndexedDB.ts`:
- Resolves on `tx.oncomplete` (durable commit). `tx.onabort` emits pinned `CUM:WRITE-ABORT` and returns undefined.
- After commit, opens a fresh readonly tx to read back and emits `CUM:VERIFY` (match) or pinned `CUM:VERIFY-MISMATCH` (error) with one retry.
- Returns the persisted value (number) so callers can log what was actually committed.
- New optional 6th arg `options: { transrefno?, verifySource? }` for log correlation.
- Adds `writeSeq` (monotonic) and `lastWriteSource` to each record — additive, no schema bump.

Sync log convention: `[SYNC] ✅ Refreshed cumulative for X: fetched=N kg persisted=M kg`. Never log a single value claiming success.

`getFarmerTotalCumulative` emits `CUM:CAPTURE-READ` before `CUM:PRINT` so a single farmer's `/debug` slice shows: WRITE → VERIFY → CAPTURE-READ → PRINT.
