/**
 * Cumulative Monitor (v2.10.88)
 *
 * Lightweight helper that watches every cumulative refresh and emits
 * structured persistent log rows for /debug. It does NOT perform any math,
 * does NOT make network calls, and never throws into the caller — every
 * public entry point is wrapped in try/catch so cumulative writes can never
 * be blocked by monitoring.
 *
 * Tag taxonomy (all pinned where noted):
 *   CUM:REGRESSION  (pinned, error)   — base went backwards
 *   CUM:RECALC      (debug, sampled)  — base unchanged but rewritten
 *   CUM:DUPLICATE   (warn)            — transrefno re-synced
 *   CUM:ORDER       (warn)            — local row dated after server row
 *   CUM:OFFLINE     (info)            — offline buffer flushed late
 *   CUM:EDIT        (pinned, warn)    — fingerprint of a known transrefno changed
 *   CUM:INSERT      (pinned, warn)    — unknown mid-month transrefno surfaced
 *   CUM:ERROR       (pinned, error)   — exception inside cumulative path
 *   CUM:SYNC        (info)            — one summary row per bulk batch
 */

import { plog } from "./persistentLogger";

const RECALC_SAMPLE_RATE = 50; // emit 1-in-50

let recalcCounter = 0;

export interface CumulativeContext {
  farmerId: string;
  route?: string;
  icode?: string;
  source?: string; // "batch" | "individual" | "post-sync" | "print" | ...
}

/**
 * Compare the previous (cached) baseCount with the new backend baseCount and
 * emit the right CUM:* row. Should be called immediately BEFORE the IndexedDB
 * write inside updateFarmerCumulative (backend path only).
 */
export function observeBaseChange(
  prev: number | undefined,
  next: number,
  ctx: CumulativeContext
): void {
  try {
    const before = typeof prev === "number" ? prev : 0;
    const after = typeof next === "number" ? next : 0;
    if (!isFinite(before) || !isFinite(after)) return;

    if (after < before) {
      const delta = +(after - before).toFixed(3);
      plog.pinned("error", "CUM:REGRESSION",
        `${ctx.farmerId} route=${ctx.route || "?"} ${before} → ${after} (Δ${delta})`,
        { ...ctx, before, after, delta, suspectedCause: classifyRegression(before, after, ctx) }
      );
      return;
    }
    if (after === before && before > 0) {
      recalcCounter++;
      if (recalcCounter % RECALC_SAMPLE_RATE === 0) {
        plog.debug("CUM:RECALC", `${ctx.farmerId} unchanged @ ${after}`, ctx);
      }
    }
    // growth: silent (normal)
  } catch {
    /* never throw from monitor */
  }
}

function classifyRegression(_before: number, _after: number, _ctx: CumulativeContext): string {
  // Heuristic only — full classification needs fingerprint diff (see recordRowFingerprint)
  return "unknown";
}

// ---- fingerprint tracking for edit / insert detection ---------------------

interface RowFingerprint {
  ccode?: string;
  route?: string;
  transdate?: string;
  transtype?: string | number;
  weight?: number;
}

const fingerprints = new Map<string, RowFingerprint>();
const FP_MAX = 5000;

export function recordRowFingerprint(transrefno: string, fp: RowFingerprint): void {
  try {
    if (!transrefno) return;
    const prev = fingerprints.get(transrefno);
    if (prev) {
      const cause = diffFingerprint(prev, fp);
      if (cause) {
        plog.pinned("warn", "CUM:EDIT", `${transrefno} ${cause}`, { transrefno, prev, next: fp, cause });
      }
    } else if (fingerprints.size === 0 && fp.transdate) {
      // first-ever sighting; no signal
    } else if (fp.transdate && isPastDate(fp.transdate)) {
      // surfaced mid-month with a back-dated transdate → likely manual insert
      plog.pinned("warn", "CUM:INSERT", `${transrefno} back-dated ${fp.transdate}`, { transrefno, ...fp });
    }
    fingerprints.set(transrefno, fp);
    // LRU eviction (simple)
    if (fingerprints.size > FP_MAX) {
      const firstKey = fingerprints.keys().next().value;
      if (firstKey) fingerprints.delete(firstKey);
    }
  } catch {
    /* noop */
  }
}

function diffFingerprint(a: RowFingerprint, b: RowFingerprint): string | null {
  if ((a.ccode || "") !== (b.ccode || "")) return "ccode-reassigned";
  if ((a.route || "").toUpperCase() !== (b.route || "").toUpperCase()) return "route-changed";
  if ((a.transdate || "") !== (b.transdate || "")) return "date-shifted";
  if (String(a.transtype ?? "") !== String(b.transtype ?? "")) return "transtype-changed";
  return null;
}

function isPastDate(iso: string): boolean {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d.getTime() < today.getTime();
  } catch {
    return false;
  }
}

// ---- batch summarization --------------------------------------------------

interface BatchState {
  label: string;
  startedAt: number;
  ok: number;
  fail: number;
  total?: number;
  extra?: Record<string, unknown>;
}

const batches = new Map<string, BatchState>();

export function startBatch(label: string, total?: number, extra?: Record<string, unknown>): void {
  batches.set(label, { label, startedAt: Date.now(), ok: 0, fail: 0, total, extra });
}

export function batchOk(label: string, n = 1): void {
  const b = batches.get(label);
  if (b) b.ok += n;
}

export function batchFail(label: string, n = 1): void {
  const b = batches.get(label);
  if (b) b.fail += n;
}

export function endBatch(label: string, totalOverride?: number): void {
  try {
    const b = batches.get(label);
    if (!b) return;
    batches.delete(label);
    const total = totalOverride ?? b.total ?? (b.ok + b.fail);
    const elapsedMs = Date.now() - b.startedAt;
    const sec = (elapsedMs / 1000).toFixed(1);
    const msg = `${label} · ${b.ok}/${total} ok · ${b.fail} err · ${sec}s`;
    const level = b.fail > 0 ? "warn" : "info";
    plog[level === "warn" ? "warn" : "info"]("CUM:SYNC", msg, { label, ok: b.ok, fail: b.fail, total, elapsedMs, ...(b.extra || {}) });
  } catch {
    /* noop */
  }
}

// ---- public api ----------------------------------------------------------

export const cumulativeMonitor = {
  observeBaseChange,
  recordRowFingerprint,
  startBatch,
  batchOk,
  batchFail,
  endBatch,
};

export default cumulativeMonitor;
