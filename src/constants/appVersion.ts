// Shared app version constant — update here and in android/app/build.gradle
// v2.10.43: Add Member UX — auto-suggest next mmcode per ccode (preserves prefix + padding) via new GET /api/members/next-id; backend POST /api/members now auto-retries on ER_DUP_ENTRY (max 5); inline green success banner inside Add Member modal; modal stays open after success and re-fetches next ID for rapid sequential entry
export const APP_VERSION = '2.10.43';
export const APP_VERSION_CODE = 65;
