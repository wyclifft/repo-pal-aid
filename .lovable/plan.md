**Cause found from the logs and code**

The 52 Kg was not deleted. The app is comparing two different cumulative states and then allowing the wrong refresh path to lower the cache.

For M01859:

```text
Previous persisted cache: 1843.4
Backend batch refresh returned: 1791.4
Difference: -52
```

That means the app already had a cumulative that included the 52 Kg, but `refreshCumulativesBatch()` later fetched a backend total that did not include that 52 Kg at that moment, then tried to write the lower number.

Evidence:
- `src/pages/Index.tsx:318-343` runs `getMonthlyFrequencyBatch(deviceFingerprint, selectedRouteCode)` and writes every farmer through `updateFarmerCumulative()` as `W3:prewarm-batch(...)`.
- `src/hooks/useIndexedDB.ts:954-988` rejects a lower incoming value for W3, so the first two reads were correctly blocked:
  - M01859: `1843.4 → 1791.4`
  - M03486: `365.6 → 351.6`
  - M02957: `666.6 → 585.4`
- But the same lower values were later accepted by `W5:postcapture-refresh` because `useIndexedDB.ts:977` allows W5 to auto-heal downward. That is why the system reduced the cumulative total.
- The log pattern affects many farmers at the same time, so this is not one member or one deleted transaction. It is a batch refresh / stale backend-read / route-period cache issue.

**Permanent fix**

1. **Stop W5 from silently lowering cumulative totals**
   - Change `updateFarmerCumulative()` so no backend refresh source can lower `baseCount` immediately unless it is an explicit confirmed reconciliation flow.
   - Keep upward writes always accepted.
   - Keep zero-protection intact.

2. **Use confirmed two-read heal-down for all downward changes**
   - Move downward acceptance behind the existing W3-style confirmation rules:
     - two backend reads agree on the lower value,
     - no unsynced local receipts exist for that farmer/route,
     - route is normalized and scoped,
     - log the exact confirmation source.
   - This prevents a valid captured 52 Kg from being removed just because one refresh endpoint temporarily returned a stale/lower total.

3. **Fix post-submit cumulative refresh behavior**
   - After an online submit, the app must not reduce cache if the immediate backend cumulative is lower than the trusted local floor.
   - It should use:

   ```text
   trustedFloor = max(cachedBase, previousDisplayedCumulative) + justSubmittedWeight
   ```

   - If backend returns below that floor, keep the trusted floor for printing/display and queue a reconfirm instead of writing the lower backend value.

4. **Make batch prewarm route/product-safe**
   - Ensure `refreshCumulativesBatch()` and `loadCumulativeBatch()` always write to the selected route bucket only when `selectedRouteCode` is present.
   - Normalize route and product codes before compare/write.
   - Do not allow route `ALL` and route `T001` values to overwrite or validate each other.

5. **Improve logs so this cannot be ambiguous again**
   - Add explicit logs:
     - `CUM:DOWNWARD-HELD` when lower backend is blocked.
     - `CUM:DOWNWARD-CONFIRMED` only after two-read confirmation.
     - include `cachedBase`, `incomingBackend`, `trustedFloor`, `unsyncedTotal`, `route`, `icode`, and caller.

6. **Version and memory update**
   - Increment app version from `2.10.120` to `2.10.121`.
   - Document this as a permanent cumulative guard fix.

**Expected result**

- A valid captured 52 Kg will not be removed by refresh.
- Backend refresh can still increase cumulative immediately.
- A real downward correction can still be applied, but only after confirmed reconciliation.
- M01859-style `1843.4 → 1791.4` will be held, not silently accepted by W5.
- Receipt printing keeps using the trusted floor so the farmer’s cumulative does not go backwards after a valid delivery.