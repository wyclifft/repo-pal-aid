## Keep Store/AI receipts in Recent Receipts even when sync fails or uploadrefno repeats

### Goal
Ensure a Store or AI receipt stays visible in Recent Receipts once it is created locally, even if:
- the transaction never reaches the database
- sync later fails
- `uploadrefno` goes backward and repeats an older value

### Root cause
Recent Receipts for Store/AI are stored separately from the offline sync queue, so the sync deletion is not the direct problem. The real weak point is the duplicate guard in `ReprintContext`:
- `addStoreReceipt()` treats any existing `store` receipt with the same `uploadrefno` as a duplicate
- `addAIReceipt()` does the same for `ai`

That means if `uploadrefno` repeats after an upgrade/counter rollback, the new receipt is never added to Recent Receipts, even though the operator just made a real transaction.

### Implementation plan
1. Strengthen Store/AI receipt identity in the reprint history
   - Add a stable local receipt identifier for Store/AI snapshots
   - Persist the batch’s item-level `transrefno` values in the reprint record
   - Keep `uploadrefno` for search/display, but stop using it as the only uniqueness key

2. Fix duplicate detection in `ReprintContext`
   - Replace the current `uploadrefno`-only duplicate rule
   - Only skip saving when the exact same Store/AI batch was already saved locally
   - If the `uploadrefno` matches an older receipt but the item references differ, save it as a new Recent Receipt entry

3. Update Store and AI submit flows
   - Pass the generated item `transrefno` list into `addStoreReceipt()` / `addAIReceipt()`
   - Continue saving the receipt snapshot immediately after transaction creation, regardless of later sync outcome

4. Preserve backward compatibility in Recent Receipts
   - Keep old saved receipts readable even if they do not have the new fields
   - Use fallback matching for legacy entries so existing reprint history is not broken

5. Version bump
   - Increment app version and add a short changelog note describing the receipt-history fix

### Files to update
- `src/contexts/ReprintContext.tsx`
  - Add stronger Store/AI receipt identity and safer duplicate detection
- `src/components/ReprintModal.tsx`
  - Extend `PrintedReceipt` type with the new Store/AI identity fields
- `src/pages/Store.tsx`
  - Pass per-item `transrefno` values when saving the Store receipt snapshot
- `src/pages/AIPage.tsx`
  - Pass per-item `transrefno` values when saving the AI receipt snapshot
- `src/constants/appVersion.ts`
  - Version bump and changelog note
- `android/app/build.gradle`
  - Version bump/code bump

### Technical details
Recommended Store/AI receipt shape:
```ts
{
  localReceiptId: string,
  type: 'store' | 'ai',
  uploadrefno: string,
  itemRefs: string[],
  printedAt: Date,
  ...existingFields
}
```

Recommended duplicate rule:
- Legacy fallback: if no `itemRefs` exist, keep current behavior only for exact same old entry
- New rule: treat as duplicate only when `type` matches and `itemRefs` match exactly
- Do not suppress a new receipt just because `uploadrefno` matches an older one

### Expected result
After this change:
- operators will still see Store/AI receipts in Recent Receipts even if sync fails
- repeated `uploadrefno` values will no longer hide newer receipts
- deleting synced offline queue items will not affect Recent Receipts history
- existing older receipts remain reprintable