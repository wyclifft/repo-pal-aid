

## Fix multOpt=0 silent data loss after offline captures — v2.10.60

### What you're seeing (and why)

You're right: **multOpt=0** means *one delivery per session per farmer*. The first offline capture syncs fine. The second offline capture for the same farmer/session **never reaches the DB** and operators get no clear warning. Two independent bugs cause this:

#### Bug A — Capture is *not* blocked offline for coffee orgs

`src/hooks/useSessionBlacklist.ts` line 67 builds the offline blacklist by reading `getUnsyncedReceipts()` and matching `r.session === sessionType` where `sessionType` is always `'AM'` or `'PM'`.

But for **coffee** orgs, captured receipts store `session = SCODE` (e.g. `S0002`). The match fails → no coffee multOpt=0 farmer ever gets blacklisted from offline receipts → operator can re-capture freely. (Dairy is partially protected because both sides use AM/PM, but the date comparison via `toISOString()` is timezone-shifted — a separate latent bug already covered by the `timezone-date-integrity-standard` memory.)

#### Bug B — Sync silently drops the second receipt

When two offline captures for the same farmer/session exist with different `uploadrefno` (which happens any time the operator restarts the buy workflow, closes the app, or the second capture is a different day), sync handles them like this:

1. **Frontend guard** in `src/hooks/useDataSync.ts` lines 189–227 calls `getByFarmerSessionDate`. Existing record found, `uploadrefno` differs → marks the receipt as **failed** in native SQLite, `continue`s. The IndexedDB row is **never deleted, never sent to backend, never surfaced to the operator**. It just rots locally and re-fails on every sync.
2. **If the guard misses** and the request reaches the backend, `server.js` line 909–918 returns HTTP **409** `DUPLICATE_SESSION_DELIVERY`. The sync handler at line 353–394 catches the word "duplicate", calls `getByReference(receipt.reference_no)`, gets `null` (because the server rejected it, never stored it), falls into `safeToDelete = true` (line 369), **deletes the IndexedDB row, and counts it as `synced`**. Silent loss.

Combined effect: operator sees "all synced", but a real delivery is missing in the cooperative's books.

### The fix — three layers, production-safe

#### Layer 1 — Block at capture, even offline, for ALL org types

Update `src/hooks/useSessionBlacklist.ts` to compare the receipt's session against the *correct* expected value:

- For **dairy** orgs (`orgtype !== 'C'`): keep AM/PM comparison, but also check `r.session.toUpperCase().includes(sessionType)` so legacy stamps like `'AM SESSION'` also match.
- For **coffee** orgs (`orgtype === 'C'`): compare `r.season_code` (preferred) or `r.session` against the **active session SCODE** passed into the hook.

Add a new optional param to the hook: `activeSeasonCode?: string`. `Index.tsx` already knows `activeSession.scode`, so it just passes it down (one-line change).

Replace the timezone-broken `new Date(r.collection_date).toISOString().split('T')[0]` with the local-date helper used elsewhere (per `timezone-date-integrity-standard`), so AM/PM rollover after midnight in EAT is correct.

After this layer, the operator gets a **toast at farmer selection time** (already wired via `BuyProduceScreen.handleSelectFarmer`) the moment they try to re-pick a farmer who already has an unsynced offline receipt — exactly your "they forget they already captured" scenario.

#### Layer 2 — Stop the silent drop in the sync engine

Two minimal, surgical changes in `src/hooks/useDataSync.ts`:

**(a) Frontend `multOpt=0` conflict guard (lines 189–227)** — when the existing remote `uploadrefno` differs from the incoming one, do NOT silently mark failed and continue. Instead:

- Mark as failed in native SQLite **with a clear message**: `"DUPLICATE_SESSION_DELIVERY: server already has uploadrefno=X for this farmer/session/date"`.
- Surface a **visible toast** (one per farmer per sync run, deduped by farmer+session+date) summarising the conflict and the stuck receipt's reference. Phrasing: *"Farmer M00123 already has a synced delivery for AM today. Local receipt #BB01200000044 was not uploaded — please review and clear or re-key intentionally."*
- Keep the local IndexedDB row in place so the operator/admin can see it. Add it to a new in-memory `conflictedReceipts` list exposed by `useDataSync` for an optional UI badge later (no UI work in this version — just the data + toast).

**(b) Backend-409 deletion path (lines 353–394)** — currently any "duplicate"-flavoured error makes the sync delete the local row when `getByReference` returns null. Tighten it: if the server response includes `error === 'DUPLICATE_SESSION_DELIVERY'` (which it does — see server.js lines 911 and 929), treat it like the (a) path above. **Never** delete the local receipt on `DUPLICATE_SESSION_DELIVERY`. Surface the same toast.

The existing "real duplicate by transrefno" path (where the same reference truly already exists on the server) is untouched — we only special-case the `DUPLICATE_SESSION_DELIVERY` error code, which is unambiguous.

#### Layer 3 — Operator-visible "blocked at sync" indicator

Add a small read-only count to the existing pending-sync banner: when there are `n` receipts that the sync engine has flagged as `DUPLICATE_SESSION_DELIVERY conflicts`, show a yellow **"⚠ {n} stuck receipt(s) need review"** chip in the dashboard's existing sync area (re-uses `unified-sync-visibility` styling). Tap-through opens an existing reprint/sync list — no new screen built in this version.

This makes the historical stuck rows that already exist on devices in the field visible immediately after upgrade, instead of staying invisible forever.

### Backend — no changes required

`server.js` already enforces `multOpt=0` correctly (lines 881–943) and returns the unambiguous `DUPLICATE_SESSION_DELIVERY` error code we'll key off. **No backend redeploy needed.** Older app versions keep the old (broken) behaviour, but every device that updates to v2.10.60 stops losing data immediately.

### What does NOT change

- `multOpt=0` business rule itself — still "one delivery per farmer per session per day".
- Sell Portal (`transtype=2`) — still exempt from multOpt (per memory `multopt-session-blocking-rules`).
- Reference generator format, `transrefno`/`uploadrefno`/`reference_no` mapping, sync idempotency matrix, IndexedDB schema, photo audit, cumulative engine, receipts, printing — all untouched.
- The "same uploadrefno = same workflow, allow extra rows" rule on the backend — preserved.
- The Sell Portal capture screen — `SellProduceScreen` is already a no-op for multOpt (memory).

### Files Touched

| File | Change |
|---|---|
| `src/hooks/useSessionBlacklist.ts` | Org-type-aware session matching (AM/PM for dairy, SCODE for coffee); local-date comparison; new optional `activeSeasonCode` param |
| `src/pages/Index.tsx` | Pass `activeSession?.scode` into `useSessionBlacklist` (one prop) |
| `src/hooks/useDataSync.ts` | Frontend `multOpt=0` guard: never silent-fail, surface toast, keep local row; backend 409 path: detect `DUPLICATE_SESSION_DELIVERY` and never delete local row; expose `conflictedReceiptsCount` |
| `src/components/Dashboard.tsx` (or existing sync banner component) | Show small "⚠ {n} stuck receipts" chip when `conflictedReceiptsCount > 0` |
| `src/constants/appVersion.ts` | Bump to v2.10.60 (Code 82); changelog comment |
| `android/app/build.gradle` | `versionName "2.10.60"`, `versionCode 82` |

### Verification Checklist

1. **Dairy, online, multOpt=0**: capture + submit for `M00123` AM → receipt syncs. Try to re-select `M00123` → blocked with toast. ✓ (already works)
2. **Dairy, offline, multOpt=0**: capture + submit `M00123` AM offline → close app → reopen offline → try to re-select `M00123` → **now blocked** with toast. ✓ (Layer 1 fix; previously could pass under timezone edge)
3. **Coffee, offline, multOpt=0**: capture + submit `M00123` season `S0002` offline → close app → reopen → try to re-select `M00123` → **now blocked**. ✓ (Layer 1 fix; previously always slipped through)
4. **Two offline receipts already exist for the same farmer/session with different uploadrefno** (the historical broken state): go online → first syncs OK → second is **kept locally** with a clear toast and shows in the new "⚠ {n} stuck receipts" chip — **not silently deleted**. ✓ (Layer 2 fix)
5. Backend response `error: 'DUPLICATE_SESSION_DELIVERY'` arriving from a v2.10.32 device that bypasses Layer 1 → still kept locally on devices running v2.10.60. ✓
6. Sell Portal (`transtype=2`) still allows unlimited captures, no blocking, no toasts. ✓
7. Receipts whose `transrefno` truly already exists on the server (rare collision case) still get cleaned up correctly via the existing duplicate path. ✓
8. `multOpt=1` farmers — zero behaviour change. ✓
9. No new console errors. App build, transactions, sync stats, receipts, photo audit unchanged.

### Out of scope

- A dedicated "Conflicted Receipts" admin screen with re-key / discard actions (this version surfaces them via toast + chip + existing reprint list; admin screen can come next).
- Server-side change to `server.js` (not needed; the code already returns the right error code).
- Auto-merging two offline receipts into a single workflow (operationally unsafe; we deliberately keep them stuck until a human resolves them).
- Migrating already-stuck-and-deleted historical rows (those are gone — only future losses are prevented; the chip surfaces only rows still in IndexedDB on devices that haven't synced since the bug last fired).

