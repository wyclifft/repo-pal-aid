# Walkthrough: Re-implementation of Supervisor 7 Manual Entry Exception

I have re-applied the `supervisor = 7` Manual Entry exception on the current project state (v2.12.48, Code 210). This ensures that specific users in Dairy organizations can bypass the `AutoW` (Auto Weight Only) restriction.

## Changes Made

### Frontend: [useAppSettings.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useAppSettings.tsx)
- Integrated `useAuth` to access the current user's supervisor level.
- Updated the `autoWeightOnly` derivation logic to allow a bypass for level 7 in Dairy:
```typescript
const autoWeightOnly = settings.autow === 1 && !(isDairy && currentUser?.supervisor === 7);
```

### Backend: [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- Updated the `/api/milk-collection` POST endpoint.
- Added a robust database query for the user's supervisor level using `TRIM(userid)` and scoping by `ccode`.
- Modified the enforcement logic to permit manual entry if the user is a supervisor level 7 in a Dairy organization.
- Added enhanced logging to report the `supervisor_level` in case of rejection.

### Versioning
- Updated `APP_VERSION` to `2.12.48` in [appVersion.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/constants/appVersion.ts) and [build.gradle](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/android/app/build.gradle).
- Maintained `versionCode 210` as requested.

## Verification

1.  **Frontend**: If a user has `supervisor: 7` and the org is `D`, the UI will show "Manual Weight Entry" as enabled, even if `psettings.AutoW = 1`.
2.  **Backend**: The server will validate the `supervisor` level directly from the `Users` table before enforcing the `AutoW` rule.

render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useAppSettings.tsx)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/constants/appVersion.ts)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/android/app/build.gradle)
