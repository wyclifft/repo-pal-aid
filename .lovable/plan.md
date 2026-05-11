## Goal

In the Periodic Report (Member Produce Statement), include the device code with the receipt number so each row reads like `BB01-00002` instead of just `00002`. Apply to both the on-screen preview and the printed thermal receipt.

## Changes

### 1. REC NO formatting (10 chars: `DEVCODE-LAST5`)

The stored `rec_no` is the full `transrefno` (devcode[4] + clientFetch[1] + padded_trnid[8] = 13 chars). Format as:
- `devcode = rec_no.slice(0, 4)` (e.g. `BB01`)
- `last5 = rec_no.slice(-5)` (last 5 of trnid)
- Display = `${devcode}-${last5}` (e.g. `BB01-00002`)
- Fallback when `rec_no` missing: `----------`

### 2. Column widths (thermal printer, 32-col)

`src/services/bluetooth.ts` — `printMemberProduceStatement`, lines 2711–2745:
- `dateColW`: 12 → 9 (date already prints as `DD/MM/YY`-style 8 chars + 1 space)
- `recColW`: 7 → 11 (fits `BB01-00002` + 1 space)
- `qtyColW`: `W - dateColW - recColW` (= 12, unchanged net effect after rebalancing)
- Header row updates `'DATE'` / `'REC NO'` paddings to the new widths.
- Data row uses the new `formatRecNo(tx.rec_no)` helper.

### 3. On-screen preview

`src/components/PeriodicReportReceipt.tsx`, lines 257–268:
- Update grid template: `'9ch 11ch 1fr'`.
- Replace `tx.rec_no?.slice(-5) || '-----'` with `formatRecNo(tx.rec_no)`.
- Header label `REC NO` stays the same.

### 4. Helper

Add a tiny shared helper (inline in both files, no new module needed):
```ts
const formatRecNo = (ref?: string) => {
  if (!ref || ref.length < 9) return '----------';
  return `${ref.slice(0, 4)}-${ref.slice(-5)}`;
};
```

### 5. Versioning

- `src/constants/appVersion.ts`: `APP_VERSION` → `2.10.82`, `APP_VERSION_CODE` → `104`.
- `android/app/build.gradle`: `versionCode` → `104`, `versionName` → `'2.10.82'`.
- `public/sw.js`: `CACHE_VERSION` → `'v29'`.

## Out of scope

- No backend / SQL changes (`backend-api/server.js` already returns `transrefno as rec_no`).
- No change to the underlying `rec_no` value stored — only display formatting.
- No change to other receipts (milk, store/AI) or to date format.

## Verification

1. Open Periodic Report for any member with transactions — preview shows `BB01-00002` style under REC NO.
2. Print the statement on the thermal printer — REC NO column aligns, QUANTITY still right-aligned, no wrapping.
3. Reprint a normal milk receipt and a Store/AI receipt to confirm they are unaffected.
