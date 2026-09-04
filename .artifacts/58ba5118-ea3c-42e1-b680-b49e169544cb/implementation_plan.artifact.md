# Implementation Plan - Adapt Reference Number Display

The user wants to fix the display of reference numbers (REC NO) across all reports. Currently, the system often slices only the last 5 digits (e.g., `51281`), but references can be longer (e.g., `AE02100151281`). The goal is to show the full ID part and ensure the display adapts to its length.

## User Review Required

> [!IMPORTANT]
> Including the full reference number (e.g., `AE02-100151281`) in reports will take up significantly more horizontal space. This is especially critical for the **thermal printer (Bluetooth)** which has a fixed width of 32 characters.

> [!NOTE]
> I will adjust the column widths in the Periodic Report and Z-Report to accommodate the longer references. For Z-Reports, we will prioritize showing the full TRNID (digits after the devcode) while maintaining enough space for weights and times.

## Proposed Changes

### [Reporting Components]

#### [MODIFY] [PeriodicReportReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/PeriodicReportReceipt.tsx)
- Update `formatRecNo` (and the inline formatting in the Group logic) to use `slice(4)` instead of `slice(-5)`. This will change `AE02-51281` to `AE02-100151281`.
- Adjust grid column widths in the preview to prevent truncation.

#### [MODIFY] [DeviceZReportReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/DeviceZReportReceipt.tsx)
- Update `getShortRef` to use `slice(4)` to show the entire transaction ID instead of just the last 5 digits.
- Adjust the grid columns in the preview (e.g., increase `6ch` to `10ch` or more).

#### [MODIFY] [bluetooth.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/bluetooth.ts)
- **Periodic Report**:
  - Update `formatRecNo` to use `slice(4)`.
  - Increase `recColW` from 11 to 14 characters.
  - Decrease `qtyColW` and `nameColW` slightly to compensate.
- **Z-Report**:
  - Update `shortRef` calculation to use `slice(4)`.
  - Re-calculate column widths for both `showMoney=true` and `false` cases to fit the longer reference while keeping 32 characters total.

## Verification Plan

### Automated Tests
- Review the math for column widths in the thermal printer logic to ensure it exactly equals 32 characters.
- Verify that the `slice(4)` correctly extracts the TRNID part for references of varying lengths.

### Manual Verification
- Ask the user to print a Periodic Report and a Z-Report with a long reference number and verify that all digits are visible and columns are aligned.
