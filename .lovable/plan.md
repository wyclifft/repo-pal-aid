

## Fix: Separate Transaction Date from Reprint Timestamp — v2.10.27

### Problem

Both the "Date" field (line 488) and the bottom timestamp (line 633) in `TransactionReceipt.tsx` use the same `formattedDate`/`formattedTime` variables derived from `transactionDate`. The bottom timestamp should show the current time when the receipt is viewed/reprinted.

### Fix

**`src/components/TransactionReceipt.tsx`** (line 633):
- Replace `{formattedDate} at {formattedTime}` with a dynamically generated `new Date()` timestamp
- Add a `viewedAt` constant: `const viewedAt = new Date()` and format it the same way
- Top "Date" field (line 488) remains unchanged — shows original transaction time

**`src/constants/appVersion.ts`**: Bump to v2.10.27

### Files Changed

| File | Change |
|------|--------|
| `src/components/TransactionReceipt.tsx` | Bottom timestamp uses `new Date()` instead of `transactionDate` |
| `src/constants/appVersion.ts` | Bump to v2.10.27 |

