

## Fix: Search Text Deletion + Store Photo Crash — v2.10.23

### Bug 1: FarmerSearchModal resets search text while typing

**Root cause**: `FarmerSearchModal.tsx` line 24-30 has a `useEffect` that resets `searchQuery` to `''` whenever `isOpen` or `farmers` changes. Since `farmers` is an array prop, any parent re-render that creates a new array reference triggers this effect — wiping the user's input mid-typing.

**Fix** in `src/components/FarmerSearchModal.tsx`:
- Remove `farmers` from the `useEffect` dependency array that resets `searchQuery`. The reset should only happen when the modal **opens** (i.e., `isOpen` transitions from false to true).
- Use a ref to track previous `isOpen` state, so the reset only fires on open transition, not on every `farmers` update.

### Bug 2: Store photo capture crashes app on Android

**Root cause**: In `src/pages/Store.tsx` lines 1043-1048, the `onCapture` callback calls `handlePhotoCaptured`, then `setShowPhotoCapture(false)`, then `setTimeout(() => handleSubmit(), 100)`. Meanwhile, `PhotoCapture.confirmPhoto()` (line 240-247) **also** calls `onClose()` after `onCapture`. This double-close races with the 100ms `handleSubmit` timeout.

On Android, the native camera flow causes activity recreation. When the photo returns, the compression runs (creating large canvas + Uint8Array from base64), and then the rapid state changes (close dialog + start submission + blob-to-base64 conversion) can exceed available memory on lower-end devices, causing a crash.

**Fix** in `src/components/PhotoCapture.tsx`:
- Wrap the compression in a try/catch with memory-safe fallback — if compression fails, use a smaller canvas (max 600px instead of 800px).
- Add a `null` guard after `atob` to prevent crash on empty base64.

**Fix** in `src/pages/Store.tsx`:
- Remove the redundant `setShowPhotoCapture(false)` from the `onCapture` callback (PhotoCapture already calls `onClose` internally via `confirmPhoto`).
- Increase the `setTimeout` delay from 100ms to 300ms to allow React state to settle after dialog close.

**Fix** in `src/utils/imageCompression.ts`:
- Reduce `MAX_DIMENSION` from 800 to 640 for native platform captures to reduce canvas memory.
- Add a try/catch around the canvas operations to prevent unhandled crashes.

### Version bump
`src/constants/appVersion.ts` → v2.10.23

### Files Changed

| File | Change |
|------|--------|
| `src/components/FarmerSearchModal.tsx` | Only reset searchQuery on open transition, not on farmers change |
| `src/pages/Store.tsx` | Remove double-close, increase submit delay |
| `src/components/PhotoCapture.tsx` | Add memory safety guards for native camera |
| `src/utils/imageCompression.ts` | Lower max dimension, add crash guard |
| `src/constants/appVersion.ts` | Bump to v2.10.23 |

