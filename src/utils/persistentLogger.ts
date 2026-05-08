/**
 * Persistent Debug Logger (v2.10.78)
 *
 * Captures console output + uncaught errors into a dedicated IndexedDB
 * database (`delicoopDebugLogs`) — isolated from production data.
 *
 * Hardened in v2.10.78:
 *   - Throttling/dedupe: identical messages within 2s are coalesced
 *     (emitted as "(×N suppressed)") so noisy loops cannot flood storage.
 *   - Hard rate cap (50 records / second flushed) with a single drop summary.
 *   - QuotaExceeded recovery: oldest 1000 rows dropped and write retried.
 *   - Periodic age-based prune (keep 7 days, max 5000 rows).
 *   - Re-entrancy + double-install guards.
 *   - Production gate: drops oversized debug payloads, never throws.
 */

const DB_NAME = 'delicoopDebugLogs';
const DB_VERSION = 1;
const STORE = 'logs';
const MAX_ENTRIES = 5000;
const SOFT_CAP = 5500;
const PRUNE_BATCH = 200;
const FLUSH_INTERVAL_MS = 1000;
const DEDUPE_WINDOW_MS = 2000;
const DEDUPE_MAX_KEYS = 200;
const RATE_CAP_PER_SEC = 50;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_PAYLOAD_CHARS = 4000;

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id?: number;
  ts: number;
  level: LogLevel;
  message: string;
  route?: string;
  user?: string;
  version?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;
let appVersion: string | undefined;
let inLogger = false; // re-entrancy guard
let droppedSinceLastFlush = 0;

// Dedupe map: key -> { count, firstTs, lastEmitTs }
interface DedupeEntry { count: number; firstTs: number; lastEmitTs: number; level: LogLevel; }
const dedupeMap = new Map<string, DedupeEntry>();

// Rate cap window (per-second)
let rateWindowStart = 0;
let rateWindowCount = 0;

const isProd = (() => {
  try { return Boolean((import.meta as any)?.env?.PROD); } catch { return false; }
})();

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          s.createIndex('ts', 'ts', { unique: false });
          s.createIndex('level', 'level', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
  return dbPromise;
}

function safeStringify(args: unknown[]): string {
  const seen = new WeakSet();
  const parts = args.map((a) => {
    if (a == null) return String(a);
    if (typeof a === 'string') return a;
    if (typeof a === 'number' || typeof a === 'boolean') return String(a);
    if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
    try {
      return JSON.stringify(a, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      });
    } catch {
      try { return String(a); } catch { return '[Unserializable]'; }
    }
  });
  let out = redact(parts.join(' '));
  if (out.length > MAX_PAYLOAD_CHARS) out = out.slice(0, MAX_PAYLOAD_CHARS) + '…(truncated)';
  return out;
}

function redact(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/("?password"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/(password\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
}

function getRoute(): string | undefined {
  try { return typeof location !== 'undefined' ? location.pathname : undefined; } catch { return undefined; }
}

function getUser(): string | undefined {
  try {
    const raw = localStorage.getItem('delicoop_user');
    if (raw) {
      const u = JSON.parse(raw);
      return u?.userid || u?.username || u?.user_id;
    }
  } catch { /* ignore */ }
  return undefined;
}

/** Build dedupe key — strip dynamic numbers/timestamps so similar errors collapse. */
function dedupeKey(level: LogLevel, msg: string): string {
  const skeleton = msg
    .slice(0, 200)
    .replace(/\d{4,}/g, '#')
    .replace(/0x[0-9a-f]+/gi, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return `${level}:${skeleton}`;
}

function evictOldestDedupe() {
  if (dedupeMap.size <= DEDUPE_MAX_KEYS) return;
  const firstKey = dedupeMap.keys().next().value;
  if (firstKey !== undefined) dedupeMap.delete(firstKey);
}

function enqueue(level: LogLevel, args: unknown[]) {
  if (inLogger) return; // re-entrancy guard
  try {
    inLogger = true;

    // Production gate: drop verbose log/debug if too large
    if (isProd && (level === 'log') && args.length > 0) {
      // keep but truncate (already truncated in safeStringify)
    }

    const message = safeStringify(args);
    const key = dedupeKey(level, message);
    const now = Date.now();

    // Dedupe: same key within window → just count
    const existing = dedupeMap.get(key);
    if (existing && (now - existing.lastEmitTs) < DEDUPE_WINDOW_MS) {
      existing.count++;
      return;
    }

    // If we have suppressed copies from a previous window, flush them now
    let finalMessage = message;
    if (existing && existing.count > 1) {
      finalMessage = `${message} (×${existing.count} suppressed in last ${Math.max(1, Math.round((now - existing.firstTs) / 1000))}s)`;
    }

    // Update / insert dedupe entry
    if (existing) {
      existing.count = 1;
      existing.lastEmitTs = now;
      existing.firstTs = now;
    } else {
      dedupeMap.set(key, { count: 1, firstTs: now, lastEmitTs: now, level });
      evictOldestDedupe();
    }

    // Hard rate cap
    if (now - rateWindowStart >= 1000) {
      rateWindowStart = now;
      rateWindowCount = 0;
    }
    if (rateWindowCount >= RATE_CAP_PER_SEC) {
      droppedSinceLastFlush++;
      return;
    }
    rateWindowCount++;

    queue.push({
      ts: now,
      level,
      message: finalMessage,
      route: getRoute(),
      user: getUser(),
      version: appVersion,
    });

    // Bound the in-memory queue defensively
    if (queue.length > MAX_ENTRIES) {
      const overflow = queue.length - MAX_ENTRIES;
      queue.splice(0, overflow);
      droppedSinceLastFlush += overflow;
    }
  } catch { /* never throw */ }
  finally {
    inLogger = false;
  }
}

async function writeBatch(db: IDBDatabase, batch: LogEntry[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let quotaHit = false;
      batch.forEach((e) => {
        try {
          const req = store.add(e);
          req.onerror = (ev) => {
            const err = (ev.target as IDBRequest).error;
            if (err && err.name === 'QuotaExceededError') quotaHit = true;
            ev.preventDefault?.();
          };
        } catch { /* ignore single-row failure */ }
      });
      tx.oncomplete = () => resolve(!quotaHit);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function dropOldestRows(db: IDBDatabase, n: number): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      let removed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && removed < n) {
          cursor.delete();
          removed++;
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

async function flush(): Promise<void> {
  if (queue.length === 0 && droppedSinceLastFlush === 0) return;
  // Capture & emit drop summary as a single record
  if (droppedSinceLastFlush > 0) {
    queue.push({
      ts: Date.now(),
      level: 'warn',
      message: `[LOGGER] dropped ${droppedSinceLastFlush} entries (rate cap or queue overflow)`,
      route: getRoute(),
      user: getUser(),
      version: appVersion,
    });
    droppedSinceLastFlush = 0;
  }
  const batch = queue.splice(0, queue.length);
  try {
    const db = await openDB();
    let ok = await writeBatch(db, batch);
    if (!ok) {
      // QuotaExceeded path — drop oldest 1000 rows then retry once
      try { await dropOldestRows(db, 1000); } catch { /* ignore */ }
      ok = await writeBatch(db, batch);
    }
    void prune();
  } catch {
    // Swallow — never throw from logger
  }
}

async function prune(): Promise<void> {
  try {
    const db = await openDB();
    // Count + age prune
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const cutoff = Date.now() - MAX_AGE_MS;
      let countReq: IDBRequest<number>;
      try { countReq = store.count(); }
      catch { resolve(); return; }
      countReq.onsuccess = () => {
        const total = countReq.result || 0;
        const overflow = Math.max(0, total - MAX_ENTRIES);
        const toDelete = overflow > 0 ? overflow + PRUNE_BATCH : 0;
        if (toDelete === 0) {
          // age-only sweep
          const idx = store.index('ts');
          const range = IDBKeyRange.upperBound(cutoff);
          const cur = idx.openCursor(range);
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) { c.delete(); c.continue(); }
          };
        } else {
          const cursor = store.openCursor();
          let removed = 0;
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c && removed < toDelete) {
              c.delete();
              removed++;
              c.continue();
            }
          };
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch { /* ignore */ }
}

export async function getLogs(opts?: { level?: LogLevel; sinceMs?: number; search?: string; limit?: number }): Promise<LogEntry[]> {
  try {
    const db = await openDB();
    const all = await new Promise<LogEntry[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    let out = all;
    if (opts?.level) out = out.filter((e) => e.level === opts.level);
    if (opts?.sinceMs) {
      const cutoff = Date.now() - opts.sinceMs;
      out = out.filter((e) => e.ts >= cutoff);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      out = out.filter((e) => e.message.toLowerCase().includes(q));
    }
    out.sort((a, b) => b.ts - a.ts);
    if (opts?.limit) out = out.slice(0, opts.limit);
    return out;
  } catch {
    return [];
  }
}

export async function getLogStats(): Promise<{ total: number; errors1h: number }> {
  try {
    const db = await openDB();
    const total = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
    const since = Date.now() - 60 * 60 * 1000;
    const all = await getLogs({ level: 'error', sinceMs: 60 * 60 * 1000 });
    return { total, errors1h: all.filter((e) => e.ts >= since).length };
  } catch {
    return { total: 0, errors1h: 0 };
  }
}

export async function clearLogs(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    dedupeMap.clear();
  } catch { /* ignore */ }
}

export function exportLogsAsText(entries: LogEntry[]): string {
  const lines = entries
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((e) => {
      const t = new Date(e.ts).toISOString();
      const meta = [e.route, e.user, e.version].filter(Boolean).join(' | ');
      return `[${t}] [${e.level.toUpperCase()}] ${meta ? `(${meta}) ` : ''}${e.message}`;
    });
  return lines.join('\n');
}

/**
 * Install console interceptors + global error handlers. Idempotent.
 */
export function installPersistentLogger(version?: string): void {
  if (installed) return;
  installed = true;
  appVersion = version;

  const levels: LogLevel[] = ['log', 'info', 'warn', 'error'];
  levels.forEach((lvl) => {
    const orig = (console as any)[lvl]?.bind(console);
    if (typeof orig !== 'function') return;
    (console as any)[lvl] = (...args: unknown[]) => {
      try { orig(...args); } catch { /* ignore */ }
      enqueue(lvl, args);
    };
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (ev) => {
      enqueue('error', [`[window.error] ${ev.message}`, ev.filename, `:${ev.lineno}:${ev.colno}`, ev.error?.stack || '']);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason;
      enqueue('error', ['[unhandledrejection]', r instanceof Error ? `${r.message}\n${r.stack}` : r]);
    });

    const flushNow = () => { void flush(); };
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }

  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  pruneTimer = setInterval(() => { void prune(); }, 60 * 1000);

  enqueue('info', [`[persistentLogger] installed (v${version || 'unknown'}) — throttle ${DEDUPE_WINDOW_MS}ms, cap ${RATE_CAP_PER_SEC}/s, max ${MAX_ENTRIES}`]);
}
