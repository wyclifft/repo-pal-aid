

## Fix Store/AI Wrong SCODE — Frontend + Backend Guard + Historical SQL — v2.10.56

You're approving the frontend fix AND asking for two extra things:
1. A **backend safety net** in `server.js` so even devices still on **v2.10.32** stop writing the wrong SCODE on Store/AI.
2. A **one-time SQL script** to repair the historical Store rows (`S0003` → `S0002`).

All three pieces below.

---

### Part 1 — Frontend (v2.10.56+ devices)

Make Store and AI resolve the active session from the **same place Buy already does**: the Dashboard-persisted session in `localStorage.active_session_data`. The current `mysqlApi.sessions.getActive` call (which uses server wall-clock and returns S0003 once the time window rolls) is kept only as a **cold-start fallback** when nothing is on the dashboard yet.

Resolution priority (Store + AI):
1. `localStorage.active_session_data.session` — what the operator selected on the Dashboard
2. `localStorage.delicoop_session_data.session` — legacy fallback
3. `mysqlApi.sessions.getActive(deviceFingerprint)` — existing time-based behavior (last resort)

Result: Buy / Store / AI all stamp the same SCODE in both `transactions.session` and `transactions.CAN`.

**Files**
| File | Change |
|---|---|
| `src/pages/Store.tsx` | Replace `loadActiveSession` body with the priority resolver; preserve the `Session` shape so downstream code (`resolveSessionMetadata(activeSession)`) is unchanged. |
| `src/pages/AIPage.tsx` | Same fix. |
| `src/utils/sessionMetadata.ts` | Add helper `resolveDashboardActiveSession()` returning the dashboard session (or null), reused by Store + AI. |

---

### Part 2 — Backend safety net in `server.js` (covers v2.10.32 devices)

Old v2.10.32 builds keep posting whatever they computed locally. We add **server-side normalization** on the Store/AI write paths so the DB is correct regardless of what the device sent. Strictly additive and production-safe.

In `/api/sales` and `/api/sales/batch` (the endpoints Store + AI hit), for **coffee orgs only** (`psettings.orgtype = 'C'`) and **`Transtype IN (2,3)`** only:

1. Resolve the canonical SCODE for the row in this priority order:
   - The most recent **Buy** (`Transtype = 1`) row for the same `ccode` + same `transdate`, picking its `CAN` value (this is what the operator actually used today).
   - Else, the active session from the `sessions` table for that `ccode` whose `time_from ≤ transtime ≤ time_to` (matching the row's own time, NOT server "now" — so late-arriving offline rows still get the correct SCODE).
   - Else, leave the payload values alone (no destructive guess).
2. If resolved, write `session = CAN = <resolved SCODE>` regardless of what the device sent.
3. Log every normalization: `[NORMALIZE] dev=<code> ref=<transrefno> store/ai SCODE <sent> → <fixed>` so you can see it working in production logs.

Dairy orgs and Buy rows are **never** touched. v2.10.55+ devices already send the correct value, so the helper is a no-op for them. v2.10.32 devices get auto-corrected at write time.

**Files**
| File | Change |
|---|---|
| `backend-api/server.js` | Add `normalizeCoffeeSessionForSale(ccode, transdate, transtime, payload)` helper. Call it from `/api/sales` and `/api/sales/batch` before INSERT for `orgtype='C'` AND `Transtype IN (2,3)`. Pure addition — no existing logic removed. |

---

### Part 3 — One-time SQL to repair historical Store rows (S0003 → S0002)

Run this once on phpMyAdmin / MySQL CLI for **your ccode**. Wrapped in a transaction with a preview count first, so you can review and roll back.

Replace placeholders:
- `<YOUR_CCODE>` — your company code
- `<WRONG_SCODE>` — `S0003`
- `<RIGHT_SCODE>` — `S0002`
- `<FROM_DATE>` / `<TO_DATE>` — date range to repair (use `'1900-01-01'` / `'2999-12-31'` for everything)

```sql
START TRANSACTION;

-- 1. Preview how many rows will change
SELECT COUNT(*) AS rows_to_fix
FROM transactions
WHERE ccode = '<YOUR_CCODE>'
  AND Transtype IN (2, 3)               -- 2=Store, 3=AI (drop 3 if AI is fine)
  AND session = '<WRONG_SCODE>'
  AND CAN     = '<WRONG_SCODE>'
  AND CAST(transdate AS DATE) BETWEEN '<FROM_DATE>' AND '<TO_DATE>';

-- 2. Inspect a sample (optional but recommended)
SELECT transrefno, transdate, transtime, Transtype, memberno, session, CAN, route
FROM transactions
WHERE ccode = '<YOUR_CCODE>'
  AND Transtype IN (2, 3)
  AND session = '<WRONG_SCODE>'
  AND CAN     = '<WRONG_SCODE>'
  AND CAST(transdate AS DATE) BETWEEN '<FROM_DATE>' AND '<TO_DATE>'
ORDER BY transdate DESC, transtime DESC
LIMIT 20;

-- 3. Apply the fix
UPDATE transactions
SET session = '<RIGHT_SCODE>',
    CAN     = '<RIGHT_SCODE>'
WHERE ccode = '<YOUR_CCODE>'
  AND Transtype IN (2, 3)
  AND session = '<WRONG_SCODE>'
  AND CAN     = '<WRONG_SCODE>'
  AND CAST(transdate AS DATE) BETWEEN '<FROM_DATE>' AND '<TO_DATE>';

-- 4. Verify post-update count is 0
SELECT COUNT(*) AS rows_still_wrong
FROM transactions
WHERE ccode = '<YOUR_CCODE>'
  AND Transtype IN (2, 3)
  AND session = '<WRONG_SCODE>'
  AND CAN     = '<WRONG_SCODE>'
  AND CAST(transdate AS DATE) BETWEEN '<FROM_DATE>' AND '<TO_DATE>';

-- 5. If counts look right → COMMIT. If anything is off → ROLLBACK.
COMMIT;
-- ROLLBACK;
```

Safety guarantees:
- Strict `ccode = '<YOUR_CCODE>'` — never touches another tenant's data.
- Exact match on `session = CAN = '<WRONG_SCODE>'` — leaves all other rows alone.
- Buy rows (`Transtype = 1`) untouched.
- Wrapped in a transaction — easy rollback.

---

### Version Bump

| File | Change |
|---|---|
| `src/constants/appVersion.ts` | Bump to **v2.10.56 (Code 78)**. Note: "Frontend: Store/AI now resolve active session from Dashboard selection (same as Buy). Backend: `/api/sales` and `/api/sales/batch` auto-normalize coffee Store/AI session/CAN to the canonical SCODE so legacy v2.10.32 devices stop writing the wrong code." |

---

### What Does NOT Change

- Buy / Sell flow (`Index.tsx`) — already correct, untouched.
- `/api/sessions/active/<dev>` endpoint — untouched (still used as cold-start fallback).
- Dairy orgs — Store/AI Dashboard source is already aligned; backend normalization gated on `orgtype='C'`, so dairy AM/PM untouched.
- Existing `/api/sales` request/response contract — additive only.
- Z-Reports, Periodic Reports, sync engine, IndexedDB, references, photo upload — untouched.
- Multi-tenant `ccode` boundaries — strictly preserved everywhere.
- v2.10.53 / .54 / .55 fixes — preserved.

### Verification After Deploy

1. Update one device to **v2.10.56**. Select session **S0002** on Dashboard → Buy/Store/AI all write `session = CAN = S0002`. ✓
2. Wait until server clock passes S0002's `time_to` window → Store still writes `S0002` (no drift). ✓
3. On a device still running **v2.10.32**, perform a Store sale → DB row has correct active SCODE in both `session` and `CAN` (auto-normalized server-side). Look for `[NORMALIZE]` line in backend logs. ✓
4. Run the historical SQL above → preview count matches expectation → commit → re-run preview → returns 0. ✓
5. Re-print Z-Reports / Periodic Reports for the repaired range → coffee Store transactions group under the correct season. ✓
6. Dairy device → normalization is a no-op, AM/PM unchanged. ✓

### Out of Scope

- Rows where `session ≠ CAN` (your case has both equal to S0003; if mixed rows surface later, I'll provide a second targeted UPDATE).
- Auto-running the historical backfill on app startup (kept manual + audited).
- Changing the `/api/sessions/active/` resolution rule itself.

