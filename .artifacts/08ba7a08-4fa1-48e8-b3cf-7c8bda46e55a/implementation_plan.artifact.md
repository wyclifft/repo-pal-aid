# Implementation Plan - Change Decimal Precision to 1 Place

This plan outlines the changes required to update the system to use one decimal place for weights and quantities (e.g., 7.83 -> 7.8) instead of two, as requested.

## User Review Required

> [!IMPORTANT]
> This change will affect all weight and quantity displays (KGS, Liters) throughout the application, including screens, receipts, and reports.
> Monetary values (KES) will remain at two decimal places to maintain financial accuracy.

## Proposed Changes

### Core Logic & Hooks
Update the stable reading logic to round to one decimal place.

#### [MODIFY] [useScaleConnection.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useScaleConnection.ts)
- Change `.toFixed(2)` to `.toFixed(1)` for `finalWeight` calculation.

---

### UI Components (Screens)
Update screens where weights are captured and displayed.

#### [MODIFY] [BuyProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/BuyProduceScreen.tsx)
- Update weight display and change handlers to use `.toFixed(1)`.

#### [MODIFY] [SellProduceScreen.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/SellProduceScreen.tsx)
- Update weight display and change handlers to use `.toFixed(1)`.

#### [MODIFY] [CoffeeWeightDisplay.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/CoffeeWeightDisplay.tsx)
- Update all weight rounding and displays to `.toFixed(1)`.

#### [MODIFY] [LiveWeightDisplay.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/LiveWeightDisplay.tsx)
- Update stable weight display to `.toFixed(1)`.

#### [MODIFY] [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx)
- Update `captureWeight` and `gross_weight` rounding to `.toFixed(1)`.

---

### Receipts & Reports
Update the formatting of weights in receipts and reports.

#### [MODIFY] [TransactionReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/TransactionReceipt.tsx)
- Update item weights and total weights to `.toFixed(1)`.

#### [MODIFY] [ZReportReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ZReportReceipt.tsx)
- Update all liter/weight totals and session breakdowns to `.toFixed(1)`.

#### [MODIFY] [PeriodicReportReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/PeriodicReportReceipt.tsx)
- Update subtotal and total weight displays to `.toFixed(1)`.

#### [MODIFY] [ZReport.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/ZReport.tsx)
- Update thermal receipt strings and UI table cells to use `.toFixed(1)`.

#### [MODIFY] [PeriodicReport.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/PeriodicReport.tsx)
- Update weight column in report table to `.toFixed(1)`.

#### [MODIFY] [ReceiptList.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ReceiptList.tsx)
- Update weight display in list items to `.toFixed(1)`.

#### [MODIFY] [ReprintModal.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ReprintModal.tsx)
- Update total weight display to `.toFixed(1)`.

---

### Services & Backend
Update service-level formatting and backend calculations.

#### [MODIFY] [bluetooth.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/bluetooth.ts)
- Update receipt line formatting and total calculations to use `.toFixed(1)`.

#### [MODIFY] [pdfExport.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/utils/pdfExport.ts)
- Update all weight fields in PDF export templates to `.toFixed(1)`.

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- Update `liters` and `weight` rounding to `.toFixed(1)`.

## Verification Plan

### Manual Verification
1. Connect a Bluetooth scale and verify the live weight display shows only one decimal place.
2. Capture a weight and verify it is rounded to one decimal place in the collection list.
3. Print a transaction receipt and verify weights are displayed with one decimal place.
4. Generate a Z-Report and Periodic Report to verify totals and session data use one decimal place.
5. Export a PDF report and check decimal precision.
6. Verify monetary values (KES) still use two decimal places.
