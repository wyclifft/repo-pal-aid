
# Fix: `milkid` not advancing on sync + `uploadrefno` starts at 1 on cache-wiped devices

## Symptoms
1. `devsettings.milkid` stays put after milk syncs, while `trnid` and `storeid`/`aiid` advance correctly.
2. Devices that have been cache-wiped (or are running an older APK that omits `uploadrefno`) generate `uploadrefno` starting at `1`, colliding with already-existing rows.

This is a **server-only** fix — production APKs in the field are unchanged. The frontend already absorbs higher backend counters via `Math.max(local, backend)` on the next 30s authorization poll (see `src/components/DeviceAuthStatus.tsx`, `src/components/Login.tsx`, `src/utils/referenceGenerator.ts`).

## Root causes (confirmed by reading `backend-api/server.js`)

### Cause A — `milkid` not advancing
In the milk insert success path (`backend-api/server.js` ~lines 985–1004):

```js
await pool.query(
  `UPDATE devsettings SET 
     trnid  = GREATEST(IFNULL(trnid, 0), ?),
     milkid = GREATEST(IFNULL(milkid, 0), ?)
   WHERE uniquedevcode = ?`,
  [insertedTrnId, attemptUploadrefno || 0, deviceserial]
);
```

`attemptUploadrefno` comes from the request body. **Older/field APKs that do not send `uploadrefno`** (or send `null`/empty) cause `attemptUploadrefno || 0` to evaluate to `0`. `GREATEST(milkid, 0) = milkid`. The column never advances.

For comparison, store/AI inserts (lines ~1985 and ~2288) compute `typeId` from the inserted `Uploadrefno` column itself with a fallback, which is why `storeid`/`aiid` advance even when the client omits the value.

### Cause B — `uploadrefno` starts at 1 after cache wipe
In the fingerprint endpoint (lines 2576–2616), only `trnid` is cross-checked against `MAX(transrefno)` and self-healed. `milkid`, `storeid`, `aiid` are returned **raw** from `devsettings` (lines 2497–2500). If `devsettings.milkid = 0` (because of cause A above, or because a fresh row was inserted), the device receives `0`, and its local counter starts the next milk `uploadrefno` at `1` — colliding with existing approval-workflow IDs.

## Plan — change `backend-api/server.js` only

### 1. Always advance `milkid` to the row's actual `Uploadrefno`

Replace the UPDATE in the milk insert success block (~lines 985–1004) so that `milkid` is derived from the **just-inserted `Uploadrefno`** rather than from the request body. If the client didn't send one, fall back to the current `MAX(Uploadrefno)+1` for this `ccode + Transtype=1`.

```js
// SUCCESS: Update trnid AND milkid AFTER successful insert
const [devRows] = await pool.query(
  'SELECT devcode FROM devsettings WHERE uniquedevcode = ?',
  [deviceserial]
);
if (devRows.length > 0 && devRows[0].devcode) {
  const insertedTrnId = parseInt(attemptTransrefno.slice(-8), 10);

  // Derive the milkid we should advance to. Prefer the value actually
  // stored on the row (covers older APKs that don't post uploadrefno).
  let advanceMilkId = parseInt(attemptUploadrefno, 10) || 0;
  if (!advanceMilkId) {
    try {
      const [maxRows] = await pool.query(
        `SELECT CAST(MAX(CAST(Uploadrefno AS UNSIGNED)) AS UNSIGNED) AS maxId
         FROM transactions
         WHERE ccode = ? AND Transtype = 1`,
        [ccode]
      );
      advanceMilkId = (maxRows[0] && maxRows[0].maxId) ? Number(maxRows[0].maxId) : 0;
    } catch (e) {
      console.warn('⚠️ [MILKID] MAX(Uploadrefno) lookup failed:', e?.message || e);
    }
  }

  if (!isNaN(insertedTrnId)) {
    await pool.query(
      `UPDATE devsettings SET 
         trnid  = GREATEST(IFNULL(trnid, 0), ?),
         milkid = GREATEST(IFNULL(milkid, 0), ?)
       WHERE uniquedevcode = ?`,
      [insertedTrnId, advanceMilkId, deviceserial]
    );
    console.log(`✅ Updated trnid=${insertedTrnId}, milkid=${advanceMilkId} for ${deviceserial}`);
  }
}
```

This is fully backward-compatible: new APKs continue to advance to `attemptUploadrefno`; old APKs now also advance correctly via the MAX fallback.

### 2. Self-heal `milkid` / `storeid` / `aiid` in the fingerprint endpoint

Extend the existing `trnid` self-heal block (lines 2576–2616) with parallel logic for the three type-specific counters. After the existing `trnid` healing, add:

```js
// Self-heal milkid / storeid / aiid using MAX(Uploadrefno) per Transtype
// (1 = milk, 2 = store, 3 = AI). Only relies on ccode (multi-tenant safe).
if (deviceData.ccode) {
  const counterMap = [
    { col: 'milkid',  transtype: 1 },
    { col: 'storeid', transtype: 2 },
    { col: 'aiid',    transtype: 3 },
  ];
  for (const { col, transtype } of counterMap) {
    try {
      const [rows] = await pool.query(
        `SELECT CAST(MAX(CAST(Uploadrefno AS UNSIGNED)) AS UNSIGNED) AS maxId
         FROM transactions
         WHERE ccode = ? AND Transtype = ?`,
        [deviceData.ccode, transtype]
      );
      const txMax = (rows[0] && rows[0].maxId) ? Number(rows[0].maxId) : 0;
      const current = parseInt(deviceData[col], 10) || 0;
      if (txMax > current) {
        console.log(`🔧 [${col.toUpperCase()}-SYNC] devsettings.${col} (${current}) is stale for ccode=${deviceData.ccode}; using MAX (${txMax})`);
        deviceData[col] = txMax;
        try {
          await pool.query(
            `UPDATE devsettings
             SET ${col} = GREATEST(IFNULL(${col}, 0), ?)
             WHERE uniquedevcode = ?`,
            [txMax, fingerprint]
          );
        } catch (healErr) {
          console.warn(`⚠️ [${col.toUpperCase()}-SYNC] self-heal failed:`, healErr?.message || healErr);
        }
      }
    } catch (lookupErr) {
      console.warn(`⚠️ [${col.toUpperCase()}-SYNC] MAX lookup failed:`, lookupErr?.message || lookupErr);
    }
  }
}
```

The column name is interpolated directly because it comes from a hardcoded allow-list (`milkid`, `storeid`, `aiid`) — not from user input — so there's no injection risk.

### 3. Version bump (per `version-alignment-and-cache-management-protocol`)

- `src/constants/appVersion.ts`: `APP_VERSION = '2.10.72'`, `APP_VERSION_CODE = 94`. Add a release note describing the milkid backfill + per-type self-heal.
- `android/app/build.gradle`: bump `versionCode` to `94`, `versionName` to `"2.10.72"`.
- `public/sw.js`: bump cache version one notch (e.g. `v18` → `v19`) to keep the existing protocol consistent.

### 4. Optional: index recommendation (no migration in this change)
For shops with very large `transactions` tables, a composite index `(ccode, Transtype, Uploadrefno)` will keep the new MAX queries fast. We will **not** add the index in this change (no migrations against production). It will be documented in a comment near the new query so the operator can apply it during a maintenance window.

## Files to edit

1. `backend-api/server.js` — patch the milk insert UPDATE block + extend the fingerprint self-heal block. **No other endpoints touched.**
2. `src/constants/appVersion.ts` — bump to `2.10.72` (code 94) with release notes.
3. `android/app/build.gradle` — bump `versionCode` 94, `versionName` `"2.10.72"`.
4. `public/sw.js` — bump cache version per protocol.

## Production-safety notes

- **No schema changes.** No migrations.
- **No endpoint contracts changed.** Same request/response shape; we only return a corrected (higher) counter where applicable.
- **Backward compatible** with every APK currently in the field. Older APKs that omit `uploadrefno` benefit from the MAX-based fallback; newer APKs continue to use the value they sent.
- **Idempotent on the existing dataset.** `GREATEST` ensures no counter ever decreases.
- **Fix takes effect on the next fingerprint poll** (≤30s for online devices) without any client update.
