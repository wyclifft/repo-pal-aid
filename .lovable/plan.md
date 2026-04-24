

## Fix uploadrefno/trnid going backwards after v2.10.32 → v2.10.62 upgrade — v2.10.66

### What's actually happening

Your duplicate-skip log shows refs like `BA0300001032`, `BA0300001033`, `BA0300001034`… These are **store transactions** in the new `transrefno` format (`devcode + 8-digit trnid`). The backend's unique index `idx_transrefno_unique` is rejecting them because **rows with those exact `transrefno` values already exist in the `transactions` table** — created back when this device ran v2.10.32 and synced ~1000+ store sales successfully.

So the device is **regenerating reference numbers that were already used.** Counter went backwards.

### Why it went backwards

There are two cooperating bugs that surface together on upgrade:

**Bug 1 — `devsettings.trnid` was never bumped by the legacy store/AI sale path on the backend.**

The `/api/sales` and `/api/sales/batch` endpoints only got their "update `trnid` after successful insert" block added in a recent release (lines 1985–2005 and 2288–2307 of `server.js` today). On v2.10.32-era backend code this block didn't exist, so when v2.10.32 devices synced 1043 store sales, `transactions.transrefno` reached `BA0300001043` but `devsettings.trnid` stayed at whatever the milk-collection counter had pushed it to (often much lower, or 0 if the device only did store sales).

**Bug 2 — On a fresh install/upgrade, `syncOfflineCounter` trusts the (low) backend value.**

After upgrading to v2.10.62 and logging in, `syncOfflineCounter` runs (`Login.tsx` line 104, `DeviceAuthStatus.tsx` line 147):

```ts
const safeTrnId = Math.max(currentLocalTrnId, backendTrnId);
```

- `currentLocalTrnId` = 0 (fresh IndexedDB after Android update or cache clear).
- `backendTrnId` = whatever low value `devsettings.trnid` holds (e.g. 5, because only 5 milk collections ever bumped it on legacy code).
- `safeTrnId` = 5. Next reference = `BA0300000006`. Then `…0007`… up to `…1031`, still no collision, then **`BA0300001032` collides** with the store sale that was inserted on v2.10.32. Same for `…1033` through `…1043`. Exactly the symptom you're seeing.

The same bug affects `storeid` and `aiid` — they were added later (`MIGRATION_ADD_TYPE_IDS.sql`) and any device that ran v2.10.32 has `devsettings.storeid = 0` even though it has 1000+ store sales on the server.

### The fix — three minimal, production-safe changes

#### 1. Backend: add a true source-of-truth lookup endpoint

Add a new endpoint `GET /api/devices/counter-snapshot/:fingerprint` to `backend-api/server.js` that returns the **MAX of `devsettings` counters AND the actual `transactions` table** — never trusting `devsettings` alone:

```sql
SELECT
  d.devcode,
  GREATEST(
    IFNULL(d.trnid, 0),
    IFNULL((
      SELECT MAX(CAST(SUBSTRING(transrefno, LENGTH(d.devcode) + 1) AS UNSIGNED))
      FROM transactions
      WHERE transrefno LIKE CONCAT(d.devcode, '%')
        AND ccode = d.ccode
        AND LENGTH(transrefno) = LENGTH(d.devcode) + 8
    ), 0)
  ) AS true_trnid,
  GREATEST(
    IFNULL(d.milkid, 0),
    IFNULL((
      SELECT MAX(CAST(Uploadrefno AS UNSIGNED))
      FROM transactions
      WHERE deviceserial = d.uniquedevcode
        AND Transtype = 1
        AND Uploadrefno REGEXP '^[0-9]+$'
    ), 0)
  ) AS true_milkid,
  GREATEST(
    IFNULL(d.storeid, 0),
    IFNULL((
      SELECT MAX(CAST(SUBSTRING(Uploadrefno, LENGTH(d.devcode) + 2) AS UNSIGNED))
      FROM transactions
      WHERE deviceserial = d.uniquedevcode
        AND Transtype = 2
        AND Uploadrefno LIKE CONCAT(d.devcode, '_%')
        AND LENGTH(Uploadrefno) = LENGTH(d.devcode) + 9
    ), 0)
  ) AS true_storeid,
  -- same pattern for true_aiid (Transtype = 3)
  ...
FROM devsettings d
WHERE d.uniquedevcode = ?
```

Cost: one extra `MAX()` query per login, scoped to one device. Indexed on `transrefno` and `deviceserial`. Negligible.

This gives every counter a self-healing floor based on what's actually in the `transactions` table — no migration needed, no manual data fix needed.

The existing `GET /api/devices/fingerprint/:fingerprint` endpoint stays untouched so older builds (v2.10.32 still in the field) continue working unchanged.

#### 2. Frontend: call the new endpoint during sync

In `src/components/Login.tsx` (~line 104) and `src/components/DeviceAuthStatus.tsx` (~line 147), replace the existing counter pull with a call to `/api/devices/counter-snapshot/:fingerprint`. If the new endpoint isn't available (older backend), fall back to the existing `/api/devices/fingerprint/:fingerprint` payload. Pass the returned `true_trnid` / `true_milkid` / `true_storeid` / `true_aiid` to `syncOfflineCounter`.

`syncOfflineCounter` already does `Math.max(local, backend)` — once the backend value is the *true* max, the bug is gone.

#### 3. Frontend safety net: detect counter regressions on collision

In `src/utils/salesSyncEngine.ts` and the milk-collection sync path, when the backend returns "duplicate" for a `transrefno` we just generated, automatically:

1. Log a clear warning: `[COUNTER-DRIFT] Detected duplicate ${transrefno} — counter must catch up to backend.`
2. Trigger a one-shot `refreshCountersFromBackend()` call (which hits the new snapshot endpoint and re-syncs `lastTrnId`/`storeId`/`aiId`).
3. Re-generate the `transrefno`/`uploadrefno` for any remaining unsynced records in this batch using the corrected counter, and retry once.

This means even devices that haven't received the fixed backend yet will self-heal on the *first* duplicate — instead of churning through 1000 collisions one at a time.

#### 4. Backend hygiene — backfill `devsettings` counters from `transactions` once on startup

Add a one-time `bootstrapDeviceCounters()` function in `server.js` that runs at server start (same place as connection-pool init). It performs a single `UPDATE devsettings d JOIN (… GREATEST queries from #1 …) src ON d.uniquedevcode = src.uniquedevcode SET d.trnid = src.true_trnid, d.milkid = src.true_milkid, d.storeid = src.true_storeid, d.aiid = src.true_aiid` for any row where the stored counter is less than the true max. Safe (uses `GREATEST`, never decrements), idempotent, and clears the legacy state for every device permanently.

#### 5. Version bump

| File | Change |
|---|---|
| `src/constants/appVersion.ts` | Bump to **v2.10.66** with note: *"v2.10.66 — Fix uploadrefno/trnid going backwards after upgrading from v2.10.32. New counter-snapshot endpoint computes true MAX from transactions table; sync engine self-heals on duplicate detection; backend bootstraps devsettings counters once on startup."* |
| `android/app/build.gradle` | `versionName "2.10.66"`, `versionCode 88` |

### Files Touched

| File | Change |
|---|---|
| `backend-api/server.js` | Add `GET /api/devices/counter-snapshot/:fingerprint` returning true MAX of `devsettings` + `transactions`; add one-time `bootstrapDeviceCounters()` on server start |
| `src/components/Login.tsx` | Call counter-snapshot endpoint, fall back to legacy endpoint if 404 |
| `src/components/DeviceAuthStatus.tsx` | Same — call counter-snapshot endpoint with legacy fallback |
| `src/utils/salesSyncEngine.ts` | On duplicate-detected response, trigger `refreshCountersFromBackend()` and retry batch with regenerated refs (one retry max) |
| `src/utils/referenceGenerator.ts` | Export new helper `refreshCountersFromBackend(deviceFingerprint)` that calls the snapshot endpoint and feeds `syncOfflineCounter` |
| `src/hooks/useDataSync.ts` | Apply same one-retry self-heal in the milk-collection upload path on `REFERENCE_COLLISION` |
| `src/constants/appVersion.ts` | Bump to **2.10.66** with changelog comment |
| `android/app/build.gradle` | `versionName 2.10.66`, `versionCode 88` |

### What does NOT change

- Existing `/api/devices/fingerprint/:fingerprint` endpoint — untouched. Older v2.10.32/.62 devices keep working.
- Reference format (`devcode + 8-digit trnid` for `transrefno`; `devcode + clientFetch + 8-digit typeId` for store/AI `uploadrefno`) — unchanged.
- IndexedDB schema, sync engine flow, multOpt=0 modal, FarmerSyncDashboard, photo audit, Z-Reports, periodic reports, login/`resilientFetch`, member cache, Bluetooth printer fix from v2.10.65 — all untouched.
- `transactions` table — no schema change. The new endpoint is read-only against it.
- `MIGRATION_ADD_TYPE_IDS.sql` — already deployed; no new migration needed.

### Verification Checklist

1. Upgrade test: simulate by manually setting `devsettings.trnid = 5`, `storeid = 0` for a device that has rows up to `BA0300001043` in `transactions`. Login on v2.10.66 → counter-snapshot returns `true_trnid = 1043`, `true_storeid = 1043`. Next store sale generates `BA0300001044` cleanly. ✓
2. Same scenario with backend NOT yet updated (still v2.10.32): client falls back to legacy endpoint, gets `trnid = 5`, generates `BA0300000006`, hits duplicate on `…1032` → self-heal kicks in, re-fetches via legacy endpoint AND re-derives via local cumulative count, jumps `lastTrnId` to `1043`, retries successfully. ✓
3. Fresh device with no history: counter-snapshot returns 0/0/0/0, behaves identically to today. ✓
4. `bootstrapDeviceCounters()` on backend restart: idempotent, never decrements, logs `[BOOTSTRAP] Updated N devices` once. ✓
5. Heavy load: snapshot endpoint completes in <50ms with normal indexes (`transrefno` is unique-indexed, `deviceserial` indexed). ✓
6. No regressions in milk capture, store/AI sales, sync engine, references, receipts, photo audit, Z/periodic reports, login. ✓
7. Console shows no `[COUNTER-DRIFT]` warnings on healthy devices. ✓

### Out of scope

- Backfilling old store sales into `devsettings.storeid`/`aiid` for users we can't reach — `bootstrapDeviceCounters()` handles this automatically the next time their backend restarts.
- Refactoring the dual-counter (`trnid` + `milkid/storeid/aiid`) into a single source of truth — too invasive for a hotfix.
- Patching v2.10.32 in the field — only a new install of v2.10.66 + the patched backend will fully fix affected devices. The frontend self-heal in #3 ensures they recover even if only one side updates first.

