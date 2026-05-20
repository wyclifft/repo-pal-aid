# Fix: Debug Console Delete deletes all logs instead of filtered logs

## Root cause
`src/pages/DebugConsole.tsx` → `onClear()` calls `plog.clear()` unconditionally. `plog.clear()` in `src/utils/persistentLogger.ts` truncates the entire `logs` object store, ignoring the level / tag / search / view (CUM) filters shown on screen. So filtering by `ERROR` + `CUM:RECALC` then pressing Delete wipes everything — same root cause family as the earlier Download-all bug.

## Fix

### 1. `src/utils/persistentLogger.ts` — add filtered delete
Add a new method on the `plog` API:

```ts
async deleteFiltered(filter?: {
  level?: LogLevel;
  tag?: string;
  search?: string;
  tagPrefix?: string;
  includePinned?: boolean; // default false — pinned rows survive unless explicit
}): Promise<number>
```

Behavior:
- Open a `readwrite` cursor on the `ts` index.
- For each row, apply the same matching logic used by `plog.list` (level, tag exact, search substring against message/data/tag) plus optional `tagPrefix` (matches the Cumulative tab's `tag.startsWith("CUM")`).
- Skip rows with `pinned === 1` unless `includePinned` is true.
- `cur.delete()` matched rows, count removed, return count.
- Never throw — swallow errors and return count so far (consistent with the rest of the logger).
- If `filter` is undefined / empty AND `includePinned` is true → fall through to existing `plog.clear()` for speed.

Keep the existing `plog.clear()` untouched so any other caller is unaffected.

### 2. `src/pages/DebugConsole.tsx` — wire Delete to active filters
- Reuse `buildActiveFilter()` (already used by Share) to derive the filter — guarantees Delete and Download stay in sync.
- Detect "no filters" = `level === "all" && !tag && !search && view !== "cumulative"`.
- New `onClear` flow:
  - If no filters active → confirm "Clear ALL debug logs? This cannot be undone." → `plog.clear()` → toast "All debug logs cleared".
  - If filters active → confirm `Delete the N filtered entries? Pinned rows are preserved.` (N = `rows.length` for normal view, `cumRows.length` for Cumulative view) → `plog.deleteFiltered({ ...buildActiveFilter(), includePinned: false })` → toast `Deleted X filtered entries`.
- Always `await reload()` after.
- No change to button placement / styling.

### 3. Version bump (workspace rule)
- `src/constants/appVersion.ts`: `APP_VERSION` → `2.10.92`, `APP_VERSION_CODE` → `114`.
- `android/app/build.gradle`: `versionCode 114`, `versionName "2.10.92"`.
- `public/sw.js`: bump `CACHE_VERSION` → `v39` and the version string banner.

## Files touched
- `src/utils/persistentLogger.ts` (additive)
- `src/pages/DebugConsole.tsx` (onClear only)
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`

## Out of scope (not requested)
- Pinned-row UX toggle ("also delete pinned"). Default behavior preserves pinned `CUM:REGRESSION` evidence, matching v2.10.88 retention policy.
- No backend, sync, IndexedDB schema, or cumulative-logic changes.

## Verification
1. Set Type=ERROR + Category(tag)=CUM:RECALC → press Delete → only those rows disappear; other levels/tags intact; pinned regressions intact.
2. Cumulative tab → Delete → only CUM:* rows removed.
3. Clear all filters + All tab → Delete → confirm wording says "ALL"; full clear works.
4. Toast counts match what was visible.
5. App build OK, no console errors, transactions/sync/receipts unaffected (no touched code paths).
