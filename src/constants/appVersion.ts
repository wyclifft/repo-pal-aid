// Shared app version constant — update here and in android/app/build.gradle
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
export const APP_VERSION = '2.10.107';
export const APP_VERSION_CODE = 128;
