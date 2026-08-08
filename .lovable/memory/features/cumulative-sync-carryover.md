---
name: Cumulative Sync Carry-Over
description: v2.12.11 backend delta overlay + frontend bumpFarmerCumulativeBase stop the cumulative going backwards right after pending receipts sync
type: feature
---
v2.12.11. Problem: after syncing pending receipts the printed cumulative dropped back to the pre-sync base, because the local unsynced row was deleted while the Contabo batch snapshot (re-warm ~90s, scan 20-70s) still lacked the just-uploaded row.

Backend (`backend-api/server.js`):
- `applyCumulativeDelta({ccode, route, farmerId, icode, weight, transdate, transtype})` runs after every successful transaction insert (transtype 1 only) and patches each cached snapshot whose ccode/period/route covers the row (route match or `ALL`), also updating `by_product`. Best-effort; never breaks an insert. Marks the key for priority re-warm.
- `ER_DUP_ENTRY` on the composite `unique_transaction` key returns idempotent success (previously 500 → local row lingered and retried forever).
- All `ANY_VALUE` replaced with `MIN(TRIM())` for MariaDB.

Frontend:
- `bumpFarmerCumulativeBase(farmerId, weight, icode?, route?, opts)` in `src/hooks/useIndexedDB.ts` adds a confirmed weight into `baseCount` + per-icode breakdown, `lastWriteSource='sync-carryover'`, logs `CUM:CARRYOVER`.
- `src/hooks/useDataSync.ts` calls it in three places: post-sync refresh (tops up by `(baseBefore + weight) - persisted` when positive) and both duplicate-delete paths (server duplicate, exception duplicate).

Purely additive — the downward guard (two-read `W3:reconfirm-heal-down`) still governs any decrease.
