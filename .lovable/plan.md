

## Plan: Fix Reference Number Race Condition

### Root Cause

`syncOfflineCounter` and `storeDeviceConfig` read/write the device config **without the `withLock` mutex**. Meanwhile, `generateOfflineReference` (which generates transrefno) **does** use the lock. This creates a race condition:

1. User makes a Store transaction → `generateOfflineReference` (locked) writes `lastTrnId=1`
2. The 30-second `checkAuthorization` interval fires → `syncOfflineCounter` (unlocked) reads stale `lastTrnId=0` from IndexedDB, writes back `Math.max(0, 0) = 0`, **overwriting the counter**
3. User switches to Buy → `generateOfflineReference` reads `lastTrnId=0`, generates trnid=1 again → **duplicate transrefno**

Additionally, in `DeviceAuthStatus.tsx` line 159, `initializeDeviceConfig` is called **after** `syncOfflineCounter`, creating a second unlocked read-then-write that can also overwrite just-incremented counters.

### Bugs

| # | Location | Issue |
|---|----------|-------|
| 1 | `referenceGenerator.ts` — `syncOfflineCounter` | No mutex lock; can overwrite counter mid-generation |
| 2 | `referenceGenerator.ts` — `storeDeviceConfig` | No mutex lock; same race |
| 3 | `DeviceAuthStatus.tsx` line 159 | Redundant `initializeDeviceConfig` call after sync — second unlocked write |
| 4 | `Login.tsx` line 95 | `storeDeviceConfig` called without `await` (fire-and-forget), races with subsequent `syncOfflineCounter` |

### Fix

#### 1. `src/utils/referenceGenerator.ts` — Wrap both functions in `withLock`

- **`syncOfflineCounter`**: Wrap the entire body in `withLock` so it can't interleave with `generateOfflineReference`
- **`storeDeviceConfig`**: Wrap the entire body in `withLock` for the same reason

This ensures all config reads and writes are serialized through one queue.

#### 2. `src/components/DeviceAuthStatus.tsx` — Remove redundant `initializeDeviceConfig` call

Line 159 calls `initializeDeviceConfig` (which calls `storeDeviceConfig`) right after `syncOfflineCounter` already stored the devcode and all counters. This is redundant and creates a second write. Remove it.

#### 3. `src/components/Login.tsx` — Await `storeDeviceConfig`

Line 95: Change from fire-and-forget to `await storeDeviceConfig(...)` so it completes before `syncOfflineCounter` runs.

### Files Changed

| File | Change |
|------|--------|
| `src/utils/referenceGenerator.ts` | Add `withLock` wrapper to `syncOfflineCounter` and `storeDeviceConfig` |
| `src/components/DeviceAuthStatus.tsx` | Remove redundant `initializeDeviceConfig` call on line 159 |
| `src/components/Login.tsx` | Add `await` to `storeDeviceConfig` call on line 95 |

