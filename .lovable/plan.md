

## Fix: Verification Using Wrong Field Names

### Root Cause

The verification step after successful sync (lines 284-305 in `useDataSync.ts`) checks `verifyResult.memberno` and `verifyResult.weight`, but the backend GET endpoint (`/api/milk-collection/:ref`) returns **mapped** field names:

**Backend returns:**
```javascript
{ farmer_id: rows[0].memberno, weight: rows[0].weight, ... }
```

**Frontend checks:**
```javascript
const vFarmerId = String((verifyResult as any).memberno || '').trim();  // ← WRONG: field is "farmer_id"
```

Since `verifyResult.memberno` is always `undefined`, `vFarmerId` becomes `''`, which never matches `lFarmerId`. Every single verification fails, marking all successfully synced records as "failed" and keeping them in IndexedDB as "pending."

The same bug exists in the duplicate-response verification path (lines 340-345).

### Fix

**File: `src/hooks/useDataSync.ts`** — Two changes:

1. **Success verification** (line 288): Change `memberno` to `farmer_id`
```javascript
// Before
const vFarmerId = String((verifyResult as any).memberno || '').trim();
// After
const vFarmerId = String((verifyResult as any).farmer_id || (verifyResult as any).memberno || '').trim();
```

2. **Duplicate verification** (line 341): Same fix
```javascript
// Before
const eFarmerId = String((existingRecord as any).memberno || '').trim();
// After
const eFarmerId = String((existingRecord as any).farmer_id || (existingRecord as any).memberno || '').trim();
```

Using fallback `|| .memberno` ensures compatibility if the backend response format ever changes back.

### Version bump
- `src/constants/appVersion.ts`: bump to v2.10.3

