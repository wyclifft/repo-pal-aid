

# Transaction Reference, Delivery Tracking, and Z-Report Improvements

## 1. Uploadrefno Prefix Change for Store/AI

**Current**: `generateFormattedUploadRef('store')` produces `BA0100000002` (devcode + padded storeId).

**Requested**: Insert `clientFetch` digit into the prefix:
- Store (clientFetch=2): `BA0120000002` — devcode + "2" + padded storeId
- AI (clientFetch=3): `BA0130000002` — devcode + "3" + padded aiId

**Note**: Transtype=1 (milk/buy) remains unchanged.

### Files to modify:
- **`src/utils/referenceGenerator.ts`** — Update `generateFormattedUploadRef` to accept an optional `clientFetch` parameter. When `transactionType` is `'store'` or `'ai'`, insert the clientFetch digit after devcode in the uploadrefno format. Transrefno generation stays the same.
- **`src/pages/Store.tsx`** — Pass `clientFetch` (from route or stored setting) when calling `generateReferenceWithUploadRef('store', clientFetch)`.
- **`src/pages/AIPage.tsx`** — Pass `clientFetch` when calling `generateReferenceWithUploadRef('ai', clientFetch)`.
- **`src/hooks/useSalesSync.ts`** — Offline sync already uses stored `uploadrefno`, no changes needed there.

### How clientFetch reaches Store/AI pages:
The Store and AI pages already load routes via `checkRoutesAndLoadItems()`. We'll extract `clientFetch` from the loaded route data and store it in component state for use during reference generation.

---

## 2. DeliveredBy Field

Add a "Delivered By" input field to Store and AI transaction screens.

### Files to modify:
- **`src/services/mysqlApi.ts`** — Add `delivered_by?: string` to `Sale` and `BatchSaleRequest` interfaces.
- **`src/pages/Store.tsx`** — Add `deliveredBy` state, input field in UI, default to `"owner"`, include in batch request and offline save.
- **`src/pages/AIPage.tsx`** — Same: add state, input field, default to `"owner"`, include in transaction data.
- **`src/components/TransactionReceipt.tsx`** — Add `deliveredBy?: string` to `ReceiptData`, display "Delivered By: \<name\>" on receipt.

---

## 3. Store Photo: Require Only 1 Image

The current Store flow already captures exactly 1 photo (single `PhotoCapture` dialog). The flow is: tap SUBMIT → photo dialog opens → capture 1 photo → auto-submits. This is already correct — **no change needed** unless the user is seeing a different behavior. I'll verify the `PhotoCapture` component doesn't prompt twice.

---

## 4. Z-Report: Separate Totals by Type and Individual Transactions

**Current behavior**: `DeviceZReportReceipt` groups by transtype (Buy/Sell/AI) and shows individual transaction rows with MNO, weight, time. Each transaction row is already separate.

**Requested**: Ensure that if a farmer has multiple deliveries (e.g., 10kg coffee S0001 and 12kg coffee S0002), both appear as separate rows — not accumulated.

The current Z-report already shows individual transactions. The backend query returns per-row data. I'll verify and ensure:
- Each uploadrefno group shows separately (not merged by farmer)
- Type subtotals are clearly labeled

### Files to verify/modify:
- **`src/components/DeviceZReportReceipt.tsx`** — Already groups by transtype. Confirm individual rows are shown, not merged by farmer.
- **`src/components/ZReportReceipt.tsx`** — The legacy Z-report may aggregate by farmer. Will check if it needs item-level breakdown.

---

## 5. Version Bump

- **`android/app/build.gradle`** — Increment versionCode to 18, versionName to "2.7"
- **`src/constants/appVersion.ts`** — Update to "2.7"

---

## Implementation Order

1. Update `referenceGenerator.ts` to support clientFetch-prefixed uploadrefno
2. Add `deliveredBy` field to API interfaces
3. Update Store.tsx (clientFetch prefix + deliveredBy UI + reference changes)
4. Update AIPage.tsx (clientFetch prefix + deliveredBy UI + reference changes)
5. Update TransactionReceipt to display "Delivered By"
6. Verify Z-report shows separate transaction rows (no farmer merging)
7. Version bump

