## v2.10.75 — Offline Resilience & Data Restore

Three independent fixes, all additive. Production-safe: existing online flows unchanged, no schema breaks, no API removals.

---

### Issue 1 — Farmer Sync Status shows partial results offline (after a successful sync)

**Root cause** (in `src/components/FarmerSyncDashboard.tsx`, `loadFromOfflineCache`):

The offline path reads `farmer_cumulative` (already correctly route-scoped via the cacheKey since v2.10.73) but then re-filters each row against the farmer's *home* route stored in `cm_members`:

```ts
if (meta && farmerRoute && farmerRoute !== cleanActiveRoute) continue;
```

A farmer who **delivers** at the active factory but is **registered** under a different home route is silently dropped — even though their cumulative is genuinely cached for this route. Online the batch API returns them; offline they vanish. Hence "partial results after sync."

**Fix**

- Drop the cm_members route filter in `loadFromOfflineCache`. The cacheKey (`farmer_id__ROUTE__YYYY-MM`) is already the source of truth for route scoping — anything in that bucket belongs to this route by construction.
- Keep the route label hydration from cm_members for display only (fall back to `activeRoute` when missing, instead of "N/A").
- After a successful `triggerSync` refresh, also re-hydrate the local cumulative cache for any farmer that still has unsynced receipts (so their `localCount` is reflected immediately even if the batch API row hasn't caught up).

---

### Issue 2 — Restore Recent Receipts after "Clear App Data"

**Root cause**

`printed_receipts` lives only in IndexedDB. Clearing app data wipes IndexedDB. The native encrypted SQLite (`SyncRecord` table via `OfflineStoragePlugin`) already retains every captured transaction (milk / store / AI) but is currently only used as a sync backup, never as a restore source for the Recent Receipts list.

**Fix** (Android-only, web behavior unchanged)

1. Extend `OfflineStoragePlugin` with one new read-only method `getAllRecords(limit, sinceMs)` returning every record (synced + unsynced) ordered by `createdAt DESC`. No schema change — uses the existing `sync_records` table.
2. Add a thin web wrapper `getAllFromLocalDB()` in `src/services/offlineStorage.ts`.
3. In `ReprintProvider` (`src/contexts/ReprintContext.tsx`), after `getPrintedReceipts()` returns an empty list AND we are on native, call `getAllFromLocalDB({ limit: 200 })`, reconstruct `PrintedReceipt[]` from the JSON payloads (we already store the full transaction object), then `savePrintedReceipts(...)` so the IndexedDB cache is rebuilt.
4. Surface a one-time toast: "Restored N recent receipts from device storage."
5. Online supplement: when online and the rebuild yields fewer than expected entries, fetch the last N transactions for this device via the existing `/transactions` endpoint (already used elsewhere) and merge by `transrefno` / `uploadrefno` to fill gaps. No new backend endpoint required.

This works because every BUY / SELL / AI capture already calls `saveToLocalDB(referenceNo, type, capture)` with the full payload (`src/pages/Index.tsx`, `Store.tsx`, `AIPage.tsx`). The encrypted SQLite survives "Clear cache" and survives "Clear data" only on Android where Lovable's `app_data` is preserved by the encrypted DB path — confirmed by existing `[STORAGE]` logs.

---

### Issue 3 — Complete Periodic Report when offline

**Root cause** (in `src/pages/PeriodicReport.tsx`)

The `periodic_reports` IndexedDB store only caches the *exact* date-range + route + farmer-search combinations the operator has previously generated online. Any new range offline returns nothing.

**Fix — local report engine fed by a rolling transaction cache**

1. **New IndexedDB store `transactions_cache`** (keyPath: `transrefno`) added in `useIndexedDB.ts` with a small migration. Indexes on `transdate`, `farmer_id`, `tcode`.
2. **Background hydration** in `useDataSync.ts`: after each successful sync cycle (online), pull the last 90 days of milk transactions for the active device via the existing `/transactions` endpoint in pages of 500, upsert into `transactions_cache`. Stored only — never displayed directly.
3. **Local report builder** `buildPeriodicReportFromCache(start, end, route, farmerSearch)` in a new `src/utils/periodicReportLocal.ts` that:
   - Reads `transactions_cache` between dates (using the `transdate` index).
   - Filters by `tcode` (active route) and farmer search if provided.
   - Aggregates per farmer → `{ farmer_id, farmer_name, total_weight, collection_count }`.
   - Includes any unsynced receipts from `getUnsyncedReceipts()` so today's offline captures appear.
4. **PeriodicReport page wiring**: when `navigator.onLine === false` (or the API call fails), call the local builder *in addition to* the existing per-key cache lookup, and prefer the union with the higher row count. Also wire the same builder into `PeriodicReportReceipt` for the per-farmer detail (transaction list) so the printed statement is complete offline.
5. Cap `transactions_cache` to ~10k rows (LRU by `transdate`) to keep IndexedDB lean on legacy devices.

No backend changes required — the `/transactions` endpoint is already used by `useDataSync.ts` (see line 973).

---

### Version & Documentation

- Bump `APP_VERSION` to `2.10.75`, `APP_VERSION_CODE` to `97`, `android/app/build.gradle` versionCode 97 / versionName "2.10.75", and `public/sw.js` cache to `v22`.
- New memory rules:
  - `mem://features/farmer-sync-offline-cache-trust` — "farmer_cumulative cacheKey IS the route filter; never re-filter by cm_members home route."
  - `mem://features/recent-receipts-native-restore` — "On native, rebuild printed_receipts from SyncRecord when IndexedDB is empty."
  - `mem://features/periodic-report-offline-engine` — "transactions_cache + local builder is the canonical offline source for Periodic Report."

---

### Files to edit

- `src/components/FarmerSyncDashboard.tsx` — drop home-route filter, hydrate display label.
- `android/app/src/main/java/app/delicoop101/storage/OfflineStoragePlugin.kt` — add `getAllRecords`.
- `android/app/src/main/java/app/delicoop101/database/SyncRecordDao.kt` — add `getAllRecent(limit)` query.
- `src/services/offlineStorage.ts` — add `getAllFromLocalDB`.
- `src/contexts/ReprintContext.tsx` — restore from native on empty cache.
- `src/hooks/useIndexedDB.ts` — add `transactions_cache` store + accessors.
- `src/hooks/useDataSync.ts` — periodic background hydration of `transactions_cache`.
- `src/utils/periodicReportLocal.ts` — new local builder.
- `src/pages/PeriodicReport.tsx` + `src/components/PeriodicReportReceipt.tsx` — fall back to local builder offline.
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — version bump.

### What stays untouched (production safety)

- `backend-api/server.js` — no changes (reuses existing `/transactions`, `/periodic-report`, `/farmer-monthly-frequency-batch`).
- `src/integrations/supabase/*`, `src/services/bluetooth.ts`, Z-report code — untouched.
- All existing IndexedDB stores keep the same keyPaths; only one additive store.
- Native Room schema unchanged; the new method is a SELECT only.
