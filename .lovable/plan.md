# Dynamic Z Report Period Selector

## Goal
The "Select Z Report Period" dialog currently lists hard-coded options (Morning Z / Afternoon Z / Evening Z / All Z). Replace these with one option per session row from the `sessions` table, matched by `transactions.CAN` → `sessions.SCODE`, displayed using `sessions.descript`. Always keep an "All Z" option that combines every session.

## Source of truth
- `sessions` table already cached in IndexedDB via `useIndexedDB().getSessions()` (the same source `SessionSelector` uses), refreshed online from `mysqlApi.sessions.getByDevice(deviceFingerprint)`.
- Each session row carries `SCODE` (matches `transactions.CAN`) and `descript` (label like "Morning", "Afternoon", "AM Coffee", etc).
- No backend changes. No new endpoints. Works offline (uses cached sessions).

## Changes

### 1. `src/components/ZReportPeriodSelector.tsx`
- Convert period type from fixed union (`'morning'|'afternoon'|'evening'|'all'`) to `string` (the SCODE), with `'all'` reserved for the combined option.
- Remove the hard-coded `Z_REPORT_PERIODS` array.
- Add props: `sessions: Array<{ SCODE: string; descript: string }>` (passed in from ZReport page).
- Build the option list dynamically:
  - One card per session: `value = session.SCODE`, `label = "{descript} Z"`, `description = "{descript} session collections only"`.
  - Append a permanent "All Z" card (`value = 'all'`) at the bottom.
- Pick an icon per option by simple keyword match on `descript` (morning→Sun, afternoon→Sunset, evening/night→Moon, default→Clock), falling back to a generic icon. Purely cosmetic, no logic dependency.
- Rewrite `filterTransactionsByPeriod`:
  - If `period === 'all'` return all.
  - Else filter by exact match on `tx.season_code` (which maps to `transactions.CAN`), with trim + case-insensitive compare. Fallback to `tx.session` only if `season_code` is empty (legacy rows).
- Rewrite `getPeriodDisplayLabel(period, sessions)` to look up the descript from the passed sessions list, defaulting to "All Z".
- Empty-state: if `sessions.length === 0`, render only the "All Z" option (safe fallback so existing flow still works).

### 2. `src/pages/ZReport.tsx`
- Load sessions via existing `useIndexedDB().getSessions()` on mount (cache-first, identical pattern to `SessionSelector`). Store in `const [sessions, setSessions] = useState<Session[]>([])`.
- Pass `sessions` prop into `<ZReportPeriodSelector ... />`.
- Update `selectedPeriod` state type to `string` (default `'all'`).
- Update `handlePeriodSelect` and any `getPeriodDisplayLabel` calls to pass the sessions list.
- No change to print/receipt logic beyond carrying the new period string through (already opaque to `DeviceZReportReceipt`).

### 3. `src/constants/appVersion.ts`
- Bump `APP_VERSION` → `'2.10.114'`, `APP_VERSION_CODE` → `135`.
- Update `APP_FIX_TAG` to `'dynamic-zreport-sessions'`.
- Add changelog comment.

### 4. `android/app/build.gradle`
- Bump `versionCode` to `135`, `versionName` to `"2.10.114"` (keeps APK filename auto-generated as `DeliCoop101.v2.10.114-fix135-dynamic-zreport-sessions.apk`).

## Safety / compatibility
- Production-safe: no backend/server.js change, no schema change, no API change.
- Offline-safe: uses already-cached sessions, falls back to "All Z" if cache empty.
- Preserves all existing flows (transactions, receipts, sync, photo, references). Filtering still uses `season_code` (CAN) which is already saved on every transaction per `lib/supabase.ts` `MilkCollection`.
- Backward compatible with legacy receipts: secondary fallback to `tx.session` for rows that pre-date `season_code`.
- No UI regression on the rest of the Z Report page — only the period-selector dialog and its filter are touched.

## Out of scope
- Backend SQL changes.
- Restyling the dialog beyond replacing the option rows.
- Changing how `transactions.CAN` is written (already done upstream).
