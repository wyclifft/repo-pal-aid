# Implementation Plan - Z Report Enhancements

This plan details the changes required to update the Z Report to show farmer counts instead of entries for sessions, and to use full route descriptions instead of codes.

## Proposed Changes

### Backend Components

#### [MODIFY] [server.js](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
- Update `GET /api/z-report` handler:
    - Modify the SQL query to join `transactions` with `fm_tanks` to fetch `descript` as `route_name`.
    - Update `byRoute` grouping to use `route_name` (falling back to `route` code).
    - Update `bySession` (AM/PM) to include a `farmers` count (unique `memberno`).

### Frontend Components

#### [MODIFY] [mysqlApi.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/services/mysqlApi.ts)
- Update `ZReportData` interface to include `farmers: number` in the `bySession` AM and PM objects.

#### [MODIFY] [ZReportReceipt.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/ZReportReceipt.tsx)
- In `handlePrint`:
    - Replace `data.bySession.AM.entries` with `data.bySession.AM.farmers`.
    - Replace `data.bySession.PM.entries` with `data.bySession.PM.farmers`.
- In the JSX:
    - Update the "BY SESSION" section labels and values to show "Farmers" instead of "Entries".

#### [MODIFY] [ZReport.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/ZReport.tsx)
- Update the table under "By Session" to change the "Entries" column to "Farmers" and use the `farmers` count.
- Update the thermal print preview (`thermal-print` div) to show "Farmers" instead of "Entries" for sessions.

#### [MODIFY] [pdfExport.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/utils/pdfExport.ts)
- Update `generateZReportPDF` to show "Farmers" instead of "Entries" in the session summary (both HTML and text versions).

## Verification Plan

### Automated Tests
- I will verify the changes by manually inspecting the code and ensuring that the `farmers` count is correctly calculated and displayed.
- I will verify that the route descriptions are being used as keys for the `byRoute` object.

### Manual Verification
- Ask the user to verify the Z Report display on the device.
- Verify that the print output (Bluetooth/Thermal) shows "Farmers" instead of "Entries" for sessions.
- Verify that the PDF output shows "Farmers" instead of "Entries" for sessions.
