

## Fix: Offline Store Route + Photo Audit Duplicate Images

### Bug 1: Offline store `transactions.route` defaults to L001

**Root cause**: In `src/pages/Store.tsx` line 691, offline sales save `route: selectedFarmer.route || ''` (the farmer's cm_members route). While `route_tcode` is also saved (line 692), the sync logic in `useSalesSync.ts` sends `route_tcode` to the server which validates it. However, when the server receives the offline-synced batch, it may not find `route_tcode` because the field name mapping could be lost.

Looking at `useSalesSync.ts` line 107: `route_tcode: String(firstSale.route_tcode || '').trim()` — this IS passed. The issue is that for **individual AI-style sync** (which offline store items without `uploadrefno` fall into), `route_tcode` is spread conditionally on line 178: `...(saleRecord.route_tcode && { route_tcode: saleRecord.route_tcode })`. This should work.

The actual problem: `saveSale` in `useIndexedDB.ts` stores the sale as a generic object in IndexedDB. When retrieved, the `route_tcode` field should persist. Let me verify the offline save includes `route_tcode` — yes, line 692 confirms it's included.

**Most likely cause**: The `route_tcode` value is empty at save time because `localStorage` doesn't have the session data under the expected key. Need to verify the localStorage key used in Store.tsx matches what Dashboard saves.

**Fix**: Ensure `route_tcode` is reliably read from localStorage at offline save time, and as a safety net, also populate `route` with the tcode value (not just the farmer route) so even if `route_tcode` is lost, the correct value is in `route`.

#### Changes in `src/pages/Store.tsx`
- Line 691: Change offline sale `route` to use `selectedRouteTcode || selectedFarmer.route || ''` so the correct route is stored even if `route_tcode` gets lost during sync
- Same pattern for the batch request line 657: already sends `route_tcode`, but ensure `route` fallback also uses tcode

#### Changes in `src/hooks/useSalesSync.ts`
- In the batch sync section (~line 107), ensure `route` field also falls back to `route_tcode` if available
- In the individual sync section (~line 168), same pattern

### Bug 2: Photo audit shows duplicate photos per member

**Root cause**: The server query (`backend-api/server.js` line 3137) returns one row per transaction. Store batch transactions create multiple rows with the same `photo_filename` (one per item). So if a member buys 3 items, the same photo appears 3 times.

**Fix (server-side primary)**: Group by `photo_filename` + `memberno` in the SQL query, aggregating item details.

**Fix (frontend)**: Restructure PhotoAuditViewer to show one card per member-photo, with a detail view listing all items.

#### Changes in `backend-api/server.js`
- Modify the transaction-photos query to GROUP BY `photo_filename, memberno, transdate` 
- Use `GROUP_CONCAT` to collect all `transrefno` values and item details
- Return aggregated data: one row per unique photo with item count and references

```sql
SELECT MIN(ID) as ID, GROUP_CONCAT(transrefno) as transrefnos, 
       memberno, transdate, MIN(transtime) as transtime, clerk,
       SUM(amount) as amount, photo_filename, photo_directory,
       COUNT(*) as item_count,
       GROUP_CONCAT(CONCAT(descript, ' (', quantity, ')') SEPARATOR ', ') as items_summary
FROM transactions 
WHERE photo_filename IS NOT NULL AND photo_filename != '' AND ccode = ?
GROUP BY photo_filename, memberno, transdate, clerk, photo_directory
ORDER BY MIN(ID) DESC
```

#### Changes in `src/components/PhotoAuditViewer.tsx`
- Update `TransactionPhoto` interface to include `transrefnos`, `item_count`, `items_summary`
- Show `transrefnos` (first ref) on the card, with item count badge
- Detail view: show the photo once, list all items with their references

### Version bump
`src/constants/appVersion.ts` → v2.10.13

### Files Changed

| File | Change |
|------|--------|
| `src/pages/Store.tsx` | Use `selectedRouteTcode` as primary `route` value in offline saves |
| `src/hooks/useSalesSync.ts` | Ensure `route` uses `route_tcode` when available during sync |
| `backend-api/server.js` | GROUP BY photo in transaction-photos query to deduplicate |
| `src/components/PhotoAuditViewer.tsx` | Show grouped photos with item list in detail view |
| `src/constants/appVersion.ts` | Bump to v2.10.13 |

