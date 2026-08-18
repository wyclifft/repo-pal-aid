# Implementation Plan - Fix Sacco Portal Access Logic (Refined)

The Sacco Portal access logic will be updated to use `psettings.sacco_module_active` as the organization-level gate and `Users.can_access_payments` as the user-level gate. `orgtype = 'S'` and `psettings.payments_active` will be removed from the requirements.

## Proposed Changes

### Frontend: Sacco Module

#### [MODIFY] [useSaccoAccess.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/useSaccoAccess.ts)
- Maintain `visible = saccoModuleActive` for menu visibility.
- Ensure `canAccessPayments` is correctly derived from `currentUser?.can_access_payments`.

#### [MODIFY] [SaccoPortal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/modules/sacco/SaccoPortal.tsx)
- Change the access gate condition to `(!saccoModuleActive || !canAccessPayments)`.
- Update the `AlertDescription` to show:
    - "The Sacco module is not active for this organization." if `!saccoModuleActive`.
    - "Your account does not have permission to view Sacco payments." if `!canAccessPayments`.
- Remove the `isSacco` (orgtype) and `paymentsActive` specific error messages.

### Backend: Sacco API

#### [MODIFY] [yetuRoutes.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/yetuRoutes.js)
- Update `resolveSaccoAccess` function:
    - Query `sacco_module_active` from `psettings`.
    - Change the organization-level check to `sacco_module_active === 1`.
    - Remove the `orgtype === 'S'` and `payments_active === 1` checks.
    - **Keep** the `can_access_payments === 1` check for user-level permission.
    - Continue to verify linked accounts in `link_account`.

## Verification Plan

### Manual Verification
1. **Org Inactive**: Set `sacco_module_active = 0`. Verify "Sacco Portal" is hidden in the menu. Manually navigate to `/sacco` and verify the "module not active" message.
2. **User Permission Denied**: Set `sacco_module_active = 1` but `can_access_payments = 0` for the user. Verify "Sacco Portal" appears in the menu. Click it and verify the "permission denied" message.
3. **Full Access**: Set `sacco_module_active = 1` and `can_access_payments = 1`. Verify the portal opens and loads data regardless of whether `orgtype` is 'D', 'C', or 'S'.
4. **Backend API**: Verify that `/api/yetu/transactions` returns `403` if `can_access_payments` is 0, even if `sacco_module_active` is 1.
