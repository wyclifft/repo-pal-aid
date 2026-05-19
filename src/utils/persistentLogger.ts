/**
 * Persistent Debug Logger (v2.10.84)
 *
 * Dedicated, app-isolated IndexedDB store for debug logs that survive:
 *   - logout
 *   - app reload / restart
 *   - device reboot
 *
 * Designed to be lightweight and crash-proof on low-end Android POS devices:
 *   - Batched async writes (never blocks UI thread)
 *   - 2s dedupe window (collapses repeat lines into a single row + count)
 *   - Hard rate cap of 50 entries/sec (excess summarised as a single "dropped N" row)
 *   - Size cap (5,000 rows, ~5 MB) with oldest-first prune
 *   - 7-day age prune at startup + hourly
 *   - QuotaExceededError recovery (prune to 50% and retry once)
 *   - Payload trimming (2 KB per entry, depth-limited stringify)
 *
 * NOTE: This database is intentionally separate from the main app IndexedDB
 *       so a schema migration / data clear in the app DB cannot wipe debug
 *       history. It also means cumulative/sync data is unaffected.
 */

const DB_NAME = "delicoop-debug-logs";
const DB_VERSION = 1;
const STORE = "logs";

const MAX_ROWS = 5000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FLUSH_EVERY_MS = 1000;
const FLUSH_AT_QUEUE = 25;
const DEDUPE_WINDOW_MS = 2000;
const RATE_CAP_PER_SEC = 50;
const ENTRY_DATA_CAP_BYTES = 2048;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PLogEntry {
  id?: number;
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
  data?: string; // pre-stringified, capped
  count?: number;
  route?: string;
  version?: string;
  pinned?: 0 | 1; // v2.10.88: pinned rows survive age/row-cap pruning
}

// v2.10.88: two-tier retention for pinned rows (CUM:REGRESSION etc.)
const PINNED_MAX_ROWS = 500;
const PINNED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let dbPromise: Promise<IDBDatabase | null> | null = null;
let persistenceDisabled = false;

function openDb(): Promise<IDBDatabase | null> {
  if (persistenceDisabled) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          os.createIndex("ts", "ts", { unique: false });
          os.createIndex("level", "level", { unique: false });
          os.createIndex("tag", "tag", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        persistenceDisabled = true;
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    } catch {
      persistenceDisabled = true;
      resolve(null);
    }
  });
  return dbPromise;
}

// ---- payload trimming -------------------------------------------------------

function safeStringify(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const seen = new WeakSet();
    let str = JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]";
        seen.add(v);
      }
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    });
    if (str && str.length > ENTRY_DATA_CAP_BYTES) {
      str = str.slice(0, ENTRY_DATA_CAP_BYTES) + "…[truncated]";
    }
    return str;
  } catch {
    try {
      return String(value).slice(0, ENTRY_DATA_CAP_BYTES);
    } catch {
      return undefined;
    }
  }
}

// ---- queue + dedupe + rate limit -------------------------------------------

interface QueuedEntry extends PLogEntry {}

const queue: QueuedEntry[] = [];
let lastEntry: QueuedEntry | null = null;
let lastEntryAt = 0;

let rateWindowStart = 0;
let rateWindowCount = 0;
let droppedSinceLastFlush = 0;

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_EVERY_MS);
}

let cachedVersion: string | undefined;
export function _setLoggerAppVersion(v: string) {
  cachedVersion = v;
}
function appVersion(): string | undefined {
  return cachedVersion;
}

function currentRoute(): string | undefined {
  try {
    return typeof window !== "undefined" ? window.location.pathname : undefined;
  } catch {
    return undefined;
  }
}

function enqueue(level: LogLevel, tag: string, message: string, data?: unknown) {
  const now = Date.now();

  // Rate cap: 50/sec
  if (now - rateWindowStart >= 1000) {
    rateWindowStart = now;
    rateWindowCount = 0;
  }
  rateWindowCount++;
  if (rateWindowCount > RATE_CAP_PER_SEC) {
    droppedSinceLastFlush++;
    return;
  }

  const dataStr = safeStringify(data);

  // Dedupe window: identical (level, tag, message, data) within 2s collapses
  if (
    lastEntry &&
    now - lastEntryAt <= DEDUPE_WINDOW_MS &&
    lastEntry.level === level &&
    lastEntry.tag === tag &&
    lastEntry.message === message &&
    lastEntry.data === dataStr
  ) {
    lastEntry.count = (lastEntry.count || 1) + 1;
    lastEntry.ts = now;
    lastEntryAt = now;
    return;
  }

  const entry: QueuedEntry = {
    ts: now,
    level,
    tag,
    message: typeof message === "string" ? message.slice(0, 1024) : String(message).slice(0, 1024),
    data: dataStr,
    count: 1,
    route: currentRoute(),
    version: appVersion(),
  };
  queue.push(entry);
  lastEntry = entry;
  lastEntryAt = now;

  if (queue.length >= FLUSH_AT_QUEUE) {
    void flush();
  } else {
    scheduleFlush();
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0 && droppedSinceLastFlush === 0) return;
  const db = await openDb();
  if (!db) {
    queue.length = 0;
    droppedSinceLastFlush = 0;
    return;
  }

  if (droppedSinceLastFlush > 0) {
    queue.push({
      ts: Date.now(),
      level: "warn",
      tag: "LOGGER",
      message: `dropped ${droppedSinceLastFlush} log entries (rate cap)`,
      count: 1,
      route: currentRoute(),
      version: appVersion(),
    });
    droppedSinceLastFlush = 0;
  }

  const batch = queue.splice(0, queue.length);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      for (const e of batch) os.add(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    const name = (err as DOMException | null)?.name;
    if (name === "QuotaExceededError") {
      try {
        await pruneToHalf();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          const os = tx.objectStore(STORE);
          for (const e of batch) os.add(e);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        persistenceDisabled = true;
      }
    }
    // swallow other errors — never break app on logging failures
  }
}

async function pruneToHalf(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const countReq = os.count();
    countReq.onsuccess = () => {
      const total = countReq.result;
      const toDelete = Math.floor(total / 2);
      if (toDelete <= 0) return resolve();
      const idx = os.index("ts");
      const cursorReq = idx.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || removed >= toDelete) return resolve();
        cur.delete();
        removed++;
        cur.continue();
      };
      cursorReq.onerror = () => resolve();
    };
    countReq.onerror = () => resolve();
  });
}

async function pruneOld(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const idx = tx.objectStore(STORE).index("ts");
    const range = IDBKeyRange.upperBound(cutoff);
    const cursorReq = idx.openCursor(range);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) return resolve();
      cur.delete();
      cur.continue();
    };
    cursorReq.onerror = () => resolve();
  });

  // Also enforce max-row cap
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const countReq = os.count();
    countReq.onsuccess = () => {
      const total = countReq.result;
      const excess = total - MAX_ROWS;
      if (excess <= 0) return resolve();
      const idx = os.index("ts");
      const cursorReq = idx.openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || removed >= excess) return resolve();
        cur.delete();
        removed++;
        cur.continue();
      };
      cursorReq.onerror = () => resolve();
    };
    countReq.onerror = () => resolve();
  });
}

// Hourly maintenance + initial prune (after first paint)
function startMaintenance() {
  setTimeout(() => {
    void pruneOld();
  }, 5000);
  setInterval(() => {
    void pruneOld();
  }, 60 * 60 * 1000);
}

// Flush on page hide / unload
function bindLifecycleFlush() {
  if (typeof window === "undefined") return;
  const onHide = () => {
    void flush();
  };
  window.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  window.addEventListener("beforeunload", onHide);
}

// ---- public API -------------------------------------------------------------

export const plog = {
  debug: (tag: string, message: string, data?: unknown) => enqueue("debug", tag, message, data),
  info: (tag: string, message: string, data?: unknown) => enqueue("info", tag, message, data),
  warn: (tag: string, message: string, data?: unknown) => enqueue("warn", tag, message, data),
  error: (tag: string, message: string, data?: unknown) => enqueue("error", tag, message, data),

  flush,

  async list(opts: { level?: LogLevel; tag?: string; search?: string; limit?: number } = {}): Promise<PLogEntry[]> {
    const db = await openDb();
    if (!db) return [];
    const limit = opts.limit ?? 1000;
    return new Promise((resolve) => {
      const out: PLogEntry[] = [];
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("ts");
      // newest first
      const cursorReq = idx.openCursor(null, "prev");
      const search = opts.search?.toLowerCase();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur || out.length >= limit) return resolve(out);
        const v = cur.value as PLogEntry;
        const okLevel = !opts.level || v.level === opts.level;
        const okTag = !opts.tag || v.tag === opts.tag;
        const okSearch =
          !search ||
          v.message.toLowerCase().includes(search) ||
          (v.data && v.data.toLowerCase().includes(search)) ||
          v.tag.toLowerCase().includes(search);
        if (okLevel && okTag && okSearch) out.push(v);
        cur.continue();
      };
      cursorReq.onerror = () => resolve(out);
    });
  },

  async tags(): Promise<string[]> {
    const db = await openDb();
    if (!db) return [];
    return new Promise((resolve) => {
      const set = new Set<string>();
      const tx = db.transaction(STORE, "readonly");
      const cursorReq = tx.objectStore(STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cur = cursorReq.result;
        if (!cur) return resolve(Array.from(set).sort());
        set.add((cur.value as PLogEntry).tag);
        cur.continue();
      };
      cursorReq.onerror = () => resolve([]);
    });
  },

  async clear(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  async stats(): Promise<{ count: number; estBytes: number }> {
    const db = await openDb();
    if (!db) return { count: 0, estBytes: 0 };
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const os = tx.objectStore(STORE);
      const countReq = os.count();
      countReq.onsuccess = () => {
        let bytes = 0;
        const cursorReq = os.openCursor();
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (!cur) return resolve({ count: countReq.result, estBytes: bytes });
          const v = cur.value as PLogEntry;
          bytes += (v.message?.length || 0) + (v.data?.length || 0) + 64;
          cur.continue();
        };
        cursorReq.onerror = () => resolve({ count: countReq.result, estBytes: bytes });
      };
      countReq.onerror = () => resolve({ count: 0, estBytes: 0 });
    });
  },

  async exportNDJSON(): Promise<Blob> {
    const rows = await plog.list({ limit: 10000 });
    const lines = rows.map((r) => JSON.stringify(r)).join("\n");
    return new Blob([lines], { type: "application/x-ndjson" });
  },

  async exportCSV(): Promise<Blob> {
    const rows = await plog.list({ limit: 10000 });
    const esc = (v: unknown): string => {
      if (v === undefined || v === null) return "";
      const s = String(v).replace(/\r?\n/g, " ").replace(/\r/g, " ");
      // Always quote, escape internal quotes
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = "timestamp,level,tag,message,data,count,route,version";
    const body = rows
      .map((r) =>
        [
          esc(new Date(r.ts).toISOString()),
          esc(r.level),
          esc(r.tag),
          esc(r.message),
          esc(r.data ?? ""),
          esc(r.count ?? 1),
          esc(r.route ?? ""),
          esc(r.version ?? ""),
        ].join(",")
      )
      .join("\n");
    // Prepend BOM for Excel UTF-8 compatibility
    return new Blob(["\uFEFF" + header + "\n" + body], { type: "text/csv;charset=utf-8" });
  },
};

// ---- global capture ---------------------------------------------------------

let installed = false;

function classifyTag(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "string") {
    const s = first;
    if (/IndexedDB|VersionError|object ?store/i.test(s)) return "IDB";
    if (/bluetooth|BLE|printer|scale|BT|classic/i.test(s)) return "BT";
    if (/sync|cumulative|\[CUM]|REFERENCE_COLLISION|upload/i.test(s)) return "SYNC";
    if (/fetch|xhr|api|http|network|503|502|cors/i.test(s)) return "API";
    if (/auth|login|jwt|device approv/i.test(s)) return "AUTH";
    if (/\[CUM]/i.test(s)) return "CUM";
  }
  return "GLOBAL";
}

function joinArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

export function installPersistentLogger() {
  if (installed) return;
  installed = true;

  // Wrap console.error / warn — NEVER replace, always still call original
  try {
    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const origLog = console.log.bind(console);

    console.error = (...args: unknown[]) => {
      try {
        enqueue("error", classifyTag(args), joinArgs(args));
      } catch {
        /* noop */
      }
      origError(...args);
    };
    console.warn = (...args: unknown[]) => {
      try {
        enqueue("warn", classifyTag(args), joinArgs(args));
      } catch {
        /* noop */
      }
      origWarn(...args);
    };
    // console.log: only capture lines tagged with our [CUM]/[SYNC]/[BT] taxonomy
    console.log = (...args: unknown[]) => {
      try {
        const first = args[0];
        if (typeof first === "string" && /^\s*\[(CUM|SYNC|BT|API|AUTH|IDB)]/i.test(first)) {
          enqueue("info", classifyTag(args), joinArgs(args));
        }
      } catch {
        /* noop */
      }
      origLog(...args);
    };
  } catch {
    /* noop */
  }

  if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
      try {
        const err = event.error;
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(event.message || "window error");
        enqueue("error", "UNHANDLED", msg, err instanceof Error ? { stack: err.stack } : undefined);
      } catch {
        /* noop */
      }
    });

    window.addEventListener("unhandledrejection", (event) => {
      try {
        const reason = (event as PromiseRejectionEvent).reason;
        const msg = reason instanceof Error ? `${reason.name}: ${reason.message}` : safeStringify(reason) || "unhandled rejection";
        enqueue("error", "UNHANDLED", msg, reason instanceof Error ? { stack: reason.stack } : undefined);
      } catch {
        /* noop */
      }
    });

    window.addEventListener("online", () => enqueue("info", "NET", "online"));
    window.addEventListener("offline", () => enqueue("warn", "NET", "offline"));
  }

  bindLifecycleFlush();
  startMaintenance();

  enqueue("info", "LOGGER", `persistent logger installed v${appVersion() || "?"}`);
}

export default plog;
