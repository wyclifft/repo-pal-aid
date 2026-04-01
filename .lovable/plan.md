

## Fix: Cart Item Disappears on Quantity Edit + Search Results Hidden by Keyboard

### Issue 1: Item disappears when clearing quantity field

**Root cause**: Line 922 — `parseFloat(e.target.value) || 0` converts empty string to `0`. Line 507-509 — `handleQuantityChange` removes the item when `newQty <= 0`. So when a user deletes "1" to type a new number, the empty field becomes `0`, triggering removal.

**Fix in `src/pages/Store.tsx`**:
- Track quantity as a **string** in the input, only apply numeric logic on blur or when valid
- Change `handleQuantityChange` to accept string input: if the string is empty, keep the item but display empty field; only remove on explicit "remove" action
- Use a local state wrapper or change the `onChange` to not remove at `0`:

```javascript
// Line 507-509: Change condition
const handleQuantityChange = (index: number, newQty: number, raw?: string) => {
  // If user is still typing (empty field), keep item with quantity 0 displayed as empty
  if (raw === '' || raw === undefined && newQty <= 0) {
    const updated = [...cart];
    updated[index].quantity = 0;
    updated[index].lineTotal = 0;
    setCart(updated);
    return;
  }
  if (newQty < 0) return; // Don't allow negative
  const updated = [...cart];
  updated[index].quantity = newQty;
  updated[index].lineTotal = newQty * updated[index].item.sprice;
  setCart(updated);
};
```

- Line 919-926: Change the input to use raw string value and pass it through:

```jsx
<input
  type="number"
  value={cartItem.quantity === 0 ? '' : cartItem.quantity}
  onChange={(e) => {
    const raw = e.target.value;
    const parsed = parseFloat(raw);
    handleQuantityChange(index, isNaN(parsed) ? 0 : parsed, raw);
  }}
  className="w-14 text-center border rounded py-1 text-sm"
  min="0.1"
  step="0.1"
/>
```

- Add a dedicated remove button (X) per cart item so users can intentionally remove items

### Issue 2: Search results hidden by keyboard

**Root cause**: Line 1010 — `max-h-64` (256px) limits the results list height. On mobile with keyboard open, the dialog content gets squeezed and items at the bottom are not scrollable into view.

**Fix in `src/pages/Store.tsx`**:
- Change `max-h-64` to `max-h-[50vh]` so the list adapts to available viewport
- Add `pb-4` padding at bottom of the list for safe scrolling
- Ensure the dialog itself doesn't overflow by adding proper overflow handling

```jsx
<div className="max-h-[50vh] overflow-y-auto space-y-2 pb-4">
```

### File: `src/constants/appVersion.ts`
- Bump to v2.10.12

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Fix quantity edit to not remove items; add remove button; increase search results height |
| `src/constants/appVersion.ts` | Bump to v2.10.12 |

