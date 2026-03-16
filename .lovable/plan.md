

## Fix: Persist Store/AI Counters in Backend After Sales

### Problem
The milk collection endpoint updates `trnid` and `milkid` in `devsettings` after each insert (line 962-967). However, both sale endpoints (`/api/sales` and `/api/sales/batch`) **never update** `trnid`, `storeid`, or `aiid`. When the device reconnects, `syncOfflineCounter` fetches these stale values from the backend, and `Math.max(local, backend)` may reset counters if local storage was cleared.

### Fix

**File: `backend-api/server.js`**

**1. Single sale endpoint (after line 1781, post-commit)**
Add counter update using the same pattern as milk collection:
```javascript
// After conn.commit()
if (body.device_fingerprint) {
  const insertedTrnId = parseInt(transrefno.slice(-8), 10);
  const typeId = uploadrefno ? parseInt(String(uploadrefno).slice(-8), 10) : 0;
  const counterField = transtype === 3 ? 'aiid' : 'storeid';
  if (!isNaN(insertedTrnId)) {
    await pool.query(
      `UPDATE devsettings SET 
        trnid = GREATEST(IFNULL(trnid, 0), ?),
        ${counterField} = GREATEST(IFNULL(${counterField}, 0), ?)
       WHERE uniquedevcode = ?`,
      [insertedTrnId, typeId, body.device_fingerprint]
    );
  }
}
```

**2. Batch sale endpoint (after line 1991, post-commit)**
Same pattern, using the highest trnid from inserted items:
```javascript
if (body.device_fingerprint && insertedRefs.length > 0) {
  const maxTrnId = Math.max(...insertedRefs.map(ref => parseInt(ref.slice(-8), 10)));
  const typeId = uploadrefno ? parseInt(String(uploadrefno).slice(-8), 10) : 0;
  const counterField = body.transtype === 3 ? 'aiid' : 'storeid';
  if (!isNaN(maxTrnId)) {
    await pool.query(
      `UPDATE devsettings SET 
        trnid = GREATEST(IFNULL(trnid, 0), ?),
        ${counterField} = GREATEST(IFNULL(${counterField}, 0), ?)
       WHERE uniquedevcode = ?`,
      [maxTrnId, typeId, body.device_fingerprint]
    );
  }
}
```

**File: `src/constants/appVersion.ts`** — Version bump

| File | Change |
|------|--------|
| `backend-api/server.js` | Add `UPDATE devsettings` for `trnid`+`storeid`/`aiid` after both single and batch sale commits |
| `src/constants/appVersion.ts` | Version bump |

