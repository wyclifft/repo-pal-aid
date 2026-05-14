Add dual-format log export (NDJSON + CSV) to the /debug console.

## What will change

### 1. persistentLogger.ts
- Add `exportCSV(): Promise<Blob>` method alongside the existing `exportNDJSON()`.
- CSV columns: `timestamp,level,tag,message,data,count,route,version`.
- Sanitise cell content (escape quotes, strip newlines) so the CSV opens cleanly in Excel / Sheets.

### 2. DebugConsole.tsx
- Replace the single Export icon-button with a dropdown menu (or split-button) offering:
  - **Export NDJSON** (current behaviour, preserves full structured data)
  - **Export CSV** (human-readable table format for sharing / email)
- Keep the same file-naming convention: `debug-logs-<ISO-timestamp>.ndjson` / `.csv`.
- No changes to log capture, filters, search, or auto-refresh logic.

## What will NOT change
- Log storage, throttling, pruning, or global capture rules.
- Any transaction, receipt, sync, auth, or Bluetooth code.
- Existing NDJSON export API (`exportNDJSON`).

## Verification
- Click Export → CSV: downloaded file opens correctly in a spreadsheet.
- Click Export → NDJSON: still produces valid NDJSON identical to before.
- App builds without errors.