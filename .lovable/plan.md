
Fix coffee session payloads so the frontend always sends SCODE to the backend for all coffee flows, including offline replay.

1. Correct the frontend session contract
- Treat coffee session values as two separate things:
  - backend value = `SCODE`
  - display value = `descript`
- Keep dairy behavior unchanged:
  - backend/session duplicate logic stays AM/PM for milk capture
  - existing Store/AI dairy behavior stays as-is unless already derived elsewhere

2. Replace the remaining AM/PM coercion in Buy/coffee flows
- In `src/pages/Index.tsx`:
  - change coffee capture records so `capture.session` stores `activeSession.SCODE` instead of `activeSession.descript`
  - keep `session_descript` as the human-readable label for receipts/logging
  - during online submit, only normalize to AM/PM for dairy; for coffee send the stored SCODE directly
- In `src/hooks/useDataSync.ts`:
  - remove unconditional AM/PM normalization for offline milk sync and orphan cleanup
  - for coffee receipts, send `receipt.season_code || receipt.session` as the backend session value
  - keep dairy duplicate checks using AM/PM, but use SCODE for coffee duplicate checks

3. Fix Store and AI to send SCODE, not the season description
- In `src/pages/Store.tsx` and `src/pages/AIPage.tsx`:
  - stop sending `session_label = descript` for coffee
  - send SCODE as the backend session value for both online and offline saves
  - keep the readable description only for UI/receipt purposes
- In `src/utils/salesSyncEngine.ts`:
  - use the same coffee-safe session value during offline replay so queued Store/AI records also upload with SCODE

4. Make session metadata resolver return the right value offline
- Refactor `src/utils/sessionMetadata.ts` so it can resolve:
  - `season` / SCODE
  - display label / descript
  - backend session value for transmission
- Prefer the Dashboard-selected session over page-local “active session” fetches so Store/AI use the exact selected season
- Add an IndexedDB-backed fallback path for SCODE recovery when the app is offline and localStorage is stale

5. Fix stale cache sources that are still feeding wrong values
- In `src/components/SessionSelector.tsx`:
  - force a refresh when coffee session cache entries lack `SCODE`
  - replace the sessions cache fully instead of merging so legacy records without SCODE do not linger
- In `src/hooks/useIndexedDB.ts`:
  - make `saveSessions()` clear the `sessions` store before re-inserting the latest server list
- Keep the existing `Dashboard.tsx` coffee cache invalidation and extend it if needed to clear any legacy persisted season objects missing `SCODE`

6. Tighten request types so the payload meaning is explicit
- In `src/services/mysqlApi.ts` and `src/lib/supabase.ts`:
  - update comments/types to reflect that coffee backend session values must be SCODE
  - if needed, add an explicit field for display label to avoid overloading `session_label` with two meanings across flows

7. Version and compatibility
- Bump `src/constants/appVersion.ts`
- Preserve backward compatibility:
  - old queued records without SCODE should be upgraded during sync using persisted session metadata or cached sessions
  - dairy logic must remain unchanged

8. Verification checklist
- Buy coffee online: `transactions.session` = SCODE, `CAN` = same SCODE
- Buy coffee offline then sync: `transactions.session` = SCODE, not AM/PM
- Store coffee online: `transactions.session` = SCODE, not `2ND CROP 2`
- Store coffee offline then sync: `transactions.session` = SCODE
- AI coffee online/offline sync: `transactions.session` = SCODE
- Dairy buy/store/AI still behave exactly as before

Technical notes
- Root cause is no longer only backend fallback. The frontend still sends the wrong value in three places:
  - Buy submit/sync paths still coerce coffee to AM/PM
  - Store and AI still send `descript` as the session field
  - stale cached session objects can still lack `SCODE`
- The safest fix is to make SCODE the single backend session value for coffee everywhere, while keeping `descript` only for display.
