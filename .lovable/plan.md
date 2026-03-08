

## Plan: Per-Product Cumulative Totals (by icode)

### What Changes

Currently, cumulative weight is a single number combining all products (icode) for a farmer. This plan breaks it down by product, showing a grand total plus a per-product breakdown on receipts and thermal prints.

### Changes Required

#### 1. Backend API (`backend-api/server.js`)
- **`/api/farmer-monthly-frequency`**: Add `GROUP BY icode` to return per-product weights alongside the total. Response changes from `{ cumulative_weight: number }` to `{ cumulative_weight: number, by_product: [{ icode, product_name, weight }] }`.
- **`/api/farmer-monthly-frequency-batch`**: Add `GROUP BY memberno, icode` and reshape response to include per-product breakdown per farmer: `{ farmer_id, cumulative_weight, by_product: [...] }`.

#### 2. TypeScript Types (`src/services/mysqlApi.ts`)
- Update `FarmerMonthlyFrequency` and `FarmerMonthlyFrequencyBatch` interfaces to include `by_product: Array<{ icode: string; product_name: string; weight: number }>`.

#### 3. IndexedDB Cumulative Cache (`src/hooks/useIndexedDB.ts`)
- Extend the `farmer_cumulative` store records to include a `byProduct` field (JSON array of `{ icode, product_name, weight }`).
- Update `updateFarmerCumulative` to accept and store per-product data when syncing from backend.
- Update `getFarmerCumulative` to return the `byProduct` array.
- Update `getUnsyncedWeightForFarmer` to also return per-product unsynced weights by reading `product_code` from unsynced receipts.
- Update `getFarmerTotalCumulative` to merge backend per-product + unsynced per-product.

#### 4. State & Flow (`src/pages/Index.tsx`)
- Change `cumulativeFrequency` state from `number | undefined` to `{ total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined`.
- Update all places that set/use cumulative to work with the new shape (pre-fetch, farmer selection, post-submit calculation).

#### 5. Receipt Display (`src/components/TransactionReceipt.tsx`)
- Update `ReceiptData` interface: add `cumulativeByProduct?: Array<{ icode: string; product_name: string; weight: number }>`.
- In the footer section, show:
  - **Cumulative: [grand total]** (existing line)
  - Below it, one line per product: **[product_name]: [weight]**

#### 6. Thermal Printer (`src/services/bluetooth.ts`)
- In `printReceipt`, after the existing cumulative line, add per-product lines.

#### 7. Reprint Support (`src/contexts/ReprintContext.tsx`, `src/components/ReprintModal.tsx`)
- Store `cumulativeByProduct` alongside `cumulativeWeight` in `PrintedReceipt`.
- Pass it through when replaying/viewing receipts.

#### 8. Direct Print (`src/hooks/useDirectPrint.ts`)
- Pass `cumulativeByProduct` through to the print payload.

### What Stays the Same
- Z-Report UI and logic (unchanged per constraint)
- Store/AI receipts (cumulative only applies to Buy/milk transactions)
- The overall sync architecture and timing

