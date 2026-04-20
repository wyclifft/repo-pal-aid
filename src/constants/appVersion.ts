// Shared app version constant — update here and in android/app/build.gradle
// v2.10.45: Fix /api/members/next-id and POST /api/members SQL — cm_members column is `mcode` (not `mmcode`). Restore backend-api/.htaccess to live CloudLinux Passenger config (Node 19 nodevenv + maddasys_wycliff DB user) so deploys don't 503 the backend.
export const APP_VERSION = '2.10.45';
export const APP_VERSION_CODE = 67;
