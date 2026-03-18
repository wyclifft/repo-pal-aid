# App Bug Audit and Improvement Plan

## ✅ Completed in v2.10.0 (versionCode 31)

### Phase 1 — Backend Duplicate Detection (DONE)
- `backend-api/server.js`: On duplicate `transrefno`, now fetches existing row and compares `memberno`, `weight`, `session`. Returns success only on true match; returns `REFERENCE_COLLISION` on payload mismatch.

### Phase 2 — Frontend Sync Verification (DONE)
- `src/hooks/useDataSync.ts`: On `REFERENCE_COLLISION`, auto-regenerates reference and retries once. Post-sync verification now compares `memberno` + `weight` before deleting local records.

### Phase 3 — multOpt=0 Safety (DONE)
- `src/hooks/useDataSync.ts`: Ambiguous multOpt=0 cases no longer delete local records. Instead marked as `failed` for retry, preventing silent cumulative drops.

### Phase 4 — icode Normalization (DONE)
- `src/hooks/useIndexedDB.ts`: All `icode` merge keys now use `trim().toUpperCase()` in both `getUnsyncedWeightForFarmer` and `getFarmerTotalCumulative`.
- `src/pages/Index.tsx`: All merge paths (pre-fetch, post-sync refresh, farmer select) use normalized icode keys.

### Phase 5 — Cumulative Floor Guard (DONE)
- `src/pages/Index.tsx`: Post-sync cumulative refresh now prevents UI regression below previously displayed value when reason is `post-sync`.

### Phase 6 — Version Alignment (DONE)
- `src/constants/appVersion.ts`: v2.10.0, code 31
- `android/app/build.gradle`: v2.10.0, code 31
- `public/sw.js`: CACHE_VERSION bumped to v17

---

## Previous fixes (v2.9.x)
- IndexedDB singleton cleanup removed
- saveSale/saveZReport/savePeriodicReport wrapped in proper Promises
- activeSession null guard added
- Render-time console.log removed
- Chunk reload retry counter added
- Session blacklist batched
- Cumulative reset on route/product/mode switch
- New Session button guard fixed
