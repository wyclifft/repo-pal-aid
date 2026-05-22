# Cumulative & Farmer Sync — Bug Audit

I audited `FarmerSyncDashboard.tsx`, `useIndexedDB.ts` (`getFarmerCumulative` / `updateFarmerCumulative` / `getUnsyncedWeightForFarmer` / `getFarmerTotalCumulative`), `useDataSync.ts` (post-sync refresh) and `cumulativeMonitor.ts`. Findings below, ranked by impact on cumulative accuracy.

---

## 🔴 BUG 1 — `DB_VERSION = 12` while installed browsers are at 14 (CRITICAL)

`src/hooks/useIndexedDB.ts:9` declares `DB_VERSION = 12`, but the current preview's IndexedDB is at version 14 (visible in console):

```
[DB] IndexedDB error: VersionError: The requested version (12) is less than the existing version (14)
```

Effect: `indexedDB.open` fails → `db` stays null → **every cumulative read/write silently no-ops**:
- `getFarmerCumulative` returns null → printed receipts show backend value only, never the live local additions
- `updateFarmerCumulative` is a no-op → post-sync refresh writes nothing → next offline session reads zero base
- `FarmerSyncDashboard` offline cache is empty → looks like no farmers have transactions
- `referenceGenerator` shares the same constant, so transaction-reference generation also fails

Same pattern affects any user who ever ran a build with version ≥13.

**Fix:** bump `DB_VERSION` to a value ≥ the highest ever shipped (15+ is safe), and ensure `onupgradeneeded` is idempotent for the existing `farmer_cumulative` schema (don't drop the store on every upgrade — only when migrating away from the legacy `farmer-month` keyPath).

---

## 🟠 BUG 2 — AI receipts (`transtype=3`) inflate unsynced cumulative

`useIndexedDB.getUnsyncedWeightForFarmer` (line 933) and `FarmerSyncDashboard.loadFromOfflineCache` (lines 233–234) only exclude **SELL** (`transtype === 2`) and `type === 'sale'`. **AI transactions** (`transtype === 3`, per the transaction-printing-routing memory) are still counted into the farmer's BUY cumulative.

Effect: any pending AI receipt for a farmer inflates their printed cumulative until the AI record syncs.

**Fix:** exclude `transtype === 3` in both filters (or invert: only count `transtype === 1`).

---

## 🟠 BUG 3 — Offline dashboard double-counts `localCount + unsyncedWeight`

`FarmerSyncDashboard.loadFromOfflineCache` (line 261):
```ts
const total = baseCount + localCount + unsyncedWeight;
```
All current writers call `updateFarmerCumulative(..., fromBackend=true)` which resets `localCount` to 0, so today this is silent. But any legacy row written by an older build (or a future caller using `fromBackend=false`) with a non-zero `localCount` will be **added on top of** the same unsynced receipts → double-count. This is a latent landmine.

**Fix:** drop `localCount` from the offline total (it's redundant with `unsyncedWeight`), or compute total as `baseCount + Math.max(localCount, unsyncedWeight)` if you want defence-in-depth.

---

## 🟡 BUG 4 — Post-sync refresh writes stale `cumulative_weight = 0`

`useDataSync.ts` line 448: `if (refreshResp.success && refreshResp.data)` — if the backend GET returns `success:true` but `cumulative_weight: 0` (because the just-POSTed row hasn't been committed/aggregated yet on the read replica), we overwrite the cached base with **0** and reset `localCount` to 0. The local receipt has already been deleted by then.

The 2-read transient guard in `cumulativeMonitor` suppresses the *log*, but the cache itself is still poisoned until the next refresh. A receipt printed in that window will show the wrong cumulative.

**Fix:** guard the write with `if (freshTotal >= existingBase)` (refuse to write a backend value that's strictly less than what we already had cached), or require `freshTotal > 0 || freshByProduct.length > 0` before accepting.

---

## 🟡 BUG 5 — `activeRoute` captured once per render in `FarmerSyncDashboard`

Line 62: `const activeRoute = getActiveRoute();` runs only on render. The dashboard doesn't subscribe to session/route changes, so changing factory in another tab/component while the dashboard is mounted shows stale data and queries the wrong cumulative key.

**Fix:** read `activeRoute` from a state hook that listens for `storage` / `session-changed` events, or recompute inside `loadData`.

---

## 🟡 BUG 6 — Month boundary loses unsynced previous-month receipts

`getFarmerCumulative` / `updateFarmerCumulative` build `month` from `new Date()` at call time. An unsynced receipt captured at 23:59 on the last day of the month becomes orphaned at 00:00 the next day: cached row is under the old month key, new-month query returns null, and the unsynced receipt's `collection_date` may also fail the `currentMonth` check in `getUnsyncedWeightForFarmer` (line 943).

**Fix:** when computing total, also probe the previous month's cache row if today is within the first 24 h of a new month, and include unsynced receipts dated within the last 7 days regardless of month.

---

## Scope of fix I'd recommend

Phase 1 (critical, unblocks everything): **Bug 1**.
Phase 2 (data accuracy): **Bug 2** and **Bug 4**.
Phase 3 (hardening): **Bugs 3, 5, 6**.

Each fix is small (1–2 file edits), version-bumpable independently, and keeps the existing receipt / sync / reference-generation contracts intact. Want me to implement Phase 1 + 2 now, or all six?
