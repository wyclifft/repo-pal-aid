# v2.12.6 — Contabo performance + Sacco/season fixes

One release, all six areas. No business-logic, reference-generation, sync-matrix or receipt-format changes.

## 1. Stop the repeated `/api/items` calls

Cause found in `src/components/ProductSelector.tsx`: `loadProducts` is a `useCallback` whose deps include `selectedProduct` and `onProductChange`. Selecting (or auto-selecting) a product changes the callback identity, the mount effect re-fires, another `/api/items` request goes out, which auto-selects again — a self-feeding loop. `Store.tsx` (invtype 05) and `AIPage.tsx` (invtype 06) share the pattern.

- Move `selectedProduct` / `onProductChange` into refs so `loadProducts` has stable identity; the effect keys only on `routeCode`.
- Add a request-level guard in `mysqlApi.items.getAll`: in-flight de-duplication per `(device, invtype)` plus a 5-minute memory cache, with `force` for explicit refreshes (data sync, pull-to-refresh).
- Backend `/api/items`: 60-second LRU cache per `(ccode, invtype)` using the existing `lib/lruCache.js`, and demote the `[ITEMS]` log to only fire on cache miss.

## 2. Coffee never runs session time validation

`SessionSelector.tsx` seeds `orgtype` from a localStorage snapshot, so before `psettings` resolves it treats a coffee org as dairy and hits the `time_from/time_to` branch, logging "Session time validation failed" and marking seasons inactive.

- Take `isCoffee` from `useAppSettings` (single source of truth) instead of the local snapshot.
- For coffee, validation is date-only: no `toHour`, no time comparison, no time text in the session labels/pills.
- `BuyProduceScreen`'s AM/PM derivation from `time_from` runs only for dairy (coffee already uses SCODE).
- `useSessionExpiration` already bypasses coffee — left unchanged.

## 3. Coffee type selector must never freeze

- `ProductSelector` paints from the IndexedDB cache synchronously and defers the network sync to after first paint (idle callback / timeout), so the dropdown is interactive immediately.
- The dropdown is disabled only when there is nothing to show — never merely because a background refresh is in flight (removes the flicker between "loading" and "loaded" states).
- Cumulative prewarm is scheduled after the Buy screen is interactive and yields between write batches, so it can't block the select.

## 4. Login initialisation under 2 seconds

Backend currently computes a season-wide scan for 2,114 farmers inside the request (totals 22 s, products 24 s, snapshot 35 s).

- Turn `/api/farmer-monthly-frequency-batch` into a cache-serving endpoint: a background warmer recomputes each active `(ccode, route, period)` snapshot on an interval and on demand, storing it in the existing LRU with a longer TTL.
- On a cache miss the endpoint returns immediately with `{ success: true, pending: true, farmers: [] }` and schedules the warm job — never a 20–35 s blocking response. The existing 503-under-pool-pressure path stays.
- Frontend keeps its IndexedDB cumulative cache when it sees `pending: true` (no zero-writes, no heal-down — the v2.11.0 guard is untouched) and retries with the existing backoff.
- Startup no longer awaits the cumulative batch: login renders, then the prewarm runs in the background.
- Add the supporting composite index on `transactions (ccode, transdate, memberno)` (plus route/icode) so the warm job itself finishes quickly.

## 5. `devsettings` NOT NULL safety

Every insert/update path that touches `devSettings` writes `'000'` instead of `NULL`/empty for `uniquedevcode` and `device` (device-registration insert at `server.js` ~3380 and the identity-resolve path).

## 6. Sacco portal + season selection

- Header title comes from `psettings` (company/portal name) instead of the hardcoded "Yetu Sacco Payments".
- Print button removed when `orgtype = 'S'`.
- Export writes a real file through the existing cross-platform `saveExportedFile` helper (works inside the Capacitor WebView, not just browser anchor download) and exports the full filtered result set, not just the visible page.
- Summary card 1 changes from "Total contributed" to "Today", backed by a new `today_total` field on the Sacco summary query.
- Coffee season switching offline: `SessionSelector`'s offline branch currently allows only the currently-active session. For coffee it will also allow any cached past season (future seasons stay blocked), using the seasons already stored in IndexedDB.
- Settings → Cumulative (`FarmerSyncDashboard`) passes the selected season to the cumulative endpoints, which accept an optional season/date-range parameter and fall back to the active season when absent — so a past season shows that season's totals.

## Technical notes

Files touched: `src/components/ProductSelector.tsx`, `src/pages/Store.tsx`, `src/pages/AIPage.tsx`, `src/services/mysqlApi.ts`, `src/components/SessionSelector.tsx`, `src/components/BuyProduceScreen.tsx`, `src/pages/Index.tsx`, `src/components/FarmerSyncDashboard.tsx`, `src/modules/sacco/SaccoPortal.tsx`, `src/modules/sacco/components/SummaryCards.tsx`, `src/modules/sacco/saccoApi.ts`, `backend-api/server.js`, `backend-api/yetuService.js`, plus a new SQL migration for the transactions index. Version bumped to v2.12.6 in `src/constants/appVersion.ts` and `android/app/build.gradle` (code 182) with changelog notes.

Backend changes are additive (new optional query params, caching, background warmer) so existing production clients keep working unchanged.
