## Always keep milk/coffee receipts in Recent Receipts — v2.10.67

### What's wrong today

`addStoreReceipt` and `addAIReceipt` were already hardened in v2.10.66 so Store/AI receipts stay in Recent Receipts even if sync never reaches the database. The same protection was **not** extended to milk/coffee receipts. Looking at `src/pages/Index.tsx`:

1. When the backend returns `DUPLICATE_SESSION_DELIVERY`, the submit handler sets `hardStopped = true` and **returns early on line 1209**, before the block that calls `addMilkReceipt(...)`. Result: the operator made and printed a real transaction, but it never lands in Recent Receipts.
2. When the local `saveReceipt(...)` (IndexedDB write) itself fails, neither `successCount` nor `offlineCount` is incremented. The flow then skips the receipt-history save altogether, even though the operator already captured weights and (in `printCopies > 0` mode) printed a thermal receipt in the background.

So the user's exact complaint — "for coffee or milk they should never be deleted even after failing to reach the database" — is the same root cause as the Store/AI fix: the receipt-history save is being suppressed by failure paths instead of running unconditionally.

### Goal

Treat `addMilkReceipt(...)` the same way `addStoreReceipt`/`addAIReceipt` are treated in v2.10.66: **always save the receipt snapshot locally as soon as a transaction was created**, regardless of:

- backend `DUPLICATE_SESSION_DELIVERY` rejection
- network error
- local IndexedDB write failure
- whether sync ever succeeds later

### Plan

#### 1. Always save milk/coffee receipt snapshot

In `src/pages/Index.tsx`, lift the milk-receipt history save out of the conditional success path so it runs in every outcome:

- On the `hardStopped` (duplicate-session) early return, call `addMilkReceipt(printData.collections, ...)` **before** returning. The transaction was attempted and references are real — it belongs in Recent Receipts so the operator can reprint and reconcile.
- In the normal success/offline-save path, keep the existing `addMilkReceipt(...)` calls (lines 1309 and 1404). These already work and shouldn't change.
- Add a final defensive `addMilkReceipt(...)` for the edge case where the loop completes but `successCount === 0 && offlineCount === 0` (every IndexedDB save failed). The on-screen receipt and the printed copy still represent a real transaction; the snapshot must be preserved.

All `addMilkReceipt` calls remain `.catch(() => {})` so a history-save failure never breaks the submit flow.

#### 2. Confirm duplicate-detection still works

`addMilkReceipt` already keys on `reference_no` (= `transrefno`), which comes from the per-device `lastTrnId` counter and is globally unique on the device. Calling it from multiple paths is safe: the existing duplicate guard inside `ReprintContext.addMilkReceipt` will silently skip if the same batch was already saved (e.g. if the user retries submit). No change needed in `ReprintContext.tsx`.

#### 3. Logging

Add a clear log line on the new `hardStopped` save path: `[REPRINT] Milk receipt preserved despite server duplicate-session rejection`. This makes the behavior auditable in the device logs without changing user-facing copy.

#### 4. Version bump

| File | Change |
|---|---|
| `src/constants/appVersion.ts` | Bump to **v2.10.67** with note: *"v2.10.67 — Milk and coffee receipts are always saved to Recent Receipts after a transaction is made, even if the backend rejects it as a duplicate or the local save fails. Matches the v2.10.66 fix already applied to Store and AI receipts."* |
| `android/app/build.gradle` | `versionName "2.10.67"`, `versionCode 89` |

### Files Touched

| File | Change |
|---|---|
| `src/pages/Index.tsx` | In `handleSubmit`: call `addMilkReceipt(...)` on the `hardStopped` early-return path; add a final defensive save for the `successCount === 0 && offlineCount === 0` edge case |
| `src/constants/appVersion.ts` | Version + changelog bump to 2.10.67 |
| `android/app/build.gradle` | `versionName 2.10.67`, `versionCode 89` |

### What does NOT change

- `src/contexts/ReprintContext.tsx` — `addMilkReceipt` already deduplicates by `reference_no`; no change needed.
- `src/components/ReprintModal.tsx` — milk receipt shape already includes everything reprint needs.
- Store/AI receipt logic from v2.10.66 — untouched.
- Sync engine, IndexedDB schema, native SQLite dual-write, transaction reference generator, multOpt=0 blacklist, cumulative weight, printing pipeline — all untouched.
- Backend `server.js` — untouched.
- Capacitor native plugins — untouched, no rebuild required.

### Verification

1. Online dairy submit, backend returns `DUPLICATE_SESSION_DELIVERY` → red toast still shown, captures still preserved on screen, **and the receipt now appears in Recent Receipts** with the correct reference and weights. Reprint from history works.
2. Online dairy submit, backend accepts → unchanged behavior; receipt in Recent Receipts (regression check).
3. Offline dairy submit → unchanged behavior; receipt saved offline AND in Recent Receipts (regression check).
4. Coffee submit (orgtype=C) on each of the three paths above → same expected behavior (uses the same `addMilkReceipt` code path).
5. multOpt=0 blacklist still triggers correctly only when `processedCount === capturedCollections.length` (regression check — that block is untouched).
6. Cumulative weight still computed and shown correctly on receipt and reprint (regression check).
7. No new console errors; build succeeds; app version reads `v2.10.67` on Settings/Dashboard.

### Out of scope

- Any change to Store/AI receipt history (already fixed in v2.10.66).
- Backend retention/cleanup of duplicate-rejected entries.
- Reconciling rejected-duplicate captures back into the multOpt=0 blacklist (intentionally left as-is so an operator can review).
