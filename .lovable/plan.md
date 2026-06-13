
# v2.10.117 — Writer Provenance + Stale-Write Rejection

Ships Phase A (full per-write provenance) and Phase B (stale-write rejection inside the single writer that owns the tx). No "CAS" naming — we are not comparing `writeSeq`, we are comparing `prevValue` vs `incoming`. Logs use `STALE-CHECK` / `STALE-REJECT`.

---

## Phase A — Provenance on every write

### `src/utils/cumulativeMonitor.ts`
Add helpers (all pinned where noted):
- `logWrite(ctx)` — info, tag `CUM:WRITE`
- `logVerify(ctx)` — info, tag `CUM:VERIFY` / pinned error `CUM:VERIFY-MISMATCH` (already exists)
- `logBackendDecrease(ctx)` — **pinned error**, tag `CUM:BACKEND-DECREASE`
- `logStaleCheck(ctx)` — info, tag `CUM:STALE-CHECK` (every backend write goes through it, accept or reject)
- `logStaleReject(ctx)` — **pinned warn**, tag `CUM:STALE-REJECT`

Common `ctx` shape (one object, serialized into `data`):
```text
{
  farmerId, route, factory, icode, scode,
  prevValue, newValue, delta, writeSeq,
  source: 'backend' | 'local',
  verifySource,                  // e.g. 'W3:prewarm-batch'
  caller,                        // function name string
  transrefno,                    // when relevant
  deviceCode, sessionId,         // from localStorage
  ts                             // epoch ms
}
```

### `src/hooks/useIndexedDB.ts` — `updateFarmerCumulative`
Inside the existing readwrite tx (v2.10.116 already commits on `tx.oncomplete`):
1. Read `prev` row → capture `prevValue = prev?.baseCount ?? null`.
2. Build full `ctx` (above) using the new optional 6th-arg `options.verifySource`, `options.caller`, `options.transrefno`.
3. If `fromBackend && !options.allowDecrease && prevValue != null && newValue < prevValue`:
   - `cumulativeMonitor.logStaleReject(ctx)` (pinned).
   - Do NOT call `put`. Let tx commit empty.
   - Return `prevValue` so callers see the persisted (unchanged) value.
4. Otherwise: `cumulativeMonitor.logStaleCheck(ctx)` (accept), then `put`, then existing verify-after-write.
5. If `fromBackend && delta < 0` (only reachable via `allowDecrease`), also emit `logBackendDecrease(ctx)`.

`writeSeq` continues to increment monotonically and is included in every log (no semantic comparison — name reflects this).

### Sync log lines (`useDataSync.ts`)
Both refresh sites (W1 post-sync ~L466, W2 collision-retry ~L361) update their log to:
```text
[SYNC] Refreshed cumulative for X: fetched=N persisted=M stale=accept|reject
```
Where `stale=reject` means the writer rejected the incoming value and `persisted` equals the prior cached value.

### Wire `verifySource` + `caller` at every writer
| # | File | Site | verifySource |
|---|---|---|---|
| W1 | `useDataSync.ts` | post-sync refresh | `W1:postsync-refresh` |
| W2 | `useDataSync.ts` | collision-retry | `W2:collision-retry` |
| W3 | `pages/Index.tsx` | 5s pre-warm batch | `W3:prewarm-batch` |
| W4 | `pages/Index.tsx` | per-farmer on-select fetch | `W4:on-select-fetch` |
| W5 | `pages/Index.tsx` | post-capture background refresh | `W5:postcapture-refresh` |
| W6 | `pages/Index.tsx` | on-screen print path | `W6:onscreen-print` (already guarded) |
| W7 | `pages/Index.tsx` | background-print path | `W7:background-print` (already guarded) |

Each pass `{ verifySource, caller: '<fnName>', transrefno? }` as the 6th arg.

### Debug Console — new panel
`src/pages/DebugConsole.tsx`, **Cumulative tab only** (All Logs tab untouched):

Add a panel above "All CUM events":
- **"Stale-write rejections & backend decreases (24h)"**
- Rows: every `CUM:STALE-REJECT` and `CUM:BACKEND-DECREASE` with prev→new, verifySource, caller, route/factory, deviceCode, sessionId, transrefno. One-tap copy.

No new tabs. No filter changes elsewhere.

---

## Phase B — Rejection rule (already specified in A3 above)

- **Only one site:** inside `updateFarmerCumulative`, single readwrite tx.
- **Only affects `fromBackend === true` writes.** Local capture writes are untouched.
- **Escape hatch:** `options.allowDecrease: true` bypasses the check. No call site sets this today; reserved for explicit reconciliation/correction flows in a follow-up patch. Documented inline.
- **No silent loss:** rejections are pinned and surface in the new Debug Console panel and in the `[SYNC]` line as `stale=reject`.

Legitimate decrease scenarios (reversal, transfer, season reset, cleanup) currently rare; they will be rejected loudly and visibly until the reconciliation patch lands. Month rollover already safe (different cache key).

---

## Files touched
```text
src/utils/cumulativeMonitor.ts     (new helpers: logStaleCheck/Reject/BackendDecrease)
src/hooks/useIndexedDB.ts          (full ctx logging + stale-reject branch in updateFarmerCumulative)
src/hooks/useDataSync.ts           (verifySource on W1, W2; stale=accept|reject in log line)
src/pages/Index.tsx                (verifySource + caller on W3–W7)
src/pages/DebugConsole.tsx         (Cumulative-tab panel for STALE-REJECT + BACKEND-DECREASE)
src/constants/appVersion.ts        (2.10.117, code 138, tag writer-provenance-and-stale-reject)
android/app/build.gradle           (versionCode 138 / versionName "2.10.117")
.lovable/plan.md                   (M01186 repro recipe)
```

## Untouched
Backend, MySQL schema, IndexedDB schema/version, sync engine, reference generator, receipt math, photo, Bluetooth, auth, Z-report, All-Logs tab UI, Capacitor config.

## M01186 reproducer
1. `localStorage.cum_debug_focus = 'M01186'`; reload.
2. Force sync from dashboard.
3. Open `/debug → Cumulative`.
4. Capture a delivery for M01186.
5. Read the new panel — the offending writer is named in `verifySource` (W1–W5) with `prev=405.4 new=352.4` and the rejection is recorded; cache stays at 405.4; print shows `449.8`.

## Verification matrix (all must pass)
| # | Scenario | Expected |
|---|---|---|
| 1 | Healthy sync | `CUM:STALE-CHECK accept` per backend write; no STALE-REJECT |
| 2 | M01186 repro | `CUM:STALE-REJECT` pinned with verifySource naming the writer; cache unchanged |
| 3 | Two rapid captures | baseCount monotonic; WRITE/VERIFY/CAPTURE-READ/PRINT all equal |
| 4 | Offline → online | All writers log verifySource; no VERIFY-MISMATCH |

Ready to switch to build mode and ship.
