

## Audit Result: Device Config / Counter Writes Without `withLock`

### Status: Almost Clean

After the previous fix, every function that increments or syncs counters now uses `withLock`. Only **one remaining function** writes to the device config store without the mutex:

### Bug: `resetDeviceConfig` (line 576) — No Lock

This function clears both localStorage and IndexedDB config **without acquiring the lock**. If it runs concurrently with a reference generation (e.g., user taps "Reset" while a transaction is being submitted), it can:
- Delete `devcode` from localStorage mid-generation → `generateOfflineReference` returns `null`
- Delete the IndexedDB config record while `updateConfig` is reading it → counter reset to 0

**Severity:** Low — this is only called from test/debug flows, not normal operation. But for correctness it should be locked.

### Fix

Wrap `resetDeviceConfig` in `withLock`:

```ts
export const resetDeviceConfig = async (): Promise<void> => {
  return withLock(async () => {
    try {
      localStorage.removeItem(LOCALSTORAGE_KEY);
      localStorage.removeItem('devcode');
    } catch (error) { ... }
    
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await store.delete('config');
    } catch (error) { ... }
  });
};
```

### All Other Writers — Confirmed Safe

| Function | Has `withLock` |
|----------|---------------|
| `storeDeviceConfig` | ✅ |
| `syncOfflineCounter` | ✅ |
| `getNextTrnId` | ✅ |
| `generateOfflineReference` | ✅ |
| `getNextTypeId` | ✅ |
| `resetOfflineCounter` | ✅ |
| `resetDeviceConfig` | ❌ → fix |

| External Caller | Status |
|-----------------|--------|
| `Login.tsx` — `storeDeviceConfig` | ✅ awaited + locked |
| `Login.tsx` — `syncOfflineCounter` | ✅ locked |
| `DeviceAuthStatus.tsx` — `syncOfflineCounter` | ✅ locked |
| `Index/Store/AI` — `generateReferenceWithUploadRef` | ✅ locked internally |
| `Store/AI` — `generateTransRefOnly` | ✅ locked internally |

**One small fix. No other unlocked writers remain.**

