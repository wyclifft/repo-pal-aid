## Goal

Give the operator/support a built-in **debug console** inside the Capacitor app that:
- Captures every `console.log / warn / error` plus app-emitted events.
- **Persists across logout, app restart, and reinstall-resistant cache clears** (uses IndexedDB primary + native SQLCipher backup, mirroring the existing dual-write pattern used for transactions).
- Can be viewed, filtered, and exported from a hidden Settings page.
- Has bounded size so it never bloats the device.

## Why this is needed

Today the only way to see what went wrong on a production tablet is to attach a USB cable and read `adb logcat`, which loses everything once the app is killed. Operators report bugs hours after they happen — by then the in-memory `console` history is gone and they've already logged out.

There is a Kotlin-side `DatabaseLogger` (encrypted SQLite, table `app_logs`) used only by native code. We will add a parallel **JS-side persistent log buffer** that operators can view, and bridge it to the existing native logger so a single export contains both worlds.

## Design

### 1. Persistent log store (`src/utils/persistentLogger.ts` — new)

- New IndexedDB object store `app_logs` (added to existing `milkCollectionDB`, schema v12 → v13). Key: auto-increment. Indexed by `timestamp` and `level`.
- Ring buffer: **max 5000 entries** (≈1–2 MB). On insert, if count > 5000, oldest 100 are pruned in one transaction.
- Record shape:
  ```ts
  { id, timestamp, level: 'log'|'info'|'warn'|'error', tag?, message, data?, user?, route?, version }
  ```
- Writes are **batched** (queued in memory, flushed every 1 s or on `beforeunload` / `pagehide` / `visibilitychange:hidden` / `pause` Capacitor event) so logging never blocks the UI thread (workspace performance rule).
- Survives logout because `clear()` is never called on logout — only the `app_users` and session caches are touched. Survives app restart because IndexedDB is persistent.

### 2. Console interception (one-time, on app boot)

In `src/main.tsx` (very early), wrap `console.log/info/warn/error` so each call:
1. Calls the original (so dev tools still see it).
2. Pushes a record onto the persistentLogger queue with the current `level`, the call's args (JSON-stringified safely with circular handling), and metadata: appVersion, current route, current `userId` from localStorage (if any).

Also capture:
- `window.addEventListener('error', …)` — uncaught errors with stack.
- `window.addEventListener('unhandledrejection', …)` — promise rejections.

### 3. Native bridge (Capacitor only — optional but recommended)

Extend the existing `OfflineStoragePlugin` (Kotlin) with one new method `appendLog({level, tag, message})` that writes through `DatabaseLogger.log(...)` into the encrypted `app_logs` SQLite table. The JS persistentLogger calls this in addition to its IndexedDB write, mirroring the dual-write pattern memorialised in `mem://architecture/native-sqlite-dual-write-backup`. This way logs survive even if the user clears Chrome WebView storage from Android settings.

### 4. Log Viewer UI (`src/pages/DebugConsole.tsx` — new, route `/debug`)

- Hidden route — reachable from Settings → "Debug Console" (already a tappable area we can wire up). No public link.
- Table view: timestamp · level (colored badge) · tag · message. Click a row to expand `data` JSON.
- **Filters**: level (multi-select), text search, time range (last 5 min / 1 h / 24 h / all), tag.
- **Toolbar**: Pause/Resume tail mode, Clear (with confirm), Copy to clipboard, **Export .txt** (writes to `/storage/emulated/0/Download/delicoop-logs-YYYYMMDD-HHMM.txt` on Capacitor via existing file-export utility, or browser download on web), Share (Capacitor Share API).
- Shows count + storage size at the bottom; a "compact" button drops everything older than X.
- Auto-scroll-to-bottom unless the user has scrolled up (tail mode).

### 5. Settings entry

In `src/pages/Settings.tsx`, add a "Debug & Diagnostics" card with:
- "View console logs" → routes to `/debug`.
- "Export last 24h logs" → one-tap export.
- A small badge showing error count in the last hour (so support can ask "do you have any red badges?").

### 6. What gets logged automatically

Beyond raw `console.*`:
- App boot: version, deviceFingerprint, devcode, ccode (no secrets).
- Login success/failure (no password).
- Sync engine start/stop + per-batch outcome (counts only).
- Reference collisions (already logged via `console.warn`, will now persist).
- Cumulative regression-guard hits (if/when you add the monotonic guard).
- Bluetooth print attempts and results.
- Any `[ERROR]` or `[WARN]` tagged scoped-logger output.

### 7. Privacy & size guards

- Never log: passwords, SHA-256 hashes, full JWT, PII beyond farmer ID + member number.
- Auto-redact: any string matching `/Bearer\s+[A-Za-z0-9._-]+/`, `/password["':\s]+[^,}\s]+/i`.
- Hard cap: 5000 entries OR 2 MB, whichever first.
- On `mem-low` Capacitor event (Android), trigger an extra prune.

### 8. Backward compatibility & safety

- IndexedDB schema bump v12 → v13 only **adds** the `app_logs` store (no destructive migration). Existing receipts, farmer_cumulative, members are untouched.
- The console interceptor only runs on the client; SSR/build are unaffected.
- If IndexedDB is not ready yet, the queue holds records in memory until flush.
- All persistent writes are wrapped in try/catch — logging must never crash the app.
- Web build behaves identically minus the native SQLite mirror.

### 9. Versioning + memory

- Bump `APP_VERSION` to `2.10.77`, `APP_VERSION_CODE` to `99`, SW cache `v24` per workspace rule.
- New memory `mem://features/persistent-debug-console` capturing: store name, ring-buffer size, redaction rules, dual-write requirement.
- Update `mem://index.md` to reference it.

## Files to add / change

**New:**
- `src/utils/persistentLogger.ts` — IndexedDB-backed buffered logger + console interceptor wiring.
- `src/pages/DebugConsole.tsx` — viewer UI (filters, export, share).
- `mem://features/persistent-debug-console.md`

**Modified:**
- `src/hooks/useIndexedDB.ts` — add `app_logs` object store at version 13; expose `appendLog`, `getLogs`, `clearLogs`, `pruneLogs`.
- `src/main.tsx` — install console interceptor + global error/unhandledrejection listeners as the very first import.
- `src/pages/Settings.tsx` — add Debug & Diagnostics card linking to `/debug`.
- `src/App.tsx` — register `/debug` route.
- `android/app/src/main/java/app/delicoop101/storage/OfflineStoragePlugin.kt` — add `appendLog` Capacitor method that delegates to `DatabaseLogger.log(...)`.
- `src/services/offlineStorage.ts` — typed wrapper for the new native method.
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — version bumps.
- `mem://index.md` — add reference.

## What this does NOT change

- Reference generator, sync engine, transaction creation, Z-Report, photo upload, RLS, backend API, login flow — all untouched.
- No change to existing `farmer_cumulative` schema or behaviour.
- Android `app.delicoop101` ID, Capacitor build, Bluetooth pipeline — untouched.
- Existing `src/utils/logger.ts` keeps working unchanged; the new persistent layer wraps `console.*` underneath it.

## Acceptance check

1. Trigger a few captures, sync errors, and a forced exception. Logout, restart the app, log back in, open `/debug` → all events are still there with timestamps.
2. Export → a `.txt` file lands in Downloads on the Android tablet.
3. Force-stop the app, reopen → logs still present.
4. Fill past 5000 entries → oldest pruned, newest preserved, no crash.
5. Verify no password or token strings appear in any exported log.
