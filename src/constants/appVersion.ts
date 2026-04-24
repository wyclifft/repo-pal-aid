// Shared app version constant — update here and in android/app/build.gradle
// v2.10.65: Fix Classic BT printer state being cleared by spurious scale-side
//           connectionStateChanged events during Store/AI receipt printing on
//           integrated POS units that share a single BluetoothClassic plugin
//           instance across both roles. ROOT CAUSE: in bluetoothClassic.ts,
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
export const APP_VERSION = '2.10.66';
export const APP_VERSION_CODE = 88;
