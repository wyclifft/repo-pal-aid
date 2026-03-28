

## Analysis: Batch Store Sync — Race Conditions & fm_tanks.tcode Optimization

### Current State

Both store endpoints query `fm_tanks` with `SELECT COUNT(*)`:
- **Single-item** (~line 1682): one query per request
- **Batch** (~line 1918): one query per batch (not per item) — already inside a transaction

### Race Condition Assessment

**Low risk.** The `fm_tanks.tcode` value is administrative config data — it changes rarely (only when an admin reconfigures a center). Both endpoints already run inside `BEGIN TRANSACTION` / `COMMIT` blocks, so within a single batch all items use the same connection and see the same data.

Multiple concurrent batch requests each get their own connection and each do one `fm_tanks` lookup — this is safe because:
1. `fm_tanks.tcode` is read-only config (not a counter or balance)
2. Each batch does exactly **one** lookup, not per-item
3. MySQL `InnoDB` consistent reads ensure each transaction sees a snapshot

### The Real Concern: 100 Transactions = 100 Single-Item Requests?

If the APK syncs 100 transactions as **individual** `/api/sales` calls (not using `/api/sales/batch`), then yes — 100 separate `fm_tanks` queries. This is wasteful but not a race condition. Each is an independent insert with its own connection + transaction.

### Proposed Fix

Apply the approved `tcode` fix to both endpoints, with one optimization for the batch path:

**File: `backend-api/server.js`** — 2 locations:

#### 1. Single-item store insert (~line 1682)
```javascript
// Change SELECT COUNT(*) to SELECT tcode
const [allowedRoutes] = await conn.query(
  'SELECT tcode FROM fm_tanks WHERE ccode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
  [ccode, requiredClientFetch]
);
if (allowedRoutes.length === 0) { /* existing reject logic */ }
const storeRoute = (allowedRoutes[0].tcode || '').toString().trim() || (body.route || '');
```
Then use `storeRoute` in the INSERT at line 1786 instead of `body.route || ''`.

#### 2. Batch store insert (~line 1918)
Same change — already one lookup per batch, so no per-item overhead. Use `storeRoute` in the per-item INSERT at line 2001 instead of `body.route || ''`.

#### 3. No caching layer needed
- `fm_tanks` is config data, not hot-path — one query per request/batch is acceptable
- Adding an in-memory cache would introduce staleness risk and complexity for negligible gain
- The batch endpoint already does only one lookup for all items

### Safety Summary

| Concern | Status |
|---------|--------|
| Race conditions on tcode | **Safe** — read-only config, InnoDB snapshots |
| Batch overhead (100 items) | **Safe** — one fm_tanks query per batch, not per item |
| 100 individual requests | **Acceptable** — each is independent; no shared mutable state |
| APK compatibility | **Safe** — server overrides `body.route`, APK unchanged |
| Fallback | **Safe** — falls back to `body.route` if tcode is empty |

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | Replace `SELECT COUNT(*)` with `SELECT tcode LIMIT 1` in both store endpoints; use `storeRoute` in INSERTs |
| `src/constants/appVersion.ts` | Bump to v2.10.9 |

