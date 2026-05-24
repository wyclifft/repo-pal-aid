# Z Report Type/Period Gating + Company Isolation

## 1. Gate "Select Z Report Period" by `orgtype === "D"`

**File:** `src/pages/ZReport.tsx`

- Read `orgtype` via `useAppSettings()` (already imported elsewhere in the page).
- In `handlePrintClick`, branch:
  - If `orgtype === 'D'` **and** the new type-selector resolves to Coffee/Milk → open `ZReportPeriodSelector` (existing modal).
  - Otherwise → skip the period selector entirely and proceed straight to `fetchDeviceReport('all')` + preview.
- No changes to `ZReportPeriodSelector.tsx` itself (keeps it reusable, isolation per Z-Report UI rule).

## 2. New "Select Z Report Type" step

**New file:** `src/components/ZReportTypeSelector.tsx`

- Small dialog with two options:
  - **Coffee / Milk Z Report {depending on the orgtype}** — value `produce`
  - **Store Z Report** — value `store`
- Same visual pattern as `ZReportPeriodSelector` (RadioGroup + Confirm/Cancel).
- Exports `ZReportType = 'produce' | 'store'`.

**Flow in `ZReport.tsx`:**

```text
Print click
   │
   ├─ Inspect reportData transactions:
   │     hasProduce = any tx with transtype === 1
   │     hasStore   = any tx with transtype === 2 || 3
   │
   ├─ If hasProduce && hasStore → open ZReportTypeSelector
   ├─ Else if only hasProduce   → type = 'produce' (auto)
   ├─ Else if only hasStore     → type = 'store'   (auto)
   │
   ├─ type === 'produce'
   │     ├─ orgtype === 'D' → open ZReportPeriodSelector → fetchDeviceReport(period)
   │     └─ orgtype !== 'D' → fetchDeviceReport('all') directly
   │
   └─ type === 'store' → fetchDeviceReport('all') with reportMode='store'
```

- New state: `selectedReportType: ZReportType`, `showTypeSelector: boolean`.
- Pass `reportType` down to the receipt preview component.

## 3. Store Z report rendering

**File:** `src/components/DeviceZReportReceipt.tsx` (and/or the produce variant currently used)

- Accept new prop `reportType?: 'produce' | 'store'` (default `'produce'` — backward compatible).
- When `reportType === 'store'`:
  - Filter transactions to `transtype === 2 || transtype === 3` only.
  - Hide: session header, season/scode chip, produce/icode column, farmer-delivery breakdown rows, per-product cumulative section.
  - Show: header "STORE Z REPORT", date/route/device chip, columns `Ref | Item | Qty | Amount`, grand totals split by SELL vs AI (already supported by store-units rule), no Kgs unit override (use stored unit / "items").
- Re-use existing thermal-print CSS classes so receipt-output standards stay intact.
- Produce mode renders exactly as today (no regression to existing Z-report layout, headers, column alignment rule).

## 4. Strict company isolation by `user.ccode`

**Frontend — `src/components/Login.tsx` / `AuthContext`:**

- After a successful `/api/auth/login`, read the cached device ccode (from `devsettings`-driven device approval payload already stored locally).
- If `user.ccode` is present and does **not** equal device `ccode`:
  - Reject the login (do not call `login()`).
  - Show toast: `"Access denied. Your account is restricted to your assigned company."`
  - Do not cache offline credentials.
- Offline login path: compare cached `user.ccode` against cached device ccode before allowing entry; same denial message.

**Backend — `backend-api/server.js` (`/api/auth/login`, additive only):**

- Accept optional `device_fingerprint` in the login body.
- If provided, after the user row is found:
  - Look up `devsettings.ccode WHERE uniquedevcode = ?`.
  - If device ccode exists and `user.ccode !== device.ccode` → return `403 { success:false, error:"Access denied. Your account is restricted to your assigned company." }`.
- All existing fields/behaviour preserved → mobile clients that don't send `device_fingerprint` continue to work (backward compatible per server.js production safety rule).
- No changes to existing data endpoints (they already filter `WHERE ccode = ?` via the device fingerprint lookup — DEVICE_FILTERING_SETUP.md).

## 5. Versioning

Per workspace version rule:

- `src/constants/appVersion.ts` → `APP_VERSION = '2.10.97'`, `APP_VERSION_CODE = 119`.
- `public/sw.js` → `CACHE_VERSION = 'v44'`.
- `android/app/build.gradle` → bump `versionCode`/`versionName`.

## Out of scope

- No IndexedDB schema changes.
- No changes to transaction creation, sync engine, receipt generation for produce, photo upload, or farmer cumulative logic.
- No new backend tables; only an additive guard on `/api/auth/login`.

## Verification

- Dairy device (`orgtype=D`) with mixed transtype 1+2/3 → type selector appears → Coffee/Milk path shows period selector → Store path skips period selector and renders store-only receipt.
- Coffee device (`orgtype=C`) → period selector never appears regardless of choice.
- Device with only `transtype=1` → no type selector, original flow.
- Device with only `transtype=2/3` → no type selector, store receipt directly.
- Login attempt with mismatched `user.ccode` vs device ccode → blocked with the required message, both online and offline.
- Existing transaction creation, sync, receipt print (transtype 1 and 2/3), device auth, photo upload paths unchanged.