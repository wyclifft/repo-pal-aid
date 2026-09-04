# Walkthrough - 6-Digit Reference Number Update

I have updated the reference number (REC NO) display across all reports to show the last 6 digits instead of 5, as requested.

## Changes Made

### 1. Global Reference Formatting
Updated the reference formatting logic in `PeriodicReportReceipt.tsx`, `DeviceZReportReceipt.tsx`, and `bluetooth.ts` to use `slice(-6)`.
- **Old Format**: `AE02-51281`
- **New Format**: `AE02-151281` (for a full reference like `AE02100151281`)

### 2. Thermal Printer Layout Adjustments
In `src/services/bluetooth.ts`, I adjusted the column widths for the 58mm thermal printer (32 characters wide) to accommodate the extra digit:
- **Z-Report**: Increased the `ref` column padding to 6 characters.
- **Periodic Report**: Increased the `recColW` from 11 to 12 characters and adjusted the remaining columns to keep the total width at 32.

### 3. Screen Preview Updates
Updated the grid layouts in the receipt preview dialogs to ensure the 12-character reference (`XXXX-XXXXXX`) fits correctly without wrapping or overlapping other columns.

## Verification

### Column Alignment
- **Normal Report**: Date (11) + Rec (12) + Qty (9) = 32 chars.
- **Group Report**: Rec (12) + Name (13) + Qty (6) + space (1) = 32 chars.
- **Z-Report (Buy)**: MNO (9) + Ref (6) + Qty (8) + Time (6) + spaces (3) = 32 chars.

render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/PeriodicReportReceipt.tsx)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/DeviceZReportReceipt.tsx)
render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/bluetooth.ts)
