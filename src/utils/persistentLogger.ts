/**
 * Persistent Debug Logger (v2.10.77)
 *
 * Captures console output + uncaught errors into a dedicated IndexedDB
 * database (`delicoopDebugLogs`) that survives logout, app restart, and
 * background-kill. NEVER touches `milkCollectionDB` — totally isolated from
 * transactions/farmers/cumulative cache so it cannot break production data.
 *
 * Design:
 *   - Ring buffer capped at MAX_ENTRIES (oldest pruned in batches).
 *   - In-memory queue, flushed every 1s (and on visibilitychange/pagehide).
 *   - Wraps console.{log,info,warn,error} once at boot — original calls
 *     are always invoked first so dev tools still work.
 *   - All writes wrapped in try/catch — logging must never crash the app.
 *   - Auto-redacts Bearer tokens and password fields from messages.
 */

const DB_NAME = 'delicoopDebugLogs';
const DB_VERSION = 1;
const STORE = 'logs';
const MAX_ENTRIES = 5000;
const PRUNE_BATCH = 200;
const FLUSH_INTERVAL_MS = 1000;

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id?: number;
  ts: number;          // epoch ms
  level: LogLevel;
  message: string;     // stringified args
  route?: string;
  user?: string;
  version?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;
const queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let installed = false;
let appVersion: string | undefined;

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
  return redact(parts.join(' '));
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

function enqueue(level: LogLevel, args: unknown[]) {
  try {
    queue.push({
      ts: Date.now(),
      level,
      message: safeStringify(args),
      route: getRoute(),
      user: getUser(),
      version: appVersion,
    });
  } catch { /* never throw */ }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      batch.forEach((e) => { try { store.add(e); } catch { /* ignore */ } });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    void prune();
  } catch {
    // Re-queue at the front if write failed (bounded so we don't grow forever)
    if (queue.length < MAX_ENTRIES) queue.unshift(...batch.slice(-MAX_ENTRIES));
  }
}

async function prune(): Promise<void> {
  try {
    const db = await openDB();
    const count = await new Promise<number>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
    if (count <= MAX_ENTRIES) return;
    const toDelete = (count - MAX_ENTRIES) + PRUNE_BATCH;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      let removed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && removed < toDelete) {
          cursor.delete();
          removed++;
          cursor.continue();
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
    out.sort((a, b) => b.ts - a.ts); // newest first
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
 * Call once, very early at app boot.
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

  enqueue('info', [`[persistentLogger] installed (v${version || 'unknown'})`]);
}
