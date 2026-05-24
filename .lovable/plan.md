# Store Z Report — Strip Non-Store Fields + Clean POS Layout

The on-screen preview already gates the produce fields behind `isStoreReport`, but the **printed receipt** (`printZReport` in `src/services/bluetooth.ts`) still emits `COFFEE SUMMARY`, `SEASON`, `PRODUCE` and uses BUY-shaped column widths. The user's photo confirms this — those lines are crossed out on the printed slip. We fix the print path and tighten the store row layout, without touching the produce (transtype=1) path.

## 1. `src/services/bluetooth.ts` — `printZReport`

- Add new optional field on the data arg: `reportType?: 'produce' | 'store'` (default `'produce'` — backward compatible for any caller that doesn't set it).
- Derive `isStore = reportType === 'store'`.
- **Header**:
  - Company name (unchanged).
  - If `isStore` → second line: `Z REPORT: STORE Z` (skip the existing `Z REPORT: <periodFilter>` line entirely).
  - Else → unchanged.
- **Metadata block** — when `isStore`, emit ONLY:
  ```
  * DATE: DD/MM/YYYY
  * <ROUTE LABEL>: <factoryName>
  ```
  Skip `* <PRODUCE> SUMMARY`, `* SEASON: ...`, and `* PRODUCE: ...`.
- **Section rendering for SELL / AI when `isStore`** — replace fixed-width product-name divider + 5-col grid with a compact POS layout:
  ```
  == SELL ==
  TWIGA ACE 1LTR
  M00021 00085  1   650  8:59
  FERTILIZER C.A.N 25 KGS
  M00010 00116 21 36750  8:35
  M00021 00084  2  3500  8:59
  Coffee Seedlings S1 28
  M00021 00086  9   360  8:59
  Spray Pumps
  M00011 00080  1  7000 11:54
  SELL TOTAL          34 items KSh 48260
  ```
  Rules:
  - Item name line is left-aligned, full-width (no padding, no centered dashes, no reserved column). Long names wrap on the printer naturally; do not truncate or pad.
  - Data rows: keep the existing right-aligned numeric columns so QTY / KSh / TIME stay in a vertical tabular spine. Spec: `MNO(7) REF(5) QTY(4 R) KSh(7 R) TIME(5 R)` (already used; total = 32). No change to data-row math, only the surrounding scaffolding.
  - Drop the `'-'.repeat(W)` underline beneath the column header for store mode — produce mode keeps it. Column header (`MNO REF QTY KSh TIME`) only prints once per section.
- **Subtotal line** stays as `<TYPE> TOTAL  N items  KSh A`.
- **Grand totals (store mode)**: emit only the SELL/AI lines:
  ```
  TOTAL ITEMS  34 items
  TOTAL VALUE  KSh 48260
  ```
  Suppress the `TOTAL <kg> KGS` line (BUY won't exist anyway in store mode, but make it explicit).
- **Footer**: unchanged (CLERK / date+time / DEV).
- Produce-mode rendering (transtype=1) is untouched — fully backward compatible per the workspace stability rule.

## 2. `src/components/DeviceZReportReceipt.tsx`

- In `handlePrint`, pass `reportType` through to `printZReport`:
  ```ts
  await printZReport({ ..., reportType });
  ```
- In the on-screen preview, the metadata block already hides SUMMARY/SEASON/PRODUCE for `isStoreReport`. Apply the same "item name left-aligned, no fixed column" tweak inside `renderTypeSection` **only when `isStoreReport && showMoney`**:
  - Replace the centered `── product name ──` divider with a left-aligned bold line: `<div class="text-left font-semibold text-[11px] pt-1.5 pb-0.5">{product_name}</div>`.
  - Keep the right-aligned numeric grid as-is for the data rows so MNO/REF/QTY/KSh/TIME still align top-to-bottom.
- No change to produce mode rendering.

## 3. `src/services/bluetooth.ts` callers

Only `DeviceZReportReceipt` calls `printZReport`. Other callers (none in the project) keep working because `reportType` is optional and defaults to `'produce'`.

## 4. Versioning (per workspace rule)

- `src/constants/appVersion.ts` → `APP_VERSION = '2.10.98'`, `APP_VERSION_CODE = 120`.
- `public/sw.js` → `CACHE_VERSION = 'v45'`.
- `android/app/build.gradle` → bump `versionCode` to `120`, `versionName` to `'2.10.98'`.

## Out of scope

- No change to transaction creation, sync, photo upload, device auth, period selector, type selector, produce Z layout, or any backend code.
- No new fields persisted; `reportType` is a UI/print-only flag.

## Verification

- Store Z print on a device with mixed SELL+AI transactions:
  - Header shows `Z REPORT: STORE Z`.
  - No `COFFEE SUMMARY`, `SEASON`, or `PRODUCE` lines.
  - Item names print left-aligned across the full width; numeric columns still align vertically.
  - Subtotal and grand totals render `items` + `KSh`, no `KGS`.
- Produce Z (transtype=1) print is byte-identical to current output.
- On-screen Store Z preview matches the printed layout (item names left-aligned, no centered dividers).
- App still builds, transactions still create, sync still works, no console errors.
