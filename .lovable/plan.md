
## Fix: Offline Store/AI Sync Still Leaving `session` and `CAN` Empty — v2.10.38

### Root Cause
The backend is already ready to save these fields, and the sync engine already forwards them. The remaining gap is on the client when a transaction is created offline:

1. **`Store.tsx` and `AIPage.tsx` rely on `loadActiveSession()`**
   - That function calls `/api/sessions/active/...`.
   - When the device is offline, the request fails and `activeSession` stays `null`.

2. **Offline transaction payloads are built from `activeSession`**
   - Offline Store saves:
     - `season: activeSession?.SCODE || ''`
     - `session_label: activeSession?.descript || ''`
   - Offline AI does the same.
   - If `activeSession` is `null`, both values are saved as empty strings into IndexedDB.

3. **`salesSyncEngine.ts` only forwards what was saved**
   - During reconnect, sync sends `firstSale.season` and `firstSale.session_label`.
   - If the offline record was saved blank, the backend correctly inserts blanks.

### Safe Fix Strategy
Keep the backend unchanged and fix the offline metadata source on the client.

### Changes

#### 1) Add a shared client-side session metadata resolver
Create a small utility that resolves session metadata in this order:

1. Current in-memory `activeSession`
2. Dashboard persisted session from `localStorage.active_session_data`
3. Fallback persisted session from `localStorage.delicoop_session_data`
4. Cached sessions from IndexedDB if needed

It should return:
- `season` from `SCODE`
- `session_label` from `descript`

This gives Store/AI a reliable source even when fully offline.

#### 2) Update `src/pages/Store.tsx`
Use the resolver before building both:
- the online `BatchSaleRequest`
- the offline `Sale` objects stored for sync

Result:
- New offline Store transactions will carry `season` and `session_label` even without network access.

#### 3) Update `src/pages/AIPage.tsx`
Use the same resolver before building AI transaction payloads for:
- online submit
- offline save

Result:
- New offline AI transactions will also retain `CAN` and `session` metadata.

#### 4) Update `src/utils/salesSyncEngine.ts`
Add a best-effort enrichment step before syncing a pending offline Store/AI record:
- If `season` or `session_label` is missing on the saved record,
- resolve session metadata from persisted dashboard session / cached session data,
- then send the enriched values to the backend.

This is important for:
- records already queued offline before the fix,
- cases where the page failed to populate metadata during capture.

#### 5) Version bump
Update:
- `src/constants/appVersion.ts` → **v2.10.38** (Code 60)

### Production-Safe Scope
No backend API changes are needed for this fix.
That keeps `server.js` untouched and avoids risk to production clients while solving the offline capture gap.

### Files to Change
| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Resolve session metadata from persisted/cached session when offline; use it in online + offline payloads |
| `src/pages/AIPage.tsx` | Same fix for AI transactions |
| `src/utils/salesSyncEngine.ts` | Enrich missing `season` / `session_label` before syncing old pending records |
| `src/constants/appVersion.ts` | Bump to v2.10.38 (Code 60) |
| `src/utils/...` or shared helper file | Add reusable session metadata resolver |

### Technical Notes
- The dashboard already persists the selected session in `localStorage.active_session_data`.
- That persisted session is the safest offline source for `SCODE` and `descript`.
- The current bug is not in backend insertion anymore; it is in offline transaction creation.
- The sync engine should remain the single place that performs final payload cleanup for pending Store/AI records.

### Expected Outcome
After this fix:
- Newly captured offline Store and AI transactions will sync with both `session` and `CAN` populated.
- Already pending offline transactions with missing values will be best-effort repaired during sync if the session snapshot is still available on the device.
