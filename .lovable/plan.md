

## Bug Fixes Found — v2.10.15

### Bug 1: Zero-quantity items can be submitted

**Problem**: When a user clears the quantity field (quantity becomes 0), the SUBMIT button remains enabled. Submitting creates transactions with `quantity: 0` and `amount: 0` in the database.

**Fix** in `src/pages/Store.tsx`:
- Add a validation guard in `handleSubmit` (around line 568) and `handleInitiateSale` (line 553): check that all cart items have `quantity > 0`. If any item has zero quantity, show a toast error and block submission.
- Also disable the SUBMIT button when any cart item has zero quantity (line 906).

```typescript
const hasZeroQty = cart.some(c => c.quantity <= 0);

// In handleInitiateSale:
if (hasZeroQty) {
  toast.error('Please set quantity for all items');
  return;
}
```

### Bug 2: Farmer search results hidden by keyboard on mobile

**Problem**: The farmer search modal (line 989) uses `max-h-64` (256px) for the results list. On mobile devices with a virtual keyboard open, this is too small and results get clipped below the keyboard.

**Fix** in `src/pages/Store.tsx`:
- Change the farmer search Dialog to use the same pattern as the item search dialog (which already has `max-h-[85vh] flex flex-col` and flex-based scrolling).
- Apply `max-h-[85vh] flex flex-col` to the DialogContent and `flex-1 overflow-y-auto min-h-0` to the results container.

### Bug 3: Photo audit pagination mismatch

**Problem**: In `backend-api/server.js` (line 3170-3177), the server filters out deleted photos from `rows` but still returns the original SQL `total` count. When deleted photos span pages, the page count is inflated — users see empty or partially-empty pages.

**Fix** in `backend-api/server.js`:
- Return the adjusted total consistently. The current code partially adjusts (`total - (rows.length - validRows.length)`) but this only accounts for the current page. A better approach: run the count query with the same `fs.existsSync` check is impractical, so instead just note when rows were filtered and return `filteredTotal` as a hint. The simplest safe fix: set `totalPages` based on the adjusted total.

Actually, the current adjustment `total - (rows.length - validRows.length)` is a reasonable approximation. The real issue is that `totalPages` on line 3176 still uses the unadjusted `total`. Fix: use the adjusted total for `totalPages`.

```javascript
const adjustedTotal = validRows.length < rows.length ? total - (rows.length - validRows.length) : total;
return sendJSON(res, {
  success: true,
  data: validRows,
  total: adjustedTotal,
  page,
  limit,
  totalPages: Math.ceil(adjustedTotal / limit)  // was using unadjusted total
});
```

### Version bump
`src/constants/appVersion.ts` → v2.10.15

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Block submit with zero-qty items; fix farmer search modal height for keyboard visibility |
| `backend-api/server.js` | Fix photo audit pagination using adjusted total |
| `src/constants/appVersion.ts` | Bump to v2.10.15 |

### Safety
- No schema changes
- No API contract changes
- Existing APK behavior unaffected
- All fixes are additive guards or UI improvements

