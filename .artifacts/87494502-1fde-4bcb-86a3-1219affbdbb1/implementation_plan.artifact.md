# Implementation Plan - Fix Weight Precision and Stability UX

Fix the 1.3kg vs 1.25kg discrepancy and the repeating "Stable Reading" banner.

## User Review Required

> [!NOTE]
> All weight displays in the Buy/Sell screens will be updated to show 2 decimal places to match high-precision scales.

## Proposed Changes

### [Component] Bluetooth Hooks

#### [MODIFY] [useScaleConnection.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useScaleConnection.ts)
- **Clear buffer on fluctuation**: When a significant difference is detected (`Math.abs(newWeight - lastStableWeightRef.current) > STABLE_READING_THRESHOLD`), clear the `stableReadingsRef` buffer. This ensures the progress bar starts from 0% when the weight actually changes, providing better visual feedback.
- **Ensure 2-decimal consistency**: Confirm all internal calculations use high precision before final rounding.

### [Component] UI Components

#### [MODIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
#### [MODIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- Update all instances of `toFixed(1)` to `toFixed(2)` for:
    - Member Info Card (Total Captured Weight)
    - Weight Today summary
    - Transaction list (Net, Gross, Tare weights)

### [Component] Receipt Rendering

#### [MODIFY] [ReceiptModal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ReceiptModal.tsx)
#### [MODIFY] [ReprintModal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ReprintModal.tsx)
- Update weight formatting to 2 decimals to match the on-screen display.

## Verification Plan

### Automated Tests
- N/A

### Manual Verification
1.  **Banner UX Check**:
    - Place 1.25kg on scale.
    - Wait for stable (100%).
    - Move weight to 2.50kg.
    - Verify banner progress resets to 33% (or 0%) and moves to 100% as it settles, instead of flickering at 100%.
2.  **Summary Card Check**: Verify "Member Info Card" shows "1.25KGS" instead of "1.3KGS".
3.  **List Check**: Verify transaction list shows 2 decimals.
