

## Fix: Periodic Report Missing End-Date Transactions

### Problem
The periodic report queries on lines 1123, 1194, and 1215 use:
```sql
t.transdate BETWEEN ? AND ?
```
If `transdate` stores datetime values (e.g., `2026-03-08 14:30:00`), then `BETWEEN '2026-02-01' AND '2026-03-08'` excludes any record after midnight on March 8th. So today's transactions (and any day's transactions with a time component) are partially or fully missing.

### Fix
Change all 3 queries to cast the date:

```sql
CAST(t.transdate AS DATE) BETWEEN ? AND ?
```

This matches the pattern already used by the cumulative frequency queries in the same file.

### Changes

**`backend-api/server.js`** — 3 line changes:
1. **Line 1123** (summary query): `CAST(t.transdate AS DATE) BETWEEN ? AND ?`
2. **Line 1194** (farmer detail produce lookup): `CAST(t.transdate AS DATE) BETWEEN ? AND ?`
3. **Line 1215** (farmer detail transactions): `CAST(t.transdate AS DATE) BETWEEN ? AND ?`

No frontend or Capacitor changes needed — this is purely a backend SQL fix.

