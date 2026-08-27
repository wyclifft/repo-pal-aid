# Implementation Plan - zeroOpt Capture Protection

Implement strict "return-to-zero" capture protection for scale and manual weighing. This ensures that after a capture, the scale must return to ≤0.5 kg before another capture is permitted, preventing accidental or fraudulent double-captures.

## User Review Required

> [!IMPORTANT]
> The protection will now persist even when switching farmers or clearing the current farmer. This is stricter than the previous implementation but aligns with the requirement: "the user must not be allowed to make another capture until the scale reading returns to 0.5 kg or below."

## Proposed Changes

### [Core Logic]

#### [MODIFY] [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx)
- **Remove `captureLocked` reset on farmer selection**: In `handleSelectFarmer`, delete the block that resets the lock when a different farmer is picked.
- **Remove `captureLocked` reset on farmer clear**: In `handleClearFarmer`, remove `setCaptureLocked(false)`.
- **Prevent immediate weight reset in `handleCapture`**: Only call `setWeight(0)` and `setGrossWeight(0)` if `zeroOpt` is disabled. This forces the UI (and the lock) to wait for a physical or manual zeroing event.
- **Ensure `captureLocked` state is correctly initialized**: It is already initialized to `false`.

### [UI Components]

#### [VERIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
- Confirm `zeroOptBlocked` correctly disables the Capture button and shows the amber warning banner.

#### [VERIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- Confirm `zeroOptBlocked` correctly disables the Capture button and shows the amber warning banner.

## Verification Plan

### Manual Verification
1.  **Standard Flow (Scale)**:
    - Connect a scale.
    - Place 10kg on scale.
    - Click **Capture**.
    - Verify Capture button is now disabled (grayed out).
    - Verify amber banner "Clear weight to continue" is visible.
    - Remove weight (scale drops to 0.0kg).
    - Verify Capture button becomes enabled once new weight is placed.
2.  **Farmer Switch Bypass Check**:
    - Place 10kg, click **Capture**.
    - While 10kg is still on scale, select a different farmer.
    - Verify Capture button **remains disabled**.
3.  **Clear Farmer Bypass Check**:
    - Place 10kg, click **Capture**.
    - While 10kg is still on scale, click **Clear** (X button).
    - Re-select the same or different farmer.
    - Verify Capture button **remains disabled**.
4.  **Manual Mode Flow**:
    - Enter "10" in Manual weight.
    - Click **Capture**.
    - Verify Capture button is disabled and input still shows "10" (if using `!requireZeroScale` logic).
    - Change manual input to "0".
    - Verify Capture button becomes enabled when a new non-zero weight is entered.
