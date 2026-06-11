## Goal
Rename the built APK from `app-debug.apk` to:

```
DeliCoop101.v2.10.112-fix133-ssaid-fingerprint.apk
```

Format: `DeliCoop101.v{versionName}-fix{versionCode}-{fixTag}.apk`

Single source of truth is `src/constants/appVersion.ts`, injected into Gradle at build time so we never edit two places per release.

## Changes

### 1. `src/constants/appVersion.ts`
Add and export a new constant alongside the existing version fields:
```ts
// Short kebab-case tag describing the headline fix in this build.
// Used by Android build to name the APK output file.
export const APP_FIX_TAG = 'ssaid-fingerprint';
```
Bump version: `APP_VERSION = '2.10.113'`, `APP_VERSION_CODE = 134`, with a changelog comment noting the APK-naming change.

### 2. `android/app/build.gradle`
At the top of the file (above `apply plugin`), add a small Groovy block that parses the three constants out of `src/constants/appVersion.ts` via regex — no Node execution required at build time:

```groovy
def appVersionTs = file('../../src/constants/appVersion.ts').text
def fixTag = (appVersionTs =~ /APP_FIX_TAG\s*=\s*['"]([^'"]+)['"]/)[0][1]
```

Then inside the existing `android { ... }` block:
```groovy
applicationVariants.all { variant ->
    variant.outputs.all {
        outputFileName = "DeliCoop101.v${variant.versionName}-fix${variant.versionCode}-${fixTag}.apk"
    }
}
```

`versionName` and `versionCode` already come from the existing `defaultConfig` (kept aligned with `appVersion.ts` per the Version Management memory), so the filename stays in sync automatically.

### 3. Per-release workflow (documented in the comment in `appVersion.ts`)
Each release:
1. Bump `APP_VERSION` / `APP_VERSION_CODE` in `appVersion.ts`
2. Update `APP_FIX_TAG` to a short kebab-case slug for the headline fix
3. Bump matching `versionName` / `versionCode` in `android/app/build.gradle`
4. Build → APK is named automatically.

## Safety
- No runtime code changes — build-time output naming only.
- Gradle parse is resilient: if regex fails, build still succeeds (we'll guard with a fallback `fixTag = 'build'`).
- No impact on web, sync, transactions, receipts, fingerprint, or any production logic.
