

## Fix: Version Display, Cumulative Totals Showing 0, and trnid Corruption

### Issue 1: Version Not Showing 2.8.3
**Root cause**: `android/app/build.gradle` has `versionCode 19` and `versionName "2.8"` — never updated to match `appVersion.ts`.

**Fix**: Update `build.gradle` lines 12-13 to `versionCode 22` and `versionName "2.8.3"`.

### Issue 2: Cumulative Totals Showing 0
**Root cause**: `filterCumulativeByProduct` does an exact string match (`p.icode === productIcode`) but the backend returns trimmed icodes while the frontend `selectedProduct.icode` may have different casing or whitespace. Additionally, line 586 passes `undefined` when `total.total` is 0, which bypasses filtering and leaves cumulative as `undefined`.

**Fix in `src/pages/Index.tsx`**:
- Update `filterCumulativeByProduct` to use case-insensitive trimmed comparison:
```typescript
const match = cumData.byProduct.find(p => 
  p.icode.trim().toUpperCase() === productIcode.trim().toUpperCase()
);
```
- Remove the `total.total > 0 ? total : undefined` guard at all call sites — always pass the data object so `filterCumulativeByProduct` can match by product even when total is from a different product breakdown.

### Issue 3: trnid Corruption (20000006 instead of 2)
**Root cause**: The backend extracts trnid from transrefno using `parseInt(transrefno.substring(devcode.length))`. For store transactions with clientFetch=2 (e.g., `BB0120000005`), it strips `BB01` and parses `20000005` as trnid. This corrupted value is stored in `devsettings.trnid` and synced back to the frontend, inflating the counter.

**Two-part fix**:

**A. Frontend fix — Don't pass clientFetch for milk (Buy) transrefno** (`src/utils/referenceGenerator.ts`):
The `generateReferenceWithUploadRef` already correctly only passes `clientFetch` for store/ai types (line 542). But the `generateOfflineReference` function is also called by `generateTransRefOnly` (line 558), which Store.tsx calls with `clientFetch`. This is correct for Store.

The actual problem is the **backend parsing**. However, since we can't change the backend parsing in this session, the frontend fix is:
- For `transrefno`: Do NOT embed `clientFetch` in the transrefno. Only embed it in `uploadrefno`. This keeps transrefno in the format `devcode + 8-digit trnid` that the backend expects.

**Fix in `src/utils/referenceGenerator.ts`**:
- `generateReferenceWithUploadRef`: Remove the `cfForTransref` variable — always pass `undefined` to `generateOfflineReference` so transrefno never includes clientFetch
- `generateTransRefOnly`: Remove the `clientFetch` parameter — it should never be passed
- `generateOfflineReference`: Remove the `clientFetch` parameter entirely — transrefno is always `devcode + 8-digit padded trnid`

**B. Update Store.tsx calls** (`src/pages/Store.tsx`):
- Remove `clientFetch` from `generateTransRefOnly()` calls (line 566)

### Files Changed

| File | Change |
|------|--------|
| `android/app/build.gradle` | Update versionCode to 22, versionName to "2.8.3" |
| `src/pages/Index.tsx` | Fix `filterCumulativeByProduct` comparison; remove `total > 0` guards |
| `src/utils/referenceGenerator.ts` | Remove clientFetch from transrefno generation entirely; keep only in uploadrefno |
| `src/pages/Store.tsx` | Remove clientFetch from `generateTransRefOnly` calls |
| `src/constants/appVersion.ts` | Bump to 2.8.4 |

