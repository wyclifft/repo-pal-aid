## Decision: Option A — route-wide pre-warm + CUM:OFFLINE-MISS diagnostic (v2.10.102)

### Root cause confirmed (from BA02 log)

Three farmers' slips printed without cumulative because BA02 was **offline** at capture time and the local `farmer_cumulative` cache had no entry for them:

| Time (EAT) | Event |
|---|---|
| 14:17:03 | App login — **offline** (so the startup batch pre-fetch never ran) |
| ~14:17–14:19 | Three receipts captured for M00489 / M03353 / M03399 — offline fallback returns `baseCount(0) + unsynced`, so slip prints without monthly total |
| 14:19:54 | Network event "offline" recorded |
| 14:20:10 | Network back, sync of 3 offline receipts starts |
| 14:20:13–16 | ✅ Refreshed cumulative for M00489 / M03353 / M03399 (post-sync, **too late** for the printed slip) |

The startup pre-fetch effect (`Index.tsx` ~439) is gated on `navigator.onLine === true && isReady`. When the device opens offline, it never re-runs after the network returns. The post-sync refresh does run, but only *after* receipts are submitted and printed.

### Implementation — minimal, additive, safe

1. **`src/pages/Index.tsx` — refresh-cumulatives effect (~line 285)**
   - Add `window.addEventListener('online', …)` that calls `refreshCumulativesBatch('online')` and treat `'online'` as a forced reason alongside `'post-sync' | 'manual'` (bypasses the 60 s throttle gate).
   - Mirror the cleanup `removeEventListener` in the effect teardown.
   - Net effect: as soon as a previously-offline device reconnects, the full per-route batch pre-warm runs **before** the next capture, so the next offline drop has a populated cache.

2. **`src/pages/Index.tsx` — print fallback diagnostic (~line 1455)**
   - When `cumulativeForPrint.total === 0` AND `showCumulative === true` (i.e. the slip *was supposed to* show cumulative but ended up with nothing), emit one `plog.warn('CUM:OFFLINE-MISS', …, { farmerId, route, online: navigator.onLine, reason: 'no-baseCount-cached' })`.
   - Zero behaviour change. Gives us a direct signal in `/debug` next time this complaint comes in instead of having to reconstruct from sync timestamps.

3. **Version bump** (workspace rule — every change increments the version):
   - `src/constants/appVersion.ts`: `APP_VERSION = '2.10.102'`, `APP_VERSION_CODE = 124`, plus changelog comment block at top.
   - `android/app/build.gradle`: `versionCode 124`, `versionName "2.10.102"`.
   - `public/sw.js`: `CACHE_VERSION = 'v49'`.

### Explicitly NOT touched

- `backend-api/server.js` — no API changes
- IndexedDB schema (`useIndexedDB.ts`) — no migration
- Reference generator (`referenceGenerator.ts`) — untouched
- Receipt rendering (`TransactionReceipt.tsx`, `ReceiptModal.tsx`, `useDirectPrint.ts`) — untouched
- Sync engine, photo upload, auth, BT — untouched

### Verification after build

- Install on BA02, force-quit, switch device to airplane mode, open app (offline login), capture for a farmer that's never been captured before this session — slip should now print cumulative because the prior online session's pre-warm + the `online`-triggered pre-warm cover the route fully.
- Reverse scenario: capture offline immediately, take device online — confirm `[SYNC] Refreshed cumulative for …` rows still appear and no `CUM:OFFLINE-MISS` row is logged for any farmer the pre-warm has already cached.
- If a brand-new farmer (no server history) is captured offline, expect a single `CUM:OFFLINE-MISS` warn row — this is the intended diagnostic, not a regression.
- Final checks: transaction creation, transrefno generation, sync, reprint, photo upload, periodic report, Z-report — all expected to remain unchanged.

**Switch to build mode to apply.**
