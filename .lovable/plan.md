
## What the logs show

Three distinct issues, in order of severity:

### 1. IndexedDB `VersionError` on every login (CRITICAL)
```
❌ IndexedDB open error: VersionError: The requested version (11)
   is less than the existing version (12).
```
Repeated 8+ times per login. Cascades into:
```
❌ Failed to load farmers: DB not ready
```

**Root cause:** Two files open the same DB (`milkCollectionDB`) with different versions:
- `src/hooks/useIndexedDB.ts` → `DB_VERSION = 12` (current, correct)
- `src/utils/referenceGenerator.ts` → `DB_VERSION = 11` (stale)

Once the main hook upgrades the DB to v12, `referenceGenerator.getDB()` keeps requesting v11 and IndexedDB rejects every open call. This breaks reference generation reads/writes and contributes to the "DB not ready" cascade because the rejected open requests race with the legitimate ones.

### 2. Infinite printer reconnect loop on web (HIGH)
Hundreds of repeating entries:
```
[BT][printer] connect attempt failed:
  Failed to execute 'requestDevice' on 'Bluetooth':
  Must be handling a user gesture to show a permission request.
[BT][printer] retry in 2000ms (attempt 1)
[BT][printer] retry in 4000ms (attempt 2)
... forever ...
```

**Root cause:** `btConnectionManager.installAutoReconnect()` runs on both web and native. On web, the low-level `quickReconnect*` path eventually calls `navigator.bluetooth.requestDevice()`, which the browser rejects outside a user gesture (`NotAllowedError` / "Must be handling a user gesture"). The manager treats it like any transient failure and re-arms the backoff timer, producing an unbounded retry loop that floods the persistent log, drains battery on background tabs, and never succeeds without a click.

### 3. "Failed to load farmers: DB not ready" (downstream)
A direct symptom of #1. Once #1 is fixed and the DB opens cleanly on first try, this error stops on its own. No separate fix needed beyond #1, plus a small guard in the farmer-load path so it logs once at `warn` instead of `error` if the DB really isn't ready yet.

---

## Plan (v2.10.87 — Version Code 109)

### Fix 1 — Single source of truth for DB version
Edit `src/utils/referenceGenerator.ts`:
- Remove the local `const DB_VERSION = 11`.
- Import `DB_VERSION` (and `DB_NAME`) from `src/hooks/useIndexedDB.ts` (export them from there if not already exported).
- The `device_config` object store is already created in the main `onupgradeneeded` of `useIndexedDB.ts`; keep the same `onupgradeneeded` fallback in `referenceGenerator` as a safety net (idempotent — only creates the store if missing).

This eliminates the version race forever — there is exactly one place to bump on future schema changes.

### Fix 2 — Stop the infinite Web-Bluetooth retry loop
Edit `src/services/btConnectionManager.ts`:
- In `tryConnectOnce`, classify the caught error. If it matches **either** of:
  - `NotAllowedError`, or
  - message contains `"user gesture"` / `"requestDevice"`,

  return a tagged result `{ ok: false, requiresGesture: true }`.
- In `ensureConnected`, when `requiresGesture` is true:
  - Set status to `failed` with `lastError = "needs manual reconnect"`.
  - **Do not** call `scheduleRetry`. Cancel any pending retry timer.
  - Log once at `warn`: `[BT][role] paused — needs user gesture to reconnect`.
- Reset this paused state and resume auto-reconnect when:
  - The user explicitly re-pairs from `PrinterSelector`/scale UI (existing flows already call `ensureConnected` after a successful pair), OR
  - The app transitions from background→foreground via a real user interaction (we already listen to `appStateChange`/`visibilitychange`; on web we additionally clear the paused flag on the next `pointerdown`/`keydown` so the next retry runs inside a gesture).
- Native (Capacitor) path is unaffected — classic SPP and native BLE don't throw `NotAllowedError`, so behavior on the production Android app stays identical.

### Fix 3 — Soften the cascading farmer-load error
In the farmer-load path that emits `Failed to load farmers: DB not ready` (search reveals it lives in the dashboard data hook), change the single `console.error` to `console.warn` and add a one-shot retry after 500 ms. Once Fix 1 lands this path stops triggering, but the soft-fail prevents future schema upgrades from looking like crashes in the debug console.

### Versioning & cache (workspace rule)
- `src/constants/appVersion.ts`: `2.10.86 → 2.10.87`, code `108 → 109`.
- `android/app/build.gradle`: `versionCode 108 → 109`, `versionName "2.10.87"`.
- `public/sw.js`: `CACHE_VERSION v33 → v34`.

### Out of scope
Receipt printing, transaction creation, sync engine, IndexedDB schema, reference-number format, Android native plugins, server.js — none are touched.

### Verification
1. Hard reload → log in → confirm **zero** `VersionError` lines and no `DB not ready` errors in the Debug Console.
2. On web preview: disconnect printer power → confirm BT manager logs `paused — needs user gesture` once and stops retrying (no flood). Click "Connect Printer" → reconnects normally.
3. On native build (smoke): scale + printer auto-reconnect on app resume still works (unchanged code path).
4. Create one milk receipt → confirm `transrefno` still generates with correct `devcode + clientFetch + padded_trnid` format and increments.
5. App version banner shows `v2.10.87`.

### Files touched
- `src/utils/referenceGenerator.ts` (use shared DB_VERSION)
- `src/hooks/useIndexedDB.ts` (export DB_NAME + DB_VERSION constants)
- `src/services/btConnectionManager.ts` (gesture-aware retry pause)
- the farmer-load hook emitting "DB not ready" (downgrade to warn + retry)
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` (version bump)
