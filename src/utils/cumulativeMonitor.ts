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
 * v2.10.101: Focused-farmer trace mode. When `localStorage.cum_debug_focus`
 * is set (comma-separated farmer IDs), every read/write of those farmers'
 * cumulative cache emits a CUM:FOCUS / CUM:READ row with full context.
 * Empty list = no-op (zero overhead for everyone else).
 */
let focusSet: Set<string> | null = null;
let focusLoaded = false;
function loadFocus(): Set<string> {
  if (focusLoaded && focusSet) return focusSet;
  const s = new Set<string>();
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("cum_debug_focus") : null;
    if (raw) {
      for (const id of raw.split(",")) {
        const k = id.replace(/^#/, "").trim().toUpperCase();
        if (k) s.add(k);
      }
    }
  } catch { /* noop */ }
  focusSet = s;
  focusLoaded = true;
  return s;
}
export function isFocusedFarmer(farmerId: string): boolean {
  try {
    const s = loadFocus();
    if (s.size === 0) return false;
    return s.has((farmerId || "").replace(/^#/, "").trim().toUpperCase());
  } catch { return false; }
}
export function plogFocus(tag: string, msg: string, data?: Record<string, unknown>): void {
  try {
    plog.info(tag, msg, { ...getActiveContext(), ...(data || {}) });
  } catch { /* never throw */ }
}

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
      const factory = d?.route?.factory || d?.factory?.fcode || d?.factory;
      const icode = d?.product?.icode;
      const scode = d?.session?.SCODE;
      if (tcode) ctx.tcode = String(tcode).trim();
      if (factory) ctx.factory = String(factory).trim();
      if (icode) ctx.icode = String(icode).trim().toUpperCase();
      if (scode) ctx.scode = String(scode).trim();
    }
  } catch { /* noop */ }
  try {
    const cc = typeof localStorage !== "undefined" ? localStorage.getItem("device_ccode") : null;
    const dc = typeof localStorage !== "undefined" ? localStorage.getItem("devcode") : null;
    if (cc) ctx.ccode = cc;
    if (dc) ctx.devcode = dc;
    // v2.10.117: stable per-app-load session id for correlating writes
    let sid = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("cum_session_id") : null;
    if (!sid && typeof sessionStorage !== "undefined") {
      sid = `S${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      sessionStorage.setItem("cum_session_id", sid);
    }
    if (sid) ctx.sessionId = sid;
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

// ---- always-on write log (v2.10.115) -------------------------------------
//
// Every cumulative cache write — backend refresh, local increment, sync,
// print-time refresh — emits exactly one CUM:WRITE row so discrepancies
// like M01186 (405.0 → 396.8 silently) are visible end-to-end without
// relying on the regression confirmation flow.

const growthCounter = { n: 0 };
const GROWTH_SAMPLE_RATE = 20;

export interface WriteLogCtx {
  farmerId: string;
  route?: string;
  source: string; // 'backend' | 'local' | 'sync' | 'post-sync' | 'print' | 'batch-dashboard'
  prevByProduct?: ByProductEntry[];
  nextByProduct?: ByProductEntry[];
  transrefno?: string;
  increment?: number;
  reason?: string;
  verifySource?: string; // v2.10.117: writer tag (W1..W7)
  caller?: string;       // v2.10.117: calling function name
  writeSeq?: number;     // v2.10.117: persisted writeSeq snapshot
}

export function logWrite(
  prev: number | undefined,
  next: number,
  ctx: WriteLogCtx
): void {
  try {
    const before = +(Number(prev) || 0).toFixed(3);
    const after = +(Number(next) || 0).toFixed(3);
    const delta = +(after - before).toFixed(3);
    const prevSum = (ctx.prevByProduct || []).reduce((s, p) => s + (Number(p?.weight) || 0), 0);
    const nextSum = (ctx.nextByProduct || []).reduce((s, p) => s + (Number(p?.weight) || 0), 0);

    // Per-icode diff (best-effort; safe when breakdowns missing)
    const prevMap = toIcodeMap(ctx.prevByProduct);
    const nextMap = toIcodeMap(ctx.nextByProduct);
    const perIcodeDiff: Record<string, number> = {};
    const keys = new Set<string>([...prevMap.keys(), ...nextMap.keys()]);
    for (const k of keys) {
      const d = +(((nextMap.get(k) || 0) - (prevMap.get(k) || 0))).toFixed(3);
      if (d !== 0) perIcodeDiff[k] = d;
    }

    const arrow = `${before}→${after}`;
    const sign = delta > 0 ? `+${delta}` : `${delta}`;
    const vs = ctx.verifySource ? ` vs=${ctx.verifySource}` : "";
    const cl = ctx.caller ? ` caller=${ctx.caller}` : "";
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} src=${ctx.source}${vs}${cl} ${arrow} (Δ${sign})${ctx.transrefno ? ` ref=${ctx.transrefno}` : ""}`;
    const level = delta < 0 ? "warn" : "info";
    plog[level === "warn" ? "warn" : "info"]("CUM:WRITE", msg, {
      ...getActiveContext(),
      farmerId: ctx.farmerId,
      route: ctx.route,
      source: ctx.source,
      verifySource: ctx.verifySource,
      caller: ctx.caller,
      writeSeq: ctx.writeSeq,
      prevValue: before,
      newValue: after,
      delta,
      prevByProductSum: +prevSum.toFixed(3),
      nextByProductSum: +nextSum.toFixed(3),
      perIcodeDiff,
      transrefno: ctx.transrefno,
      increment: ctx.increment,
      reason: ctx.reason,
    });
  } catch { /* never throw */ }
}

// v2.10.117: every backend write that reaches updateFarmerCumulative passes
// through a stale-check. The check compares incoming vs. the just-read
// persisted baseCount inside the same readwrite tx — no writeSeq compare,
// hence STALE-CHECK / STALE-REJECT (not "CAS").
export interface StaleCtx {
  farmerId: string;
  route?: string;
  prevValue: number;
  newValue: number;
  writeSeq?: number;
  verifySource?: string;
  caller?: string;
  transrefno?: string;
}
export function logStaleCheck(decision: "accept" | "reject", ctx: StaleCtx): void {
  try {
    const delta = +(ctx.newValue - ctx.prevValue).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} ${decision} prev=${ctx.prevValue} new=${ctx.newValue} (Δ${delta}) vs=${ctx.verifySource || "?"} caller=${ctx.caller || "?"}${ctx.transrefno ? ` ref=${ctx.transrefno}` : ""}`;
    plog.info("CUM:STALE-CHECK", msg, { ...getActiveContext(), decision, ...ctx, delta });
  } catch { /* never throw */ }
}
export function logStaleReject(ctx: StaleCtx): void {
  try {
    const delta = +(ctx.newValue - ctx.prevValue).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} REJECT incoming<persisted prev=${ctx.prevValue} new=${ctx.newValue} (Δ${delta}) vs=${ctx.verifySource || "?"} caller=${ctx.caller || "?"}${ctx.transrefno ? ` ref=${ctx.transrefno}` : ""}`;
    plog.pinned("warn", "CUM:STALE-REJECT", msg, { ...getActiveContext(), ...ctx, delta });
  } catch { /* never throw */ }
}
export function logBackendDecrease(ctx: StaleCtx): void {
  try {
    const delta = +(ctx.newValue - ctx.prevValue).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} backend lowered prev=${ctx.prevValue} new=${ctx.newValue} (Δ${delta}) vs=${ctx.verifySource || "?"} caller=${ctx.caller || "?"}${ctx.transrefno ? ` ref=${ctx.transrefno}` : ""}`;
    plog.pinned("error", "CUM:BACKEND-DECREASE", msg, { ...getActiveContext(), ...ctx, delta });
  } catch { /* never throw */ }
}
// v2.10.118: STALE-RECONCILE — auto-heal when device is online and the
// rejection came from a user/sync-driven fetch (W1/W4/W5). Pinned warn so
// it surfaces in /debug like STALE-REJECT, but is informational, not an
// error. Includes `online: true` and source writer for traceability.
export function logStaleReconcile(ctx: StaleCtx): void {
  try {
    const delta = +(ctx.newValue - ctx.prevValue).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} HEAL prev=${ctx.prevValue} new=${ctx.newValue} (Δ${delta}) vs=${ctx.verifySource || "?"} caller=${ctx.caller || "?"}${ctx.transrefno ? ` ref=${ctx.transrefno}` : ""}`;
    plog.pinned("warn", "CUM:STALE-RECONCILE", msg, { ...getActiveContext(), ...ctx, delta, online: true, healedFrom: ctx.prevValue, healedTo: ctx.newValue });
  } catch { /* never throw */ }
}

// Print-time receipt cumulative composition. Captures everything the
// receipt math used so a wrong printed total can be traced after the fact.
export interface PrintLogCtx {
  farmerId: string;
  route?: string;
  cachedBase: number;
  cachedLocal: number;
  unsyncedWeight: number;
  cloudCumulative?: number;
  finalPrinted: number;
  excludedRefs?: string[];
  source?: string; // 'on-screen' | 'background-print' | 'fallback' | ...
  icode?: string;
}

export function logPrint(ctx: PrintLogCtx): void {
  try {
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} printed=${+(ctx.finalPrinted || 0).toFixed(3)} (cachedBase=${+(ctx.cachedBase || 0).toFixed(3)} local=${+(ctx.cachedLocal || 0).toFixed(3)} unsynced=${+(ctx.unsyncedWeight || 0).toFixed(3)}${typeof ctx.cloudCumulative === "number" ? ` cloud=${+ctx.cloudCumulative.toFixed(3)}` : ""})`;
    plog.info("CUM:PRINT", msg, {
      ...getActiveContext(),
      ...ctx,
    });
  } catch { /* never throw */ }
}

// v2.10.116: VERIFY-AFTER-WRITE. The previous "✅ Refreshed cumulative for X: N"
// log reported the FETCHED value, not the PERSISTED one. If the IndexedDB
// transaction aborted after put.onsuccess, or a parallel local-increment
// overwrote baseCount in a separate tx (last-writer-wins race), the success
// log lied and capture read the stale value. CUM:VERIFY pairs fetched →
// readBack so the silent overwrite is observable; CUM:VERIFY-MISMATCH is
// pinned-error so it surfaces immediately in /debug.
export interface VerifyLogCtx {
  farmerId: string;
  route?: string;
  source: string;     // 'backend' | 'post-sync' | 'collision-retry' | 'batch-dashboard'
  fetched: number;    // value we asked IndexedDB to persist
  readBack: number;   // value the readonly re-read returned
  match: boolean;
  retried?: boolean;
  transrefno?: string;
}
export function logVerify(ctx: VerifyLogCtx): void {
  try {
    const fetched = +(Number(ctx.fetched) || 0).toFixed(3);
    const readBack = +(Number(ctx.readBack) || 0).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} src=${ctx.source} fetched=${fetched} readBack=${readBack} match=${ctx.match}${ctx.retried ? " (retried)" : ""}`;
    if (ctx.match) {
      plog.info("CUM:VERIFY", msg, { ...getActiveContext(), ...ctx, fetched, readBack });
    } else {
      plog.pinned("error", "CUM:VERIFY-MISMATCH", msg, {
        ...getActiveContext(),
        ...ctx,
        fetched,
        readBack,
        delta: +(readBack - fetched).toFixed(3),
      });
    }
  } catch { /* never throw */ }
}

// v2.10.116: CAPTURE-READ. The exact inputs the print/capture path consumed.
// Together with CUM:VERIFY upstream and CUM:PRINT downstream this gives a
// single farmer's slice the full chain: fetched → written → readBack →
// captureRead → printed.
export interface CaptureReadLogCtx {
  farmerId: string;
  route?: string;
  baseCount: number;
  localCount: number;
  unsyncedWeight: number;
  source?: string;    // 'getFarmerTotalCumulative' | ...
}
export function logCaptureRead(ctx: CaptureReadLogCtx): void {
  try {
    const base = +(Number(ctx.baseCount) || 0).toFixed(3);
    const local = +(Number(ctx.localCount) || 0).toFixed(3);
    const unsynced = +(Number(ctx.unsyncedWeight) || 0).toFixed(3);
    const msg = `${ctx.farmerId} route=${ctx.route || "?"} base=${base} local=${local} unsynced=${unsynced}`;
    plog.info("CUM:CAPTURE-READ", msg, {
      ...getActiveContext(),
      ...ctx,
      baseCount: base,
      localCount: local,
      unsyncedWeight: unsynced,
    });
  } catch { /* never throw */ }
}

// v2.10.116: RACE-CLOBBER. The local-increment branch detected that its
// `existing` snapshot was stale (writeSeq advanced between get and put),
// re-read, and avoided demoting baseCount. Surfaces in /debug so race
// frequency is observable.
export function logRaceClobber(farmerId: string, route: string | undefined, prevSeq: number, freshSeq: number, source: string): void {
  try {
    plog.warn("CUM:RACE-CLOBBER",
      `${farmerId} route=${route || "?"} src=${source} prevSeq=${prevSeq} freshSeq=${freshSeq} re-read to avoid demote`,
      { ...getActiveContext(), farmerId, route, source, prevSeq, freshSeq });
  } catch { /* never throw */ }
}

// Periodic flusher: any pending regression candidate older than its TTL
// gets emitted as CUM:REGRESSION-UNCONFIRMED so the drop is never silent.
let unconfirmedFlusherStarted = false;
function startUnconfirmedFlusher(): void {
  if (unconfirmedFlusherStarted) return;
  if (typeof setInterval === "undefined") return;
  unconfirmedFlusherStarted = true;
  setInterval(() => {
    try {
      const now = Date.now();
      for (const [key, p] of pending) {
        if (now - p.ts <= PENDING_TTL_MS) continue;
        pending.delete(key);
        const [farmerId, route] = key.split("|");
        const delta = +(p.after - p.before).toFixed(3);
        plog.pinned("warn", "CUM:REGRESSION-UNCONFIRMED",
          `${farmerId} route=${route || "?"} ${p.before} → ${p.after} (Δ${delta}) [no second read within ${PENDING_TTL_MS}ms]`,
          { ...getActiveContext(), farmerId, route, before: p.before, after: p.after, delta, prevByProduct: p.prevByProduct, nextByProduct: p.nextByProduct, confirmed: false }
        );
      }
    } catch { /* noop */ }
  }, 4000);
}
// Start eagerly at module load so even cold-path drops are caught.
try { startUnconfirmedFlusher(); } catch { /* noop */ }


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

// ---- zero-confirmation guard (v2.10.104) ---------------------------------
//
// The stale-write guard in updateFarmerCumulative originally refused any
// `incoming=0 vs cached>0` write outright to protect against read-replica
// lag. In practice almost every refusal was legitimate — either a manual
// negative-value reversal that genuinely zeroed the farmer's monthly total,
// or a first-ever delivery for a brand-new farmer. We now require a second
// backend read within 8 s to confirm before accepting the overwrite.

interface ZeroPending { firstSeenAt: number; existingBase: number }
const ZERO_TTL_MS = 8000;
const ZERO_MAX = 500;
const zeroPending = new Map<string, ZeroPending>();

function zeroKey(farmerId: string, route?: string): string {
  return `${(farmerId || "").trim().toUpperCase()}|${(route || "").trim().toUpperCase()}`;
}

export type ZeroObservation = "stash" | "confirm" | "expired-restash";

export function observeIncomingZero(farmerId: string, route: string | undefined, existingBase: number): ZeroObservation {
  try {
    const k = zeroKey(farmerId, route);
    const now = Date.now();
    const p = zeroPending.get(k);
    if (!p) {
      if (zeroPending.size >= ZERO_MAX) {
        const oldest = zeroPending.keys().next().value;
        if (oldest) zeroPending.delete(oldest);
      }
      zeroPending.set(k, { firstSeenAt: now, existingBase });
      return "stash";
    }
    if (now - p.firstSeenAt > ZERO_TTL_MS) {
      zeroPending.set(k, { firstSeenAt: now, existingBase });
      return "expired-restash";
    }
    zeroPending.delete(k);
    return "confirm";
  } catch {
    return "stash"; // conservative: keep cached value
  }
}

export function clearZeroPending(farmerId: string, route?: string): void {
  try { zeroPending.delete(zeroKey(farmerId, route)); } catch { /* noop */ }
}

// ---- reversal detection (v2.10.104) --------------------------------------

const reversalSeen = new Set<string>();
const REVERSAL_MAX = 500;

export function noteReversalIfNegative(
  transrefno: string | undefined,
  weight: number,
  ctx: { farmerId?: string; route?: string; transdate?: string } = {}
): void {
  try {
    if (!isFinite(weight) || weight >= 0) return;
    const key = transrefno || `${ctx.farmerId || "?"}|${ctx.transdate || "?"}|${weight}`;
    if (reversalSeen.has(key)) return;
    if (reversalSeen.size >= REVERSAL_MAX) {
      const first = reversalSeen.values().next().value;
      if (first) reversalSeen.delete(first);
    }
    reversalSeen.add(key);
    plog.info("CUM:REVERSAL-DETECTED",
      `${ctx.farmerId || "?"} ${transrefno || "(no-ref)"} weight=${weight}`,
      { ...getActiveContext(), transrefno, weight, ...ctx }
    );
  } catch { /* never throw */ }
}

// ---- public api ----------------------------------------------------------

export const cumulativeMonitor = {
  observeBaseChange,
  recordRowFingerprint,
  startBatch,
  batchOk,
  batchFail,
  endBatch,
  observeIncomingZero,
  clearZeroPending,
  noteReversalIfNegative,
  logWrite,
  logPrint,
  logVerify,
  logCaptureRead,
  logRaceClobber,
  logStaleCheck,
  logStaleReject,
  logBackendDecrease,
};

export default cumulativeMonitor;
