// v2.10.120: Sticky-regression pin store.
//
// When the W3 prewarm batch detects that the cache is strictly greater than
// what the backend reports (STALE-REJECT), we pin the farmer so that we keep
// re-evaluating them on subsequent prewarms — even if a future prewarm no
// longer includes them in today's active batch. Without this, a farmer that
// got a "poisoned" cache before today (e.g. M01859, M03544, M02957, M00385,
// M03284 from v2.10.118 sessions) would never be re-checked again until
// something farmer-specific touches them.
//
// Storage: localStorage (small JSON map, capped). Avoids IndexedDB schema
// migration. Keyed per device — pin set is implicitly multi-tenant via the
// device JWT scoping already enforced elsewhere.
//
// Pin lifecycle:
//   - add()   : called from the batch loop when STALE-REJECT signature fires.
//   - take()  : returns up to N pins NOT covered by the just-finished batch.
//   - clear() : called after a successful heal-down OR when cache==backend.
//   - prune() : drops pins older than 7 days on every read.

const LS_KEY = 'cumulative_regression_pins_v1';
const MAX_PINS = 200;
const PIN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface RegressionPin {
  farmerId: string;       // cleanId (no leading #, trimmed)
  route: string;          // normalized routeKey ('ALL' if none)
  lastPersisted: number;  // cache value at time of pin
  lastBackend: number;    // backend value at time of pin
  firstSeenAt: number;    // ms epoch — first time pinned
  lastSeenAt: number;     // ms epoch — most recent re-pin
  sessions: number;       // count of distinct STALE-REJECT events recorded
}

type PinMap = Record<string, RegressionPin>;

function keyOf(farmerId: string, route: string): string {
  return `${(farmerId || '').replace(/^#/, '').trim()}::${(route || 'ALL').trim().toUpperCase()}`;
}

function safeRead(): PinMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed as PinMap : {};
  } catch {
    return {};
  }
}

function safeWrite(map: PinMap): void {
  try {
    // Cap size: keep newest MAX_PINS by lastSeenAt.
    const entries = Object.entries(map);
    if (entries.length > MAX_PINS) {
      entries.sort((a, b) => (b[1].lastSeenAt || 0) - (a[1].lastSeenAt || 0));
      const kept: PinMap = {};
      for (let i = 0; i < MAX_PINS; i++) kept[entries[i][0]] = entries[i][1];
      localStorage.setItem(LS_KEY, JSON.stringify(kept));
      return;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // localStorage full or unavailable — drop silently; pins are best-effort.
  }
}

function pruneStale(map: PinMap): PinMap {
  const cutoff = Date.now() - PIN_TTL_MS;
  let mutated = false;
  for (const [k, v] of Object.entries(map)) {
    if (!v || (v.lastSeenAt || 0) < cutoff) {
      delete map[k];
      mutated = true;
    }
  }
  if (mutated) safeWrite(map);
  return map;
}

export function addRegressionPin(
  farmerId: string,
  route: string,
  persisted: number,
  backend: number
): void {
  if (!farmerId) return;
  const map = pruneStale(safeRead());
  const k = keyOf(farmerId, route);
  const now = Date.now();
  const existing = map[k];
  map[k] = {
    farmerId: (farmerId || '').replace(/^#/, '').trim(),
    route: (route || 'ALL').trim().toUpperCase(),
    lastPersisted: Number(persisted) || 0,
    lastBackend: Number(backend) || 0,
    firstSeenAt: existing?.firstSeenAt || now,
    lastSeenAt: now,
    sessions: (existing?.sessions || 0) + 1,
  };
  safeWrite(map);
}

export function clearRegressionPin(farmerId: string, route: string): void {
  if (!farmerId) return;
  const map = safeRead();
  const k = keyOf(farmerId, route);
  if (map[k]) {
    delete map[k];
    safeWrite(map);
  }
}

/**
 * Return pins eligible for replay this cycle:
 *   - Not in the `coveredFarmerIds` set (those just got a fresh batch read).
 *   - On the requested route (route === 'ALL' matches any pin).
 *   - Capped at `limit` (oldest firstSeenAt first — fairness, ensures
 *     long-stuck pins get retried).
 */
export function takeRegressionPinsForReplay(
  route: string,
  coveredFarmerIds: Set<string>,
  limit: number
): RegressionPin[] {
  const map = pruneStale(safeRead());
  const wantRoute = (route || 'ALL').trim().toUpperCase();
  const all = Object.values(map);
  const eligible = all.filter(p => {
    if (wantRoute !== 'ALL' && p.route !== 'ALL' && p.route !== wantRoute) return false;
    return !coveredFarmerIds.has(p.farmerId);
  });
  eligible.sort((a, b) => (a.firstSeenAt || 0) - (b.firstSeenAt || 0));
  return eligible.slice(0, Math.max(0, limit | 0));
}

export function listRegressionPins(): RegressionPin[] {
  return Object.values(pruneStale(safeRead()));
}
