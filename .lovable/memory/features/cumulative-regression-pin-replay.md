---
name: Cumulative regression pin replay
description: localStorage-backed pin store of farmers whose batch prewarm was stale-rejected; replayed on every prewarm cycle so over-counts from prior sessions are eventually healed even when the farmer isn't in today's active batch.
type: feature
---

# Cumulative regression pin replay (v2.10.120)

## Why
The W3 batch prewarm only includes farmers in *today's* active set. A farmer whose cache was poisoned in a prior session (e.g. M01859 / M03544 / M02957 / M00385 / M03284 on BA01 from a v2.10.118 session) is never re-evaluated by today's batch, so the over-count survives indefinitely.

## Storage
- File: `src/utils/cumulativeRegressionPins.ts`
- Backing store: `localStorage` key `cumulative_regression_pins_v1` (small JSON map; no IndexedDB migration needed)
- Cap: 200 entries (oldest by `lastSeenAt` evicted first)
- TTL: 7 days (`lastSeenAt`)
- Multi-tenancy: scoped implicitly by device JWT and per-device localStorage

## Schema
```ts
interface RegressionPin {
  farmerId: string;       // cleanId, no leading '#'
  route: string;          // normalized routeKey, 'ALL' if none
  lastPersisted: number;  // cache value at time of pin
  lastBackend: number;    // backend value at time of pin
  firstSeenAt: number;    // ms epoch
  lastSeenAt: number;     // ms epoch (most recent re-pin)
  sessions: number;       // distinct STALE-REJECT events recorded
}
```

## API
- `addRegressionPin(farmerId, route, persisted, backend)` — called on every batch-prewarm stale-reject in `Index.tsx`.
- `clearRegressionPin(farmerId, route)` — called on heal-down success, on natural resolution (cache ≤ backend), or on confirmed empty cache.
- `takeRegressionPinsForReplay(route, coveredFarmerIds, limit)` — fairness-ordered by `firstSeenAt` ascending; excludes farmers already covered by today's batch.
- `listRegressionPins()` — read-only listing for the /debug console.

## Replay
Stage B of the W3 reconfirm pass (see `mem://features/cumulative-w3-reconfirm`). Up to 25 pins per cycle, two independent reads per farmer, heal-down only if (a) the two reads agree, (b) both are strictly less than the current persisted cache, (c) zero unsynced local rows on that route.

## Pin lifecycle (when do pins go away)
- Heal-down succeeded → cleared
- Cache matches backend on a later prewarm → cleared
- Cache went to 0 between sessions → cleared (treated as resolved/empty)
- 7 days elapsed without re-pin → pruned
- Cap reached → oldest by `lastSeenAt` evicted

## Out of scope
- No backend involvement; pins are device-local and best-effort.
- Pins are NOT used by the print-time floor / unsynced bucket — they only feed reconfirm.
- Not synced across devices; each device maintains its own pin set.
