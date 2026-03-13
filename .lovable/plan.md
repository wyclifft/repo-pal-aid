

## Filter Cumulative Totals by Selected Produce Type

### Problem
When a farmer has multiple produce types (e.g., Coffee CF01 + Macadamia MC01), the cumulative total shown on the buy screen and receipt includes **all** products combined. It should only show the total for the **currently selected** produce type.

### Root Cause
The `cumulativeFrequency` state holds `{ total, byProduct[] }` where `total` is the sum across all products. When displaying or printing, this unfiltered `total` is used. The `selectedProduct.icode` is never used to filter the cumulative calculation.

### Solution
Filter the cumulative data by `selectedProduct.icode` at every point where `cumulativeFrequency` is set or computed. When a product is selected, the cumulative total should only include the weight for that specific `icode`.

### Changes

**`src/pages/Index.tsx`** — Create a helper function and apply it at all cumulative computation points:

1. **Add a helper** (near top of component) to filter cumulative by selected product icode:
```typescript
const filterCumulativeByProduct = (
  cumData: { total: number; byProduct: Array<{icode: string; product_name: string; weight: number}> },
  productIcode?: string
) => {
  if (!productIcode || cumData.byProduct.length === 0) return cumData;
  const match = cumData.byProduct.find(p => p.icode === productIcode);
  return match 
    ? { total: match.weight, byProduct: [match] }
    : { total: 0, byProduct: [] };
};
```

2. **Apply filter at 6 locations** where `setCumulativeFrequency()` is called or cumulative is computed:
   - **Line ~267** (refreshCumulativesBatch — post-sync refresh): filter merged result by `selectedProduct?.icode`
   - **Line ~567** (handleSelectFarmer — online pre-fetch): filter merged result
   - **Line ~574** (handleSelectFarmer — offline fallback): filter result
   - **Line ~1158** (handleSubmit — printCopies=0 online): filter computed cumulative
   - **Line ~1161/1165/1169** (handleSubmit — printCopies=0 offline/fallback): filter
   - **Line ~1227** (handleSubmit — background print online): filter
   - **Line ~1235** (handleSubmit — background print offline fallback): filter

Each call becomes:
```typescript
// Before:
setCumulativeFrequency({ total: cloudCumulative + unsynced.total, byProduct: Object.values(merged) });
// After:
setCumulativeFrequency(filterCumulativeByProduct({ total: cloudCumulative + unsynced.total, byProduct: Object.values(merged) }, selectedProduct?.icode));
```

For the background print section (where `selectedProduct` may have been cleared), capture `selectedProduct?.icode` into `printData` before clearing state.

3. **Capture icode in printData** (~line 1070 area where printData is built): add `productIcode: selectedProduct?.icode` to the printData object so the background async print block can use it after state is cleared.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `filterCumulativeByProduct` helper; apply at all 7 cumulative computation points; capture `productIcode` in printData |

### No Backend Changes Needed
The backend already returns `by_product` arrays with per-icode breakdowns. This is purely a frontend filtering fix.

