

## Fix: Transaction Sync Error + Reference Generator Correction

### Issue 1: Sync Error — Missing `reference_no` on Store/AI Items

**Root cause**: `createStoreReceiptData` (line 716) and `createAIReceiptData` (line 750) build `TransactionItem` objects without setting `reference_no`. When the sync validator at line 147 checks `item.reference_no`, it's empty, triggering:
```
[SYNC ERROR] Item at index 0 is missing reference_no. Cannot sync.
```

Milk receipts work fine because `createMilkReceiptData` (line 681) passes `reference_no: r.reference_no`.

**Fix in `src/components/TransactionReceipt.tsx`**:
- In `createStoreReceiptData` (line 716): add `reference_no: transactionInfo.transrefno` to each item
- In `createAIReceiptData` (line 750): add `reference_no: transactionInfo.transrefno` to each item

### Issue 2: Reference Generator — `clientFetch` Corrupting `trnid` Padding

**Root cause**: In `generateOfflineReference` (lines 340, 354) and `generateFormattedUploadRef` (line 505), when `clientFetch` is present, `trnid` is padded to **7 digits** instead of 8:
```javascript
// Current (wrong): devcode + clientFetch + padStart(7)
// BB01 + 2 + 0000002 = BB0120000002 (12 chars, 7-digit trnid)
```

The correct format per requirements is **8-digit** padding for `trnid`, with `clientFetch` as a separate single digit:
```
// Correct: devcode + clientFetch + padStart(8)
// BB01 + 2 + 00000002 = BB01200000002 (13 chars, 8-digit trnid)
```

**Fix in `src/utils/referenceGenerator.ts`**:
- Line 340: `padStart(7, '0')` → `padStart(8, '0')`
- Line 354: `padStart(7, '0')` → `padStart(8, '0')`
- Line 505: `padStart(7, '0')` → `padStart(8, '0')`

### Files Changed

| File | Change |
|------|--------|
| `src/utils/referenceGenerator.ts` | Change 3 `padStart(7)` calls to `padStart(8)` |
| `src/components/TransactionReceipt.tsx` | Add `reference_no` to Store and AI receipt item mappings |

