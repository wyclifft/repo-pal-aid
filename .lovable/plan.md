

## Fix: DeliveredBy Missing from Milk/Coffee Receipt + Sync Crash

### Issue 1: DeliveredBy Not Printed on Milk/Coffee Receipts

**Root Cause**: In `src/pages/Index.tsx`, the `printData` object (lines 981-997) does not capture `deliveredBy`. When `printMilkReceiptDirect` is called (lines 1314-1326), `deliveredBy` is never passed in the options.

The `printReceipt` function in `bluetooth.ts` already supports `deliveredBy` (line 2003, 2075-2077), and `useDirectPrint.ts` already accepts it in its interface (line 17) and passes it through (line 68). The only missing link is in `Index.tsx`.

**Fix** — `src/pages/Index.tsx`:

1. Add `deliveredBy` to the `printData` object (~line 996):
```javascript
deliveredBy: deliveredBy || 'owner',
```

2. Pass it in the `printMilkReceiptDirect` call (~line 1325):
```javascript
deliveredBy: printData.deliveredBy,
```

### Issue 2: App Crash Blocking Sync

**Root Cause**: Console logs show `ReprintProvider` crashes with `TypeError: Cannot read properties of null (reading 'useState')` at `useIndexedDB`. This crashes the entire component tree, preventing `AppContent` (which runs `useDataSync()`) from ever mounting — so no sync runs at all.

This is likely caused by a stale build or HMR issue where React's module reference becomes null. The fix is to wrap the `ReprintProvider` in its own error boundary so a failure there doesn't take down the entire app and sync system.

**Fix** — `src/App.tsx`:

Wrap `ReprintProvider` in an error boundary with a fallback that renders children without reprint functionality:

```javascript
<AuthProvider>
  <ReprintErrorBoundary>
    <ReprintProvider>
      <Toaster />
      <Sonner ... />
      <AppContent />
    </ReprintProvider>
  </ReprintErrorBoundary>
</AuthProvider>
```

Where `ReprintErrorBoundary` catches errors and renders children directly (without the reprint context) as a fallback, ensuring sync and core app functionality remain operational.

Alternatively, add a try-catch guard in `ReprintProvider` itself to handle the case where `useIndexedDB` fails, falling back to a no-op state.

### Issue 2 Alternative (simpler): Guard ReprintProvider

In `src/contexts/ReprintContext.tsx`, wrap the `useIndexedDB` call in a try-catch or use a lazy initialization pattern that doesn't crash if the hook fails. Provide empty defaults so the rest of the app works:

```javascript
export const ReprintProvider = ({ children }: ReprintProviderProps) => {
  const [printedReceipts, setPrintedReceipts] = useState<PrintedReceipt[]>([]);
  
  let dbFunctions = { savePrintedReceipts: async (_: any) => {}, getPrintedReceipts: async () => [] as any[], isReady: false };
  try {
    dbFunctions = useIndexedDB();
  } catch (e) {
    console.error('[REPRINT] useIndexedDB failed, reprint disabled:', e);
  }
  // ... rest uses dbFunctions
```

**Note**: You cannot try-catch a hook call — hooks must be called unconditionally. The correct approach is the error boundary wrapper in `App.tsx`.

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `deliveredBy` to `printData` and pass to `printMilkReceiptDirect` |
| `src/App.tsx` | Add error boundary around `ReprintProvider` to prevent sync-blocking crashes |
| `src/constants/appVersion.ts` | Bump to v2.10.8 |

