// Shared app version constant — update here and in android/app/build.gradle
// v2.10.42: Fix Add-Member CORS preflight failure — remove X-Device-Fingerprint request header (body fallback covers it); also widen backend CORS allow-headers list (server.js + .htaccess) to include X-Device-Fingerprint and X-App-Origin for completeness
export const APP_VERSION = '2.10.42';
export const APP_VERSION_CODE = 64;
