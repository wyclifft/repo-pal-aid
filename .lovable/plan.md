## Goal

Three fixes in `/debug` and the cumulative monitor (v2.10.90 / Version Code 112):

1. Header action buttons (Refresh / Copy / Export / Clear) sit inside the safe area, are tap-friendly, and wrap responsively.
2. Export respects the active filters (level, tag, search, view) instead of dumping everything.
3. Cumulative regression detector stops false-positive `CUM:REGRESSION` rows when the change is a legitimate per-icode recontextualization.

No backend, IndexedDB schema, or sync behavior changes.

---

## 1. Debug Console header — `src/pages/DebugConsole.tsx`

Current header is a single row of icon-only buttons that clip on narrow viewports (726px and below) and sit under the OS status/safe area.

Changes:
- Wrap the sticky header in `pt-[env(safe-area-inset-top)] px-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]` so it never hides under the notch / status bar.
- Replace the single-row icon strip with a responsive two-row layout: title + Back on row 1, action buttons on row 2 (wrapping with `flex flex-wrap gap-2`).
- Make each action a real labelled button (`Refresh`, `Copy`, `Share`, `Clear`) with icon + text on ≥sm screens, icon-only on xs — minimum 44×44 px tap target.
- Rename the Download dropdown to **Share Logs** with sub-items `Share filtered (NDJSON)` and `Share filtered (CSV)`. The label communicates that this is an export/share action, not a bulk download.

## 2. Filter-aware export — `src/pages/DebugConsole.tsx` + `src/utils/persistentLogger.ts`

Problem: `plog.exportNDJSON()` / `plog.exportCSV()` ignore filters and always pull `limit: 10000` of every row.

Changes:
- Add `filter` parameter to both export methods:
  ```ts
  exportNDJSON(filter?: { level?; tag?; search?; limit?; pinnedOnly?; sinceTs?; untilTs? }): Promise<Blob>
  exportCSV(filter?: …): Promise<Blob>
  ```
  Both delegate to `plog.list(filter)`.
- In `DebugConsole.tsx`, build the active filter object from current UI state:
  - `view === "cumulative"` → tag prefix `CUM` (post-filter on the result since `list()` matches by exact tag) plus current level if set.
  - `view === "all"` → use `level`, `tag`, `search` exactly as displayed.
- Pass that object into the export methods so the file only contains visible rows. Append the active filter summary to the filename, e.g. `debug-logs-2026-05-20-error-CUM_RECALC.ndjson`.
- Toast text updates from "NDJSON exported" to `Shared N filtered entries`.

`plog.list()` already supports level/tag/search; no schema change needed. For the cumulative view's `tag.startsWith("CUM")`, do the prefix filter inside the export helper (read once, filter in memory, then serialize) — same approach already used to populate `cumRows`.

## 3. Eliminate false CUM:REGRESSION — `src/utils/cumulativeMonitor.ts` + `src/hooks/useIndexedDB.ts`

Root cause: `observeBaseChange` compares two scalar `baseCount` totals for a `farmer+route+month` key. When the backend recomputes totals after an admin reassigned a transaction's `ccode` (or split it by `icode`), the route-level total can legitimately drop because some weight now belongs to a different company/icode bucket. Today this fires a pinned `CUM:REGRESSION`.

Changes:

a) **Pass the per-icode breakdown into the monitor.** In `updateFarmerCumulative` (line 868), call:
   ```ts
   observeBaseChange(existing?.baseCount, count, {
     farmerId: cleanId,
     route: routeKey,
     source: 'backend',
     prevByProduct: existing?.byProduct,
     nextByProduct: byProduct,
   });
   ```

b) **Re-classify in `cumulativeMonitor.ts`:**
   - Build a comparable shape: `{ icode → weight }` for both `prev` and `next`.
   - Compute `commonDelta` = sum over icodes present in BOTH maps of `next - prev`.
   - Decision table:
     - `next >= before` → silent (current behavior).
     - `next < before` AND the icode set differs (icode added/removed) AND `commonDelta >= 0` → emit `CUM:RECONTEXT` (info, **not** pinned, not error). Message: `${farmerId} route=${route} re-bucketed: dropped icodes [X], added [Y]`.
     - `next < before` AND icode sets match AND `commonDelta < 0` → real regression → emit `CUM:REGRESSION` (pinned, error) as today, with the per-icode diff included in `data` for diagnosis.
     - `next < before` AND breakdown unavailable on one side → downgrade to `CUM:REGRESSION?` warn (not pinned) so it shows up but doesn't pollute the Pinned Regressions panel.
   - Update `classifyRegression()` to return the actual cause when the diff is conclusive (`ccode-reassignment`, `icode-split`, `manual-edit`, etc.).

c) **Cumulative tab labels** in `DebugConsole.tsx`: include `CUM:RECONTEXT` in the events list and add a small counter ("N recontextualized") next to the existing 24h badges so the activity is visible without alarming the user.

No change to fingerprint tracking (`recordRowFingerprint`) — it stays as a complementary signal.

## 4. Versioning

- `APP_VERSION` → `2.10.90`
- `APP_VERSION_CODE` → `112`
- `CACHE_VERSION` → `v37` (service worker)

## Files touched

- `src/pages/DebugConsole.tsx` — header layout + safe area + filter-aware Share action + recontext counter
- `src/utils/persistentLogger.ts` — accept filter in `exportNDJSON`/`exportCSV`
- `src/utils/cumulativeMonitor.ts` — byProduct-aware classifier, new `CUM:RECONTEXT` tag
- `src/hooks/useIndexedDB.ts` — pass `prevByProduct` / `nextByProduct` into `observeBaseChange`
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — version bumps

## Verification

- Resize preview to 320×568 and confirm all four header actions are tappable and on-screen.
- In `/debug`, filter `level=error` + `tag=CUM:RECALC` and tap **Share Logs → NDJSON**; confirm the file only contains rows matching those filters.
- Force a backend baseCount drop with a known icode bucket shift; confirm a `CUM:RECONTEXT` row appears in Cumulative tab and the Pinned Regressions panel does NOT add a row.
- Force a real same-icode drop; confirm a `CUM:REGRESSION` row still appears pinned.
