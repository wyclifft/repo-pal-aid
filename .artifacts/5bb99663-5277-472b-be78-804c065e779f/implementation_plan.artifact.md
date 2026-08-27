# Fix ReferenceError: psettings is not defined in AIPage.tsx

The user reported that AI transactions are failing with `ReferenceError: psettings is not defined` in `AIPage.tsx`. This occurred because `psettings` is used in the transaction payload but was not imported or initialized in that component.

## Proposed Changes

### [AIPage Component]

#### [MODIFY] [AIPage.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/AIPage.tsx)
- Import `useAppSettings` from `@/hooks/useAppSettings`.
- Initialize `psettings` using the `useAppSettings` hook: `const { settings: psettings } = useAppSettings();`.

## Verification Plan

### Manual Verification
- I will verify that `psettings` is correctly imported and initialized.
- I will ensure that the usage of `psettings?.routeLabel` and `psettings?.periodLabel` in the transaction payload is now valid.
