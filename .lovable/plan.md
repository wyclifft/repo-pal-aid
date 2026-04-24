
# Fix: trnid "starting afresh" while storeid syncs correctly (v2.10.71)

## Symptom
Device `BA02` keeps generating references like `BA0220000341..348` that collide with already-existing backend rows owned by real members (e.g. `M03156`, `M02857`, `M00914`). Storeid/milkid/aiid sync from `devsettings` correctly, but `trnid` appears to "start afresh" — the device keeps trying low-or-stale values that are already taken.

## Root Cause (confirmed by code review)

In `src/utils/referenceGenerator.ts` → `syncOfflineCounter(...)`:

```ts
// SAFETY: Detect corrupted trnid from backend (e.g. clientFetch digit parsed as part of trnid)
if (backendTrnId > 10000000) {
  console.warn(`⚠️ [SYNC] Backend trnid ${backendTrnId} is unreasonably large — possible clientFetch corruption. Ignoring backend value.`);
  backendTrnId = 0;
}
const safeTrnId = Math.max(currentLocalTrnId, backendTrnId);
```

This cap was added to defend against a previous bug where the backend parsed clientFetch-prefixed strings into a 9-digit trnid. But:

1. **Multiple devices share the same `devcode`** (memory: `multi-device-company-code-sharing`). The backend's fingerprint endpoint already self-heals via `MAX(transrefno) WHERE transrefno LIKE '<devcode>%'`, so it legitimately returns the **global** trnid for that devcode — which can grow well past 10,000,000 over time on busy collection centers (especially coffee/dairy shared-devcode estates).
2. When the legitimate global trnid passes 10M, the frontend silently discards it and falls back to `0`. The local counter then "wins" `Math.max(local, 0) = local`, but local is far behind the global state because another device on the same devcode has written newer rows.
3. The device generates the next-after-its-local-counter reference, which is already taken by the sibling device → `REFERENCE_COLLISION` on every sync attempt.

`storeid`/`milkid`/`aiid` are NOT capped (they have no equivalent guard) — that's why they sync correctly while `trnid` does not. This perfectly explains the user's report.

The 10M guard is also obsolete now that `transrefno` is generated **without** clientFetch (only `uploadrefno` carries clientFetch — see `generateOfflineReference` vs `generateFormattedUploadRef`), so the original "clientFetch corruption" failure mode it was protecting against no longer exists.

## Plan

### 1. `src/utils/referenceGenerator.ts` — replace the broken 10M cap

Replace the absolute cap with a **relative sanity check** that only rejects backend values that are wildly larger than what local has seen, instead of penalising legitimately high counters.

Change the guard around line 407–412 from:

```ts
if (backendTrnId > 10000000) {
  console.warn(`⚠️ [SYNC] Backend trnid ${backendTrnId} is unreasonably large — possible clientFetch corruption. Ignoring backend value.`);
  backendTrnId = 0;
}
```

to:

```ts
// SAFETY: Only reject backend trnid if it is *implausibly* larger than the local
// counter (suggests a stale clientFetch-corrupted value). Devices that share a devcode
// can legitimately reach very high trnids (>10M), so an absolute cap caused real
// outages — the device kept generating colliding references because the legit
// high backend value was discarded. We instead require backend to be within a
// reasonable jump (e.g. 10M ahead of local) before accepting it as authoritative.
const MAX_REASONABLE_JUMP = 10_000_000; // tolerant headroom for shared-devcode estates
if (
  backendTrnId > 100_000_000 &&
  currentLocalTrnId > 0 &&
  backendTrnId - currentLocalTrnId > MAX_REASONABLE_JUMP
) {
  console.warn(`⚠️ [SYNC] Backend trnid ${backendTrnId} is implausibly far ahead of local ${currentLocalTrnId}; ignoring (possible corruption).`);
  backendTrnId = 0;
}
```

Effect:
- A device whose local counter is `0` (fresh install / cache wipe) will **always** accept the backend value (no rejection at zero), letting it catch up to the shared-devcode global max immediately.
- A device with local `20_000_340` and backend `20_000_341` accepts backend (delta 1, well within tolerance).
- Only obviously bogus values (e.g. local 100, backend 999_999_999) are rejected.

### 2. `src/utils/referenceGenerator.ts` — fix truthy-check for legit zero in callers

In `Login.tsx:100-103` and `DeviceAuthStatus.tsx:143-146` the pattern is:

```ts
const lastTrnId = data.data.trnid ? parseInt(String(data.data.trnid), 10) : undefined;
```

This treats `0` and `null` identically (both → `undefined`). That's fine for first-ever device, but it means a device whose backend value is `0` (not yet healed) sees `undefined` passed in, and `syncOfflineCounter` then leaves whatever local has — which is the desired fallback behavior. **No change needed**, but document it in the function comment so this is not "fixed" later by mistake.

Add a one-line comment above lines 100/143 in both files:

```ts
// Note: 0/null both → undefined, so syncOfflineCounter keeps the local counter.
//       The backend GREATEST(devsettings.trnid, MAX(transrefno)) self-heals on the next call.
```

### 3. `src/hooks/useDataSync.ts` — make collision recovery resilient to high trnids

Around line 304:

```ts
const trnidTail = parseInt(backendRef.slice(-8), 10) || 0;
if (devcode && trnidTail > 0) {
  try { await syncOfflineCounter(devcode, trnidTail); } catch {}
}
```

This is fine for trnids ≤ 99,999,999 (8 digits). Since collision recovery requests an authoritative ref from the backend (via `/api/milk-collection/next-reference` which uses the same devcode-prefix MAX query), it will return the correct global max. The new sanity check above will accept it.

**No code change needed here**, but add an inline comment noting that this path now relies on the relaxed sanity check in `syncOfflineCounter` to absorb high values:

```ts
// Push local forward to backend's authoritative trnid.
// (The relaxed sanity check in syncOfflineCounter accepts high values from
// shared-devcode estates that legitimately exceed 10M.)
```

### 4. Backend `backend-api/server.js` — make the self-heal also bound trnid to MAX storeid/milkid/aiid where applicable (optional, defensive)

Currently the fingerprint endpoint's self-heal only checks `MAX(transrefno) LIKE '<devcode>%'`. That's correct for `transrefno` but, just to belt-and-braces against any future reset of `devsettings.trnid` on a shared-devcode estate, we leave the existing healing logic untouched. **No change** — the existing v2.10.70 backend logic is correct; the bug was 100% client-side.

### 5. Version bump (per `version-alignment-and-cache-management-protocol`)

- `src/constants/appVersion.ts`: `APP_VERSION = '2.10.71'`, `APP_VERSION_CODE = 93`. Add a release note explaining the relaxed sanity check and why the absolute 10M cap was wrong for shared-devcode estates.
- `android/app/build.gradle`: bump `versionCode` to 93 and `versionName` to `"2.10.71"`.
- `public/sw.js`: bump cache version constant in line with the existing protocol so clients re-fetch the new bundle.

## Production-safety notes

- **No backend changes** — the existing v2.10.70 self-heal endpoint is preserved verbatim. Production mobile clients that haven't yet upgraded continue to work as before; they simply remain affected by the same collision until they upgrade.
- **Idempotent on existing devices**: Devices currently above 10M whose local counter already happens to be ahead won't change behavior. Devices currently colliding will, on next login / device-auth refresh / collision-recovery cycle, receive the high backend value, accept it, and start generating non-colliding references.
- **No data is overwritten or deleted.** The relaxed guard is purely additive in the "what values are accepted" sense.
- **Behavior on cache-wipe / fresh install** improves: previously a fresh device on a shared-devcode estate with global trnid >10M would silently generate `<devcode>00000001` and collide forever; now it correctly inherits the global max on first authorization.

## Files to edit

1. `src/utils/referenceGenerator.ts` — relax the trnid sanity check in `syncOfflineCounter`.
2. `src/components/Login.tsx` — add explanatory comment near the trnid sync site (no behavior change).
3. `src/components/DeviceAuthStatus.tsx` — add explanatory comment near the trnid sync site (no behavior change).
4. `src/hooks/useDataSync.ts` — add explanatory comment in collision-recovery path (no behavior change).
5. `src/constants/appVersion.ts` — bump to `2.10.71` (code 93) with release notes.
6. `android/app/build.gradle` — bump `versionCode` 93, `versionName` `"2.10.71"`.
7. `public/sw.js` — bump cache version per the version-alignment protocol.
