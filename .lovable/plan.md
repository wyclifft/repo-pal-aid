

## Fix: Show Both Transaction Date and Printed Date in Recent Receipts — v2.10.19

### Problem

The Recent Receipts modal (ReprintModal) only displays `printedAt` (line 654). It does not show the actual transaction date separately. The user wants:
- **Transaction date** — when the sale/collection happened
- **Printed on date/time** — when the receipt was originally printed

### Fix in `src/components/ReprintModal.tsx`

**Lines 650-661** — Update the timestamp row to show both dates:

1. Show the **transaction date** on the left using `receipt.transactionDate` (for store/AI) or the first collection's date (for milk). Label: date only, e.g. `"Apr 07"`.
2. Show the **printed on** date/time on the right using `receipt.printedAt`. Label: `"Printed: Apr 07, 14:30"`.

For milk receipts that don't have `transactionDate`, derive it from `receipt.collections[0]?.date` or fall back to `printedAt`.

### Version bump
`src/constants/appVersion.ts` → v2.10.19

### Files Changed

| File | Change |
|------|--------|
| `src/components/ReprintModal.tsx` | Show transaction date + printed-on date separately in receipt cards |
| `src/constants/appVersion.ts` | Bump to v2.10.19 |

