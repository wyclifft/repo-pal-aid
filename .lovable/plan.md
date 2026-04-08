

## Fix: Fall Back to Web Camera When No System Camera App — v2.10.24

### Problem

On Android devices without a built-in system camera app, `CapacitorCamera.getPhoto()` throws an error because no activity can handle the camera intent. The app shows an error instead of falling back to the WebView-based camera (`getUserMedia`).

### Fix

**`src/components/PhotoCapture.tsx`**:
- In the `captureWithNativeCamera` catch block (line 140-152), when the error is **not** a user cancellation, instead of showing a generic error, **fall back to the web camera**:
  - Set `useNativeCamera` to `false` → this triggers the `useEffect` to call `startWebCamera()`
  - Log the fallback so it's diagnosable
  - Show a toast: "Using in-app camera"

- This means the web camera UI (live video preview + capture button) will appear instead, using `navigator.mediaDevices.getUserMedia` which works on any Android WebView with a camera sensor — no system camera app needed.

**`src/constants/appVersion.ts`**: Bump to v2.10.24

### Files Changed

| File | Change |
|------|--------|
| `src/components/PhotoCapture.tsx` | Fall back to web camera when native camera intent fails |
| `src/constants/appVersion.ts` | Bump to v2.10.24 |

