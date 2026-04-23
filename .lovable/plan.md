

## Make Capacitor Farmer Sync Dashboard match Web behaviour — v2.10.62

### What you're seeing

- **Web app (correct):** the "Farmer Sync Status" card on Settings shows **only farmers who have transactions this period**, and the route filter strictly narrows them to the selected center.
- **Capacitor (wrong):** the same card lists **every cached farmer** (with or without weight) and the route filter is partial or returns nothing.

### Root cause

`src/components/FarmerSyncDashboard.tsx` has two data paths:

1. **Online path — `loadFromBatchAPI`** (lines 95-152) calls `/api/farmer-monthly-frequency-batch`, which `GROUP BY memberno` over the `transactions` table. It returns **only farmers with weights** and applies `TRIM(route) = TRIM(?)` server-side. This is the web behaviour.
2. **Offline fallback — `loadFromOfflineCache`** (lines 157-206) reads the **entire `cm_members` IndexedDB store**, optionally filtering by `f.route.trim() === activeRoute`. This includes **all farmers regardless of transactions**, and the route filter is fragile because `cm_members.route` doesn't always match the active route exactly (legacy whitespace / member moved between centers / coffee farmers with no fixed route).

The dashboard falls into path #2 when path #1 returns `null`. On the production Capacitor app, path #1 is failing silently — most likely causes:

- Capacitor's native HTTP bridge / legacy WebView 52 occasionally trips a 503 / proxy error on this single GET, even when other requests succeed (covered by `legacy-android-native-http-bridge` and `network-request-resilience` memories — but `getMonthlyFrequencyBatch` doesn't yet use the resilient retry).
- `apiRequest` returns `{ success: false }` on any 5xx, AbortError, or JSON parse hiccup → `loadFromBatchAPI` returns `null` → fallback path runs → the user sees the "all farmers, broken filter" view.

The web app rarely hits this fallback because it has no proxy bridge between the browser and the API.

### Fix — three small, additive changes

#### 1. `src/components/FarmerSyncDashboard.tsx` — make the offline fallback transaction-driven

Stop showing every cached `cm_members` row. Instead, derive the offline farmer list from **what we actually have evidence of transactions for**:

- Read every key from the `farmer_cumulative` IndexedDB object store (this store is populated by the batch cumulative cache refresh; each entry has `baseCount + localCount > 0` only if there are transactions).
- Read all unsynced receipts from IndexedDB and union those farmer IDs in (so just-captured offline deliveries appear immediately).
- Drop any farmer whose `(baseCount + localCount)` is `0` AND has no unsynced receipts.
- Hydrate display name and route from the existing `cm_members` cache via the existing `nameLookup` map.
- Apply the route filter using the **same precedence the online path uses**: prefer `cm_members.route`, but if the cumulative entry was recorded under the active route (we'll start tagging it — see #2), trust that.

Behaviour after this change:
- Capacitor offline → only shows farmers with cached weights or pending receipts (matches web).
- Capacitor online → unchanged (still uses the batch API).
- Web → unchanged (rarely needs the fallback at all).

#### 2. `src/components/FarmerSyncDashboard.tsx` — add resilient retry to the online path

Wrap the `getMonthlyFrequencyBatch` call in a small retry (1 retry, 2-second back-off) **only when running on Capacitor** (`Capacitor.isNativePlatform()`). This pushes the Capacitor app onto the same code path as the web app whenever the network is genuinely available — so the user sees the correct "transaction-driven" view almost every time, and the fallback only triggers when the device is truly offline.

No new endpoint, no backend change.

#### 3. `src/components/FarmerSyncDashboard.tsx` — tighten the route filter on both paths

- Online path: already correct (server-side `TRIM(route) = TRIM(?)`). Keep.
- Offline path: when an `activeRoute` is set, filter the union list by `nameLookup.get(farmer_id)?.route.trim() === activeRoute.trim()`. If `cm_members` doesn't have that farmer (rare), include them anyway so transactions are never silently hidden — but tag them with route `'N/A'` in the row so the operator can see the gap.

This stops the "partial / empty" route filter symptom on Capacitor.

### What does NOT change

- `backend-api/server.js` — untouched (the endpoint already does the right thing).
- `useIndexedDB.ts` — schema, key paths, `farmer_cumulative` store all untouched.
- `useDataSync.ts`, `useSessionBlacklist.ts`, capture/submit/print/photo audit — untouched.
- Reference generator, `transrefno`/`uploadrefno`/`reference_no` mapping — untouched.
- `multOpt=0` blocking and `DuplicateDeliveryDialog` (v2.10.61) — untouched.
- The Buy/Sell capture screens — untouched. This change is **only** in the Settings → Farmer Sync Status card.

### Files Touched

| File | Change |
|---|---|
| `src/components/FarmerSyncDashboard.tsx` | Rewrite `loadFromOfflineCache` to be transaction-driven (union of `farmer_cumulative` keys + unsynced receipt farmer IDs, hydrated via `nameLookup`); add 1-retry/2s back-off to the online batch call when on Capacitor; tighten route filter for the offline path |
| `src/constants/appVersion.ts` | Bump to **v2.10.62** (Code **84**) + changelog comment *"v2.10.62 — Farmer Sync Status: Capacitor offline list is now transaction-driven and route-filtered to match the web app."* |
| `android/app/build.gradle` | `versionName "2.10.62"`, `versionCode 84` |

### Verification Checklist

1. **Capacitor, online, no route selected** → list matches web exactly: only farmers with weight this month/season. ✓
2. **Capacitor, online, route `R03` selected** → list narrows to farmers with weight on `R03` only (server-side filter). ✓
3. **Capacitor, online, intermittent batch-API failure** → retry succeeds, list still matches web. ✓
4. **Capacitor, fully offline** → list shows only farmers with cached cumulatives or pending receipts (no zero-weight `cm_members` rows). Route filter narrows correctly. ✓
5. **Capacitor, fully offline, just captured a delivery for a brand-new farmer** → that farmer appears immediately in the list with `localCount > 0`. ✓
6. **Web app** → unchanged, identical look and content as today. ✓
7. Settings page renders, Refresh button works, search input still filters, "Show more" pagination still works. ✓
8. No new console errors. Buy/Sell capture, sync engine, multOpt=0 modal, receipts, photo audit, Z-Reports, periodic reports all unchanged. ✓

### Out of scope

- Adding a "show all cached farmers" toggle — operators have asked for the transaction-driven view; we keep one mode.
- Exposing the cumulative period range (month vs season) in the card UI — already shown via `CardDescription`.
- Backend changes to `farmer-monthly-frequency-batch` — not needed.

