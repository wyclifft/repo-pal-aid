

## Fix: Store Receipt Printing — Item Names, DeliveredBy, and Layout Optimization

### Issues

1. **Item names not printing**: `TransactionReceipt.handlePrint()` always calls `printReceipt()` (the milk/coffee printer), even for Store (transtype=2) and AI (transtype=3) receipts. `printReceipt` formats output as `index: refno weight` — no item names, no prices.

2. **DeliveredBy not printed**: Neither `printReceipt` nor `printStoreAIReceipt` accept a `deliveredBy` parameter. The field shows in the on-screen receipt but is never sent to the thermal printer.

3. **Receipt layout**: `printStoreAIReceipt` uses generous spacing that can be tightened.

### Fix Plan

**File: `src/components/TransactionReceipt.tsx`** — `handlePrint()` method (~line 370)

Route printing by `transtype`:
- **transtype 1** (milk/coffee): continue using `printReceipt()` (unchanged)
- **transtype 2 or 3** (store/AI): call `printStoreAIReceipt()` with proper item data

```javascript
// Inside handlePrint, replace the single printReceipt call:
if (transtype === 2 || transtype === 3) {
  // Use Store/AI printer with full item details
  const result = await printStoreAIReceipt({
    companyName,
    memberName,
    memberId,
    memberRoute,
    uploadRefNo: uploadrefno || transrefno,
    clerkName,
    deliveredBy,
    items: items.map(item => ({
      item_code: item.item_code || '',
      item_name: item.item_name || '',
      quantity: item.quantity || 1,
      price: item.price || 0,
      lineTotal: item.lineTotal || 0,
      cowDetails: item.cowDetails,
    })),
    totalAmount: totalAmount || 0,
    transactionDate,
    receiptType: transtype === 2 ? 'store' : 'ai',
  });
  // handle result...
} else {
  // existing printReceipt call for milk/coffee
}
```

Import `printStoreAIReceipt` alongside existing `printReceipt`.

**File: `src/services/bluetooth.ts`** — `printStoreAIReceipt` function (~line 2104)

1. Add `deliveredBy?: string` to the function signature
2. Add `deliveredBy` line to receipt output (after Clerk Name, before timestamp)
3. Optimize layout: reduce blank lines, tighten spacing

Also add `deliveredBy` to `printReceipt` for Buy/Sell milk receipts:
1. Add `deliveredBy?: string` parameter
2. Print after Clerk Name line when present

**File: `src/services/bluetooth.ts`** — `printReceipt` function (~line 1982)

1. Add `deliveredBy?: string` to the function signature
2. After the "Clerk Name" line (~line 2071), conditionally add:
```
receipt += formatLine('Delivered By  ', data.deliveredBy || '', W) + '\n';
```

**File: `src/hooks/useDirectPrint.ts`** — pass `deliveredBy` through to `printReceipt`

Add `deliveredBy` to the options interface and pass it in the `printReceipt` call.

**File: `src/constants/appVersion.ts`** — Bump to v2.10.6

### Layout Optimization (printStoreAIReceipt)

Current layout has unnecessary blank lines. Optimized version:
- Remove blank line between header and member info
- Remove blank line between member info and items
- Compact item format: `ItemName x2 500` (already done)
- Add DeliveredBy after Clerk line
- Remove trailing blank line before print

### Files Changed

| File | Change |
|------|--------|
| `src/components/TransactionReceipt.tsx` | Route Store/AI prints to `printStoreAIReceipt`; import it |
| `src/services/bluetooth.ts` | Add `deliveredBy` to both `printReceipt` and `printStoreAIReceipt`; optimize layout |
| `src/hooks/useDirectPrint.ts` | Pass `deliveredBy` through to printer |
| `src/constants/appVersion.ts` | Bump to v2.10.6 |

