

## Fix: Photo Audit 500 Error — Unknown Column 'descript'

### Root Cause

The `/api/transaction-photos` query references `descript` directly on the `transactions` table, but that column doesn't exist there. Item descriptions live in `fm_items.descript`. The `transactions` table stores item codes in the `icode` column.

### Fix in `backend-api/server.js` (~line 3141)

Join `fm_items` to get item descriptions. Replace the current query with:

```sql
SELECT MIN(t.ID) as ID, 
       GROUP_CONCAT(t.transrefno ORDER BY t.ID SEPARATOR ', ') as transrefnos,
       t.memberno, t.transdate, MIN(t.transtime) as transtime, t.clerk,
       SUM(t.amount) as amount, t.photo_filename, t.photo_directory,
       COUNT(*) as item_count,
       GROUP_CONCAT(CONCAT(IFNULL(i.descript, t.icode), ' (', IFNULL(t.weight, 1), ')') ORDER BY t.ID SEPARATOR ', ') as items_summary
FROM transactions t
LEFT JOIN fm_items i ON t.icode = i.icode AND i.ccode = t.ccode
WHERE {whereClause with t. prefixes}
GROUP BY t.photo_filename, t.memberno, t.transdate, t.clerk, t.photo_directory
ORDER BY MIN(t.ID) DESC
LIMIT ? OFFSET ?
```

Also update the count query to prefix columns with `t.`.

### Version bump
`src/constants/appVersion.ts` → v2.10.14

### Files Changed

| File | Change |
|------|--------|
| `backend-api/server.js` | JOIN fm_items for item descriptions in transaction-photos query; prefix all column refs with `t.` |
| `src/constants/appVersion.ts` | Bump to v2.10.14 |

