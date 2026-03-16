

## Fix: Cumulative Totals Inconsistency + "New Session" Button Guard

### Issues Found

**1. Cumulative not cleared on route/product/mode change**
- `handleRouteChange` (line 596) clears farmer but NOT `cumulativeFrequency`
- `handleClearFarmer` (line 628) clears farmer but NOT `cumulativeFrequency`
- `handleClearRoute` (line 643) clears route+farmer but NOT `cumulativeFrequency`
- Switching between Store and Buy modes doesn't reset cumulative — stale data from previous route/product lingers

**2. "New Session" button enabled without product selection**
- Line 557: `disabled={... || (availableProductCount > 1 && !selectedProduct)}`
- When `availableProductCount === 0` (loading or no products), the guard passes because `0 > 1` is false — button is enabled prematurely

### Fix Plan

**File: `src/pages/Index.tsx`** — 4 small changes

1. Add `useEffect` to clear cumulative when route or product changes:
```javascript
useEffect(() => {
  setCumulativeFrequency(undefined);
}, [selectedRouteCode, selectedProduct?.icode]);
```

2. Add `setCumulativeFrequency(undefined)` to `handleClearFarmer` (line 635)

3. Add `setCumulativeFrequency(undefined)` to `handleClearRoute` (line 653)

4. Add `setCumulativeFrequency(undefined)` to `handleRouteChange` — both branches (lines 601, 610)

**File: `src/components/Dashboard.tsx`** — 1 change

Line 557: Change button guard from `availableProductCount > 1` to `availableProductCount !== 1`:
```javascript
disabled={!selectedRoute || !selectedSession || (availableProductCount !== 1 && !selectedProduct)}
```
This ensures: if exactly 1 product (auto-selected) → no selection needed; if 0 (loading/none) or >1 → require explicit selection.

**File: `src/constants/appVersion.ts`** — Version bump

### Changes Summary

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Clear `cumulativeFrequency` on route change, product change, farmer clear, and route clear |
| `src/components/Dashboard.tsx` | Fix button guard: `availableProductCount !== 1` instead of `> 1` |
| `src/constants/appVersion.ts` | Version bump |

