# Fix cumulative going backwards after syncing pending receipts (v2.12.11)

## What the two logs show

Device A7, member M00003, route F001 (line-by-line from the CSV):

```text
17:34:02  print 61.1  = base 56.1 + 5 unsynced
17:39:24  print 56.1  = base 56.1 + 0 unsynced   <-- sync completed, base unchanged
17:41:52  CUM:SYNC cumulative-refresh route=F001 16/16 ok
17:42:09  print 64.1  = base 64.1 + 0 unsynced   <-- correct value arrives ~8 min late
```

So the receipts synced, the local unsynced rows were removed, but the cloud
total the app wrote back still described the pre-sync state. Everything printed
in that window is short by the weight of the just-synced receipts.

The server log explains why the cloud total is old:

- The batch cumulative is served only from a background snapshot
  (`CUM_BATCH_TTL_MS` 5 min, `CUM_BATCH_REWARM_MS` 90 s), and each warm scan
  itself takes 21–70 s (`timings totals=45390ms products=70404ms`).
- Requests in between log `[CUM:BATCH] cache-hit` / `pending (warming)` — they
  return a snapshot taken before the device's receipts were inserted.
- Nothing invalidates or adjusts that snapshot when a transaction is inserted,
  so a just-synced receipt is invisible for up to ~2–3 minutes.

Two more real problems visible in the same logs:

- The individual (fast, uncached) endpoint `/api/farmer-cumulative` still uses
  `ANY_VALUE(...)`, which the batch query was already migrated away from for
  MariaDB compatibility — so the one accurate path is unreliable.
- Repeated `ER_DUP_ENTRY 'A700000932-17:43:57-C000'` on insert: the device
  re-uploads receipts the server already has, so its local rows linger and the
  same weight is counted as "unsynced" longer than it should be.

## Fix

### Backend (`backend-api/server.js`)

1. Delta overlay on insert. After a successful transaction insert, add the
   inserted weight (per farmer, per icode) to every cached cumulative snapshot
   whose (ccode, route, period) covers it, and flag the key for priority
   re-warm. A cache-hit then already includes receipts synced seconds ago; the
   overlay is discarded when the next full snapshot lands.
2. Make the individual endpoint MariaDB-safe: replace `ANY_VALUE(TRIM(t.icode))`
   with `MIN(TRIM(t.icode))`, matching the batch query.
3. Treat a duplicate reference as success. On `ER_DUP_ENTRY` for
   `unique_transaction`, return the existing row as an accepted/idempotent
   result instead of an error, so the device clears its local copy.

### Frontend

4. `src/pages/Index.tsx` — post-sync refresh: for farmers whose receipts just
   synced, fetch the fresh single-farmer cumulative rather than relying on the
   batch snapshot, and only fall back to the batch value when that call fails.
5. Optimistic base carry-over: when a receipt is confirmed synced and its local
   row is deleted, immediately add its weight to the cached `baseCount` for that
   farmer/route/icode. The printed total then never dips while the cloud catches
   up.
6. Harden the floor: extend the existing post-sync floor guard so it protects
   the persisted cache, not just the on-screen number — a backend value lower
   than `baseCount` is rejected for a farmer that synced within the last 5
   minutes, unless the existing two-read `W3:reconfirm-heal-down` path confirms
   it.

### Version

Bump to v2.12.11 (versionCode 187), update `sw.js` cache version, and log the
change in `src/constants/appVersion.ts`.

## Verification

- Capture several receipts offline, go online, let sync finish, then capture
  again: the printed cumulative must be previous total + new weight, never lower.
- `/debug` should show no `CUM:PRINT` where the printed value drops between two
  consecutive captures for the same farmer/route.
- Server log: after an insert, the next `[CUM:BATCH] cache-hit` for that route
  reflects the new weight without waiting for a warm.
- Existing flows unchanged: transaction creation, reference generation, receipts,
  photos, store/AI sync.

Note: the backend changes only take effect after `backend-api/` is redeployed to
the Contabo server.
