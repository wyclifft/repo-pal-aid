

## Fix: Store/AI Receipt Date + Thermal Printer Reprint Timestamp — v2.10.28

### Bug 1: Store/AI on-screen receipt shows both timestamps as current time

**Root cause**: In `ReprintModal.tsx` line 792-801, when viewing a store/AI receipt, `createStoreReceiptData` / `createAIReceiptData` are called — and both hardcode `transactionDate: new Date()` (lines 765, 800). So every time a receipt is opened from Recent Receipts, the top "Date" field gets the current time instead of the original transaction time.

**Fix**:
- `createStoreReceiptData` and `createAIReceiptData` accept an optional `transactionDate` parameter
- In `ReprintModal.tsx` line 793-801, pass `viewingReceipt.transactionDate` to the create function
- In `ReprintModal.tsx` `handleReprint` for store/AI, also pass the stored `transactionDate` to `printStoreAIReceipt`

### Bug 2: Thermal printer output has no reprint timestamp

**Root cause**: `printReceipt` (line 2082) and `printStoreAIReceipt` (line 2199) end without a "Reprinted at" line. The receipt only shows the original transaction date.

**Fix**:
- Add optional `reprintedAt?: Date` parameter to `printReceipt` and `printStoreAIReceipt`
- When `reprintedAt` is provided, append a `Printed: YYYY-MM-DD HH:MM:SS` line before paper feed
- In `ReprintModal.handleReprint`, pass `reprintedAt: new Date()` so thermal reprints show when they were printed
- In `useDirectPrint` (first-time prints), do NOT pass `reprintedAt` — no reprint line on original prints

### Files Changed

| File | Change |
|------|--------|
| `src/components/TransactionReceipt.tsx` | `createStoreReceiptData` and `createAIReceiptData` accept optional `transactionDate` param, default to `new Date()` |
| `src/components/ReprintModal.tsx` | Pass stored `transactionDate` when viewing/reprinting store/AI receipts; pass `reprintedAt: new Date()` to thermal print calls |
| `src/services/bluetooth.ts` | `printReceipt` and `printStoreAIReceipt` accept optional `reprintedAt` and append printed-on line |
| `src/constants/appVersion.ts` | Bump to v2.10.28 |

