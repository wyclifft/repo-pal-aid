

## Fix: Org-Type Pending Labels + Web Camera Permission Fallback — v2.10.25

### Bug 1: Dashboard shows "Milk" for orgType C

**Current**: Dashboard line 442 hardcodes `Milk: {pendingMilkCount}`. For coffee cooperatives (orgType C), it should say "Coffee".

**Fix** in `src/components/Dashboard.tsx`:
- Destructure `produceLabel` from `useAppSettings()` (already available — it returns `'Milk'` for D, `'Coffee'` for C)
- Change `Milk: {pendingMilkCount}` to `{produceLabel}: {pendingMilkCount}`

### Bug 2: Web camera fallback shows "Camera access denied"

**Root cause**: In `PhotoCapture.tsx` line 75-78, when `CapacitorCamera.requestPermissions()` returns `denied`, the function shows an error and **returns early** — it never reaches the catch block (line 148-152) where the web camera fallback lives.

On devices without a system camera app, the native permission request may return `denied` because there's no default camera activity to grant permissions to. The web camera (`getUserMedia`) could still work if the WebView has camera access.

**Fix** in `src/components/PhotoCapture.tsx`:
- When native camera permission is `denied`, instead of showing an error and returning, **fall back to web camera** (same as the catch block): set `useNativeCamera = false`, show toast "Using in-app camera"
- In `startWebCamera`, add a retry with relaxed constraints if `getUserMedia` fails with `NotAllowedError` — try `{ video: true }` without facingMode/resolution constraints as a last resort
- Add `navigator.permissions.query({ name: "camera" })` check before `getUserMedia` to provide better guidance when truly denied

### Version bump
`src/constants/appVersion.ts` → v2.10.25

### Files Changed

| File | Change |
|------|--------|
| `src/components/Dashboard.tsx` | Use `produceLabel` from settings instead of hardcoded "Milk" |
| `src/components/PhotoCapture.tsx` | Fall back to web camera when native permission denied; retry with relaxed constraints |
| `src/constants/appVersion.ts` | Bump to v2.10.25 |

