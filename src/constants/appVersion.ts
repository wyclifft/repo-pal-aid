// Shared app version constant — update here and in android/app/build.gradle
// v2.11.30: ANDROID 7 / WEBVIEW 51 UI + RECEIPT LAYOUT FIX (presentation only).
//   Printer: PosApi.printReceipt now takes fontHeight/fontWidth/lineSpace/
//   feedDots (CS10 defaults 32/24/2/80). Larger glyphs at the same 24-dot
//   width keep the 32-column layout and alignment intact; the leading blank
//   lines are gone (left indent 0, no pre-feed) and bottom clearance is a real
//   Lib_PrnStep after PrintStart so the last line clears the tear bar.
//   Camera: PhotoCapture dialog is a capped flex column with a sticky footer,
//   so Cancel / Retake / Use Photo are always on screen at 720x1280.
//   Date pickers: PeriodicReport calendars are controlled and auto-close on
//   selection; PopoverContent gains collision padding + max-height.
//   Dialogs: DialogContent capped at 92vh with internal scrolling (vh only,
//   no dvh — unsupported on WebView 51).
//   No business logic, API, database, sync, or reference-generation changes.
//
// v2.11.8: NATIVE STARTUP BOOT FIX — restored the missing React root render
//   request in src/main.tsx so Capacitor can move past the pre-React
//   index.html spinner. Removed the duplicate inline /sw.js registration
//   from index.html because it bypassed the Capacitor-native guard and could
//   send WebView navigations to offline.html before React mounted. Added a
//   boot-timeout diagnostic in index.html that replaces the endless spinner
//   with an actionable native asset/WebView message if the JS bundle never
//   starts or render is never requested. Hardened Android Theme.SplashScreen
//   handoff with postSplashScreenTheme. Strictly startup/config only — no
//   transaction, sync, IndexedDB schema, reference generation, receipt,
//   photo, Bluetooth, auth, or payments business logic changes.
//
// v2.10.119: CUMULATIVE UNDER-COUNT PROTECTION — operators reported W3 batch
//   prewarm intermittently returning `persisted − latest_delivery_weight`
//   for select farmers (M03544, M01859, M00385 on C003/T001), even though
//   the active season window 2026-01-01→2026-06-30 covers every row. The
//   batch SQL is correct; the symptom is the two SQL queries (totals SUM
//   and per-product SUM) running on DIFFERENT pooled connections that
//   could land on slightly different commit snapshots under read-replica
//   lag. Two-part fix:
//   (1) BACKEND (backend-api/server.js, /api/farmer-monthly-frequency-batch):
//       acquire one pooled connection, set SESSION TRANSACTION ISOLATION
//       LEVEL READ COMMITTED, run BOTH the totals SUM and the per-product
//       SUM on it, then release. Probe MAX(id) on the same connection and
//       return it as `snapshot_max_id` so the frontend can flag drift
//       between successive batch calls. Strictly additive: no formula
//       change, no removed filters, no removed UPPER/TRIM normalisation.
//   (2) FRONTEND (src/pages/Index.tsx loadCumulativeBatch): when the W3
//       batch write is stale-rejected (updateFarmerCumulative returns a
//       baseCount strictly greater than the value we tried to write), the
//       farmer is added to a reconfirm queue. After the batch finishes,
//       a capped (≤25) fire-and-forget pass calls the individual endpoint
//       (/api/farmer-monthly-frequency) with a 2 s hard timeout. If
//       individual > persisted → heal up via a free increase (the existing
//       stale-check accepts increases). If individual ≤ persisted → log
//       CUM:W3-RECONFIRM-OK / CUM:W3-RECONFIRM-PERSISTENT-GAP and keep
//       persisted (existing stale-reject behaviour preserved). On timeout/
//       error → CUM:W3-RECONFIRM-TIMEOUT, no change. New tags surface in
//       /debug → Cumulative tab via the existing CUM taxonomy. No backend,
//       IndexedDB schema, sync engine, reference generator, receipt
//       rendering, photo, Bluetooth, or auth changes.
//

// v2.10.107: NO-DOUBLE-COUNT PRINT GUARD. After v2.10.106 fixed the under-
//   count caused by stale read-replicas, an over-count appeared on same-
//   session repeat captures (M00013: printed 97 vs expected 87; M00012:
//   printed 39.7 vs expected 29.7 — extra weight always == just-submitted
//   transaction). Root cause: the print-time cumulative composition in
//   src/pages/Index.tsx added cloudCumulative + unsynced.total. By the time
//   it ran, the just-submitted receipt was on BOTH sides — backend already
//   reflected it (cloudCumulative), AND the offline-first writer had
//   queued the local row in the IndexedDB pending bucket
//   (getUnsyncedWeightForFarmer), which the sync engine had not yet
//   flushed. Net effect: just-submitted weight counted twice. Fix:
//   capture the just-submitted reference_no list into printData.
//   submittedRefs and pass it as { excludeRefs } to
//   getUnsyncedWeightForFarmer in BOTH the on-screen path and the
//   background-print path. New CUM:DOUBLE-GUARD info row in /debug shows
//   the removed weight whenever the exclusion saved us from a double-
//   count, so the fix is observable in production. Strictly client-side
//   — no backend, sync engine, IndexedDB schema, reference generator,
//   receipt rendering, photo, Bluetooth, or auth changes. v2.10.106
//   trusted-floor lag-recovery is preserved unchanged.

// v2.10.106: TRUSTED-FLOOR CUMULATIVE PRINT GUARD. The old race-guard in
//   src/pages/Index.tsx printed `prevCum + justSubmitted` whenever the
//   cloud read-replica returned a value lower than expected. `prevCum` is
//   the in-memory dashboard cumulative, which can lag by days when the
//   farmer card was last loaded before a previous-day sync caught up.
//   Combined with a stale cloud read, this silently dropped prior-day
//   deliveries (observed on M00389: 30th printed 1715.2 instead of 1805,
//   1st printed 1805 instead of 1911.8). New guard anchors the floor to
//   max(cached farmer_cumulative.baseCount, prevCum) + justSubmitted, and
//   retries the cloud read once after 700 ms when the first read falls
//   below the floor. The IndexedDB cache is never lowered by an
//   unconfirmed stale read (mirrors the v2.10.94/104 zero-guard spirit).
//   New CUM:LAG-RECOVERED (info) and CUM:LAG-FALLBACK (warn) rows surface
//   in /debug. Strictly client-side — no backend/server.js, schema, sync
//   engine, reference generator, receipt rendering, photo, Bluetooth, or
//   auth changes.
// v2.10.104: STALE-WRITE GUARD → TWO-READ CONFIRMATION + REVERSAL VISIBILITY.
//   The `[CUM] Refusing stale backend write incoming=0 vs cached=N` guard
//   fired 183 times in 3 days across 17 farmers. Every case was legitimate:
//   5 farmers had a manual negative-value transaction that reversed their
//   monthly total (M00160, M00301, M01517, M01618, M02413), and 7 were
//   first-ever deliveries (M01503, M01224, M03299, M00783, M03669, M03273,
//   M00216). The guard was protecting cache against a non-existent threat
//   and blocking the correct zero. New flow mirrors the regression
//   monitor's two-read pattern: first `incoming=0 vs cached>0` sighting
//   stashes (info: CUM:ZERO-PENDING), second sighting within 8 s confirms
//   and accepts the overwrite (info: CUM:ZERO-CONFIRMED). Any non-zero
//   backend read in between clears the pending entry — true read-replica
//   lag still suppressed without data loss. New CUM:REVERSAL-DETECTED info
//   row fires once per transrefno when a negative-weight transaction is
//   observed, so reversals are recognizable in /debug instead of looking
//   like errors. Strictly utils/state changes — no backend, IndexedDB
//   schema, sync engine, reference generator, receipt rendering, photo,
//   Bluetooth, or auth changes.
// v2.10.103: FARMER SYNC DASHBOARD CLARITY — the dashboard now honestly
//   reflects connectivity and sync state. New online/offline pill in the
//   header (flips on window 'online'/'offline' events). Refresh button is
//   disabled while offline OR while a cumulative refresh is in flight
//   (bgProgress active or window.__cumulativeSyncRunning === true), with a
//   tooltip-style title explaining the reason. Defensive guard in
//   loadData(true) short-circuits to a cache-only reload if the device
//   went offline between click and handler. New last-sync status row shows
//   one of: complete-from-server / complete-from-offline-cache /
//   server-refresh-failed (batch API returned null while online) /
//   incomplete (cancelled mid-flight or bg pass still running). "Cached"
//   tile now shows coverage as "X/Y". When transitioning online the
//   dashboard auto-reloads from the batch API once. Strictly UI/state in
//   src/components/FarmerSyncDashboard.tsx — no backend, IndexedDB schema,
//   sync engine, reference generator, receipt rendering, or auth changes.
// v2.10.102: OFFLINE CUMULATIVE PRE-WARM + DIAGNOSTIC — devices that
//   booted offline (or lost network before the startup batch finished)
//   never repopulated farmer_cumulative when reconnecting, so first-time
//   offline captures printed receipts without the monthly cumulative
//   (observed on BA02 for M03399 / M03353 / M00489). Fix: add a window
//   'online' listener in Index.tsx that calls refreshCumulativesBatch
//   ('online'), and treat 'online' as a forced reason alongside
//   'post-sync'/'manual' so it bypasses the 60 s throttle gate. Also
//   added a CUM:OFFLINE-MISS warn row to /debug, fired when
//   shouldShowCumulativeForFarmer is true but cumulativeForPrint.total
//   ends up 0 — gives a direct signal next time. Strictly additive: no
//   backend, IndexedDB schema, sync engine, reference generator, receipt
//   rendering, or auth changes.
// v2.10.89: CUMULATIVE REFRESH THROTTLED & COALESCED — the full-batch
//   cumulative refresh used to fire after every receipt save, every tab
//   focus, every farmer/product selection, and on a 3-min metronome,
//   hammering the backend with 3k-farmer refetches. Now: 60 s throttle
//   gate on all reasons except 'post-sync'/'manual'; trailing-edge 5 s
//   debounce so bursts of syncComplete collapse to one refresh;
//   visibility refresh only when last refresh is >2 min stale; periodic
//   interval relaxed 3 min → 10 min; refresh effect re-mounts only on
//   route/device/showCumulative change (selectedFarmer/selectedProduct
//   moved to refs); pre-fetch skips when refresh ran <60 s ago;
//   syncComplete dispatches now carry detail.synced so refreshes are
//   skipped when nothing synced. No backend, IndexedDB schema, sync
//   engine, reference generator, receipt, or auth changes.
// v2.10.85: RESILIENT BLUETOOTH CONNECTION MANAGER — both scale and printer
//   now share a single connection manager (src/services/btConnectionManager.ts)
//   that owns: per-role state machine (idle/connecting/connected/reconnecting/
//   disconnected/failed), per-role mutex (no duplicate connect attempts),
//   exponential backoff retry (2/4/8/15/30s), 15s health monitor (paused when
//   document hidden), auto-reconnect on app resume / online / adapter on,
//   persistent last-paired memory (survives logout & reload). New shared hook
//   useBtStatus(role) drives PrinterSelector status chip in real time. Logout
//   no longer disconnects Bluetooth — devices stay paired across re-login.
//   All transitions tagged "[BT][role]" so the persistent /debug console
//   captures every connect/disconnect/retry/health-check. No backend, schema,
//   sync, reference generator, receipt, or auth flow changes.
//
// v2.10.84: PERSISTENT DEBUG CONSOLE — restored at /debug, isolated IndexedDB,
//   survives logout/restart/reboot. Global capture of console.error/warn,
//   window error, unhandled rejections, online/offline. Hard guards: 1s
//   batched flush, 2s dedupe, 50/sec rate cap, 5,000-row / 7-day prune,
//   2 KB payload cap, QuotaExceeded recovery. BluetoothDebugPanel removed
//   entirely; BT/printer/scale events now flow into /debug under tag BT.
//   Settings → Debug Console card replaces old panel. No backend, schema,
//   sync, reference, or receipt changes.
//
// v2.10.83: SECURITY HARDENING.
//   (1) Removed hardcoded MySQL credential defaults from backend-api/server.js.
//       The server now refuses to start unless MYSQL_USER + MYSQL_PASSWORD env
//       vars are set (already provided by .htaccess on the production host).
//       NOTE: the previously committed credentials must be ROTATED at the host.
//   (2) Offline credential cache no longer stores plaintext passwords. Login
//       writes a per-user-salted SHA-256 hash to localStorage (passwordHash),
//       and offline login compares hash-to-hash. Existing devices upgraded
//       from earlier builds verify against the legacy plaintext field once,
//       then transparently rewrite the cache as hashed form. New util:
//       src/utils/passwordHash.ts.
//   (3) Sanitised four backend error responses that previously leaked SQL
//       error messages (lines 1084, 2902, 3490, 3598). Full details remain
//       in cPanel/Passenger stderr logs; client now sees generic messages.
//   No CORS / rate-limiting changes — those need explicit allow-list +
//   lockout policy and are deferred to avoid bricking deployed devices.
//   No reference generator, sync engine, IndexedDB schema or receipt change.
//
// v2.10.74: Z-REPORT ALIGNMENT + STORE UNIT FIX.
//   (1) Column headers (QTY, KSh, AMOUNT, TIME) and section banners (== BUY ==,
//       == SELL ==) are now generated from the SAME width spec as the data rows
//       via padL/padR helpers — labels sit directly above their numeric columns
//       on both the thermal print and the on-screen receipt.
//   (2) SELL (transtype=2) and AI (transtype=3) sections render QTY as INTEGER
//       ITEMS (e.g. "2 items"), never KGS — store goods are sold by unit.
//   (3) Per-section subtotal collapsed to ONE line: "<TYPE> TOTAL  <n> items
//       KSh <amount>" for SELL/AI and "<TYPE> TOTAL  <weight> KGS" for BUY.
//   (4) Grand total split into three independent lines (suppressed when zero):
//         TOTAL <kg> KGS         (BUY only)
//         TOTAL ITEMS <n>        (SELL+AI only)
//         TOTAL VALUE KSh <n>    (SELL+AI only)
//       BUY weight no longer includes SELL/AI rows (they're units, not weight).
//   (5) Single-product divider ("-- NPK FERTILIZER --") suppressed when the
//       section only has one distinct product.
//   Files: src/services/bluetooth.ts (printZReport), DeviceZReportReceipt.tsx,
//   src/utils/pdfExport.ts. No backend, no DB schema, no sync engine, no
//   reference generator changes — purely presentation. Capacitor-safe.
//
// v2.10.73: (1) FACTORY-SCOPED CUMULATIVES — farmer_cumulative IndexedDB
//           cache key now includes the route/factory:
//             cacheKey = `${farmerId}__${ROUTE}__${YYYY-MM}`
//           (was `${farmerId}_${YYYY-MM}`). When a member delivers to multiple
//           factories the totals no longer leak across factories — selecting
//           Factory B will display Factory B's independent total even after
//           Factory A wrote to the cache earlier. DB schema bumped 11→12; the
//           legacy farmer_cumulative store is dropped on upgrade and rebuilt
//           from backend on next online sync (no transaction loss — receipts
//           remain in their own store).
//           Affected files: src/hooks/useIndexedDB.ts (schema, get/update
//           signatures take optional `route`), src/hooks/useDataSync.ts (pass
//           receipt.route on cumulative refresh), src/pages/Index.tsx (pass
//           selectedRouteCode on every cumulative read/write — 8 call sites),
//           src/components/FarmerSyncDashboard.tsx (pass activeRoute).
//           No backend change — /api/farmer-monthly-frequency* already does
//           UPPER(TRIM(route)) filtering since v2.10.72.
//
//       (2) Z-REPORT STORE/AI MONETARY VALUE — the Store and AI sections of
//           the device Z report now show KSh per row, per-section subtotal,
//           and a TOTAL VALUE grand line. Backend already returns price/amount
//           per row (server.js); we just stopped dropping them in the receipt
//           pipeline. BUY/produce sections unchanged (no money column).
//
//       (3) Z-REPORT RECEIPT READABILITY — left-aligned MNO/REF columns with
//           proper column gaps instead of cell-level dotted dividers, larger
//           text, blank line between sections, dialog widened max-w-md→lg,
//           thermal output uses fixed-width columns and lr-justified subtotals.
//           Pure presentation; data, totals and grouping unchanged.

// v2.10.72: ROOT-CAUSE FIX for cumulative weight regressions (e.g. 553.4 → 326.5 kg
//           between consecutive receipts) reported by users on flaky/intermittent
//           connections. Operator-described scenario, exactly reproduced:
//             Day 1 evening: user taps "Sync Now" online → POST succeeds → local
//               IndexedDB rows deleted. farmer_cumulative.baseCount STILL holds
//               the old value from an earlier prefetch. The 5-second-delayed
//               background prefetchCumulatives is queued but BEFORE it can run,
//               the device loses internet (van moves, signal drops, modem
//               reboots). The fresh cumulative is never fetched.
//             Day 2 morning: app reopens (still offline OR before next prefetch).
//               getFarmerTotalCumulative reads stale baseCount + 0 unsynced
//               (everything was synced & deleted) → prints REGRESSED total.
//           ROOT CAUSE: farmer_cumulative cache was refreshed only by the
//           5s-delayed background prefetch loop, never as a transactional
//           consequence of sync. If the network died inside that 5s window the
//           cache stayed permanently stale until the next online prefetch.
//           FIX (LAYER 0 — useDataSync.ts): after EVERY successful POST and
//             AFTER post-sync verification confirms the payload, call
//             farmerFrequencyApi.getMonthlyFrequency(farmer_id, route) and write
//             the result into farmer_cumulative via updateFarmerCumulative(...,
//             true, byProduct) — BEFORE deleting the local IndexedDB row. If
//             the cumulative GET fails (network died between POST and GET), the
//             local row is KEPT (cumulative_refresh_pending) and retried on the
//             next sync cycle. Same logic applied to the collision-retry
//             success path. This piggybacks on the network connection we just
//             proved good — no extra round trips on the happy path.
//           FIX (LAYER 3 — useDataSync.ts): removed the v2.10.31 "trust API
//             on 404" shortcut. Verification GET now retries up to 3× with
//             0.5s/1.0s back-off. If all attempts return empty/fail, the local
//             row is KEPT (verification_pending) instead of being silently
//             deleted. Better to retry on next cycle than lose data the
//             backend may not actually have stored.
//           FIX (LAYER 4 — backend-api/server.js): hardened both
//             /api/farmer-monthly-frequency and /api/farmer-monthly-frequency-batch
//             SQL to use UPPER(TRIM(...)) on route, memberno, ccode, and icode
//             comparisons. Strictly additive — widens WHERE clauses, never
//             narrows. Prevents case/whitespace mismatches (e.g. 't002' vs
//             'T002', 'M03156' vs 'm03156 ') from silently excluding
//             transactions and undercounting the cumulative.
//           No IndexedDB schema change. No reference generator change. No
//           auth/login/photo/Z-Report change. Buy/Sell capture screens
//           untouched. The collision-retry path (v2.10.70) and DUPLICATE_
//           SESSION_DELIVERY conflict path (v2.10.60) are preserved.

// v2.10.71: Fix "trnid starts afresh while storeid syncs correctly" on devices
//           sharing a devcode prefix (e.g. BA02). syncOfflineCounter had an
//           absolute SAFETY cap that DISCARDED any backend trnid > 10,000,000
//           as "clientFetch corruption". On busy shared-devcode estates the
//           legitimate global MAX(transrefno) for that devcode legitimately
//           exceeds 10M, so the cap silently rejected the correct authoritative
//           value, falling back to local 0 → device generated colliding refs
//           every sync, surfacing as `Reference collision: BA0220000341 …`.
//           storeid/milkid/aiid have no such cap, which is why the user
//           observed "storeid syncs but trnid does not".
//           FIX (frontend only — referenceGenerator.ts): replace the absolute
//           cap with a RELATIVE sanity check. Backend trnid is rejected only
//           if BOTH (a) it exceeds 100M AND (b) local already has a non-zero
//           counter AND (c) the jump exceeds 10M ahead of local. This keeps
//           protection against truly bogus values while accepting legitimate
//           high counters from shared-devcode estates. Fresh-install devices
//           (local=0) ALWAYS accept the backend value, so they immediately
//           catch up to the global max instead of starting at 1 and colliding.
//           Also added explanatory comments at the Login.tsx and
//           DeviceAuthStatus.tsx callsites so the 0/null→undefined fallthrough
//           is not "fixed" by mistake — it is intentional and relies on the
//           backend GREATEST(devsettings.trnid, MAX(transrefno)) self-heal
//           introduced in v2.10.70. No backend change, no IndexedDB schema
//           change, no sync engine change, no reference format change. The
//           transrefno format remains devcode + 8-digit trnid (no clientFetch).

// v2.10.70: Fix devices stuck generating colliding milk-collection references
//           (e.g. New: member=M0000 weight=1 colliding with real members like
//           M03156). ROOT CAUSE: backend GET /api/devices/fingerprint/:fp only
//           fell back to MAX(transrefno) from transactions when devsettings.trnid
//           was 0/null. If devsettings.trnid was stale-but-nonzero (e.g. 100)
//           while the real backend high-water mark was at 348, the device kept
//           receiving trnid=100 on every login/auth-check and re-issued refs
//           starting from 101 — every one of which collided with an existing
//           transaction and was rejected as REFERENCE_COLLISION. The frontend
//           collision-retry path then bumped the local counter by 1 (to 102,
//           103…) and kept colliding because it never re-asked the backend for
//           an authoritative reference.
//           FIXES (additive, no schema change, no API contract change):
//             (1) backend-api/server.js GET /api/devices/fingerprint/:fp now
//                 ALWAYS cross-checks devsettings.trnid against the actual
//                 MAX(transrefno) tail in transactions (filtered by devcode)
//                 and returns the GREATEST of the two. When the transactions
//                 table is ahead, it self-heals by writing the corrected value
//                 back to devsettings.trnid via GREATEST(IFNULL(trnid,0), ?)
//                 — never decrements, safe under concurrent device sessions.
//             (2) src/hooks/useDataSync.ts collision-retry now requests a fresh
//                 authoritative reference from /api/milk-collection/next-reference
//                 (which already advances and persists devsettings.trnid) and
//                 then resyncs the local IndexedDB counter via syncOfflineCounter
//                 so subsequent generations start from the correct base. Falls
//                 back to the previous local-bump path only if the network call
//                 fails. No backend insert path, sync queue, photo, Z-Report,
//                 receipt, cumulative, or auth flow changed.

//           the uploadrefno counter rolls back to a previously used value.
//           ROOT CAUSE: ReprintContext.addStoreReceipt / addAIReceipt treated
//           any existing Store (or AI) receipt with a matching uploadrefno as
//           a duplicate and silently skipped saving the new one. After a
//           downgrade-then-upgrade (v2.10.32 → v2.10.62) the device's
//           devsettings.trnid effectively went backwards and the new batch's
//           uploadrefno repeated an older value — so the brand-new receipt
//           was never added to Recent Receipts even though the transaction
//           was real and offline-queued for sync. Operators perceived this
//           as "the app deleted my receipts".
//           FIX (frontend only, no schema, no sync, no backend):
//             (1) PrintedReceipt gains optional localReceiptId + itemRefs
//                 fields (legacy entries without them keep working).
//             (2) Store/AI submit handlers now pass the per-item transrefno
//                 list into addStoreReceipt / addAIReceipt.
//             (3) Duplicate detection now keys on the batch's transrefno
//                 identity, not uploadrefno alone. A repeated uploadrefno
//                 with a different item set is correctly saved as a NEW
//                 Recent Receipt entry. Legacy fallback (no itemRefs) still
//                 requires uploadrefno + item count + total to match before
//                 suppressing — so the old guard cannot wrongly hide new
//                 receipts either.
//           Recent Receipts history is independent of the offline sync queue,
//           so receipts now also persist when sync deletes the queued items.
// v2.10.65: Fix Classic BT printer state being cleared by spurious scale-side
//           connectClassicScale() and connectClassicPrinter() each registered
//           a 'connectionStateChanged' listener on the shared plugin. Native
//           events carried no device address, so a single `connected: false`
//           tick (often emitted between print chunks by some POS firmwares)
//           was delivered to BOTH listeners — the printer listener then called
//           clearClassicPrinterState() and broadcast printerConnectionChange,
//           dropping the user back to the "Select Printer" prompt mid-receipt.
//           Visible to the affected user as "printer moves to scale even when
//           no scale is paired".
//           FIXES (additive, JS-only — no native rebuild required):
//             (1) bluetoothClassic.ts: scope each listener by its device
//                 address captured in closure; ignore events for any other
//                 address (or cross-role events when address is absent);
//                 verify with BluetoothClassic.isConnected() before clearing
//                 state — preserves connection on transient false-disconnects.
//             (2) bluetooth.ts: in printToBluetoothPrinter catch block, replace
//                 unconditional clearPrinterState() with verifyPrinterConnection()
//                 gate — a single failed BLE chunk write no longer kills the
//                 printer session.
//             (3) Store.tsx: remove no-op scale autoReconnect() on mount —
//                 Store is cart-based, never reads weight, and the call was
//                 toggling Classic plugin state and feeding (1) above. Buy/Sell
//                 still auto-reconnect normally.
//           No backend, no IndexedDB schema, no sync engine, no reference
//           generator, no receipt/photo/Z-Report changes. BLE scale, BLE
//           printer, Buy/Sell weight capture, and the BluetoothClassicPlugin.kt
//           native plugin are all untouched.
// v2.10.64: Fix login "Failed to fetch" in Lovable preview / wrapped fetch envs.
//           ROOT CAUSE: external scripts in the preview iframe (lovable.js) wrap
//           window.fetch and intermittently throw TypeError: Failed to fetch on
//           POST requests, even when the backend is healthy and GETs succeed.
//           Same class of failure can occur on legacy WebViews / corporate
//           proxies. The login screen surfaced this as "Failed to fetch" with
//           no recovery path.
//           FIX: new src/utils/resilientFetch.ts wraps window.fetch and, on a
//           network-level TypeError for any non-GET, transparently falls back
//           to a raw XMLHttpRequest that bypasses the wrapped fetch entirely.
//           Returns a real Response object so apiRequest() keeps using
//           response.json() / response.headers unchanged. mysqlApi.apiRequest
//           now calls resilientFetch instead of fetch — every POST/PUT/PATCH/
//           DELETE in the app (login, milk-collection, sales, devices,
//           members…) gets the fallback for free. GET behaviour is identical.
//           No backend, no IndexedDB schema, no sync engine, no reference
//           generator, no receipt/photo/Z-Report changes.
// v2.10.63: Fix multOpt=0 duplicate-capture block bypassed after app restart for
//           coffee orgs. ROOT CAUSE: Index.tsx read activeSession.scode (lowercase)
//           but the Session interface uses .SCODE (uppercase) everywhere else, so
//           useSessionBlacklist always received an empty seasonCode and the coffee
//           blacklist stayed empty after restart — letting the operator capture a
//           second receipt for the same farmer/season. The duplicate then surfaced
//           later as a "stuck receipt" via DUPLICATE_SESSION_DELIVERY, but the
//           paper receipt was already printed and handed out.
//           FIXES (additive, two files):
//             (1) Index.tsx: read .SCODE with lowercase fallback; harden
//                 activeSessionTimeFrom int coercion (default undefined, not NaN);
//                 add eager loadedFarmers preload from IndexedDB whenever an
//                 activeSession is restored — closes the post-login window where
//                 the blacklist is empty until the user opens Buy/Sell.
//             (2) useSessionBlacklist.ts: defensive date-only fallback for coffee
//                 orgs when seasonCode is missing, plus a [WARN] log so the bug
//                 cannot silently re-appear. Public API unchanged.
//           No backend, no IndexedDB schema, no sync engine, no reference
//           generator, no receipt/photo-audit/Z-Report changes. Buy/Sell screens,
//           DuplicateDeliveryDialog (v2.10.61), and FarmerSyncDashboard
//           (v2.10.62) are all untouched.
// v2.10.62: Farmer Sync Status (Settings) — Capacitor list now matches the
//           Web app: transaction-driven, route-filtered, no zero-weight rows.
//           ROOT CAUSE: when the batch API call from Capacitor failed (legacy
//           WebView 52 / native HTTP bridge can flake on a single GET), the
//           dashboard fell back to listing every cached cm_members row —
//           including farmers with no transactions — and the route filter
//           was fragile against legacy whitespace. The web app rarely hit
//           the fallback, so it always looked correct.
//           FIX (FarmerSyncDashboard.tsx only):
//             (1) Online batch call now retries once with a 2s back-off on
//                 Capacitor (Capacitor.isNativePlatform()) so the device
//                 stays on the transaction-driven path whenever the network
//                 is genuinely available.
//             (2) Offline fallback rewritten to be transaction-driven: the
//                 list is built from the union of (a) farmer_cumulative
//                 IndexedDB keys and (b) farmer IDs in unsynced receipts.
//                 Farmers with zero total weight AND no unsynced receipts
//                 are dropped — matches web behaviour exactly.
//             (3) Offline route filter tightened: prefer cm_members.route
//                 (TRIM both sides), but if cm_members has no record for
//                 the farmer, include the row tagged 'N/A' so transactions
//                 are never silently hidden.
//           No backend, no IndexedDB schema, no sync, no capture/receipt/
//           photo audit/Z-Report changes. Buy/Sell screens untouched.
// v2.10.61: multOpt=0 duplicate capture — replace transient toast with a
//           persistent AlertDialog ("Already Delivered This Session") so
//           operators cannot miss the block under bright sunlight or while
//           the printer is running. New DuplicateDeliveryDialog.tsx (uses
//           shadcn AlertDialog, amber AlertTriangle, farmer/session/date
//           card, multOpt=0 policy subtext, offline-aware footnote, single
//           "OK, Got It" CTA). BuyProduceScreen wires it into all four
//           multOpt=0 block paths (resolveFarmerId × 3 + handleSelectFarmer)
//           via new getBlockReason() helper; old 5s toast becomes a 2s
//           fallback only. Coffee orgs show season descript/scode; dairy
//           shows AM/PM. Dismissal clears member input + focuses for next
//           farmer. SellProduceScreen unchanged (transtype=2 exempt). No
//           backend, no IndexedDB schema, no sync, no receipt-generation
//           changes.
// v2.10.60: Fix multOpt=0 silent data loss after offline captures.
//           LAYER 1 (capture): useSessionBlacklist now org-aware. Coffee orgs
//           compare receipt's season_code/session against the active SCODE
//           (e.g. S0002), closing the offline blind-spot where coffee farmers
//           could be re-captured freely. Dairy keeps AM/PM but tolerates
//           legacy stamps like 'AM SESSION'/'MORNING'. Date comparison now
//           uses local YYYY-MM-DD instead of toISOString to fix EAT midnight
//           rollover. Index.tsx passes activeSession.scode into the hook.
//           LAYER 2 (sync): useDataSync no longer silently deletes the second
//           offline receipt when the backend rejects it with
//           DUPLICATE_SESSION_DELIVERY. The local IndexedDB row is preserved,
//           a deduped toast surfaces the conflict to the operator, and an
//           in-memory conflictedReceiptsCount is exposed for UI badging.
//           The "real duplicate by transrefno" cleanup path is unchanged.
//           LAYER 3 (UI): Dashboard sync row shows a small amber chip
//           "⚠ N stuck" when conflictedReceiptsCount > 0. No backend change.
// v2.10.59: Member next-id ignores reserved test-ID range (default 9000–9999)
//           and computes a true SQL MAX across all same-prefix rows (not just
//           the recent 200), so suggestions correctly land at the next REAL
//           member ID instead of collapsing to test-sentinel neighborhoods
//           (e.g. M9999 test → real top M3556 → suggest M3557, not M10000 or
//           M1000). Jump rule: if the natural next number falls inside the
//           reserved range, jump straight past it. Range is per-ccode
//           overridable via optional psettings.reserved_testid_min / _max
//           columns (graceful fallback to defaults if columns absent — no
//           migration required). Response gains optional `reservedRange` +
//           `jumped` fields; modal shows a subtle hint when the suggestion
//           skipped the reserved range. Legacy clients (no `prefix` param)
//           keep prior behavior for full backward compatibility.
// v2.10.58: Add Member modal — explicit Member (M) vs Debtor (D) type selector.
//           Backend /api/members/next-id now accepts an optional ?prefix=M|D
//           query parameter and, when present, scopes the suggestion to that
//           prefix (targeted SQL: mcode LIKE 'M%' or 'D%', LIMIT 200). When the
//           param is omitted, behavior is identical to v2.10.43–v2.10.57
//           (latest-row prefix) — full backward compatibility for legacy
//           devices. Frontend modal defaults to Member, refetches the next ID
//           on toggle change, and keeps the chosen type sticky across rapid
//           sequential entries. Soft inline hint when typed prefix differs
//           from selected type (no hard block). Adds DialogDescription a11y.
//           No DB migrations, no schema changes, no impact on transactions /
//           sync / receipts / cumulative / photos.
// v2.10.57: Photo Audit Viewer — preserve grid scroll position when closing a
//           viewed photo. Root cause: list Dialog was unmounted while detail
//           was open (`open={open && !selectedPhoto}`), destroying the
//           scrollable grid and forcing scrollTop=0 on close. Fix: keep list
//           Dialog mounted (open={open}); detail Dialog stacks on top. Added
//           defensive scrollTop capture/restore via gridRef + savedScrollRef
//           with a data-photo-id scrollIntoView fallback. Added DialogDescription
//           for a11y. No backend, no logic, no API changes.
// v2.10.56: Fix Store/AI writing wrong SCODE to transactions.session and CAN.
//           ROOT CAUSE: Buy reads the active session from the Dashboard
//           (localStorage.active_session_data), but Store/AI were calling
//           /api/sessions/active which picks the session matching server wall
//           clock. Once server time crossed a session's time_to boundary, Store
//           and AI silently switched to the next SCODE while Buy stayed correct.
//           FRONTEND: src/pages/Store.tsx + src/pages/AIPage.tsx loadActiveSession
//             now resolve the Dashboard session FIRST (via new
//             resolveDashboardActiveSession in src/utils/sessionMetadata.ts) and
//             only fall back to the backend time-based endpoint at cold-start.
//           BACKEND: /api/sales and /api/sales/batch now, for coffee orgs only,
//             resolve the canonical SCODE in priority order:
//               (a) most recent Buy (Transtype=1) row's CAN for the same
//                   ccode + transdate (what the operator actually used today),
//               (b) sessions table date-range rescue,
//               (c) whatever the device sent.
//             Then force session = CAN = canonical. This auto-corrects writes
//             from legacy v2.10.32 devices that send a stale SCODE. Dairy
//             behaviour and existing API contract are unchanged. Logs every
//             normalization with [NORMALIZE] prefix for production audit.
// v2.10.55: Member Produce Statement print layout fixes —
//           (1) DATE column widened from 10 → 12 (clear gutter before REC NO).
//           (2) Produce title (e.g. "MBUNI RECORD") trimmed + preview wrapped
//               in justify-center flex so it visually matches print output.
//           (3) Two leading newlines before company name so it doesn't print on
//               the tear edge.
//           (4) New optional CENTER line on receipt — resolves to active dashboard
//               route → most recent transaction's route → farmer's registered route.
//               Backend /api/periodic-report/farmer-detail now returns
//               transaction_route(_name) and farmer_route_name (additive).
// v2.10.54: Bluetooth — prevent printer/scale cross-disconnects on Android.
//           (1) Device-scoped disconnect callbacks: BleClient.connect callbacks
//           now ignore disconnect events for ids that don't match the active
//           scale/printer slot — fixes "scale connects → printer reports
//           disconnected" caused by Android GATT renegotiation.
//           (2) quickReconnect/quickReconnectPrinter: only call BleClient.disconnect
//           when the deviceId matches the current slot — avoids killing the
//           other device via process-wide GATT reset.
//           (3) scanForPrinters: pause scale notifications during LE scan and
//           reduce default scan window from 5s → 3s to minimize GATT contention.
//           (4) PrinterSelector startup auto-reconnect: defer up to 5s when the
//           scale was just connected (lastScaleConnectedAt within 5s).
//           (5) Settings + PrinterSelector: verify with verifyXxxConnection
//           before flipping UI badge to "disconnected" on spurious events.
// v2.10.53: (1) Add Member: backend now hard-fails on duplicate (mcode, ccode)
//           with a clear 409 toast — removed silent auto-increment retry.
//           (2) Periodic Report: cross-device visibility within same ccode.
//           Backend dropped t.deviceserial filter (kept ccode multi-tenant
//           boundary) and added optional `route` query param. Frontend reads
//           active route from localStorage.active_session_data and passes it
//           to /periodic-report and /periodic-report/farmer-detail; route is
//           shown as a badge and included in the local cacheKey.
//           Z-Reports remain device-isolated (unchanged).
// v2.10.52: Fix Debtors picker hiding new D-prefix members (dropped the
//           crbal != 0 requirement in Store/AI). Enforce active-mode prefix
//           in farmer resolver (typing D03558 while Members is active now
//           toasts "Switch to Debtors" instead of selecting). Listen for
//           `membersUpdated` in Store/AI to refresh farmers immediately
//           after Add Member, with a remote getByDevice refresh when online.
// v2.10.51: Coffee session contract — frontend ALWAYS sends SCODE as the backend
//           session value for coffee orgs (Buy/Store/AI, online + offline replay).
//           Adds backend_session to sessionMetadata resolver, clears sessions
//           IndexedDB store on save (no stale legacy entries), forces refresh
//           when cached coffee sessions lack SCODE. Dairy AM/PM unchanged.
// v2.10.50: Fix coffee transactions.session still storing AM/PM. Backend now
//           never collapses coffee sessions to AM/PM (uses SCODE → descript →
//           active-season DB lookup) across /api/milk-collection, /api/sales,
//           /api/sales/batch. Frontend forwards session_descript and clears
//           legacy coffee session cache without SCODE on Dashboard mount.
// v2.10.49: Fix Camera.then() unhandled rejection on Android — wrap plugin proxy
//           in object before returning from async fn (Promise-resolution probes
//           `.then` on Capacitor Proxy and throws on Android).
// v2.10.48: Fix Android camera crash (remove static @capacitor/camera enum imports);
//           add DialogDescription for a11y; backend diagnostic log for coffee SCODE.
// v2.10.67: Milk and coffee receipts are always saved to Recent Receipts after a
//           transaction is made, even if the backend rejects it as a duplicate
//           (DUPLICATE_SESSION_DELIVERY) or every local IndexedDB save fails.
//           ROOT CAUSE: Index.tsx returned early on `hardStopped` before
//           addMilkReceipt() ran, and the normal save was only reached when
//           successCount > 0 OR offlineCount > 0 — so a real, printed
//           transaction could disappear from Recent Receipts. Matches the
//           v2.10.66 fix already applied to Store/AI receipts.
//           FIX (frontend only — Index.tsx): call addMilkReceipt(...) on the
//           hardStopped early-return path AND as a defensive last step when
//           the loop processed nothing successfully. Existing duplicate guard
//           in ReprintContext.addMilkReceipt (keyed on reference_no /
//           transrefno, globally unique on device) makes the extra calls
//           idempotent. No backend, no IndexedDB schema, no sync engine, no
//           reference generator, no receipt/photo/Z-Report changes.
// v2.10.68: Fix "ghost scale connects when printer connects" — Dashboard scale
//           indicator was turning green even with no scale paired, the moment
//           a Bluetooth printer was connected.
//           ROOT CAUSE: BluetoothClassicPlugin uses ONE shared RFCOMM socket
//           for both scale and printer roles, and `dataReceived` events carry
//           no device-address tag. The scale's global dataReceived listener
//           (registered the first time Settings touched the scale flow) stayed
//           alive and parsed printer ACK/status bytes as a "weight" via the
//           permissive integer-grams strategy in parseSerialWeightData. Each
//           parsed value broadcast `scaleWeightUpdate`, and useScaleConnection
//           unconditionally called `setScaleConnected(true)` on every weight
//           event — flipping the indicator on with no real scale present.
//           FIXES (frontend-only, no native rebuild required):
//             (1) bluetoothClassic.ts: dataReceived listener now drops inbound
//                 bytes unless the scale role is currently flagged connected
//                 (classicScale.isConnected && classicScale.address).
//             (2) bluetoothClassic.ts: parseSerialWeightData rejects frames
//                 with no decimal point and no kg/g/lb/oz unit — printer ACKs
//                 (e.g. \x06, \x10, short numeric flags) never have either,
//                 so they no longer match the integer-grams fallback.
//             (3) useScaleConnection.ts: scaleWeightUpdate listener no longer
//                 treats a stray weight event as proof a scale is connected;
//                 it verifies isScaleConnected() before updating live weight
//                 and notifying parents. Connection state remains driven by
//                 scaleConnectionChange events only.
//           Real scales (BLE and Classic SPP) keep working unchanged because
//           classicScale.isConnected is set by connectClassicScale BEFORE the
//           first dataReceived can arrive, and BLE scales use a separate path.
// v2.10.69: Final hardening for "scale indicator turns green when only the
//           Classic printer is connected" on integrated POS hardware.
//           Reported scenario: connect Classic printer → open Buy portal →
//           Dashboard scale dot flips green even with no scale paired.
//           Remaining holes after v2.10.68:
//             (a) useScaleConnection.autoReconnect (called on
//                 LiveWeightDisplay/CoffeeWeightDisplay mount) ran a BLE
//                 quickReconnect on the stored "scale" deviceId, which on
//                 some integrated POS units is actually the printer's MAC.
//                 The reopen succeeded and broadcast scaleConnectionChange.
//             (b) scaleConnectionChange events had no truth-source guard, so
//                 any caller could turn the indicator green.
//           FIX (frontend-only, no native rebuild required):
//             (1) bluetoothClassic.ts: new getCurrentClassicPrinterInfo();
//                 connectClassicScale and clearClassicScaleState now route
//                 through broadcastScaleConnectionChange instead of dispatching
//                 raw events.
//             (2) bluetooth.ts: broadcastScaleConnectionChange suppresses
//                 connected:true unless a real scale role is active
//                 ((scale.deviceId && scale.isConnected) || isClassicScaleConnected()).
//                 Re-exports getCurrentClassicPrinterInfo.
//             (3) useScaleConnection.ts: autoReconnect skips when a Classic
//                 printer is connected and its address matches the stored
//                 scale deviceId (case-insensitive).
//             (4) Dashboard.tsx: handleScaleChange double-checks
//                 isScaleConnected() before flipping the dot green.
//           Real BLE and Classic SPP scales remain unaffected. Printer
//           connect/print flow is untouched. No backend, no IndexedDB schema,
//           no sync engine, no reference generator changes.
// v2.10.75: TWO SURGICAL BUG FIXES.
//   (1) Z-REPORT FIRST-PRODUCT HEADER MISSING — the product divider
//       (`-- RAHA FLOUR --`) was only printed when transitioning between
//       products. The first product in a multi-product section therefore had
//       no header. Both renderers (src/services/bluetooth.ts and
//       src/components/DeviceZReportReceipt.tsx) now emit the label for every
//       distinct product group, including the first. Single-product sections
//       are still suppressed (distinctProducts > 1 gate unchanged). Column
//       widths, banners, totals and grand totals are untouched.
//   (2) FARMER SYNC OFFLINE ROUTE FILTER IGNORED TRANSACTION ROUTE —
//       FarmerSyncDashboard.loadFromOfflineCache read every farmer_cumulative
//       row via store.getAll() and used cm_members.route (the farmer's HOME
//       registration route) for filtering. Switching factories offline kept
//       showing rows from other factories with mixed totals. The cache is
//       already keyed by farmer+route+month (v2.10.73) and each row carries
//       its own `route` field, so the dashboard now drops any cumulative row
//       whose stored `route` does not match the active route key. Unsynced
//       receipts continue to be filtered by their own r.route. cm_members is
//       used only for display name/route label lookup, never for filtering.
//   No backend, no IndexedDB schema, no sync engine, no reference generator,
//   no auth/login/photo/Z-Report-summary-screen changes. Capacitor-safe.
// v2.10.78: ID NO and SIGN fields on Store/AI receipts moved from centered full-width
//       blocks to left-aligned inline label+line pairs. Both the on-screen receipt
//       (TransactionReceipt.tsx) and the 32-character thermal print output
//       (bluetooth.ts printStoreAIReceipt) now render:
//         ID NO: _________________________
//         SIGN:  _________________________
//       Purely visual — no data, no backend, no sync, no reference generator changes.
//       Capacitor-safe.
// v2.10.79: Periodic Report printed receipt — header now uses ESC/POS native
//           ALIGN_CENTER (printer-aligned, not 32-col space padding) so company
//           name and CENTER line sit truly centered on any paper width.
//           Removed redundant blank lines between header/title/member/total
//           sections and tightened multi-product group separators (dotted
//           divider in place of blank line). On-screen preview untouched.
//           Files: src/services/bluetooth.ts (printMemberProduceStatement only).
//           No backend, no IndexedDB, no sync engine, no reference generator,
//           no Z-Report or photo changes.
// v2.10.80: STORE/AI RECEIPT — wider ID NO / SIGN handwriting areas.
//   Each field now prints its label on its own line, followed by a full
//   printer-width underscore line, with a blank line separating ID NO from
//   SIGN. Gives operators ~32 underscores of writing space (vs 25 before)
//   and proper vertical room to comfortably hand-write an ID number and
//   signature on the thermal receipt. Print output only —
//   printStoreAIReceipt in src/services/bluetooth.ts. No backend, no UI,
//   no business logic, no sync/reference changes.
// v2.10.86: NATIVE FILE EXPORT FIX — debug logs and report exports now use
//   Capacitor Filesystem + Share on native Android/iOS instead of the broken
//   anchor-download approach that silently fails inside Capacitor WebViews.
//   New utility src/utils/nativeFileExport.ts handles cross-platform save:
//   web = anchor download, native = write to Documents then open Share sheet.
//   @capacitor/filesystem and @capacitor/share registered in Android build.
//   ReceiptList export handlers updated to async/await. No backend, schema,
//   sync, receipt, Bluetooth, or auth changes.
// v2.10.87: bug fixes from /debug logs —
//   (1) referenceGenerator no longer requests stale IndexedDB version 11
//       against the v12 schema (eliminates the VersionError flood and the
//       cascading "DB not ready" farmer-load errors).
//   (2) Bluetooth manager: detect Web-Bluetooth NotAllowedError /
//       "Must be handling a user gesture" and PAUSE the retry loop instead
//       of looping forever. Auto-resume on next user gesture, app resume,
//       or successful manual re-pair. Native Capacitor path unchanged.
// v2.10.90: Debug Console UX fixes — safe-area-aware responsive header, filter-aware
//   Share Logs export (NDJSON/CSV honor level/tag/search/view), and cumulative monitor
//   no longer false-flags route-total drops caused by per-icode re-bucketing
//   (new CUM:RECONTEXT info tag; pinned CUM:REGRESSION reserved for true same-icode drops).
//   No backend, IndexedDB schema, sync engine, reference generator, receipt, or auth changes.
// v2.10.91: TWO-READ CONFIRMATION GUARD for cumulative regressions. A single transient
//   stale backend read (e.g. paginated response mid-write, stale proxy, racy GET right
//   after a POST) used to be enough to fire a pinned CUM:REGRESSION even when the DB
//   was correct and the next refresh recovered the value. Now observeBaseChange stashes
//   the candidate drop for up to 8s and only emits CUM:REGRESSION / CUM:RECONTEXT after
//   a second read confirms. Recovered candidates are silently suppressed and counted as
//   CUM:TRANSIENT (sampled 1-in-10 debug row, visible in /debug Cumulative tab as
//   "transient suppressed / 24h"). Noise floor of |Δ| ≥ 0.05 kg AND ≥ 0.1% filters
//   float-precision wobble. No backend, IndexedDB schema, sync engine, reference
//   generator, receipt, photo, Bluetooth, or auth changes.
// v2.10.94: CUMULATIVE INTEGRITY HARDENING — fixes 4 latent cumulative bugs:
//   (1) IndexedDB DB_VERSION bumped 12 → 15 with idempotent farmer_cumulative
//       migration. Earlier preview builds left some browsers at v13/v14, so
//       openDatabase failed with VersionError and EVERY cumulative read/write
//       silently no-op'd — breaking printed cumulatives, post-sync refresh,
//       and the sync dashboard. (2) Unsynced AI receipts (transtype=3) were
//       being added to BUY cumulative in getUnsyncedWeightForFarmer and the
//       offline sync dashboard; now only transtype=1 contributes. (3) Offline
//       sync dashboard no longer double-counts localCount + unsyncedWeight
//       (uses max() as a guard against legacy rows). (4) updateFarmerCumulative
//       refuses to overwrite a non-zero cached base with a stale 0/empty
//       payload from a read replica that lags the just-POSTed write — the
//       monitor's transient guard only suppressed the log, this protects the
//       data. No backend, sync engine, reference generator, receipt, photo,
//       Bluetooth, or auth flow changes.
// v2.10.98: Store Z print receipt strips COFFEE SUMMARY / SEASON / PRODUCE
//   metadata and renders item names as left-aligned full-width lines (POS
//   style). Produce Z layout unchanged. On-screen Store Z preview matches.
// v2.10.109: STABLE DEVICE IDENTITY ACROSS REINSTALLS. New
//   POST /api/device/resolve-identity endpoint matches a reinstalled /
//   cleared-data device against approved_devices using SSAID +
//   model + manufacturer (in addition to the legacy device_fingerprint).
//   On a hit the server returns the device's ORIGINAL
//   (device_fingerprint, devcode, uniquedevcode, trnid, milkid, storeid,
//   aiid) so the client rehydrates its identity instead of being issued a
//   fresh one — eliminating the root cause of TRNID/MILKID mixups after
//   reinstall. Frontend collects a hardware bundle via
//   src/utils/deviceFingerprint.ts:collectHardwareBundle() (new function,
//   uses @capacitor/device) and calls the resolver before the existing
//   getByFingerprint path in Login.tsx. Migration:
//   backend-api/MIGRATION_APPROVED_DEVICES_HW.sql adds ssaid /
//   device_model / device_manufacturer / os_version / fingerprint_history /
//   last_seen_at columns plus (ccode,ssaid) and (ssaid) indexes — all
//   nullable, all additive. Backend uses try/catch around the new columns
//   so it stays compatible until the migration is run. No existing
//   endpoint, response shape, schema column, sync engine, reference
//   generator, receipt rendering, photo capture, or auth flow is modified.
//   Old APKs in the field keep working unchanged (they simply never call
//   the new endpoint). Counter self-heal mirrors the existing
//   GREATEST(devsettings.trnid, MAX(transrefno)) protection.
// v2.10.110: PASSENGER .htaccess LOCK-FAILURE FIX. After v2.10.109 deploy,
//   restarting the production Node app (2backend.maddasystems.co.ke →
//   /public_html/sync-service) failed with cPanel error
//   "Can't acquire lock for app: public_html/sync-service" and the API went
//   offline, causing client login to fail with a network error. Root cause:
//   sync-service/.htaccess and backend-api/.htaccess each declared TWO
//   conflicting Passenger blocks — the cPanel-managed header pinned Node 19
//   while a second manual block at the bottom set Node 14 via
//   PassengerNodejs /opt/alt/alt-nodejs14/root/usr/bin/node. Apache uses the
//   LAST directive, so Passenger tried to spawn the app under Node 14 while
//   the cPanel app registry expected Node 19 — the two fought for the same
//   Passenger app lockfile and neither won. Fix: collapse each .htaccess to
//   a single Passenger header block (Node 19) matching what cPanel's Node
//   Selector registered, with an inline guard comment so the duplicate is
//   not re-introduced on the next deploy. Config-only, fully reversible. No
//   server.js, schema, client logic, sync engine, reference generator,
//   receipt rendering, photo, Bluetooth, or auth changes. v2.10.109's
//   stable-device-identity feature is preserved unchanged.
// v2.10.111: STABLE DEVICE IDENTITY — PREFER APPROVED ROW. After clear-data,
//   /api/device/resolve-identity matched the correct ssaid but ORDER BY
//   last_seen_at DESC picked the freshly-created pending duplicate instead
//   of the original approved row, so the device kept the new fingerprint
//   and started a new identity (exactly what v2.10.109 was meant to
//   prevent). Fix has 3 additive parts:
//   1. resolve-identity ssaid lookups ORDER BY approved DESC first, then
//      user_id != 'pending', then last_seen_at — approved row always wins.
//   2. POST /api/devices checks ssaid up-front: if an approved row exists
//      for that ssaid, return it instead of inserting a duplicate pending
//      device. Also persists ssaid/model/manufacturer/osVersion on NEW
//      pending rows so future reinstalls have something to match on.
//   3. Frontend register payload now sends the hardware bundle, and Login
//      rehydrates the recovered fingerprint when the backend returns one.
//   See backend-api/CLEANUP_DUPLICATE_DEVICE_IDS.sql for cleaning up
//   already-duplicated rows in production. No schema changes (uses
//   v2.10.109 columns). No sync engine / reference generator / receipt /
//   photo / auth changes. Old APKs keep working.
// v2.10.112: SSAID-DERIVED DEVICE FINGERPRINT (native). generateDeviceFingerprint
//   in src/utils/deviceFingerprint.ts now derives the native fingerprint
//   deterministically from Android SSAID (fp = sha256("ssaid:" + ssaid)) instead
//   of the previous random+timestamp entropy hash. After clear-data/reinstall the
//   same physical device produces the SAME fingerprint, so the server finds the
//   original approved row via /api/devices/fingerprint/:fp without falling into
//   the recovery path or creating a duplicate pending row (the bug that produced
//   approved_devices id 268 alongside the original id 267). Back-compat is
//   preserved: any device with an existing localStorage `device_id` keeps it
//   (priority 1), so already-approved devices are NOT orphaned. SSAID path
//   triggers only on fresh installs / cleared data. Web behavior unchanged.
//   Backend, approved_devices schema, sync engine, reference generator, receipts,
//   IndexedDB, Bluetooth and auth flow are all untouched. The v2.10.109–111
//   resolve-identity safety net remains for legacy-fingerprint devices that
//   clear data and for SSAID-rotating factory resets.
// v2.10.114: Z Report period selector now reads sessions from the sessions
//   table (transactions.CAN → sessions.SCODE, labeled with sessions.descript).
//   Removes hard-coded morning/afternoon/evening options. "All Z" preserved.
//   Backend unchanged — period filter applied client-side in
//   DeviceZReportReceipt. Strictly UI/state in
//   src/components/ZReportPeriodSelector.tsx and src/pages/ZReport.tsx.
// v2.10.120: CUMULATIVE HEAL-DOWN + STICKY-REGRESSION REPLAY. v2.10.119
//   correctly detected confirmed over-counts (CUM:W3-RECONFIRM-PERSISTENT-GAP
//   — e.g. M03561 persisted=79.1 vs two-read backend=52.1) but only logged
//   them, so poisoned caches stayed poisoned forever. v2.10.120 adds a
//   guarded heal-down branch in src/pages/Index.tsx loadCumulativeBatch:
//   when the W3 batch read AND the individual reconfirm read agree AND both
//   are strictly less than the persisted cache AND the farmer has ZERO
//   unsynced local receipts on that route, the cache is healed DOWN to the
//   agreed backend value via updateFarmerCumulative(..., allowDecrease:true,
//   verifySource:'W3:reconfirm-heal-down'). The existing zero-confirmation,
//   stale-reject, lag-recovery, and unsynced-row safeguards are untouched —
//   any gate failure falls back to the v2.10.119 log-only behaviour.
//   Plus a NEW sticky-regression pin store
//   (src/utils/cumulativeRegressionPins.ts, localStorage-backed, 7-day TTL,
//   ≤200 entries) records every STALE-REJECT, and a STAGE-B replay queue
//   runs on each prewarm that picks up to 25 pins NOT covered by today's
//   batch, runs two consecutive individual reads against them, and applies
//   the same heal-down gate. This is what finally heals farmers like
//   M01859 / M03544 / M02957 / M00385 / M03284 that were rejected on
//   v2.10.118 and never re-evaluated again. Heal-down + reconfirm + pin
//   resolution events are written as pinned log lines so they bypass the
//   logger's 50/s rate cap and stay visible in /debug. No backend,
//   IndexedDB schema, sync engine, reference generator, receipt rendering,
//   photo, Bluetooth, or auth changes.
// v2.10.121: CUMULATIVE DOWNWARD-HOLD (permanent fix). Removes the
//   v2.10.118 silent auto-heal-down branch in
//   src/hooks/useIndexedDB.ts updateFarmerCumulative. HEAL_SOURCES is now
//   intentionally empty — no refresh source (W1/W3/W4/W5/W6/W7) may
//   implicitly lower a non-zero baseCount. The only path that can lower
//   baseCount is an explicit confirmed reconciliation that passes
//   allowDecrease=true, i.e. the existing two-read W3:reconfirm-heal-down
//   gate (Index/w3Reconfirm + Index/w3PinReplay) which already requires:
//   batch and individual reads agree, both strictly < persisted, snapshot
//   present, and zero unsynced local rows for that route. This stops the
//   regression observed on BA01 / route T001 / 2026-06-20 where a single
//   stale W5:postcapture-refresh read silently removed valid captured
//   weight (e.g. M01859 1843.4 → 1791.4 Δ-52, M02957 666.6 → 585.4
//   Δ-81.2, M03486 365.6 → 351.6 Δ-14). New pinned log lines:
//   CUM:DOWNWARD-HELD whenever a downward write is blocked, and
//   CUM:DOWNWARD-CONFIRMED whenever the confirmed reconciliation path
//   accepts one. Zero-confirmation guard, stale-reject log, sync engine,
//   reference generator, receipts, photo, Bluetooth, and auth flow are
//   untouched. Strictly additive on logs; behaviour change is a stricter
//   guard, never a looser one.
// v2.11.0: PAYMENTS MODULE + WEB BLUETOOTH AUTO-CONNECT REMOVAL. New Payments
//   module (gated by psettings.payments_active + user.can_access_payments)
//   surfaces farmers with unpaid transactions, computes payable totals from
//   the local transactions cache, generates a unique payment reference, and
//   marks the underlying transactions as paid via a mock SACCO service
//   (swap point: services/saccoPaymentService.js on the backend). Web builds
//   no longer auto-connect Bluetooth on load; the Capacitor APK is unchanged.
// v2.11.1: PAYMENTS NATIVE HTTP BACKEND FIX. Payment endpoints now plug into
//   backend-api/server.js native http.createServer routing (no Express), login
//   exposes user.can_access_payments, psettings responses expose payments_active,
//   and client payment calls include device fingerprint + userid for ccode-safe
//   permission checks. Existing capture, sync, receipts, Bluetooth, and native
//   plugin paths are untouched.
// v2.11.9: ANDROID SSL TRUST ANCHOR — bundle ISRG Root X1 via
//   android/app/src/main/res/xml/network_security_config.xml so Android 7.0 /
//   WebView 51 devices (CS10) can validate the Let's Encrypt chain on
//   2backend.maddasystems.co.ke. Fixes SSLHandshakeError:-202 on every API
//   call. Scoped to *.maddasystems.co.ke only; all other origins keep the
//   default system trust store. Native-only change — no React, backend, sync,
//   IndexedDB, reference generator, receipt, photo, Bluetooth, or auth logic.
// v2.11.10: NATIVE BOOT & BLUETOOTH RECOVERY (CS10 / Android 7 / WebView 51-52).
//   Root cause in the 2026-07-26 CS10 logcat: Bridge.java fires
//   `window.Capacitor.triggerEvent(...)` on every appStateChange/resume, but
//   on WebView 51/52 the injected native-bridge.js can attach AFTER the
//   legacy Vite bundle begins evaluating, so triggerEvent is undefined and
//   the eval throws TypeError before any plugin proxy binds. Cascade:
//   BluetoothLe / BluetoothClassic fall through to their web shims
//   ("BluetoothLe plugin is not implemented on android"), psettings loops
//   with "Network error - waiting for retry", dashboard shows
//   "Company code not assigned". Three additive fixes:
//   (1) index.html — inline polyfill (before the module script) that stubs
//       window.Capacitor.triggerEvent / fromNative / handleWindowError as
//       no-ops when missing. Real native-bridge.js still overwrites them
//       when it loads.
//   (2) android/.../MainActivity.kt — explicit registerPlugin(BluetoothLe)
//       so BLE binding does not race the JS bridge bootstrap on WebView 51/52.
//   (3) src/hooks/useAppSettings.ts — 500 ms trailing debounce on the
//       visibilitychange refresh so the boot-time burst of
//       visibilitychange + appStateChange + resume collapses into one
//       psettings fetch instead of 8+ overlapping failed retries.
//   Strictly boot/plugin plumbing — no changes to transaction creation,
//   receipts, cumulative logic (v2.10.121 downward-hold still active),
//   reference generator, IndexedDB schema, sync engine, payments, or auth.
// v2.11.14: WEBVIEW 51 CSS COMPATIBILITY LAYER + CLASSIC-BT DEFAULT.
//   Root cause of the "dark dashboard / overlapping text / transparent
//   modals / broken photo tiles" reported on the CS10 (WebView 51.0.2704.91)
//   was purely rendering: flex `gap` (Chrome 84), `backdrop-filter`
//   (Chrome 76), `aspect-ratio` (Chrome 88), `dvh` unit (Chrome 108), and
//   inherited `prefers-color-scheme: dark`. Fix layers, all additive:
//   (1) index.html + main.tsx: force LIGHT theme at first paint, strip the
//       `.dark` class synchronously, meta color-scheme=light.
//   (2) src/index.css: neutralize the `.dark` CSS variable overrides via
//       !important, drop `100dvh`, and append @supports-guarded fallbacks
//       for `gap` (margin `> * + *`), `backdrop-filter` (opaque tint),
//       `aspect-ratio` (padding-bottom trick), and `position: sticky`.
//   (3) Bluetooth: printer role in btConnectionManager now prefers Classic
//       (SPP) over BLE when both are stored; scale connection dialog
//       defaults to the Classic tab on native.
//   Strictly rendering + BT default routing — no changes to transaction
//   creation, receipts, cumulative logic (v2.10.121 downward-hold still
//   active), reference generator, IndexedDB schema, sync engine, KCB
//   payments, or auth.
// v2.11.18: Final CS10 native-shell light-status-bar correction. Keeps the
//   white Android/Capacitor shell consistent on WebView 51 without changing
//   transaction, receipt, cumulative, reference generator, IndexedDB schema,
//   sync engine, KCB payments, or auth logic.
// v2.11.17: CS10 WebView 51 recovery. Hardens the native BluetoothClassic
//   plugin for Android 7 by treating legacy Bluetooth permissions as install-
//   time grants, falling back to BluetoothAdapter.getDefaultAdapter(), adding
//   role-aware scale/printer sockets so printer connections no longer evict
//   scale connections, and routing JS scale/printer connect/write calls through
//   role-specific native methods. Removes fake internal-printer MAC presets so
//   operators select real paired devices or enter a real MAC only. Forces the
//   Capacitor/Android shell to a fixed light theme and adds direct WebView 51
//   CSS fallbacks for surfaces/text/borders. Coalesces overlapping psettings
//   refreshes to reduce boot-time request storms. No transaction, receipt,
//   cumulative, reference generator, IndexedDB schema, sync engine, KCB
//   payments, or auth logic changes.
// v2.11.20: BLUETOOTH CLASSIC JS-INTERFACE FALLBACK. CS10/WebView 51 logs
//   showed window.Capacitor.Plugins.BluetoothClassic existed but calls still
//   rejected as UNIMPLEMENTED and native `[BT] Plugin loaded` never appeared,
//   proving Capacitor omitted native method headers before the Kotlin plugin
//   was reached. Added a direct Android WebView bridge
//   (`BluetoothClassicAndroid`) that mirrors the Classic SPP operations for
//   paired devices, scale/printer role sockets, reads, writes, and connection
//   events. The normal Capacitor plugin remains primary; JS only switches to
//   the fallback after the UNIMPLEMENTED bridge failure is detected. Strictly
//   Bluetooth plumbing — no transaction, receipt, cumulative, reference
//   generator, IndexedDB schema, sync engine, KCB payments, or auth changes.
// v2.11.22: CS10 NATIVE BLUETOOTH/PRINTER RECOVERY. Android 7/WebView 51 now
//   prefers the direct BluetoothClassicAndroid JS bridge so paired scales are
//   read from BluetoothAdapter.bondedDevices instead of the broken Capacitor
//   UNIMPLEMENTED proxy. Added Cs10PrinterAndroid for the CS10/Z100 internal
//   printer using the vendor PosApiHelper SDK, because the built-in printer is
//   not a Bluetooth SPP device. Strictly native device discovery/printing — no
//   transaction, receipt content, cumulative, reference generator, IndexedDB
//   schema, sync engine, KCB payments, or auth logic changes.
// v2.11.12: PRINTER DIALOG + CLASSIC SPP SUPPORT. Added connection selector
//   for internal CS10 printers. Hardened bridge polyfills and native plugin
//   registration to fix "MISSING" errors on WebView 51.
// v2.11.23: CS10 A26 / ANDROID 7 HARDENING.
//   (1) Native crash guard for the CS10 internal printer. The bundled Ciontek
//       POS SDK (libPosApi.so) needs /vendor/lib*/libcustom_jni.so and the
//       system AIDL class com.android.server.bcr.IBCRService$Stub, both of
//       which are MISSING on the CS10 A26 firmware (full_a26_6737m/NRD90M).
//       PosApiHelper.<clinit> dereferences a NULL native function pointer and
//       the process dies with SIGSEGV — unrecoverable from Java once class
//       loading starts. Fix: Cs10PrinterJsBridge.kt now runs a one-time
//       compatibility probe (vendor .so present + AIDL stub present) BEFORE
//       any reference to PosApiHelper. PosApiHelper is only resolved via
//       reflection after the gate passes, so its <clinit> never fires on
//       unsupported firmware. isAvailable()/printText() return structured
//       JSON {available:false, reason} instead of crashing. Print pipeline
//       falls back to the existing Bluetooth SPP path unchanged.
//   (2) Hardware Back button now exits the app on the root route and
//       navigates back through history otherwise (src/utils/nativeBackButton.ts,
//       wired from src/main.tsx). Native only.
//   (3) Haptics: silently disable after the first UNIMPLEMENTED error so
//       Android 7 units without vibrator plugin support don't spam logcat.
//   (4) AndroidManifest: added CAMERA permission and camera uses-feature
//       so the native Capacitor camera can start on Android 7.
//   Strictly native-plugin, permission and printer-routing changes — no
//   transaction, sync, IndexedDB schema, reference generator, receipt
//   content, cumulative, Bluetooth discovery/connect, KCB payments, or
//   auth logic changes.
// v2.11.24: CLASSIC PRINTER BROKEN-PIPE RECOVERY.
//   Android 7 CS10 external Bluetooth printers can close the RFCOMM stream while
//   BluetoothSocket.isConnected still reports true; the next write then throws
//   java.io.IOException: Broken pipe. Both native Classic BT paths now clear the
//   stale role socket on read EOF/write IOException and emit a disconnected
//   state. The web print path reconnects the saved printer once and restarts the
//   whole receipt print once, avoiding partial chunk continuation. The printer
//   dialog also explains why the incompatible CS10 internal POS SDK is disabled
//   on this firmware and routes operators to the CLASSIC tab. No receipt content,
//   transaction, sync, IndexedDB, cumulative, scale parsing, or business logic
//   changes.
// v2.11.25: CS10 INTERNAL PRINTER — REAL INIT, ISOLATED-PROCESS PROBE.
//   Removed the permanent libcustom_jni.so / IBCRService compatibility gate
//   that caused the built-in CS10 thermal printer to silently report
//   available=false. The native bridge now runs a one-shot POS SDK
//   initialization probe inside a dedicated ":posprobe" Android process, so a
//   SIGSEGV inside libPosApi.so can no longer kill the main app while we
//   still capture the failing stage, exception class, missing .so name and a
//   filtered logcat tail. On success, PosApiHelper is loaded in-process and
//   receipts print on the built-in head. On failure the printer dialog now
//   shows the structured diagnostic (stage / missingLibrary / logcat) and
//   offers a manual "Retry probe" — it NEVER auto-falls-back to Bluetooth
//   when the user explicitly picked Internal. No transaction, sync,
//   IndexedDB, receipt content, Bluetooth pairing, or business logic changes.
// v2.11.27: POS-API-PLUGIN. Retired the Cs10PrinterJsBridge / probe service /
//   CiontekPrinterBridge / CiontekServiceProbe stack and introduced a proper
//   Capacitor 7 plugin (PosApiPlugin, Java) that wraps the vendor POS SDK
//   (vpos.apipackage.PosApiHelper + com.cspos.PaySys) via reflection so the
//   build stays green whether or not the vendor JAR is present at compile
//   time. Sys.Lib_AppInit(context) runs once in load(); every JNI call runs
//   on a dedicated worker thread. Exposes only confirmed SDK methods:
//   system (beep/powerOn/getVersion/getSerial/…), printer (initializePrinter/
//   printText/startPrint/printReceipt/printerStatus), ICC/PICC (openCard/
//   sendApdu/detectCard/…), MSR (openMag/readMagStripe), scanner, PIN pad
//   (enterPin/getPinBlock), EMV (initEmv/startTransaction/setAmount/loadAid/
//   loadCapk/getTag), fingerprint, ID card, serial. Return codes are
//   normalised: 0 → ok, -1 → NO_PAPER, -2 → PRINTER_OVERHEATED,
//   -3 → LOW_BATTERY, other → POS_ERR_<n>; missing SDK → HARDWARE_UNAVAILABLE.
//   PrinterConnectionDialog "Internal CS10 Printer" and
//   printToInternalPrinter() now route through PosApi.printReceipt(). No
//   transaction, sync, IndexedDB, receipt content, or Classic Bluetooth
//   changes.
// v2.11.28: POS-API-VENDOR-SDK. Replaced the reflection-only PosApi wrapper with
//   the recovered vendor SDK compiled into the app: vpos/apipackage/*, vpos/util,
//   com/cspos/PaySys plus libPosApi.so + libPaypassApi.so under
//   jniLibs/armeabi-v7a. PosApi.java now calls PosApiHelper / Sys / Print / Icc /
//   Picc / Mcr / Scan / Fingerprint / IDCard / PaySys directly; the
//   ClassNotFoundException "PosApiHelper unavailable" fallbacks are gone while
//   normal runtime error mapping (NO_PAPER / PRINTER_OVERHEATED / LOW_BATTERY /
//   POS_ERR_<n>) is preserved. Sys.Lib_AppInit(context) still runs exactly once
//   in PosApiPlugin.load() on the worker thread. Decompiled SDK sources were
//   patched to compile (checked-exception wrapping in PosApiHelper print/barcode
//   helpers, missing return in readSysBattCat, android.support → literal colour
//   masks). ABI pinned to armeabi-v7a to match the shipped native libraries and
//   ProGuard keeps vpos.** / com.cspos.**. TypeScript PosApi surface unchanged.
//   No transaction, sync, IndexedDB, receipt content, payments, scale, or
//   Classic Bluetooth logic changes.
// v2.11.29: WEBVIEW51-BRIDGE-ES5. Root-caused the long-standing Android 7 / CS10
//   "Uncaught SyntaxError: Unexpected token ( (index.html:54)". The app bundle was
//   never at fault — every emitted legacy chunk parses as ES5. The failure came
//   from Capacitor's own native-bridge.js, which the native shell injects INLINE
//   into index.html and which is ES2017 (`const convertFormData = async (...) =>`
//   at bridge line 47 → document line ~54). The inline script died mid-parse, so
//   window.Capacitor.Plugins was never fully published — the real reason plugin
//   calls kept returning UNIMPLEMENTED / empty errors. Fix: scripts/
//   build-legacy-bridge.mjs downlevels the bridge (Babel, target chrome 51 → no
//   async/await, no regenerator) into android/app/src/main/assets/native-bridge.js,
//   which overrides the Capacitor AAR asset; node_modules is untouched.
//   scripts/verify-es5.mjs is a build-time gate (acorn) over dist assets, inline
//   index.html scripts and the bridge, wired into vite.config.ts closeBundle.
//   Printer detection: PosApiPlugin.isReady() now runs on the POS worker thread
//   (it does a live JNI probe — running it on the UI thread caused skipped
//   frames), probes once instead of twice, re-runs a pending Lib_AppInit, and
//   returns { ready, state: ok|pending|failed, error } so the JS side can no
//   longer log an empty reason. PosApiHelper.getBCRService() is lazy and quiet
//   (CS10 firmware has no IBCRService; behaviour unchanged, log spam gone).
//   No transaction, sync, IndexedDB, receipt content, payments, device auth or
//   Classic Bluetooth logic changes.
export const APP_VERSION = '2.12.1'; // v2.12.1: Yetu webhook HTTP Basic auth + onboarding/troubleshooting guide
export const APP_VERSION_CODE = 177;

// Short slug embedded in the built APK filename (see android/app/build.gradle).
export const APP_FIX_TAG = 'webview51-bridge-es5';





