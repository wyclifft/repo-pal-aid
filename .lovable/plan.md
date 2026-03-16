

## Two Issues: Reference clientFetch Leak + Camera Double Trigger

### Issue 1: Reference clientFetch Leaking Between Modes

**Root Cause**: The receipt displays `uploadrefno` as the visible "Reference NO" (line 456 of TransactionReceipt.tsx: `{uploadrefno || transrefno}`). The reference generation code is actually correct — `generateOfflineReference()` never includes clientFetch, and `generateFormattedUploadRef('milk')` correctly skips clientFetch for milk type.

However, the **backend trnid parsing** at `server.js` line 554 and 958 does `parseInt(transrefno.substring(devcode.length))` — this strips the devcode prefix and parses the rest as the trnid. If a store uploadrefno like `BB0120000012` is ever stored in or compared against the transrefno field, the backend parses `20000012` as the trnid instead of `12`.

Additionally, the backend at line 2271 has the same issue: `lastRef.slice(deviceData.devcode.length)` — when querying `SELECT transrefno ... ORDER BY transrefno DESC LIMIT 1`, if any store transaction stored `BB0120000012` as transrefno, the DESC ordering would place it ABOVE `BB0100000013` (since "2" > "1"), and then parsing would yield `20000012`.

The counter sync then propagates this corrupted trnid to the frontend, causing all subsequent references to start from 20000013+.

**Fix**: 

**File: `backend-api/server.js`** (3 locations)
- Lines 554, 644, 958, 2271: When parsing trnid from transrefno, extract only the **last 7 digits** (since trnid is padded to 8 digits max and devcode is 4 chars, the reference is 12 chars). This prevents clientFetch digits from corrupting the counter.
- Safer approach: always use `parseInt(transrefno.slice(-8))` or `parseInt(transrefno.substring(devcode.length).slice(-7))` to get the actual sequential number.

**File: `src/utils/referenceGenerator.ts`**
- In `syncOfflineCounter`, add a safety check: if the synced trnid is unreasonably large (e.g., > 10000000), log a warning — this indicates a parsing corruption from the backend.

### Issue 2: Camera Opening Twice on Android

**Root Cause**: The "Couldn't save last Camera's Plugin getPhoto call" warning comes from Capacitor's Camera plugin when the Android activity is destroyed and recreated during the camera intent. On Android, launching the native camera app can cause the WebView activity to be destroyed (low memory). When it's recreated, React re-mounts the component, the `useEffect` fires again, and `captureWithNativeCamera()` is called a second time.

The current guard (`nativeCameraTriggeredRef`) uses a React ref, which is **reset when the component re-mounts** (activity recreation destroys the React tree). So the guard doesn't survive activity recreation.

**Fix**:

**File: `src/components/PhotoCapture.tsx`**
1. Use a **module-level** flag (outside the component) instead of a React ref to track whether a native camera capture is in progress. This survives component re-mounts.
2. Add `android:configChanges` with `"orientation|screenSize|screenLayout"` — already present in AndroidManifest.xml, so that's not the issue.
3. Add a timestamp-based debounce: store `window.__photoCaptureInProgress = true` before calling `getPhoto`, clear it on success/error/cancel. Skip re-triggering if the flag is still set.

### Changes Summary

| File | Change |
|------|--------|
| `backend-api/server.js` | Fix trnid parsing to use last 7 digits, preventing clientFetch corruption |
| `src/utils/referenceGenerator.ts` | Add sanity check for unreasonably large trnid values during sync |
| `src/components/PhotoCapture.tsx` | Use module-level flag to prevent double camera trigger on Android activity recreation |
| `src/constants/appVersion.ts` | Version bump |

