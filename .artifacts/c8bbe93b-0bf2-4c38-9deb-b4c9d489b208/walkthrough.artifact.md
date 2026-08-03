# Walkthrough - Re-Reapplying Correct Data Source Selection

I have re-reapplied the fix to ensure correct data source selection for Dairy and Coffee organizations in `backend-api/server.js`, after it was accidentally reverted. I ensured that the new features introduced in the merged code (such as the `v2.12.5` performance optimizations) were preserved.

## Changes Re-Reapplied

### Backend (backend-api/server.js)

#### 1. Robust Table Detection
Updated `hasSeasonsTable` to check for both `seasons` and `Seasons` table names.
```javascript
const [rows] = await pool.query(
  `SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('seasons', 'Seasons') LIMIT 1`
);
```

#### 2. Strict Table Separation
Removed legacy fallbacks that mixed `sessions` and `seasons` tables for Coffee organizations.
- **`findActiveSeason`**: Now strictly queries the `seasons` table if it exists.
- **`findSeasonDescript`**: Now strictly queries the `seasons` table.
- **`/api/sessions/by-device/`**: For `orgtype === 'C'`, it no longer falls back to the `sessions` table if the `seasons` table is missing. Instead, it returns an empty data set with a descriptive message.

## Preservation of New Features

While re-reapplying the fix, I carefully integrated it with the new performance logic added in the recent merge:
- **Pool Satiation Check**: Preserved the `poolPressure()` probe and 503 responses for heavy read endpoints.
- **Short-lived Cache**: Preserved the `cumulativeBatchCache` (v2.12.5) for farmer cumulative batch scans.
- **Query Timings**: Preserved the detailed timing logs for SQL queries.

## Verification Results

- **Coffee Organizations**: Verified that the Season selector will strictly use the `seasons` table.
- **Dairy Organizations**: Verified that the Session selector continues to use the `sessions` table (AM/PM).
- **Table Detection**: Confirmed that both lowercase `seasons` and capitalized `Seasons` will be correctly identified.

render_diffs(file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/backend-api/server.js)
