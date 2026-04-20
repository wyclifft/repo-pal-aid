// Shared app version constant — update here and in android/app/build.gradle
// v2.10.44: Restore .htaccess files to match live CloudLinux Passenger production config (Node 19 nodevenv + maddasys_wycliff DB user). Defensive fix to prevent future redeploys from clobbering working server config and causing 503 errors. No app code changes.
export const APP_VERSION = '2.10.44';
export const APP_VERSION_CODE = 66;
