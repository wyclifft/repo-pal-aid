# Walkthrough - zeroOpt Capture Protection

I have implemented the strict `psettings.zeroOpt` capture protection. This ensures that once a weight has been captured, the scale (or manual input) must return to a near-zero state (≤0.5 kg) before another capture is allowed. This protection is now persistent and cannot be bypassed by switching farmers or clearing the selection.

## Changes

### Core Logic Enforcement
In [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx), I have made the `captureLocked` state persistent:
- **Removed bypasses**: The capture lock no longer resets when a new farmer is selected or when the current farmer is cleared.
- **Conditional Weight Reset**: When `zeroOpt` is enabled, the `weight` state is NOT automatically reset to zero after a capture. This forces the system to wait for a real zeroing event from the scale or a manual zeroing from the user.
- **Subsequent Capture Blocking**: The `handleCapture` function now includes an explicit check that prevents a second capture if `captureLocked` is true and weight is >0.5 kg, providing a second layer of security beyond the disabled button.

### UI Feedback
The [BuyProduceScreen](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx) and [SellProduceScreen](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx) components now strictly reflect this state:
- **Button Disabling**: The Capture button is immediately disabled and grayed out after a successful capture.
- **Warning Banner**: An amber warning banner ("Clear weight to continue") appears when the lock is active, informing the user that the scale must return to ≤0.5 kg.

## Verification Results

### Automated Logic Check
- [x] `captureLocked` persists across farmer changes.
- [x] `captureLocked` persists across clearing the farmer.
- [x] `captureLocked` resets only when `weight <= 0.5`.
- [x] Manual entry requires typing "0" (or ≤0.5) to unlock next capture when `zeroOpt=1`.

### UI Consistency
- [x] Capture button grays out immediately on capture.
- [x] Amber warning banner correctly indicates the requirement to clear weight.
- [x] Submission does not reset the capture lock if weight is still present.
