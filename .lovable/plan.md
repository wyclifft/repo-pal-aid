# Contabo migration follow-up (v2.12.3)

## What is already correct

- The app already points at the Contabo API: `src/config/api.ts` defaults to `https://2backend.maddasystems.co.ke` (override via `VITE_MYSQL_API_URL`), and the service worker already treats that host as network-first. No APK URL change is needed.
- Every SQL reference to device settings is already lowercase `devsettings` across `backend-api/server.js` and the Yetu files — nothing to rename there.

## Remaining work

### 1. Rename the `user` table to `Users` in backend SQL

Seven SQL statements still query the old lowercase `user` table and will fail on Contabo:

- `backend-api/server.js` — lines 194, 3916, 3931, 3942, 4220 (login, password diagnostics, permissions, add-members check) plus the comment at 4020.
- `backend-api/yetuRoutes.js` — line 87 (Sacco member permission/account lookup).

Each becomes `FROM Users` with column names unchanged. No API contract or response shape changes, so deployed clients are unaffected.

### 2. Sacco dashboard live refresh

Today `useSaccoSummary` / `useSaccoTransactions` only refetch on user action (staleTime 60s / 30s). Change to auto-refresh:

- Poll every 20 seconds while the tab is visible and the device is online (`refetchInterval` with `refetchIntervalInBackground: false`), and refetch on window focus and on the browser `online` event.
- Pause polling while a filter input is being typed is not needed — react-query keys already include filters and `placeholderData` keeps the table stable, so rows update in place without flicker.
- Show a subtle "Updated HH:MM" line plus the existing spinner state in the portal header so the member can see it is live; keep the manual refresh button as a fallback.
- Same treatment for the payments screen summary if it shares the hooks (checked separately during implementation; no logic changes, only query options).

No WebSockets: the backend is a plain Express/Passenger app behind Apache, and short polling is the safe, WebView 51-compatible option.

### 3. Version bump

`src/constants/appVersion.ts` and `android/app/build.gradle` to `2.12.3` / code `179`, with a changelog note describing the Contabo table rename and the live Sacco dashboard.

## Files touched

```text
backend-api/server.js          (user -> Users, 5 queries + 1 comment)
backend-api/yetuRoutes.js      (user -> Users, 1 query)
src/modules/sacco/useSaccoTransactions.ts  (polling/focus/online refetch)
src/modules/sacco/SaccoPortal.tsx          (last-updated indicator)
src/constants/appVersion.ts, android/app/build.gradle  (version)
```

## Notes

- `backend-api/server.js` must be redeployed to `/var/www/sync-service/backend-api/` for the table rename to take effect.
- The postponed `idx_transrefno_unique` index stays postponed; nothing in this change depends on it.
