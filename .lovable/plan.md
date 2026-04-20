

## Fix `Camera.then() is not implemented on android` (Real Root Cause) — v2.10.49

### Root Cause (corrected from v2.10.48)

v2.10.48 removed the static enum import, but the error returned because the **actual** trigger is different and lives in two places:

```ts
// In src/utils/permissionRequests.ts (line 11–17)
const loadCapacitorCamera = async () => {
  if (Capacitor.isNativePlatform()) {
    const { Camera } = await import('@capacitor/camera');
    return Camera;   // ← THE BUG
  }
  return null;
};

// In src/components/PhotoCapture.tsx (line 14–23)
const loadCapacitorCamera = async (): Promise<typeof CapacitorCameraType | null> => {
  ...
  const mod = await import('@capacitor/camera');
  return mod.Camera;   // ← SAME BUG
};
```

`Camera` is a **Capacitor plugin Proxy**. When you `return Camera` from an `async` function, JavaScript wraps the return value in a Promise — and to do that wrapping, the runtime checks whether the returned value is already a thenable by accessing its `.then` property. Accessing `.then` on the Capacitor Proxy fires the proxy's `get` trap, which on Android throws:

> `"Camera.then()" is not implemented on android`

The throw happens inside Promise-resolution machinery, **outside any `try/catch`**, so it surfaces as an unhandled rejection on app startup (`requestAllPermissions` runs in `App.tsx` line 208) — exactly matching the user's stack trace from `index-CisiQ8KA.js`.

This explains why v2.10.48 (which only addressed static enum imports) did not fix the issue, and why the error fires on `/` (app startup) before the user ever opens the camera.

### Fix

Never return a Capacitor plugin proxy directly from an `async` function. Wrap it in a plain object so the Promise-resolution code only probes the wrapper's `.then` (which is `undefined`, the safe path), never the proxy's.

| File | Change |
|---|---|
| `src/utils/permissionRequests.ts` | Change `loadCapacitorCamera()` to return `{ Camera }` instead of `Camera`. Update the two call sites (`requestAllPermissions` and `requestCameraPermission`) to destructure: `const cam = await loadCapacitorCamera(); if (cam) { const { Camera } = cam; … }`. |
| `src/components/PhotoCapture.tsx` | Same wrapping pattern in the local `loadCapacitorCamera()` and its single caller `captureWithNativeCamera()`. |
| `src/constants/appVersion.ts` | Bump to **v2.10.49 (Code 71)** with comment: "Fix Camera.then() unhandled rejection on Android — wrap plugin proxy in object before returning from async fn." |

No other behavior changes. Web flow unchanged. iOS unchanged. Permission requests still fire on startup; they just no longer trigger the proxy `.then` trap.

### What does NOT change
- Backend (`server.js`) — untouched.
- IndexedDB schema, sync engine, reference generator — untouched.
- Capacitor plugin versions, native code, `.htaccess`, gradle — untouched.
- The `import type { Camera as CapacitorCameraType }` line in `PhotoCapture.tsx` — kept (type-only, erased by esbuild).
- Web/PWA camera flow — completely unaffected (the `if (!Capacitor.isNativePlatform()) return null` branch is unchanged).

### Backward Compatibility
- All production Capacitor clients (v2.10.40–v2.10.48): no contract change. Just stops the unhandled rejection on startup.
- Previously, the rejection was non-fatal *most of the time* (camera still worked because the actual `Camera.requestPermissions()` call later succeeded), but it polluted console and on some Android builds it bubbled into the WebView error pipeline and aborted subsequent camera operations. After this fix, the proxy is never accessed by Promise-resolution machinery.

### Verification After Deploy
1. Reload the Android app. Console should no longer show `Camera.then() is not implemented on android`.
2. Startup log should still show: `📱 Permissions requested on startup: { bluetooth: true, camera: true }`.
3. Open Store → add item → Complete Sale → camera dialog opens cleanly and captures a photo.
4. Re-open camera multiple times in one session — no degradation.

### Out of Scope
- Migrating off the deprecated `getPhoto` API to Capacitor Camera 8.1+ `takePhoto` (separate task).
- Removing the still-pending coffee-session backfill SQL (separate one-shot).
- Refactoring `PhotoCapture.tsx` into smaller components.

