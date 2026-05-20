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

export interface ByProductEntry {
  icode: string;
  product_name?: string;
  weight: number;
}

export interface CumulativeContext {
  farmerId: string;
  route?: string;
  icode?: string;
  source?: string; // "batch" | "individual" | "post-sync" | "print" | ...
  prevByProduct?: ByProductEntry[];
  nextByProduct?: ByProductEntry[];
}

function toIcodeMap(arr?: ByProductEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  if (!Array.isArray(arr)) return m;
  for (const e of arr) {
    if (!e || !e.icode) continue;
    const key = String(e.icode).trim().toUpperCase();
    const w = Number(e.weight) || 0;
    m.set(key, (m.get(key) || 0) + w);
  }
  return m;
}

/**
 * Compare the previous (cached) baseCount with the new backend baseCount and
 * emit the right CUM:* row. Uses byProduct breakdown when available to
 * distinguish true regressions from per-icode re-bucketing (e.g. an admin
 * reassigned a transaction's ccode/icode, dropping it from this bucket).
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

    if (after >= before) {
      if (after === before && before > 0) {
        recalcCounter++;
        if (recalcCounter % RECALC_SAMPLE_RATE === 0) {
          plog.debug("CUM:RECALC", `${ctx.farmerId} unchanged @ ${after}`, { farmerId: ctx.farmerId, route: ctx.route });
        }
      }
      return;
    }

    // after < before — classify before alerting
    const delta = +(after - before).toFixed(3);
    const prevMap = toIcodeMap(ctx.prevByProduct);
    const nextMap = toIcodeMap(ctx.nextByProduct);
    const haveBreakdown = prevMap.size > 0 && nextMap.size > 0;

    if (haveBreakdown) {
      const dropped: string[] = [];
      const added: string[] = [];
      const commonIcodes: string[] = [];
      let commonDelta = 0;
      for (const k of prevMap.keys()) {
        if (nextMap.has(k)) { commonIcodes.push(k); commonDelta += (nextMap.get(k)! - prevMap.get(k)!); }
        else dropped.push(k);
      }
      for (const k of nextMap.keys()) if (!prevMap.has(k)) added.push(k);

      const icodeSetDiffers = dropped.length > 0 || added.length > 0;
      if (icodeSetDiffers && commonDelta >= -0.001) {
        // legitimate re-bucketing: a product moved in/out, common buckets are stable
        plog.info("CUM:RECONTEXT",
          `${ctx.farmerId} route=${ctx.route || "?"} re-bucketed ${before}→${after} (Δ${delta}) dropped=[${dropped.join(",")}] added=[${added.join(",")}]`,
          { ...ctx, before, after, delta, dropped, added, commonDelta, cause: dropped.length && !added.length ? "icode-removed" : added.length && !dropped.length ? "icode-added" : "icode-reshuffled" }
        );
        return;
      }

      // same icode set (or common buckets shrank) → real regression
      const diff: Record<string, number> = {};
      for (const k of commonIcodes) {
        const d = +(nextMap.get(k)! - prevMap.get(k)!).toFixed(3);
        if (d !== 0) diff[k] = d;
      }
      plog.pinned("error", "CUM:REGRESSION",
        `${ctx.farmerId} route=${ctx.route || "?"} ${before} → ${after} (Δ${delta})`,
        { ...ctx, before, after, delta, perIcodeDiff: diff, dropped, added, suspectedCause: classifyRegression(diff, dropped, added) }
      );
      return;
    }

    // No breakdown available on one or both sides — downgrade to non-pinned warn
    plog.warn("CUM:REGRESSION?",
      `${ctx.farmerId} route=${ctx.route || "?"} ${before} → ${after} (Δ${delta}) [no breakdown]`,
      { ...ctx, before, after, delta, note: "byProduct unavailable; cannot distinguish regression from re-bucketing" }
    );
  } catch {
    /* never throw from monitor */
  }
}

function classifyRegression(perIcodeDiff: Record<string, number>, dropped: string[], added: string[]): string {
  if (dropped.length && !added.length) return "icode-removed-from-bucket";
  if (added.length && !dropped.length) return "icode-added-to-bucket";
  const negs = Object.entries(perIcodeDiff).filter(([, v]) => v < 0);
  if (negs.length === 1) return `weight-decreased:${negs[0][0]}`;
  if (negs.length > 1) return "multiple-icode-decrease";
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
