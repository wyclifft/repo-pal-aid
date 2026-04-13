

## Fix: Duplicate Captures for multOpt=0 Farmers — v2.10.39

### Root Cause
The Capture button has no re-entrancy guard. On Android WebView, a single tap can fire `handleCapture` twice concurrently, generating two records with different `transrefno` but identical data.

### Fix Plan

**1. Frontend capture lock** (`src/pages/Index.tsx`)
- Add `isCapturingRef = useRef(false)` — checked/set immediately (not state)
- Guard top of `handleCapture`: if locked, return early; set `true`; reset in `finally`

**2. Disable Capture button during capture** (`BuyProduceScreen.tsx`, `SellProduceScreen.tsx`)
- Wire `captureDisabled` prop to `isCapturing` state so button is visually disabled

**3. Sync collision guard for multOpt=0** (`src/hooks/useDataSync.ts`)
- On `REFERENCE_COLLISION` retry: if `multOpt === 0`, check if existing backend record matches on **memberno + session + weight + date + uploadrefno + Transtype + icode**
- If all 7 fields match → treat as idempotent success, delete local record
- If fields differ → retry with new transrefno

**4. Backend post-insert dedup for multOpt=0** (`backend-api/server.js`)
- After successful insert for multOpt=0 farmers, query:
  ```sql
  SELECT transrefno FROM transactions
  WHERE memberno = ? AND session = ? AND weight = ?
  AND transdate = ? AND uploadrefno = ? AND Transtype = ? AND icode = ?
  AND transrefno != ?
  ```
- If a matching row exists (same 7 fields, different transrefno) → delete the newly inserted row, return idempotent success with the original transrefno
- If no match → normal success

**5. Bump version** (`src/constants/appVersion.ts`) → v2.10.39 (Code 61)

### Dedup Match Fields (7 total)

| Field | Purpose |
|-------|---------|
| `memberno` | Same farmer |
| `session` | Same AM/PM session |
| `weight` | Same weight reading |
| `transdate` | Same day |
| `uploadrefno` | Same workflow counter |
| `Transtype` | Same transaction type (1=buy, 2=sell, 3=AI) |
| `icode` | Same item/product code |

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `isCapturingRef` lock to `handleCapture` |
| `src/components/BuyProduceScreen.tsx` | Wire `isCapturing` to disable Capture button |
| `src/components/SellProduceScreen.tsx` | Same as above |
| `src/hooks/useDataSync.ts` | Guard collision retry — 7-field match for multOpt=0 |
| `backend-api/server.js` | Post-insert dedup using 7-field match for multOpt=0 |
| `src/constants/appVersion.ts` | Bump to v2.10.39 (Code 61) |

