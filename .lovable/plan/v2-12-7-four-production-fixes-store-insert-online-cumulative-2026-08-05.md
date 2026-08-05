# v2.12.7 — Four production fixes (store insert, online cumulative, Sacco column, statement dates)

## 1. Store transaction fails online — `noofcalfs = ''`

Confirmed: both store/AI insert paths in `backend-api/server.js` pass `body.number_of_calves || ''` and `''` for `milk_session_id` into integer columns (single insert ~line 2579, batch insert ~line 2862).

Fix:
- Add a small helper `toIntOrNull(value, fallback)` in `server.js` that returns a clean integer for numeric input and `null`/`0` for blank, undefined, null, non-numeric.
- Apply it to every integer-typed value in the store/AI inserts: `noofcalfs`, `capType`, `milk_session_id`, plus `weight`/`quantity`, `iprice`, `amount`, `Transtype`, `processed`, `uploaded`, `ivat`.
- Same sanitation applied to the milk collection insert (~line 1522) so `capType`/`entry_type` can never receive `''`.
- Column semantics preserved: values that were legitimately numeric behave identically; only blanks change from `''` to `0`/`NULL`.

## 2. Online milk receipt prints cumulative 0

Online submissions write straight to the server, so there is no local unsynced row; the receipt path in `src/pages/Index.tsx` depends entirely on a cloud read that is capped at a 1500 ms race. On the Contabo server that read frequently loses the race, and the fallback (`getFarmerTotalCumulative`) returns 0 whenever the route cache was never pre-warmed. Offline works because the local receipts supply the total. This is the most likely cause but is not yet proven from a live log.

Fix (both the on-screen path and the background print path):
- Raise the online cumulative timeout for the print path (1500 ms → 4000 ms) and retry once on timeout.
- When the cloud read fails or returns below the trusted floor, use `max(cachedBase, previousCumulativeTotal) + justSubmittedWeight` instead of falling through to a possibly empty cache — never print 0 when a previous total or a just-submitted weight is known.
- Keep `filterCumulativeByProduct` but, when the cloud `by_product` list has no entry for the selected produce yet, fall back to the trusted floor rather than returning 0.
- After a successful online submit, write the resolved total back to `farmer_cumulative` so the next receipt is instant.
- Add a `[CUM][ONLINE-PRINT]` log line recording cloud value, floor, and which source was used, so the remaining ambiguity is resolved on the next log export.

## 3. Yetu Sacco — `psettings.ccode` does not exist

Confirmed: `backend-api/yetuRoutes.js` `resolveSaccoAccess()` queries `psettings ... WHERE UPPER(TRIM(ccode))` (line ~74). Everywhere else in `server.js` `psettings` is keyed by `cno`.

Fix:
- Change the `psettings` lookup in `resolveSaccoAccess()` to `WHERE UPPER(TRIM(cno)) = UPPER(TRIM(?))`.
- Audit the rest of `yetuRoutes.js` and `yetuService.js`: `devsettings.ccode`, `Users.ccode`, `sacco_members.ccode` and `sacco_transactions.ccode` are correct and stay as-is; only `psettings` uses `cno`.
- Also align the table name casing to `devSettings` / `Users` as used elsewhere, for the case-sensitive Contabo filesystem.

## 4. Member Produce Statement shows ISO timestamps

Confirmed: `formatDisplayDate` in `src/components/PeriodicReportReceipt.tsx` does `dateStr.split('-')`, so `2026-08-04T21:00:00.000Z` renders as `04T21:00:00.000Z/08/2026`.

Fix:
- Normalize the input first: take the leading `YYYY-MM-DD` (strip anything from `T` onward) and only then split, so both `2026-08-04` and full ISO strings render `04/08/2026`.
- Apply the same normalization where statement rows are handed to the thermal printer (`useDirectPrint` statement payload) so printed output matches the preview.
- Sweep the other report/receipt components for the same `split('-')` pattern and normalize them too.

## Technical notes

- Version bump to v2.12.7 (code 183) in `src/constants/appVersion.ts`, service-worker cache version bumped in `sw.js`.
- Backend changes are confined to `server.js` insert parameter sanitation and the single `psettings` predicate in `yetuRoutes.js`; no endpoints added, removed, or renamed, so running production clients are unaffected.
- `backend-api/` must be redeployed to Contabo for items 1 and 3; items 2 and 4 ship with the app build.
