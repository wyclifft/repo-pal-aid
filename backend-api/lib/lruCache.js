/**
 * Tiny TTL + LRU cache (zero dependencies).
 *
 * Purpose
 *   Reduce MySQL load on hot read-only lookups (psettings, cm_members,
 *   approved_devices) by serving repeated identical queries from memory.
 *   Each cache hit is one less connection borrowed from the 40-conn
 *   cPanel user pool.
 *
 * SAFETY (production)
 *   - DO NOT cache anything that participates in authorization decisions
 *     with a TTL longer than ~15s. Revocations must propagate quickly.
 *   - DO NOT cache writes or rows the same request mutates.
 *   - Use short TTLs (30–120s) and small max sizes; this is a hot-path
 *     accelerator, not a primary store.
 *
 * Usage
 *   const { createCache, cachedQuery } = require('./lib/lruCache');
 *   const psettingsCache = createCache({ max: 200, ttlMs: 120000 });
 *
 *   // wrap any pool.query call:
 *   const rows = await cachedQuery(psettingsCache, `ps:${ccode}`, () =>
 *     pool.query('SELECT ... FROM psettings WHERE ccode = ?', [ccode])
 *       .then(([r]) => r)
 *   );
 */

function createCache({ max = 200, ttlMs = 60000 } = {}) {
  const store = new Map(); // key -> { value, expiresAt }
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
      }
      // LRU bump: re-insert to move to tail.
      store.delete(key);
      store.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (store.size > max) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
    },
    delete(key) { store.delete(key); },
    clear() { store.clear(); },
    size() { return store.size; },
  };
}

async function cachedQuery(cache, key, loader) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  cache.set(key, value);
  return value;
}

module.exports = { createCache, cachedQuery };
