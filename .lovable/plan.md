
Goal: deliver a full root-cause review of cumulative inconsistencies and version mismatch, then implement hard fixes (not partial patches).

What I found (from current code)

1) Version mismatch is real (not just UI perception)
- `src/constants/appVersion.ts` is `2.9.2`.
- `android/app/build.gradle` is still `versionName "2.8.4"` / `versionCode 23`.
- Result: web “About” can show 2.9.2, while Android package metadata still reports 2.8.4.
- Also, web can remain on older bundle due aggressive SW cache strategy (`public/sw.js` uses cache-first + effectively non-expiring static cache).

2) Primary cumulative break: “false success” during sync can delete local records without creating new backend records
- In `backend-api/server.js` (`/api/milk-collection`), duplicate `transrefno` (`ER_DUP_ENTRY`) is treated as success (idempotent) and returned as successful create.
- In `useDataSync.ts`, sync logic treats that as synced and deletes local receipt after only checking “reference exists”.
- If that reference belongs to an older/different transaction, offline total (base + unsynced) drops to lower backend total after sync.
- This exactly matches symptom pattern: offline higher (e.g. 35.5), post-sync lower (e.g. 24.5).

3) Secondary cumulative break: multOpt duplicate skip path can remove weight from local without adding backend
- `useDataSync.ts` has a pre-insert duplicate workflow check for `multOpt=0`.
- If it decides existing workflow differs, it marks local as synced/deletes it.
- If user captured offline entries that later fail this rule, cumulative drops on reconnect.

4) Product-specific cumulative merge is not normalization-safe
- Multiple merge paths use raw `icode` object keys (`"S001"` vs `"S001   "` become separate buckets).
- Later filtering does trim/uppercase, but `find()` returns first match only, so totals can be undercounted in selected-product view after route/product switching or mixed-source merges.

5) Post-sync UI refresh can overwrite with stale backend snapshot
- `Index.tsx` refreshes cumulative on `syncComplete` after fixed 3s delay.
- No “floor guard” there (guard exists in submit receipt path, not in this post-sync refresh path).
- If backend read is lagging or partial, UI can regress to lower value.

6) Current preview logs show device unauthorized (401 on routes/sessions/farmers/items)
- So production discrepancy cannot be replayed in this preview state.
- Root causes above come directly from code-path inspection.

End-to-end flow where it breaks

```text
Offline capture/submit
  -> IndexedDB unsynced receipt saved
  -> cumulative shown as base + unsynced (e.g. 24.5 + 11 = 35.5)

Reconnect / auto-sync
  -> syncOfflineReceipts()
     -> POST /milk-collection
        Case A: transref duplicate treated as success by backend
        Case B: multOpt workflow check skips/deletes local
     -> local receipt deleted
  -> syncComplete event
  -> cumulative refresh reads backend only (or stale backend)
  -> displayed cumulative drops (e.g. back to 24.5)
```

Implementation plan (complete, production-hardening)

Phase 1 — Correctness hard-stop (no silent data loss)
1. Backend create endpoint: stop returning blind success on duplicate `transrefno`.
   - On duplicate, fetch existing row and compare critical payload fields (`memberno`, `route`, `weight`, `session`, `transdate`, `Uploadrefno`, `icode`, `ccode`).
   - Return success only if truly same record (idempotent retry).
   - Return conflict if payload mismatch (reference collision), so frontend can regenerate reference and retry.
2. Frontend sync verifier (`useDataSync.ts`):
   - Verify synced row by `reference_no` + key fields, not existence-only.
   - If mismatch, do NOT delete local record; regenerate reference and retry once.

Phase 2 — Cumulative math integrity
3. Normalize `icode` consistently before all merge keys (`trim().toUpperCase()`).
   - Apply in:
     - `useIndexedDB.ts` merge in `getFarmerTotalCumulative`
     - `Index.tsx` merge paths (prefetch/refresh/post-submit background print)
4. Add post-sync cumulative floor guard in `syncComplete` refresh path.
   - Prevent UI from regressing below known previous cumulative + synced just-now weights until confirmed refreshed snapshot.

Phase 3 — multOpt behavior safety
5. In `multOpt=0` skip path during background sync, do not immediately delete local on ambiguous cases.
   - Keep a “requires review/retry” state unless existing upload workflow match is definitive.
   - Prevent silent cumulative drops.

Phase 4 — Version and release consistency
6. Align app versions in all surfaces:
   - `src/constants/appVersion.ts`
   - `android/app/build.gradle` (`versionName` + `versionCode`)
7. SW release policy:
   - bump cache version on release
   - ensure update banner flow forces activation/reload reliably for web clients.

Validation matrix I will run after fixes

1) Offline → online cumulative continuity
- Create offline receipt for farmer/product/route.
- Confirm pre-sync cumulative = base + unsynced.
- Sync online.
- Confirm post-sync cumulative is identical (no drop).

2) Route switch + product switch
- Switch route and `icode` (`S001`/`S002`) with same farmer.
- Confirm cumulative always reflects active route + active product only, no stale carryover.

3) multOpt=0 cases
- Same workflow multi-capture allowed.
- New workflow same session/day blocked without deleting valid unsynced records incorrectly.

4) Collision simulation
- Force duplicate reference scenario.
- Confirm frontend retries with new reference and cumulative remains stable.

5) Version verification
- About dialog, Android app metadata, and deployed build all show same version.

Deliverables after implementation
- Root-cause fixes in sync + backend idempotency + cumulative normalization.
- Deterministic cumulative behavior across offline/online/route/product transitions.
- Unified versioning and cache-update behavior for release confidence.
