# Diagnosis (no code changes) + Fix: farmer-load boot race

## Part 1 — Diagnosis only: sync stuck on A700000540 / A700000541

### What the log shows
At 10:34:43–:45 the device tried to push two offline receipts for farmer **M00007**:

| transrefno  | local weight | backend response                                  | verify GET (remote) | result               |
|-------------|--------------|----------------------------------------------------|---------------------|----------------------|
| A700000540  | 1 kg         | `success:true, uploadrefno=A700000440, "Collection created"` | weight = **10**     | Verification pending |
| A700000541  | 1 kg         | `success:true, uploadrefno=A700000441, "Collection created"` | weight = **8**      | Verification pending |

Outcome: `[SYNC] Sync complete: 0 synced, 2 failed out of 2`. The frontend correctly refused to delete the local rows (per the **No Trust on 404 Verify** memory). Both receipts will retry forever on every sync cycle.

### Root cause
The `transrefno` values **A700000540 / A700000541 were already in use** on the backend for M00007 with weights 10 and 8 (likely from another device sharing devcode prefix `A7`, or an earlier session whose local trnid was not advanced). Because both receipts were created while the device was **offline** (line 38: `📡 Network offline`), the v2.10.70 backend `GREATEST(devsettings.trnid, MAX(transrefno))` self-heal on `/api/devices/fingerprint/:fp` had no opportunity to bump the local counter before the receipt got its ref. The collision-retry path in v2.10.70 only runs on `REFERENCE_COLLISION`; here the backend instead returned `success:true` for the second insert (likely because backend dedup keys differ — note the `uploadrefno` is 100 less than `transrefno`, suggesting two distinct counters), so the frontend never entered the retry branch and fell into the verify-mismatch limbo instead.

### Why this is not actioned now
User chose "Just analyze — don't change code yet." Backend-side dedup/idempotency behavior (`server.js` insert path returning `success:true` for what the verify GET considers a different record) needs inspection before any client-side reissue logic is changed. Quarantine-or-reissue can be planned in a follow-up.

### Suggested next-step investigation (for later, not now)
1. Inspect `backend-api/server.js` `/api/milk-collection` insert path — under what conditions does it return `success:true` when the `transrefno` already exists with a different weight/farmer? Does it UPDATE-on-conflict (bug), or INSERT-IGNORE (returns success but leaves the row untouched — likely culprit), or does it generate a new ref?
2. Confirm whether `uploadrefno = transrefno − 100` is intentional or a sign the backend re-issued a different ref the client never adopted.
3. Decide on one of the three policies offered: reissue+retry, quarantine, or quarantine+manual reissue.

### Secondary noise (informational, no fix)
- Network flapped offline→online 3× in 1 min — real connectivity, not a bug.
- `[BT][scale] network online` + `[NET] online` + `[SYNC] No pending` triplet fires on every online event. Dedupe window is 2 s; these are >2 s apart so they aren't collapsed. Acceptable.

---

## Part 2 — Fix: "Failed to load farmers: DB not ready" boot race

### Symptom
4 occurrences in this 4-minute log (lines 40, 42, 81, 93). Each is a render-time `getFarmers()` call firing before the IndexedDB connection has finished opening.

### Root cause
`useIndexedDB()` exposes `isReady` (set to `true` only after `openDB().onsuccess`), but **not all callers gate on it**:

| File                              | Uses `isReady` today? | Calls `getFarmers()` on mount |
|-----------------------------------|-----------------------|-------------------------------|
| `src/components/BuyProduceScreen.tsx` | ❌ no                  | yes (line 161)                |
| `src/components/SellProduceScreen.tsx`| ❌ no                  | yes (line 152)                |
| `src/pages/AIPage.tsx`             | ✅ yes (destructured) but **not in deps** of loadFarmers effect | yes |
| `src/pages/Store.tsx`              | ✅ yes (destructured) but **not in deps** of loadFarmers effect | yes |

The "ready" callers simply forgot to wire `isReady` into the effect that calls `loadFarmers`. The other two never asked for it.

### Fix (minimal, isolated, frontend-only)
For each of the 4 files:
1. Destructure `isReady` from `useIndexedDB()` (already done in 2 of 4; add it to Buy/Sell).
2. Inside the `loadFarmers` effect, return early when `!isReady`.
3. Add `isReady` to the effect's dependency array so the load runs once IndexedDB opens.

Pseudocode (applied per-file):
```ts
const { getFarmers, isReady } = useIndexedDB();

useEffect(() => {
  if (!isReady) return;          // ← new gate
  const loadFarmers = async () => { … };
  loadFarmers();
}, [isReady, getFarmers, /* existing deps */]);
```

No behavioral change once IDB is ready (effect still runs exactly once for the same dep set). Eliminates the early-render reject path that produced the error logs.

### Version bump (workspace rule)
- `src/constants/appVersion.ts`: `APP_VERSION` → `2.10.93`, `APP_VERSION_CODE` → `115`.
- `android/app/build.gradle`: `versionCode 115`, `versionName "2.10.93"`.
- `public/sw.js`: `CACHE_VERSION` → `v40`.

### Files touched
- `src/components/BuyProduceScreen.tsx`
- `src/components/SellProduceScreen.tsx`
- `src/pages/AIPage.tsx`
- `src/pages/Store.tsx`
- `src/constants/appVersion.ts`
- `android/app/build.gradle`
- `public/sw.js`

### Out of scope (per user direction)
- Sync verify-mismatch quarantine / reissue — diagnosis only, no code change.
- BT/online log noise reduction — acceptable as-is.
- IndexedDB schema, sync engine, reference generator, backend, auth — untouched.

### Verification
1. App boot: no `Failed to load farmers: DB not ready` lines in `/debug` during cold start.
2. Buy/Sell/Store/AI screens still load farmers correctly after IDB opens.
3. Offline-first behavior unchanged (gate only blocks until `isReady`, never times out).
4. App builds clean; no other console errors introduced.
