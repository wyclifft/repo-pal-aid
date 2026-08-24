# Implementation Plan - Gradual Transaction Clearing

This plan updates the "X" (Clear) button behavior in the **Buy Produce** and **Sell Produce** portals. Instead of clearing the entire transaction state at once, it will now remove captured transactions one by one. The farmer information will only be cleared when no captures remain.

## User Review Required

> [!IMPORTANT]
> The "X" button will now require multiple clicks to fully clear the screen if multiple transactions are captured.
> 1. Each click removes the most recent capture.
> 2. When the last capture is removed, the farmer details and input field are also cleared.
> 3. If no captures exist, a single click clears the farmer details/input immediately (current behavior).

## Proposed Changes

### Core Logic

#### [MODIFY] [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx)
- Update `handleClearFarmer` to check the `capturedCollections` length.
- If items exist, remove the last item using `setCapturedCollections`.
- If the last item is removed (length becomes 0), proceed to clear all farmer-related state.
- Add informative toast messages for each step.

### Portal UI

#### [MODIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
- Update `handleClear` to only clear the local `memberNo` state if `capturedCollections.length <= 1`. This ensures the input field remains populated while transactions are being cleared one by one.

#### [MODIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- Apply the same `handleClear` logic as `BuyProduceScreen.tsx`.

## Verification Plan

### Manual Verification
1. Open the **Buy Produce** portal.
2. Select a farmer and capture 3 transactions.
3. Click the "X" button once:
   - Verify the 3rd transaction is removed.
   - Verify the 1st and 2nd transactions remain.
   - Verify the farmer and "Member No." input remain.
4. Click "X" again:
   - Verify the 2nd transaction is removed.
5. Click "X" a third time:
   - Verify the 1st transaction is removed.
   - Verify the farmer details are cleared.
   - Verify the "Member No." input is empty.
6. Repeat the same steps in the **Sell Produce** portal.
7. Verify that clicking "X" when NO transactions are captured still clears the farmer/input immediately.
