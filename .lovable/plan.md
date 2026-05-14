# Persistent Console Logger v2.10.84

Restore the dedicated persistent debug console (per memory v2.10.77/78) that survives logout, app restarts, and reboots. Remove the Bluetooth debug panel entirely and route Bluetooth/device errors into the same logger.

## Scope

### 1. New persistent logger (`src/utils/persistentLogger.ts`)
Dedicated IndexedDB database **separate from app data** so it cannot be wiped by data clears or schema migrations.

- **Database**: `delicoop-debug-logs` (own DB, single store `logs`, autoIncrement key, indexes on `ts`, `level`, `tag`)
- **Schema per entry**: `{ id, ts, level, tag, message, data?, route?, version, ccode? }`
- **API**: `plog.debug/info/warn/error(tag, msg, data?)`, `plog.list({level, tag, search, since, limit})`, `plog.clear()`, `plog.export()` (returns NDJSON blob)
- **Survives**: logout (no clear on auth events), app restart (IDB), device reboot (IDB).

### 2. Performance & safety guardrails
- **Batch writes**: queue in memory, flush every 1s or at 25 entries (whichever first); flush on `visibilitychange=hidden` and `beforeunload`.
- **Dedupe window**: identical `level+tag+message` within 2s collapses to a single row with `count++` (matches existing memory rule).
- **Rate cap**: hard cap 50 writes/sec; excess logs dropped with a single `[LOGGER] dropped N` summary entry.
- **Size cap**: max **5,000 entries** OR **5 MB** estimated payload; prune oldest 20% when exceeded.
- **Age prune**: drop entries older than **7 days** on each app start and every hour.
- **Quota recovery**: on `QuotaExceededError`, prune to 50% and retry once; if still failing, disable persistence for the session and keep console logging.
- **Payload trimming**: stringify `data` with depth limit and 2 KB cap per entry.
- **Lightweight**: all writes async, never block UI thread; no work when tab hidden beyond final flush.

### 3. Global capture (install once in `src/main.tsx`, before app render)
Hook into:
- `console.error` / `console.warn` (wrap, still call originals)
- `window.onerror`
- `window.onunhandledrejection`
- `window.addEventListener('online'|'offline', ...)`
- Existing `errorHandler.ts` already routes — pipe it into `plog.error`
- Tags: `GLOBAL`, `UNHANDLED`, `NET`, `IDB`, `SYNC`, `BT`, `API`, `CUM`

### 4. Wire existing subsystems
Replace the most relevant `console.*` / `logger.*` calls with `plog.*` in:
- `src/utils/resilientFetch.ts` (API failures, XHR fallback events) → tag `API`
- `src/hooks/useIndexedDB.ts` (the `VersionError` spam shown in console) → tag `IDB`
- `src/services/bluetooth.ts`, `src/services/bluetoothClassic.ts`, `src/services/bluetoothClassicWeb.ts` → tag `BT`
- `src/utils/salesSyncEngine.ts` and `src/hooks/useSyncManager.ts` → tag `SYNC`
- Cumulative paths already using `[CUM][*]` taxonomy → tag `CUM`
- `src/contexts/AuthContext.tsx` online/offline transitions → tag `NET`

`src/utils/logger.ts` keeps its current API; we add an internal hook so every `logger.warn/error` also forwards to `plog`. No call sites need to change for those.

### 5. Debug Console UI
- Restore `src/pages/DebugConsole.tsx` at route `/debug` (lazy-loaded in `src/App.tsx`).
- Features: live tail (refresh every 2s while visible), filters (level, tag, free-text search), clear button, export-as-file button, copy-to-clipboard, entry count + storage estimate.
- Add a small "Open Debug Console" link in `src/pages/Settings.tsx` (replaces the removed Bluetooth panel slot).

### 6. Remove Bluetooth Debug Panel
- Delete `src/components/BluetoothDebugPanel.tsx`.
- Remove the import and `<BluetoothDebugPanel />` usage from `src/pages/Settings.tsx` (line 4 and 702).
- All diagnostics previously surfaced there now flow into `/debug` under tag `BT`.

### 7. Versioning
- `APP_VERSION` → `2.10.84`
- `APP_VERSION_CODE` → `106`
- `CACHE_VERSION` → `v31`
- Bump `android/app/build.gradle` versionCode/versionName accordingly.

## Files

**New**
- `src/utils/persistentLogger.ts`
- `src/pages/DebugConsole.tsx`

**Edited**
- `src/main.tsx` (global handlers + console wrap, install before render)
- `src/utils/logger.ts` (forward to plog)
- `src/utils/errorHandler.ts` (forward to plog)
- `src/utils/resilientFetch.ts` (API tag)
- `src/hooks/useIndexedDB.ts` (IDB tag)
- `src/services/bluetooth.ts`, `bluetoothClassic.ts`, `bluetoothClassicWeb.ts` (BT tag)
- `src/utils/salesSyncEngine.ts`, `src/hooks/useSyncManager.ts` (SYNC tag)
- `src/App.tsx` (add `/debug` route)
- `src/pages/Settings.tsx` (remove BluetoothDebugPanel, add link)
- `src/constants/appVersion.ts`, `public/sw.js`, `android/app/build.gradle`

**Deleted**
- `src/components/BluetoothDebugPanel.tsx`

## Out of scope / safety
- No backend changes. No schema changes to existing app IndexedDB (separate DB used).
- No changes to transaction creation, reference generator, sync payload shape, receipts, or auth flows.
- Existing `logger.ts` API preserved so no risk to call sites.

## Verification checklist
- App boots, login still required on restart.
- `/debug` shows live entries, survives logout and app reload.
- Forced error (throw in console) appears under `UNHANDLED`.
- IDB `VersionError` spam appears under `IDB` and is deduped.
- Rapid 1000-log loop does not freeze UI; entries capped & throttled.
- Bluetooth connect/disconnect events appear under `BT`.
- Settings page loads without the removed panel.
