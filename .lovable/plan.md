

## Bugs Found in Reference Number Generation

### Bug 1: AI Page — Duplicate `transrefno` for Multi-Item Carts (CRITICAL)

**File:** `src/pages/AIPage.tsx` lines 404-435

In the AI submit handler, all cart items reuse `refs.transrefno` from the single `generateReferenceWithUploadRef('ai', clientFetch)` call. When a user adds 2+ items to the AI cart, every row inserted into the database gets the **same transrefno**, violating the unique index and causing `ER_DUP_ENTRY` errors (or silent data loss).

**Compare with Store.tsx** which correctly generates a new `transrefno` per additional item using `generateTransRefOnly()`.

**Fix:** Mirror the Store.tsx pattern — use `refs.transrefno` for the first cart item, and call `generateTransRefOnly(clientFetch)` for each subsequent item (after also fixing Bug 2).

---

### Bug 2: `generateTransRefOnly` Drops `clientFetch` Prefix (Store + AI)

**File:** `src/utils/referenceGenerator.ts` line 554

```ts
export const generateTransRefOnly = async (): Promise<string | null> => {
  return generateOfflineReference(); // ← no clientFetch!
};
```

This function doesn't accept or forward `clientFetch`. Result: for Store (clientFetch=2), the first item gets `BA0120000001` but subsequent items get `BA0100000002` — **inconsistent format** within the same batch. The clientFetch digit is lost for all items after the first.

**Fix:** Add a `clientFetch` parameter:
```ts
export const generateTransRefOnly = async (clientFetch?: number): Promise<string | null> => {
  return generateOfflineReference(clientFetch);
};
```

Then update callers in `Store.tsx` and `AIPage.tsx` to pass `clientFetch`.

---

### Summary of Changes

| File | Change |
|------|--------|
| `src/utils/referenceGenerator.ts` | Add `clientFetch` param to `generateTransRefOnly` |
| `src/pages/AIPage.tsx` | Generate unique `transrefno` per cart item (same pattern as Store.tsx) |
| `src/pages/Store.tsx` | Pass `clientFetch` to `generateTransRefOnly()` calls |
| `src/pages/Index.tsx` | No change needed (milk has no clientFetch, already correct) |

