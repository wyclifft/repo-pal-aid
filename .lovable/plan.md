## v2.10.78 — Stability fixes + cumulative sync observability

### 1. IndexedDB version conflict (root cause of all "DB not ready" + farmer load failures)

`src/hooks/useIndexedDB.ts` declares `DB_VERSION = 12`. Some installed clients already hold version 13 (from a stale build), so `indexedDB.open(DB_NAME, 12)` throws `VersionError: requested 12 < existing 13`. That single failure cascades into "Failed to load farmers", "DB not ready", and many other "[DB] IndexedDB error" lines.

Fix:
- Bump `DB_VERSION` to **14** in `src/hooks/useIndexedDB.ts` (always one step ahead of any value seen in the wild). Update the comment.
- Make `onupgradeneeded` idempotent: re‑check `objectStoreNames.contains(...)` for **every** store before creating, so jumping multiple versions never throws.
- In the `request.onerror` path, detect `VersionError` specifically and:
  - Log once with `[DB][VERSION_ERROR]` (throttled — see §3).
  - Call `indexedDB.deleteDatabase(DB_NAME)` only as a last resort after a single retry (gated behind a `__db_recovery_attempted` flag in sessionStorage so we never loop).
  - Reject with a typed `DBNotReadyError` so callers can show a friendly retry instead of console‑spamming.

### 2. Dialog accessibility warnings

Radix logs `Missing Description or aria-describedby={undefined} for {DialogContent}` whenever a `<DialogContent>` has no `<DialogDescription>` and no explicit `aria-describedby`.

Fix — add a `<DialogDescription>` (or `aria-describedby={undefined}` suppression with a visually‑hidden description) to each offender:
- `src/components/BluetoothConnectionDialog.tsx`
- `src/components/FarmerSearchModal.tsx`
- `src/components/CowDetailsModal.tsx`
- `src/components/SessionExpiredDialog.tsx`
- `src/components/AddMemberModal.tsx`
- `src/components/PrinterSelector.tsx`
- `src/components/DuplicateDeliveryDialog.tsx`
- `src/components/ReprintModal.tsx`
- `src/components/PhotoCapture.tsx` (skip camera logic per request, just add the description)
- `src/components/PhotoAuditViewer.tsx`
- `src/components/ZReportPeriodSelector.tsx`
- `src/pages/AIPage.tsx`, `src/pages/Store.tsx`

Use a short, descriptive sentence per dialog; keep them visible where it makes sense, otherwise use the `sr-only` class.

### 3. Logging system hardening (`src/utils/persistentLogger.ts`)

Today every `console.*` call writes to IndexedDB. A noisy loop (e.g. the VersionError above firing 12× at boot) floods storage and stalls the UI. Hardening:

- **Throttling / dedupe**: keep a small `Map<key, {count, lastWrittenAt}>` where `key = level + ':' + truncatedMessage`. If the same key fires within 2 s, increment `count` and write nothing. On the next allowed write, append `(×N suppressed)` to the message. Cap key map at 200 entries (LRU).
- **Hard rate cap**: max 50 records flushed per second; excess is dropped with a single `[LOGGER] dropped N entries` summary.
- **Ring buffer**: enforce `MAX_LOGS = 5000` with periodic `pruneLogs()` every 60 s and on each flush when over 5500. Also trim by age (keep last 7 days).
- **Quota safety**: wrap every `IDBObjectStore.add/put` in `try/catch`; on `QuotaExceededError`, drop the oldest 1000 rows and retry once. Never throw out of the logger.
- **Production gate**: in production builds (`import.meta.env.PROD`), only persist `info | warn | error` and drop verbose `debug`/`log` payloads larger than 4 KB (truncate with `…(truncated)`).
- **Boot guard**: if `installPersistentLogger` is called twice (HMR / StrictMode double‑invoke), no‑op the second call.
- **Re‑entrancy guard**: when the logger itself logs, bypass the interceptor so we can't recurse.

### 4. Detailed cumulative / offline sync observability

Add a single tagged channel `[CUM]` (subtags in brackets) emitted via `logger.info/warn/error` so they land in the persistent debug console. No business logic changes — pure instrumentation, plus the existing high‑water guard already shipped in v2.10.77.

Touch points and tags:

| File | Where | Tag |
|------|-------|-----|
| `src/hooks/useIndexedDB.ts` `addReceipt` (offline save) | after insert | `[CUM][OFFLINE_CREATE]` farmerId, route, weight, icode, transrefno |
| `src/hooks/useIndexedDB.ts` `updateFarmerCumulative(false,…)` | local increment | `[CUM][QUEUE_STORE]` farmerId, route, localCount, baseCount |
| `src/hooks/useDataSync.ts` start of upload loop | per receipt | `[CUM][SYNC_START]` transrefno, attempt# |
| `src/hooks/useDataSync.ts` after POST 2xx | success branch | `[CUM][SYNC_OK]` transrefno, serverRef |
| `src/hooks/useDataSync.ts` POST non‑2xx / network fail | catch | `[CUM][SYNC_FAIL]` transrefno, status, attempt#, willRetry |
| backoff scheduler | each retry | `[CUM][RETRY]` transrefno, nextDelayMs |
| failed sync recovery (start of next online cycle) | rehydrate queue | `[CUM][RECOVERY]` pendingCount |
| backend duplicate (REFERENCE_COLLISION) | catch | `[CUM][DUP_BLOCKED]` transrefno, serverMsg |
| `useIndexedDB.updateFarmerCumulative(true,…)` regression guard | when clamping | `[CUM][REGRESSION_GUARD]` farmerId, incoming, highWater (already memorised rule) |
| online listener | on `online` event | `[CUM][RECONNECT]` queueSize → triggers sync |
| post‑sync verification (`getFarmerTotalCumulative`) | after each batch | `[CUM][VALIDATE]` farmerId, base, local, total, highWater |

Rules to keep production safe:
- All logs go through the throttled logger from §3, so a 200‑receipt sync won't blow the buffer.
- Never `JSON.stringify` full receipt objects — log only the small field set above.
- Wrap every emit in `try/catch`.

### 5. Version bump

- `src/constants/appVersion.ts` → `2.10.78`
- `android/app/build.gradle` → versionCode `100`, versionName `2.10.78`
- `public/sw.js` → cache `v25`

### 6. Memory updates

- New: `mem://features/cumulative-sync-observability` — list of `[CUM][*]` tags and where they fire.
- New: `mem://architecture/persistent-logger-throttling` — dedupe + rate cap + quota recovery rules.
- Update `mem://index.md` references.

### Out of scope (per user)
- Camera-related warnings/errors are intentionally left untouched.
- No change to receipt creation, reference generator, printing, or backend endpoints.

### Acceptance
- Reload app → no `VersionError`, farmers load, no `DB not ready` toast.
- Trigger a known noisy warning 50× → only the first appears, followed by a `(×N suppressed)` summary; storage row count stays bounded.
- Open every modified dialog → no Radix `aria-describedby` warning in console.
- Go offline, capture 3 receipts, go online → debug console shows full `[CUM][OFFLINE_CREATE] → [QUEUE_STORE] → [RECONNECT] → [SYNC_START] → [SYNC_OK] → [VALIDATE]` chain per receipt.
- Force a backend 500 → `[CUM][SYNC_FAIL]` then `[CUM][RETRY]` then eventual `[CUM][SYNC_OK]`; final cumulative never lower than highWater.
