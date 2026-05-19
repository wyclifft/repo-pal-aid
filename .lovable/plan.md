# Cumulative refresh is firing far too often — throttle & coalesce

## What's happening today (root cause)

`src/pages/Index.tsx` has two effects driving cumulative sync against the backend batch API:

1. **Pre-fetch effect (lines 400–590)** — runs on mount and **re-runs whenever `selectedRouteCode` changes**, refetching all ~3,000+ farmers.
2. **Refresh effect (lines 261–395)** — registers four triggers:
   - `syncComplete` window event → full batch refresh (3s delay)
   - `visibilitychange` → full batch refresh on every tab focus (no debounce)
   - `setInterval` every **3 minutes** → full batch refresh
   - Its `useEffect` dependency array includes **`selectedFarmer` and `selectedProduct`**, so picking a different farmer or product **tears down and re-installs all four listeners + the 3-min interval restarts from zero**.

On top of that, `syncComplete` is dispatched from **many** places (`useDataSync.ts` lines 640, 652, 865; `Index.tsx` lines 1206, 1338, 1359; `FarmerSyncDashboard.tsx`). Every single saved/synced receipt currently triggers a 3,000-farmer batch refresh. That's the real noise source.

Net effect when a user is online and working:
- Save a receipt → batch refresh
- Background sync flushes 5 records → 5× batch refreshes (queued)
- Switch farmer → effect re-mounts, interval resets, often an immediate refresh
- Tab loses/regains focus → another full refresh
- Plus the 3-min metronome

## The fix (frontend only, no business-logic change)

All changes confined to `src/pages/Index.tsx` + small helper. Math, IndexedDB writes, monitor logging, and floor guard stay exactly as-is.

### 1. Add a single shared throttle gate
Module-level `lastCumulativeRefreshAt: number` and `MIN_REFRESH_GAP_MS = 60_000`. `refreshCumulativesBatch(reason)` skips (logs `CUM:THROTTLED reason=…`) when called within 60 s of the previous successful run — **except** `reason === 'post-sync'` and `reason === 'manual'`, which are allowed but still coalesced through the existing in-flight queue.

### 2. Stop re-mounting the effect on farmer/product changes
Remove `selectedFarmer`, `selectedProduct`, `getUnsyncedWeightForFarmer`, `getFarmerCumulative` from the refresh effect's dependency array. Read them through `useRef` mirrors that the effect's inner closure consults. Effect now only re-installs when `deviceFingerprint`, `selectedRouteCode`, or `showCumulative` changes.

### 3. Coalesce `syncComplete` storms
Replace the bare `setTimeout(... , 3000)` with a **trailing-edge debounce of 5 s**: rapid syncComplete bursts (record-by-record flushes) collapse into one refresh after the burst ends. The existing in-flight/pending guard stays as a second line of defense.

### 4. Visibility refresh — only when stale
Only run on `visibilitychange` if `Date.now() - lastCumulativeRefreshAt > 2 * 60_000`. Otherwise skip silently.

### 5. Periodic interval: 3 min → 10 min
Detecting external DB edits doesn't need 3-min resolution; 10 min matches the regression-monitor cadence and cuts background API load by ~70 %.

### 6. Pre-fetch effect: don't re-run on route change alone
Keep the route in the dependency array (we still need a route-scoped refresh), but skip the pre-fetch body if a successful refresh ran in the last 60 s (`lastCumulativeRefreshAt` gate). The selected-farmer refresh path already handles the route switch.

### 7. Optional `syncComplete` payload respect
Where dispatch sites already know the synced count (`useDataSync.ts`), pass `{ detail: { synced: n } }`. The listener skips the refresh entirely when `synced === 0`. Non-breaking — undefined `detail` keeps current behaviour.

## Expected outcome

| Scenario | Before | After |
|---|---|---|
| Save 1 receipt | 1 full batch refresh | 0 (waits for debounce) |
| Background sync flushes 8 records | 8 batch refreshes queued | 1 batch refresh |
| User switches farmer 10× | 10 effect re-mounts + possible refreshes | 0 extra refreshes |
| Tab focus 5× in 10 min | 5 full refreshes | 1 |
| Idle 1 hr online | 20 periodic refreshes | 6 |

API hits to `getMonthlyFrequencyBatch` drop by ~80–90 % during active use. Cumulative numbers stay correct because the post-sync path still fires (just debounced), and the 10-min periodic + visibility-when-stale paths still catch external edits within minutes.

## Verification

- `/debug` → Cumulative tab: look for new `CUM:THROTTLED` entries and confirm `CUM:SYNC` row count drops dramatically during a save-heavy session.
- Save 5 receipts back-to-back → exactly one `CUM:SYNC` row written ~5 s after the last save.
- Switch selected farmer 20 times → no `CUM:SYNC` row written.
- Toggle airplane mode off → one pre-fetch `CUM:SYNC` row, no duplicate within the next 60 s.

## Files touched

- `src/pages/Index.tsx` — both effects (refresh + pre-fetch), no logic change to `updateFarmerCumulative` or `getFarmerCumulative`.
- `src/hooks/useDataSync.ts` — optional: add `{ detail: { synced } }` to the 3 `syncComplete` dispatches.
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — bump to **v2.10.89 / versionCode 111 / SW v36**.

No backend, IndexedDB schema, or RLS changes. No new tables. Production-safe: every change is a throttle/debounce; correctness paths are unchanged.
