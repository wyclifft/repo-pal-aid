# Implementation Plan - Numeric Keypad Optimization (Final)

This plan implements a strict `type="number"` approach for all digit-only fields to force the numeric keypad on Android 7 / WebView 51, while removing the visual spinner buttons.

## Proposed Changes

### Global Styling

#### [MODIFY] [index.css](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/index.css)
- Add CSS to hide spin buttons for all `type="number"` inputs.
```css
input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
input[type="number"] {
    -moz-appearance: textfield;
}
```

### UI Components - Switch to `type="number"`

The following inputs will be updated to `type="number"` with `autoComplete="off"`.

#### [MODIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
- **Member No.** field.

#### [MODIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- **Member No.** field.

#### [MODIFY] [Store.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Store.tsx)
- **Member No.** field.

#### [MODIFY] [AIPage.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/AIPage.tsx)
- **Member No.** field.

#### [MODIFY] [Login.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/Login.tsx)
- **User ID** field.

#### [MODIFY] [AddMemberModal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/AddMemberModal.tsx)
- **Member ID** and **ID Number** fields.

#### [MODIFY] [CowDetailsModal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/CowDetailsModal.tsx)
- **Number of Calves** field.

---

## Verification Plan

### Manual Verification
- **On Device (Android 7 / WV 51):**
    - Tap on "Member No." and "User ID" fields. Verify that a numeric-only keypad (digits 0-9) appears immediately.
    - Verify that no up/down "spinner" arrows are visible inside the input boxes.
    - Verify that "Member No." lookup (typing `1` to resolve to `M00001`) still works correctly.
    - Verify that the Login page still works correctly with the numeric `User ID`.
