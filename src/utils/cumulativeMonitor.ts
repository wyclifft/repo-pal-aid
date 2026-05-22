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

/**
 * v2.10.95: Read the currently-selected dashboard context from localStorage so
 * every cumulative log row carries tcode/icode/scode/ccode/devcode. Pure read,
 * never throws — falls back to {} if anything is missing.
 */
function getActiveContext(): Record<string, string> {
  const ctx: Record<string, string> = {};
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("active_session_data") : null;
    if (raw) {
      const d = JSON.parse(raw);
      const tcode = d?.route?.tcode;
      const icode = d?.product?.icode;
      const scode = d?.session?.SCODE;
      if (tcode) ctx.tcode = String(tcode).trim();
      if (icode) ctx.icode = String(icode).trim().toUpperCase();
      if (scode) ctx.scode = String(scode).trim();
    }
  } catch { /* noop */ }
  try {
    const cc = typeof localStorage !== "undefined" ? localStorage.getItem("device_ccode") : null;
    const dc = typeof localStorage !== "undefined" ? localStorage.getItem("devcode") : null;
    if (cc) ctx.ccode = cc;
    if (dc) ctx.devcode = dc;
  } catch { /* noop */ }
  return ctx;
}

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
// v2.10.91: Two-read confirmation guard. A single transient/stale backend read
// can momentarily show a lower total (e.g. mid-write, paginated response, stale
// cache layer) and recover on the next refresh. We now stash the candidate
// regression and only emit CUM:REGRESSION / CUM:RECONTEXT after a second read
// confirms the drop is real. Recovered candidates emit a sampled CUM:TRANSIENT
// debug row so we can still see them in /debug.

interface PendingCandidate {
  before: number;
  after: number;
  prevByProduct?: ByProductEntry[];
  nextByProduct?: ByProductEntry[];
  ts: number;
}

const PENDING_TTL_MS = 8000;
const PENDING_MAX = 500;
const NOISE_ABS = 0.05;     // ignore drops smaller than 50 g
const NOISE_REL = 0.001;    // ignore drops smaller than 0.1%
const pending = new Map<string, PendingCandidate>();
let transientCounter = 0;
const TRANSIENT_SAMPLE_RATE = 10;

function pendingKey(ctx: CumulativeContext): string {
  return `${(ctx.farmerId || "").trim().toUpperCase()}|${(ctx.route || "").trim().toUpperCase()}`;
}

function emitClassified(
  before: number,
  after: number,
  prevByProduct: ByProductEntry[] | undefined,
  nextByProduct: ByProductEntry[] | undefined,
  ctx: CumulativeContext
): void {
  const delta = +(after - before).toFixed(3);
  const prevMap = toIcodeMap(prevByProduct);
  const nextMap = toIcodeMap(nextByProduct);
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
      plog.info("CUM:RECONTEXT",
        `${ctx.farmerId} route=${ctx.route || "?"} re-bucketed ${before}→${after} (Δ${delta}) dropped=[${dropped.join(",")}] added=[${added.join(",")}]`,
        { ...getActiveContext(), ...ctx, before, after, delta, dropped, added, commonDelta, cause: dropped.length && !added.length ? "icode-removed" : added.length && !dropped.length ? "icode-added" : "icode-reshuffled" }
      );
      return;
    }

    const diff: Record<string, number> = {};
    for (const k of commonIcodes) {
      const d = +(nextMap.get(k)! - prevMap.get(k)!).toFixed(3);
      if (d !== 0) diff[k] = d;
    }
    plog.pinned("error", "CUM:REGRESSION",
      `${ctx.farmerId} route=${ctx.route || "?"} ${before} → ${after} (Δ${delta}) [confirmed]`,
      { ...getActiveContext(), ...ctx, before, after, delta, perIcodeDiff: diff, dropped, added, suspectedCause: classifyRegression(diff, dropped, added), confirmed: true }
    );
    return;
  }

  plog.warn("CUM:REGRESSION?",
    `${ctx.farmerId} route=${ctx.route || "?"} ${before} → ${after} (Δ${delta}) [confirmed, no breakdown]`,
    { ...getActiveContext(), ...ctx, before, after, delta, confirmed: true, note: "byProduct unavailable; cannot distinguish regression from re-bucketing" }
  );
}

export function observeBaseChange(
  prev: number | undefined,
  next: number,
  ctx: CumulativeContext
): void {
  try {
    const before = typeof prev === "number" ? prev : 0;
    const after = typeof next === "number" ? next : 0;
    if (!isFinite(before) || !isFinite(after)) return;

    const key = pendingKey(ctx);
    const now = Date.now();

    if (after >= before) {
      // Recovery path: if we had stashed a candidate, this read confirms it was transient.
      const p = pending.get(key);
      if (p && now - p.ts <= PENDING_TTL_MS && after >= p.before - 0.001) {
        pending.delete(key);
        transientCounter++;
        if (transientCounter % TRANSIENT_SAMPLE_RATE === 0) {
          plog.debug("CUM:TRANSIENT",
            `${ctx.farmerId} route=${ctx.route || "?"} transient drop suppressed ${p.before}→${p.after}→${after}`,
            { ...getActiveContext(), ...ctx, before: p.before, transient: p.after, recovered: after }
          );
        }
      }
      if (after === before && before > 0) {
        recalcCounter++;
        if (recalcCounter % RECALC_SAMPLE_RATE === 0) {
          plog.debug("CUM:RECALC", `${ctx.farmerId} unchanged @ ${after}`, { ...getActiveContext(), farmerId: ctx.farmerId, route: ctx.route });
        }
      }
      return;
    }

    // after < before — apply noise floor first
    const delta = after - before;
    const relDelta = before > 0 ? Math.abs(delta) / before : 1;
    if (Math.abs(delta) < NOISE_ABS || relDelta < NOISE_REL) return;

    const p = pending.get(key);
    if (!p || now - p.ts > PENDING_TTL_MS) {
      // First sighting (or expired prior) — stash and wait for confirmation.
      if (pending.size >= PENDING_MAX) {
        const oldest = pending.keys().next().value;
        if (oldest) pending.delete(oldest);
      }
      pending.set(key, {
        before,
        after,
        prevByProduct: ctx.prevByProduct,
        nextByProduct: ctx.nextByProduct,
        ts: now,
      });
      return;
    }

    // Second read within TTL — confirm against the original `before`.
    pending.delete(key);
    if (after >= p.before - 0.001) {
      transientCounter++;
      if (transientCounter % TRANSIENT_SAMPLE_RATE === 0) {
        plog.debug("CUM:TRANSIENT",
          `${ctx.farmerId} route=${ctx.route || "?"} transient drop suppressed ${p.before}→${p.after}→${after}`,
          { ...getActiveContext(), ...ctx, before: p.before, transient: p.after, recovered: after }
        );
      }
      return;
    }

    // Still regressed → classify using the ORIGINAL prevByProduct vs the current nextByProduct.
    emitClassified(p.before, after, p.prevByProduct, ctx.nextByProduct, ctx);
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
