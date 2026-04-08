

## Fix: Separate Sync Counts + Receipt Date/Time Bug — v2.10.22

### Bug 1: Receipt dates all the same for printOpt=0

**Root cause**: For milk receipts, `ReprintContext.addMilkReceipt` (line 94) sets `printedAt: new Date()` but never sets a `transactionDate` field. The `ReprintModal` (line 656-657) falls back to `receipt.collections[0].collection_date` for the transaction date — which should be correct. However, the `printedAt` is set at call time, and when `printOpt=0` (no modal shown), the background async block at line 1331 calls `addMilkReceipt` inside a rapid loop — all receipts get essentially the same `printedAt` timestamp.

For store/AI receipts, `transactionDate: new Date()` is set at submit time (Store.tsx line 650), so those should be unique per submission.

**The real issue**: When `printOpt=0`, the receipt modal is skipped and the user sees receipts only in "Recent Receipts". The `printedAt` for each milk receipt is set correctly at `new Date()` per submission. But the `collection_date` on captured collections may share the same timestamp if captures happen in the same minute — they are set at capture time (Index.tsx line 861), not submit time.

The displayed "Printed: Apr 07, 14:30" uses `HH:mm` format — if two receipts are saved within the same minute, they look identical. Adding seconds will differentiate them.

**Fix**:
- In `ReprintModal.tsx` line 670: change `'MMM dd, HH:mm'` to `'MMM dd, HH:mm:ss'` so printed-on times are distinguishable
- In `ReprintContext.tsx`: add `transactionDate` to milk receipts using `collections[0].collection_date` so the transaction date is explicitly stored rather than derived

### Feature: Separate sync counts on Dashboard

**Current state**: Dashboard line 438 shows `SYNC- 0/{pendingCount}` as a single combined number. `useDataSync.updatePendingCount` (line 453-474) sums milk receipts + store/AI sales into one `pendingCount`.

**Fix**: Split `pendingCount` into `pendingMilkCount` and `pendingSalesCount` in `useDataSync`, expose both. Update Dashboard to show them separately:

```
Milk: 0/3  |  Store/AI: 0/2
```

### Changes

| File | Change |
|------|--------|
| `src/hooks/useDataSync.ts` | Split `pendingCount` into `pendingMilkCount` + `pendingSalesCount`; expose both + combined `pendingCount` for backward compat |
| `src/components/Dashboard.tsx` | Show separate milk and store/AI pending counts |
| `src/contexts/ReprintContext.tsx` | Set `transactionDate` on milk receipts from `collections[0].collection_date` |
| `src/components/ReprintModal.tsx` | Show seconds in printed-on time (`HH:mm:ss`) |
| `src/constants/appVersion.ts` | Bump to v2.10.22 |

