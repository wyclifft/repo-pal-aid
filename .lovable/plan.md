

# clientFetch Reference Generation — Store Module Analysis

## How It Should Work

For Store transactions, references are:
- `transrefno` = `devcode` + 8-digit `trnid` (e.g., `BB0100000001`) — no clientFetch
- `uploadrefno` = `devcode` + `clientFetch` digit + 8-digit `storeId` (e.g., `BB01200000001`) — includes clientFetch

## Issues Found

### 1. New devices have empty `devcode`

Backend returns `devcode: ""` for pending/unapproved devices (confirmed in network response: `"devcode":""`). When `generateOfflineReference()` runs, it produces references like `00000001` — no prefix, making them unroutable and unmatchable on the backend.

**Impact**: All references generated before admin approval are malformed.

### 2. `clientFetch` is always `undefined` for new devices

The routes API returns 401 for unauthorized devices. The `catch` block (Store.tsx line 264-270) restores from `localStorage('store_clientFetch')`, but a fresh device has no cache. So `clientFetch` remains `undefined`.

When `generateFormattedUploadRef('store', undefined)` runs, the condition on line 501 (`if (... && clientFetch)`) is false — the uploadrefno is generated **without** the clientFetch digit, producing `BB0100000001` instead of `BB01200000001`.

**Impact**: uploadrefno format is wrong, breaking backend routing/approval workflows.

### 3. Non-ok, non-404 route response doesn't restore cache

Store.tsx lines 260-263 handle the "response exists but not ok and not 404" case by setting `hasRoutes(true)` and `storeEnabled(true)` but **never** restoring `clientFetch` from cache. This is a gap compared to the 404 and offline paths which do restore it.

### 4. `clientFetch = 0` would be silently dropped

If any route legitimately has `clientFetch: 0`, it's falsy in JS. The condition `if (storeRoute?.clientFetch)` (line 249) would skip it, and `generateFormattedUploadRef` would also skip it. This may not be a real-world issue but is a latent bug.

## Proposed Fix

### File: `src/pages/Store.tsx`

1. **Add clientFetch restoration to the non-ok/non-404 response path** (lines 260-263):
```javascript
} else {
  setHasRoutes(true);
  setStoreEnabled(true);
  const cachedCF = localStorage.getItem('store_clientFetch');
  if (cachedCF) setClientFetch(parseInt(cachedCF, 10));
}
```

2. **Guard `clientFetch` extraction with `!== undefined` instead of truthiness** (line 249):
```javascript
if (storeRoute?.clientFetch !== undefined && storeRoute?.clientFetch !== null) {
  setClientFetch(storeRoute.clientFetch);
  localStorage.setItem('store_clientFetch', String(storeRoute.clientFetch));
}
```

3. **Block Store submission if `devcode` is empty** — add a guard in `handleSubmit` before generating refs:
```javascript
const devcode = localStorage.getItem('devcode');
if (!devcode) {
  toast.error('Device not configured. Please ensure device is approved.');
  setSubmitting(false);
  setSyncing(false);
  return;
}
```

4. **Warn if `clientFetch` is missing at submission time** — add a warning log (not blocking, since some setups may not use clientFetch):
```javascript
if (clientFetch === undefined) {
  console.warn('[Store] clientFetch is undefined — uploadrefno will not include routing digit');
}
```

### File: `src/utils/referenceGenerator.ts`

5. **Fix `generateFormattedUploadRef` to handle `clientFetch = 0`** (line 501):
```javascript
if ((transactionType === 'store' || transactionType === 'ai') && clientFetch !== undefined && clientFetch !== null) {
```

### File: `src/constants/appVersion.ts`
- Bump to v2.10.5

## Summary

| Issue | Severity | Fix |
|-------|----------|-----|
| Empty devcode on new devices | High | Guard submission, block if no devcode |
| clientFetch undefined (no cache) | High | Restore cache in all error paths |
| Non-ok response path missing cache restore | Medium | Add cache restore |
| clientFetch=0 dropped silently | Low | Use strict !== check |

