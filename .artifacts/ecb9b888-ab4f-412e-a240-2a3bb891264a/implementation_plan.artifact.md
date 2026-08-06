# Implementation Plan - Update Linked Accounts Separator to `&&`

The current implementation uses `#` or `##` as a separator for multiple linked accounts. This is problematic because account numbers can contains `#` (e.g., `77136#T001`). This plan updates all relevant locations to use `&&` as the delimiter, ensuring `#` is treated as part of the account number.

## Proposed Changes

### Backend API

#### [MODIFY] [yetuRoutes.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/yetuRoutes.js)
- Update `resolveSaccoAccess` to split `link_account` using `&&` instead of `#`.
- Update comments to reflect the new separator.

#### [MODIFY] [yetuService.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/yetuService.js)
- Update `resolveMember` SQL query to use `&&` as the separator in `REPLACE` logic (and remove the replacement of `#`).
- Update comments in `resolveMember` to reflect the new separator.

#### [MODIFY] [YETU_SACCO_GUIDE.md](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/YETU_SACCO_GUIDE.md)
- Update documentation and examples to use `&&` as the separator for multiple accounts.

#### [MODIFY] [MIGRATION_YETU_SACCO.sql](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/MIGRATION_YETU_SACCO.sql)
- Update comments and examples in the migration file to reflect the new separator.

### Frontend

#### [MODIFY] [SaccoPortal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/SaccoPortal.tsx)
- Update the comment regarding how `accounts` are split.

#### [MODIFY] [appVersion.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/constants/appVersion.ts)
- Update the version comment to reflect the new separator.

## Verification Plan

### Manual Verification
- **Webhook Matching**: Send a webhook request with an account number containing `#` (e.g., `77136#T001`) and verify it matches correctly against a member record where `account_number` is `77136#T001&&77137#T002`.
- **Portal Access**: Mock a user with `link_account = '77136#T001&&77137#T002'` and verify that the `resolveSaccoAccess` function correctly returns an array of two accounts: `['77136#T001', '77137#T002']`.
- **Account Picker**: Verify that the frontend account picker displays the full account numbers (including `#`) correctly.
