

## Fix multOpt=0 block fails after app restart — v2.10.63

### What's broken (your exact scenario)

You capture+submit offline for farmer `M03559` in coffee season `S0002`. The modal correctly blocks a second attempt in the same session. **Then you exit the app, log in again offline, and re-enter `M03559` — capture goes through.** The modal never appears.

### Root cause — one tiny case-sensitivity bug (and a logout/login amnesia hole)

Three pieces of in-memory state guard the duplicate block today:

1. **`capturedCollections`** (Index.tsx state) — the current uncommitted queue.
2. **`sessionSubmittedFarmerIds`** (Index.tsx state) — farmers submitted this session.
3. **`blacklistedFarmerIds`** (`useSessionBlacklist`) — recomputed from IndexedDB unsynced receipts + online API.

When the app is killed and restarted, **#1 and #2 are wiped** (they live only in React memory). Only #3 survives, because `useSessionBlacklist` rebuilds it from IndexedDB. So #3 is the **only** line of defence after a restart.

`#3 is broken for coffee orgs` because of one casing bug in `src/pages/Index.tsx` line 158:

```ts
const activeSeasonCode = activeSession ? String((activeSession as any).scode || '').trim() : undefined;
```

The `Session` interface (and every other use site, including line 802 `activeSession.SCODE`, line 884 `activeSession?.SCODE`, `sessionMetadata.ts`, `AIPage.tsx`) uses **uppercase `SCODE`**. The `.scode` lookup always returns `undefined`, so the hook receives `activeSeasonCode = ''`, and inside `refreshBlacklist`:

```ts
sessionMatches = !!seasonCode && rCode === seasonCode;
//                ^^^^^^^^^^^^ always false → coffee blacklist stays empty
```

After restart: no in-memory queue, no submitted set, **no blacklist** → capture proceeds → silent duplicate (which the v2.10.60 sync engine then catches and quarantines as `DUPLICATE_SESSION_DELIVERY`, surfacing the "stuck receipts" chip — but the operator already printed and handed out a duplicate receipt by then).

For dairy this also fails in a narrower way: if `activeSession.time_from` ever round-trips through localStorage as a string (`"600"` instead of `600`), `getSessionType()` may fall back to wall-clock, mismatching the receipt's stored `'AM'`/`'PM'`. Less common, but worth hardening at the same time.

### Fix — minimal, surgical, two files

#### 1. `src/pages/Index.tsx` — fix the case bug + add a strict typed read

Replace line 158 with a robust, case-tolerant read that mirrors how the rest of the codebase already reads SCODE:

```ts
// v2.10.63: read SCODE in the same case as the Session interface (uppercase).
// Tolerate legacy lowercase by checking both, normalize to uppercase trimmed string.
const activeSeasonCode = activeSession
  ? String(activeSession.SCODE ?? (activeSession as any).scode ?? '').trim()
  : undefined;
```

Also harden `activeSessionTimeFrom` against string round-trips from localStorage (line 154-156) — coerce to integer once, default to `undefined` (not `NaN`) so the hook's wall-clock fallback only fires when truly missing.

#### 2. `src/hooks/useSessionBlacklist.ts` — defensive fallback when SCODE is missing

Add a small safety net so a single misspelling never silently disables the coffee block again:

- If `coffee && !seasonCode`, **fall back to date-only matching** for coffee orgs (any unsynced receipt for the farmer today blacklists them). This is conservative — it can over-block in the rare case where the user genuinely changed seasons mid-day, but for coffee that's almost never a real workflow, and over-blocking is operationally safe (the modal explains why).
- Log a `[WARN] Coffee org with empty seasonCode — using date-only fallback` once per refresh so the bug surfaces in console instead of being silent.

#### 3. `src/pages/Index.tsx` — eager blacklist refresh on app start (cross-session safety)

Today the blacklist only refreshes when **both** `activeSession` is set AND `loadedFarmers.length > 0`. After app restart, `activeSession` is restored from localStorage in the Dashboard but `loadedFarmers` is only populated when the user actually opens Buy/Sell. That means the dashboard-level "stuck receipts" count is correct, but the per-farmer blacklist can show empty in console for several seconds after login.

Add a one-shot effect: when `activeSession` is restored from a prior session AND IndexedDB is `isReady`, **eagerly preload `loadedFarmers` from cache** (`getFarmers()` filtered by `selectedRouteCode`/`selectedRouteMprefix`) so `refreshBlacklist` runs **before** the user navigates into Buy. This closes the timing window for fast operators who can type the ID and tap the arrow before the screen finishes mounting.

This is additive — `BuyProduceScreen` still loads farmers on its own mount, identical to today.

### What does NOT change

- Backend (`server.js`) — untouched. The v2.10.60 `DUPLICATE_SESSION_DELIVERY` enforcement remains the last safety net.
- The v2.10.61 `DuplicateDeliveryDialog` modal itself — untouched.
- The v2.10.62 `FarmerSyncDashboard` changes — untouched.
- IndexedDB schema, reference generator, sync engine, photo audit, Z-Reports, periodic reports, multOpt=1 farmers, Sell Portal — all untouched.
- The blacklist's online API check — untouched.
- The `useSessionBlacklist` public API — same return shape, same call sites.

### Files Touched

| File | Change |
|---|---|
| `src/pages/Index.tsx` | Fix `.scode` → `.SCODE` (with lowercase fallback); harden `activeSessionTimeFrom` int coercion; add eager `loadedFarmers` preload on app start when an `activeSession` is restored from localStorage |
| `src/hooks/useSessionBlacklist.ts` | Add date-only fallback for coffee orgs when `seasonCode` is empty (safety net + console warning); no API change |
| `src/constants/appVersion.ts` | Bump to **v2.10.63** (Code **85**) + changelog comment *"v2.10.63 — Fix multOpt=0 block bypassed after app restart for coffee orgs (SCODE case bug). Eager blacklist preload closes the post-login timing window."* |
| `android/app/build.gradle` | `versionName "2.10.63"`, `versionCode 85` |

### Verification Checklist

1. **Coffee org, offline**: capture+submit `M03559` for season `S0002` → kill app → reopen offline → log in → open Buy Produce → re-enter `M03559` → **modal appears**, capture blocked, no duplicate receipt printed. ✓ (was broken)
2. **Coffee org, online, after restart**: same flow → modal appears (online API check + restored blacklist). ✓
3. **Dairy org, offline, after restart**: capture+submit `M00123` AM → kill app → reopen → re-enter → modal appears. ✓ (was working; verify no regression)
4. **Coffee org with corrupted/missing SCODE on the active session** (legacy cache edge case): date-only fallback triggers, modal still blocks; `[WARN]` logged to console. ✓
5. **Same-session, no restart**: existing in-memory queue + submitted-set behaviour unchanged. ✓
6. **multOpt=1 farmer**: zero behaviour change, no modal, unlimited captures. ✓
7. **Sell Portal (transtype=2)**: zero behaviour change, no modal. ✓
8. **Fast typist after login** (types farmer ID within ~500ms of opening Buy Produce): modal still appears thanks to eager preload. ✓
9. **v2.10.60 "stuck receipts" chip**: stays at zero in the new flow because the duplicate is now blocked at capture, not at sync. ✓
10. No new console errors; transactions, sync, receipts, photo audit, Z-Reports, periodic reports unchanged. ✓

### Out of scope

- Persisting `capturedCollections` / `sessionSubmittedFarmerIds` to localStorage (over-engineering — IndexedDB is already the source of truth for submitted records).
- Adding a "Conflicted Receipts" review screen (still a separate v2.10.64 candidate if you want it later).
- Changing the `Session` interface to alias `scode` ↔ `SCODE` (would mask future bugs; better to use the strict uppercase property name everywhere).

