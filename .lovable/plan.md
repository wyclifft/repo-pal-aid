

## Fix: Immediate Pending Counter + Photo Crash Prevention — v2.10.26

### Bug 1: Dashboard pending counter doesn't update immediately after capture/save

**Root cause**: `useDataSync.updatePendingCount` is only called on mount (line 715) and after `syncAllData` completes (line 633). When a receipt is saved via `saveReceipt()` in Index.tsx or a sale is saved offline in Store.tsx, the `syncComplete` event is dispatched — but `useDataSync` never listens for it to refresh the counter.

**Fix** in `src/hooks/useDataSync.ts`:
- Add a `useEffect` that listens for `syncComplete`, `syncStart`, and `receiptSaved` custom events and calls `updatePendingCount()` on each
- In `src/pages/Index.tsx`, dispatch a `receiptSaved` event after each `saveReceipt()` call (offline save paths at lines 1066, 1095, 1111)
- In `src/pages/Store.tsx`, dispatch a `receiptSaved` event after offline sale save

This ensures the Dashboard counter refreshes within milliseconds of any save.

### Bug 2: App closes after taking photo on some Android devices

**Root cause**: The base64→blob conversion at lines 111-115 of `PhotoCapture.tsx` allocates **two large arrays** (`new Array(length)` + `new Uint8Array(length)`) simultaneously. For a 3MB photo, this means ~9MB of temporary memory. On low-RAM Android devices, this can cause an OOM that crashes the WebView.

If it doesn't OOM, but the compression fails, the error is caught at line 144 and triggers `setUseNativeCamera(false)` — which restarts the entire camera flow with web camera, appearing as if the app "closed" or restarted.

**Fix** in `src/components/PhotoCapture.tsx`:
- Replace the manual `atob` + `new Array` + `Uint8Array` conversion with `fetch(dataUrl).then(r => r.blob())` — this uses a single native allocation and is far more memory-efficient
- Wrap the entire photo processing block (lines 96-143) in its own try/catch so that processing errors show "Failed to process photo" with a Retake option, instead of falling back to web camera (which confuses users who successfully took a photo)
- Reduce photo quality from 85 to 70 in `getPhoto()` to reduce base64 size on low-end devices

### Version bump
`src/constants/appVersion.ts` → v2.10.26

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useDataSync.ts` | Listen for `syncComplete`/`receiptSaved` events to refresh pending counts |
| `src/pages/Index.tsx` | Dispatch `receiptSaved` event after offline saves |
| `src/pages/Store.tsx` | Dispatch `receiptSaved` event after offline sale save |
| `src/components/PhotoCapture.tsx` | Use `fetch()` for base64→blob; separate processing errors from camera errors; reduce quality to 70 |
| `src/constants/appVersion.ts` | Bump to v2.10.26 |

