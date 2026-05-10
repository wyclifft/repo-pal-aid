# Periodic Report — Smart Search & Per-Product Grouping (v2.10.77)

Improve the Periodic Report screen with live member suggestions and group the printed/preview transactions by product (`icode`).

## 1. Live member autocomplete (frontend)

File: `src/pages/PeriodicReport.tsx`

- Load the cached members list via the existing `useIndexedDB().getFarmers()` on mount (already used elsewhere — no new fetch needed; works fully offline).
- Replace the single "Farmer Name or ID" `Input` with a search box that opens a suggestions dropdown below it as the user types:
  - **Numeric input** (e.g. `1`, `12`): match member IDs starting with the padded form (`M00001`, `M00012`, …) and also any ID whose numeric portion starts with the digits typed. Reuse the logic style from `useFarmerResolution` (prefix `M`, pad to 5).
  - **Text input**: case-insensitive `name` substring match.
  - Limit to top 8 results, sorted by best match (exact ID → ID prefix → name prefix → name contains).
  - Each suggestion row shows `M00001 — JOHN DOE` (id + name).
- Use a lightweight inline dropdown (absolute-positioned `div` under the input, styled with existing tokens — `bg-popover`, `border`, `shadow-md`, `rounded-md`). No new shadcn dependency required; keeps it WebView 52 safe.
- Keyboard: ArrowUp/Down to navigate, Enter to pick, Esc to close. Click outside closes (use `onBlur` with small timeout so click registers).
- When a suggestion is **selected** (click or Enter):
  1. Set `farmerSearch` to the picked member's ID (so the field reflects selection).
  2. If `startDate` and `endDate` are set, immediately open `PeriodicReportReceipt` for that member by setting `selectedFarmer = { id, name }` — this opens the existing **View & Print** modal automatically with no extra clicks.
  3. If dates aren't set yet, toast: "Pick start and end dates first" and leave the field populated so the user can complete the form.
- The existing `Generate Report` button and table flow remain unchanged for users who want the listing view.

## 2. Group transactions by product (`icode`)

### Backend — `backend-api/server.js` (`/api/periodic-report/farmer-detail`)

- Extend the transaction SELECT to include `t.icode` and `i.descript AS product_name` (LEFT JOIN `fm_items i ON t.icode = i.icode AND i.ccode = ?`).
- Keep ordering: `icode ASC, transdate ASC, transtime ASC` so groups arrive contiguous.
- Response shape stays backward-compatible — only adds two optional fields per transaction; the existing `produce_name`/`total_weight` fields are unchanged so older clients keep working.

### Frontend types — `src/services/mysqlApi.ts`

- Add optional `icode?: string` and `product_name?: string` to `FarmerDetailReportData.transactions[]`.

### Receipt preview — `src/components/PeriodicReportReceipt.tsx`

- Group `data.transactions` by `icode` (fallback to `data.produce_name` when missing, for back-compat).
- Render each group as its own labeled section:
  ```
  ───────────────────────────
  <PRODUCT NAME> (<ICODE>)
  DATE         REC NO   QUANTITY
  ───────────────────────────
  …rows…
  ───────────────────────────
  Subtotal: <kg> Kgs
  ```
- Final `TOTAL:` row remains the sum across all groups (no business-logic change).

### Printed receipt — `src/services/bluetooth.ts` (`printMemberProduceStatement`)

- Accept the new optional `icode`/`productName` per transaction.
- When present, emit a per-product header + dashed separator + per-product subtotal in the same order, matching the on-screen preview.
- 32-char thermal width preserved; column spec `DATE(12) REC(7) QTY(13)` unchanged.
- If transactions have no `icode` (legacy cached data), keep current single-section behavior.

## 3. Versioning & docs

- Bump `APP_VERSION` to `2.10.77`, `APP_VERSION_CODE` to `99`, Service Worker cache to `v24`.
  - Files: `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js`.
- Add memory note `mem://features/periodic-report-product-grouping.md` (and reference in `mem://index.md`) capturing the per-icode grouping rule and "select-suggestion auto-opens receipt" UX rule.

## Files touched

- `src/pages/PeriodicReport.tsx` (autocomplete + auto-open receipt)
- `src/components/PeriodicReportReceipt.tsx` (grouped preview)
- `src/services/mysqlApi.ts` (types only)
- `src/services/bluetooth.ts` (grouped print)
- `backend-api/server.js` (additive SELECT fields + ORDER BY)
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js`
- `mem://features/periodic-report-product-grouping.md`, `mem://index.md`

## Safety

- All backend changes are **additive** (new response fields, no renames) → production mobile clients keep working.
- IndexedDB schema untouched; cached reports remain valid (transactions without `icode` render in a single legacy section).
- No changes to transaction creation, sync, or reference generation.
