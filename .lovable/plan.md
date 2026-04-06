

## Fix: 4 IndexedDB Bugs — v2.10.16

### Bug 1: `device_approvals` wiped on every upgrade

**Problem**: Lines 63-71 unconditionally delete and recreate the `device_approvals` store during `onupgradeneeded`. This runs on every version bump, wiping all cached device authorization data and forcing users to re-authorize online.

**Fix**: Only recreate when the store doesn't exist OR when the keyPath is wrong. Use the upgrade transaction to check the existing store's keyPath before deciding to delete.

```typescript
if (database.objectStoreNames.contains('device_approvals')) {
  const existingStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('device_approvals');
  if (existingStore.keyPath !== 'device_fingerprint') {
    database.deleteObjectStore('device_approvals');
    database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });
  }
  // else: already correct, leave it alone
} else {
  database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });
}
```

### Bug 2: `Date.now()` orderId collision in `saveSale`

**Problem**: Line 389 uses `Date.now()` for `orderId`. Rapid POS operations (scanning multiple items quickly) can produce the same millisecond timestamp, causing `store.put()` to silently overwrite the previous sale.

**Fix**: Append a random suffix to guarantee uniqueness:

```typescript
const orderId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
```

Apply same fix in `saveReceipt` (line 214) where `Date.now()` is used as fallback.

### Bug 3: `byProduct` dropped on local cumulative update

**Problem**: Lines 794-803 — when `fromBackend === false`, the new record omits `byProduct`, losing the backend-synced product breakdown. The existing `byProduct` array from the cached record is silently dropped.

**Fix**: Preserve existing `byProduct` when doing a local increment:

```typescript
newRecord = {
  cacheKey,
  farmer_id: cleanId,
  month,
  baseCount: existing?.baseCount || 0,
  localCount: (existing?.localCount || 0) + count,
  byProduct: existing?.byProduct || [],  // preserve existing breakdown
  lastUpdated: new Date().toISOString()
};
```

### Bug 4: `PRINTED_RECEIPTS` mixed-type key

**Problem**: The `receipts` store has `keyPath: 'orderId'` (numeric). But `savePrintedReceipts` stores a record with `orderId: 'PRINTED_RECEIPTS'` (string). This mixes key types in the same store, which can cause IndexedDB comparison issues and complicates queries like `getUnsyncedReceipts` (line 266) and `clearUnsyncedReceipts` (line 625) which must explicitly filter it out.

**Fix**: Move printed receipts to a dedicated store. Increment DB_VERSION to 11, create a `printed_receipts` store with a fixed key, and migrate existing data:

```typescript
// In onupgradeneeded:
if (!database.objectStoreNames.contains('printed_receipts')) {
  database.createObjectStore('printed_receipts', { keyPath: 'id' });
}
```

Update `savePrintedReceipts` and `getPrintedReceipts` to use the new store with `id: 'default'`. On first open, migrate existing `PRINTED_RECEIPTS` entry from `receipts` store and delete it.

### Version bump
`src/constants/appVersion.ts` → v2.10.16

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useIndexedDB.ts` | Fix all 4 bugs: conditional device_approvals recreation, collision-safe orderId, preserve byProduct, separate printed_receipts store (DB_VERSION 11) |
| `src/constants/appVersion.ts` | Bump to v2.10.16 |

### Safety
- DB version increment triggers `onupgradeneeded` once — all existing stores preserved
- Printed receipts migrated automatically from old location
- No API changes — all existing callers (`ReprintContext`, `useDataSync`, etc.) use the same hook functions
- `getUnsyncedReceipts` filter for `PRINTED_RECEIPTS` kept as a safety net during migration window

