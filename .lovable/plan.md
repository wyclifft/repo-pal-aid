

## Fix: Wider ID NO and SIGN Fields — v2.10.18

### Problem

The printed receipt uses `________________` (16 underscores) for ID NO and SIGN fields, and the on-screen receipt uses `w-32` (8rem) — both too narrow for handwriting on a thermal receipt.

### Fix

**`src/services/bluetooth.ts`** (lines 2196-2197):
- Print ID NO and SIGN as **full-width lines** instead of label+value format. Each field gets its own label line followed by a full-width underline row, giving the entire 32-character thermal width for writing:
```
ID NO:
________________________________
SIGN:
________________________________
```

**`src/components/TransactionReceipt.tsx`** (lines 616-623):
- Change layout from side-by-side `flex justify-between` to stacked: label on top, full-width dashed underline below (`w-full` instead of `w-32`), with extra vertical spacing (`mt-3`, `min-h-[2rem]`) for finger/pen space.

**`src/constants/appVersion.ts`**: Bump to v2.10.18

### Files Changed

| File | Change |
|------|--------|
| `src/services/bluetooth.ts` | Full-width underline rows for ID NO / SIGN |
| `src/components/TransactionReceipt.tsx` | Stacked layout with wider underlines |
| `src/constants/appVersion.ts` | Bump to v2.10.18 |

