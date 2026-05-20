## Goal

Eliminate false `CUM:REGRESSION` rows caused by transient/stale backend reads (confirmed today: monitor saw 31.9 → 30.9, but the DB and receipt both show 31.9). Ship as **v2.10.91 / Version Code 113 / cache v38**.

No backend, schema, sync, or business-logic changes.

---

## 1. Two-read confirmation guard — `src/utils/cumulativeMonitor.ts`

Add a pending-regression buffer keyed by `farmerId|route`. When `after < before`:

- Compute `delta` and `relDelta = |delta| / before`.
- **Noise floor:** if `|delta| < 0.05` OR `relDelta < 0.001` → ignore silently (float noise).
- Look up `pending[key]`:
  - **No pending entry** → stash `{ before, after, prevByProduct, nextByProduct, ts: now, ttlMs: 8000 }`. Do NOT emit anything yet. Schedule no timer — TTL is checked lazily on the next observation.
  - **Pending entry exists and not expired:**
    - If `next >= pending.before` → transient confirmed false positive. Discard silently. Emit a sampled `CUM:TRANSIENT` debug row (1-in-10) so we can still see it in `/debug` if needed.
    - If `next < pending.before` AND the same icode(s) still show the same drop → **confirmed regression**. Run the existing icode-aware classifier (RECONTEXT vs REGRESSION vs REGRESSION?) using the *original* `pending.prevByProduct` vs the *current* `nextByProduct`, and emit accordingly. Clear the pending entry.
  - **Pending entry expired (now - ts > ttlMs)** → treat as no pending entry: stash the new candidate, do not emit.

Public API stays the same; the buffer is module-private.

Cleanup: cap the pending map at 500 entries; on overflow drop oldest.

## 2. Tag additions

- `CUM:TRANSIENT` (debug, sampled 1-in-10) — emitted when a stashed candidate is cleared because the next read recovered.
- Existing `CUM:REGRESSION`, `CUM:RECONTEXT`, `CUM:REGRESSION?` semantics unchanged — they only fire after the second read confirms.

## 3. Debug Console — `src/pages/DebugConsole.tsx`

In the Cumulative tab, add a small "Transient suppressed (24h): N" counter alongside the existing recontext / regression counters so operators can see the guard is working. No layout changes beyond that.

## 4. Versioning

- `APP_VERSION` → `2.10.91`
- `APP_VERSION_CODE` → `113`
- `CACHE_VERSION` → `v38` (service worker)

## Files touched

- `src/utils/cumulativeMonitor.ts` — pending buffer, two-read guard, `CUM:TRANSIENT` tag, noise floor
- `src/pages/DebugConsole.tsx` — transient counter in Cumulative tab
- `src/constants/appVersion.ts`, `android/app/build.gradle`, `public/sw.js` — version bumps

## Technical details

```text
observeBaseChange(prev, next, ctx):
  if next >= prev: existing RECALC sampling, return
  delta = next - prev
  if |delta| < 0.05 or |delta|/prev < 0.001: return   # noise floor

  key = farmerId + "|" + (route||"")
  p   = pending.get(key)
  now = Date.now()

  if !p or now - p.ts > 8000:
      pending.set(key, { before: prev, after: next,
                         prevByProduct: ctx.prevByProduct,
                         nextByProduct: ctx.nextByProduct,
                         ts: now })
      return                                          # wait for confirmation

  # second read available
  pending.delete(key)
  if next >= p.before:
      sampledDebug("CUM:TRANSIENT", ...)              # recovered → silent
      return

  # still regressed → classify using p.prevByProduct vs ctx.nextByProduct
  runExistingClassifier(p.before, next, p.prevByProduct, ctx.nextByProduct, ctx)
```

The classifier (RECONTEXT / REGRESSION / REGRESSION?) logic from v2.10.90 is reused verbatim — only the gating changes.

## Verification

- Trigger the scenario from today's log: simulate one observation 31.9 → 30.9 followed within 8s by 30.9 → 31.9 (or 31.9). Confirm **no** `CUM:REGRESSION` row is emitted; a `CUM:TRANSIENT` row may appear (sampled).
- Trigger a sustained drop: 31.9 → 30.9 twice in a row (>8s apart counts as new candidate; back-to-back within 8s counts as confirmation). Confirm `CUM:REGRESSION` fires after the second read.
- Trigger a tiny float drop (e.g. 31.9 → 31.89): confirm nothing fires.
- Confirm `/debug` Cumulative tab shows the new "Transient suppressed" counter and the existing Pinned Regressions panel is unchanged.
