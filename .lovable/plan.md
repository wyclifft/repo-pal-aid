# Code Audit v2.12.107 — Fix Plan (duplicates, bugs, optimization windows)

Three deep audits ran over `src/` (~20k lines). Build is currently clean and versions are aligned (app 2.12.107 / APK 257). The audit found **11 data-integrity bugs**, **6 real copy-paste duplications + 1 conflicting double handler**, and **10 safe optimization windows**. Phased so production stays stable: critical data bugs first, then pure consolidations, then performance — no business-logic changes.

## Phase 1 — Data-integrity bugs (highest priority)

1. **Duplicate-text path can delete unsynced deliveries** — `useDataSync.ts:405-411,469-498`: any error mentioning "duplicate"/"existing_reference" marks the receipt synced, bumps cumulative and deletes local rows without checking `existing_reference` equals the submitted reference. Fix: verify the reference matches before any cleanup.
2. **Printed total promoted into cloud base = double counting** — `useIndexedDB.tsx:1338-1349,1929-1935`: a printed 110 (100 cloud + 10 pending) is installed wholesale as `baseCount`, then reads add pending again → 120. Fix: the printed floor constrains the combined total, never the base alone.
3. **Printed floors leak across scopes** — `getMaxPrintedCumulative()` filters only farmer/month; a receipt from another route, season or product can raise the current bucket. Fix: add route/season/product dimensions to the floor.
4. **Downward-hold guard bypassed by ordinary refreshes** — `useIndexedDB.tsx:1435-1455`: W1/W3/W4-W7 sources can lower a nonzero base whenever `navigator.onLine`, without the two-read `W3:reconfirm-heal-down` confirmation. Fix: restore confirmation requirement for decreases from all refresh sources.
5. **Zero-confirmation shared across buckets** — `cumulativeMonitor.ts:716-740`: pending-zero keys ignore month/season, so one month's zero can confirm another's within 8s. Fix: scope the confirmation key.
6. **Reference counter can roll back and reuse a reference** — `referenceGenerator.ts:267-307`: `updateConfig()` reports success even when the IndexedDB write fails, and reads prefer IDB over the localStorage backup → same counter issued twice. Fix: fail loudly on IDB write failure, and take max(IDB, backup) on read. Also bound the 8-digit invariant (padStart is a minimum, not a cap).
7. **Backend collision flag discarded** — `mysqlApi.ts:499-511` drops `collision` from the create result, making the collision-recovery branch in `useDataSync.ts:237-238` unreachable. Fix: pass the flag through.
8. **Receipt printed after failed local save** — `Index.tsx:1700-1744`: a failed/crashed local persistence is logged but submission continues to receipt + sync. Fix: block receipt generation when the transaction was not durably saved (offline).
9. **UTC dates in conflict records** — `useDataSync.ts:454-466` uses `toISOString().split('T')[0]` although `receipt.transdate` (correct local date) is already in hand. Fix: use `transdate`. (~20 similar `toISOString().split('T')[0]` "today" stamps reviewed; only provably-UI display uses stay UTC — per project rule, transaction dates must be local.)
10. **Month-scoped pending includes today's rows from another month** — `useIndexedDB.tsx:1887-1896`: the `isToday` wildcard pollutes historical-month pending totals. Fix: scope today's rows to the requested month.
11. **Farmer-selection UI bypasses the floor/hold result** — `Index.tsx:1217-1235`: displays the raw cloud response instead of the guarded, persisted result, which receipts later consume. Fix: read back the persisted bucket.

## Phase 2 — Duplicate consolidation (behavior-preserving)

- Extract the by-product merge helper (Index.tsx:612-623 vs 1226-1237).
- Extract post-sync receipt cleanup+verify helper (useDataSync.ts:364-395 vs 491-518).
- `isAlreadySyncedMessage()` helper for the 3 identical predicates (salesSyncEngine.ts:241/252/333).
- Shared receipt-history metadata builder (Index.tsx:1744-1752 vs 1793-1801).
- Merge identical `formatRecNo` twins (bluetooth.ts:3063/3116).
- **Consolidate the two conflicting `ionBackButton` handlers** (Index.tsx:83-100 vs 1939-1950): the direct `setShowCollection(false)` bypasses `handleBackToDashboard`'s unsaved-capture guard. One listener retaining the guarded exit and supervisor navigation.
- Remove dead plumbing: `useSyncManager` unused `syncTimeoutRef`/`mountedRef`; unused `printData` param + no-op callback on `triggerBackgroundSync`; drop redundant `export` on ~17 internally-used-only functions (verified no external consumers; `errorHandler.ts` untouched — it self-initializes).

## Phase 3 — Performance windows (no business-logic change)

- **Weight-update flood**: the "20 Hz" throttle is bypassed by any ≥0.01kg step (bluetooth.ts:680-726), driving the whole collection page re-render. Coalesce display-only weight updates to 50ms; raw readings and return-to-zero for capture rules stay unthrottled.
- **Legacy timeouts don't cancel work**: `main.tsx` abort polyfill is a no-op; `Promise.race` leaves the losing request running. Implement real XHR timeout/abort in the legacy transport and clear race timers.
- **Shared in-flight GET registry** in `mysqlApi.ts` for identical GETs (session reads, cumulative batch fetched from 3 owners). Do NOT dedupe writes/transactions.
- Fix the items force-refresh registry race (an older completion deletes a newer request's key).
- **App.tsx query persistence** serializes up to 4MB synchronously on boot: debounce writes, skip identical snapshots.
- **PersistentLogger**: defer `joinArgs` JSON serialization until after the rate gate (currently paid on every log, even dropped ones).
- Photo upload hook: track/clear its timers, guard post-unmount processing, real fetch timeout, reset state in `finally`.
- Clear `saveTimeout` in `useDataSync` effect cleanup; clear bluetooth race timeout handles in `finally`.
- Defer noncritical boot imports in `main.tsx` (version tracking, diagnostics) until after first paint; keep error/compat setup early.
- Yield between cumulative sync batches (100-record batches currently burst).

## Phase 4 — Bluetooth fixes (from the Nov 3 field log, CS10 device)

Diagnosed from `scale_fails_to_auto_connect_also_the_printer_pasted.log` (5,159 lines):

- **Internal CS10 printer never becomes ready** — `Sys.Lib_AppInit failed: UnsatisfiedLinkError` at 00:18:44. Verified in the repo: `libPosApi.so` is bundled in `jniLibs/armeabi-v7a` and DOES export `Java_vpos_apipackage_Sys_Lib_1AppInit`, so the failure is that `System.loadLibrary("PosApi")` itself fails on-device — and `Sys.java`'s static block catches the Throwable silently, hiding the true dlopen cause. Fix: in `PosApi.appInit`, load the library explicitly (not via the silent static block) and surface the exact load error to JS/`/debug` so the on-device cause (missing dependency, wrong-lib, or firmware restriction) is visible in the next field log.
- **BLE scale never re-notifies after a Bluetooth off/on** — 75 × `reject: writeDescriptor | 0x2902 (CCCD) | Setting notification failed`: every reconnect connects at GATT level but the CCCD write is rejected, so no weight data flows. Fix in `bluetooth.ts` reconnect path: ensure service discovery has fully completed before `startNotifications`, then retry the notification subscribe with a short backoff (e.g. 3 attempts ~300/600/1200ms); treat GATT-not-ready as retryable; full disconnect-and-retry cycle otherwise.
- **Reconnect loop hammers without backing off** — each low-level disconnect event resets the attempt counter to 1, producing an endless "attempt 1 / retry in 2000ms" churn (75 failures in ~2 min). Fix: keep exponential backoff across disconnect events per role; cap retries and let the health check restart the cycle.
- **Classic printer (P502A)** fails the first attempts with `bt socket closed, read return: -1` and only recovers after Bluetooth was toggled. Fix: on that specific error, schedule one quick delayed retry (~1.5s) before the long backoff — it connected successfully on later attempts, so the transport itself is fine.
- Note (separate, cosmetic): SQLite backup writes to `Documents/DeliCoop_Backups` hit `EACCES (Permission denied)` every session; falls back to the next location. Will confirm the fallback succeeds and log it as a warning only.

## Verification & version

- Version 2.12.107 → **2.12.108** (bug-fix patch), `sw.js` cache v72→v73, `package.json` aligned, changelog comments at each fix site.
- New small tests next to existing tests for the rules that matter: duplicate-reference verification before cleanup, printed-floor no-double-count, floor scope (route/season/product), reference-counter rollback rejection, today's-row month scoping.
- Regression checks before finishing: transaction creation, reference generation, receipt print, farmer/item sync, offline startup, Android back button, build clean + typecheck.
- Deployment note: all changes are client-side; no `server.js` changes needed this pass.
