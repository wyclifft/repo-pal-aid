# Re-implementation of Supervisor 7 Manual Entry Exception

This plan re-applies the bypass for the `AutoW` (Auto Weight Only) restriction for users with `supervisor = 7` in organizations of type 'D' (Dairy) on the current version `v2.12.47`.

## User Review Required

> [!IMPORTANT]
> The bypass only applies when `orgtype = 'D'`.
> Version numbers will be aligned to `v2.12.47` across both frontend and backend.

## Proposed Changes

### [Frontend]

#### [MODIFY] [useAppSettings.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useAppSettings.tsx)
- Import `useAuth` from `@/contexts/AuthContext`.
- Update `autoWeightOnly` calculation:
    ```typescript
    const autoWeightOnly = settings.autow === 1 && !(isDairy && currentUser?.supervisor === 7);
    ```

### [Backend]

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- In the `/api/milk-collection` endpoint:
    - Update the `psettings` query to include `IFNULL(orgtype, "D") as orgtype`.
    - Add a robust query to fetch `supervisor` from the `Users` table using `TRIM(userid)` and `ccode`.
    - Update the `AutoW` enforcement logic to allow manual entry if `orgtype === 'D'` and `supervisor === 7`.
    - Add enhanced logging for rejections (including supervisor level).

### [Versioning]

#### [MODIFY] [build.gradle](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/android/app/build.gradle)
- Set `versionName "2.12.47"` to match `src/constants/appVersion.ts`.

## Verification Plan

### Automated Tests
- N/A.

### Manual Verification
1.  **Dairy Org (`orgtype='D'`), `AutoW=1`**:
    - Normal user: Manual entry disabled.
    - `supervisor=7` user: Manual entry enabled. Capture and submit success.
2.  **Backend Logs**: Verify `supervisor_level` is logged on rejection to aid debugging.
