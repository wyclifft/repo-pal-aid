## Goal

Make `FarmerSyncDashboard` honestly reflect the actual sync state on the device:

1. Show clearly when the device is **offline** (online/offline pill in the header).
2. **Disable Refresh** when offline or while a cumulative refresh is already running, with a tooltip-style hint explaining why.
3. Show a distinct **"Sync incomplete / interrupted"** indicator when the last refresh did not finish (network dropped mid-batch, cancelled, batch API failed and we fell back to offline cache, or background pass is still running).

Strictly UI/state in `src/components/FarmerSyncDashboard.tsx`. No sync engine, no backend, no IndexedDB schema, no receipt rendering changes.

---

## Changes (single file: `src/components/FarmerSyncDashboard.tsx`)

### 1. Online/offline awareness

- Add `isOnline` state initialised from `navigator.onLine`.
- Subscribe to `window` `online` / `offline` events in the existing `useEffect`; flip the state and trigger a single `loadData(false)` when transitioning back online (so the dashboard repopulates from the batch API automatically — matches the new v2.10.102 cumulative pre-warm behaviour).
- Header gets a small status pill next to the title:
  - online → `<Badge variant="outline">` green dot + "Online"
  - offline → `<Badge variant="destructive">` "Offline — using cached data"

### 2. Block refresh while offline OR sync running

- Track whether a cumulative refresh is currently running anywhere in the app. We already listen to `cumulative-sync-progress`; treat `bgProgress != null && bgProgress.current < bgProgress.total` as "sync running". Also expose `(window as any).__cumulativeSyncRunning` (already set elsewhere) by checking it in `handleRefreshClick`.
- The Refresh button is `disabled` when **any** of:
  - `isLoading` (already there)
  - `!isOnline`
  - `bgProgress` active OR `__cumulativeSyncRunning === true`
- Add a `title` attribute on the button explaining the reason (offline / sync in progress / loading) so the user gets a tooltip on long-press.
- Defensive guard inside `loadData(true)`: if `!navigator.onLine`, short-circuit with a toast-equivalent inline notice ("Cannot refresh while offline — showing cached data") and call `loadData(false)` instead of attempting the sync path. This protects against race conditions where the button was enabled at click time but the network dropped before the handler ran.

### 3. Track last-sync outcome (complete / incomplete / failed)

Add a small `lastSyncState` reducer-style state:

```ts
type LastSyncState =
  | { kind: 'idle' }
  | { kind: 'complete'; at: number; source: 'online' | 'offline-cache' }
  | { kind: 'incomplete'; at: number; reason: string }   // cancelled, partial, bg-running
  | { kind: 'failed'; at: number; reason: string };       // batch API failed → fell back to cache
```

Set it in `loadData`:
- `'complete' source: 'online'` when `loadFromBatchAPI` returned a non-null result AND `cancelledRef.current` is false.
- `'complete' source: 'offline-cache'` when offline path ran and finished without `cancelledRef`.
- `'failed'` when `navigator.onLine` was true but `loadFromBatchAPI` returned `null` (batch API failure → we fell back to offline cache while online; that IS an incomplete sync from the user's POV).
- `'incomplete'` when `cancelledRef.current` is true at the end (component unmounted / re-triggered mid-flight), OR when `bgProgress` was active at the moment loading finished.

Render below the summary stats grid:

- `complete + online` → green check row: `"Last refreshed Xs ago from server"` (relative time updated on each render).
- `complete + offline-cache` → muted info row with `CloudOff` icon: `"Last refreshed from offline cache · X ago"`.
- `failed` → amber `AlertTriangle` row: `"Last server refresh failed — showing cached data. Tap Refresh when online."`
- `incomplete` → amber `AlertTriangle` row: `"Sync did not complete — background cache pass still running"` (or `"… was interrupted"`).

Use semantic tokens (`text-destructive`, `text-primary`, `bg-amber-500/10 text-amber-600` via the existing token system — keep colour usage consistent with the rest of the dashboard).

### 4. Small wording / clarity fixes

- The summary "Cached" tile gets a sub-line `${cachedCount}/${totalCount}` so the user immediately sees coverage vs total without doing the math against the progress bar.
- When `bgProgress` is active, the header pill shows a small `"Cache sync in progress (Pass X/5)"` Badge so the in-flight pass is visible without expanding the existing card.

---

## Version bump

Workspace rule — bump on every change:

- `src/constants/appVersion.ts`: `APP_VERSION = '2.10.103'`, `APP_VERSION_CODE = 125`, plus changelog comment at top describing the dashboard clarity fix.
- `android/app/build.gradle`: `versionCode 125`, `versionName "2.10.103"`.
- `public/sw.js`: `CACHE_VERSION = 'v50'`.

---

## Explicitly NOT touched

- `backend-api/server.js` — no API changes
- `useIndexedDB.ts` — no schema migration
- `referenceGenerator.ts`, receipt rendering, sync engine, photo upload, auth, Bluetooth — untouched
- `src/pages/Index.tsx` — the v2.10.102 online pre-warm stays as is; this plan only consumes the same state, never overrides it

---

## Verification

1. **Offline cold open**: airplane mode → open `/dashboard` → header shows red "Offline — using cached data" pill, Refresh is disabled with title "Cannot refresh while offline", last-sync row shows `offline-cache` source.
2. **Online refresh while bg sync running**: trigger a manual refresh from `/`, then immediately open dashboard → Refresh is disabled, bg progress card is shown, last-sync row reads `"Sync did not complete — background cache pass still running"`.
3. **Batch API failure online**: simulate by killing the network mid-batch (or pointing the API at a wrong URL) → after fallback path runs, dashboard shows amber `"Last server refresh failed — showing cached data."`.
4. **Online → offline transition**: pull the cable while dashboard is open → pill flips to Offline within ~1s (event-driven), Refresh disables. Plug back in → pill flips to Online, `loadData(false)` runs once and pill updates to "Last refreshed Xs ago from server".
5. Regression suite (per workspace rules): confirm transaction creation, receipt printing, photo upload, farmers sync, items sync, reference generation, cumulative-on-receipt all unchanged.

Switch to build mode to apply.
