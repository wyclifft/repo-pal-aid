/**
 * Ultra-Lightweight Milk Collection API
 * Optimized for cPanel with minimal RAM usage
 */

require('dotenv').config({ path: __dirname + '/.env' });

const mysql = require('mysql2/promise');
const http = require('http');
const url = require('url');
const { createCache } = require('./lib/lruCache');
const { chargeFarmerViaKCB } = require('./kcbPaymentService');
// v2.12.0 — Yetu Sacco member payments module (webhook + member portal APIs)
const { handleYetuRoutes } = require('./yetuRoutes');

// SECURITY (v2.10.83): require DB credentials from environment.
// Hardcoded fallback values were removed — they leaked production credentials
// into source control. Apache/Passenger sets MYSQL_USER & MYSQL_PASSWORD via
// the cPanel environment (see backend-api/.htaccess).
if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
  throw new Error('FATAL: MYSQL_USER and MYSQL_PASSWORD environment variables must be set');
}

// Database connection pool
// v2.10.108: Sized to live within cPanel `max_user_connections = 40` shared
// across both Node apps (backend-api + sync-service) on the same MySQL user.
// Worst case: 2 Passenger workers × pool 8 = 16 conns for this app.
// Tunable via .htaccess env without code changes.
const POOL_LIMIT = Number(process.env.MYSQL_POOL_LIMIT || 80);
const QUEUE_LIMIT = Number(process.env.MYSQL_QUEUE_LIMIT || 100);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

/**
 * v2.12.7 — Integer column sanitation.
 * MariaDB (STRICT mode) rejects '' for INT columns:
 *   "Incorrect integer value: '' for column 'noofcalfs'".
 * Never pass a raw string through to an integer column — normalise blanks.
 * @param {*} value       raw value from the request body
 * @param {number|null} fallback value used when the input is blank/non-numeric
 */
const toIntOrNull = (value, fallback = 0) => {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (str === '') return fallback;
  const num = parseInt(str, 10);
  return Number.isFinite(num) ? num : fallback;
};

/** v2.12.7 — Same guard for DECIMAL/FLOAT columns (weight, price, amount). */
const toNumOrZero = (value, fallback = 0) => {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (str === '') return fallback;
  const num = Number(str);
  return Number.isFinite(num) ? num : fallback;
};

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'maddasys_milk_collection_pwa',
  port: Number(process.env.MYSQL_PORT || 3306),
  connectionLimit: POOL_LIMIT,
  waitForConnections: true,
  queueLimit: QUEUE_LIMIT,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});

// Identify pool-pressure / DB-busy errors so the request handler can return a
// retryable 503 instead of letting the client hang. Mirrors the codes that
// `mysql2` surfaces when the user-level connection cap is hit.
const isPoolPressureError = (err) => {
  if (!err) return false;
  const code = err.code || '';
  const errno = err.errno;
  return (
    code === 'ER_USER_LIMIT_REACHED' ||      // max_user_connections cap
    code === 'ER_CON_COUNT_ERROR' ||         // server max_connections cap
    code === 'POOL_ENQUEUELIMIT' ||          // mysql2 queue full
    code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
    code === 'ETIMEDOUT' ||
    errno === 1203 ||
    errno === 1040
  );
};

// Periodic pool snapshot for observability. Logs once a minute so cPanel logs
// stay light. Useful to confirm whether the 40-conn cap is actually being hit.
setInterval(() => {
  try {
    const p = /** @type {any} */ (pool).pool;
    if (!p) return;
    const inUse = p._allConnections.length - p._freeConnections.length;
    console.log(
      `[POOL] limit=${POOL_LIMIT} inUse=${inUse} free=${p._freeConnections.length} ` +
      `queued=${p._connectionQueue.length} total=${p._allConnections.length}`
    );
  } catch (_) { /* swallow — diagnostics only */ }
}, 60000).unref();

// Helper: Parse JSON body
const parseBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try { resolve(JSON.parse(body)); } catch { resolve({}); }
  });
});

// CORS
// NOTE: Some Apache/Passenger setups strip or override wildcard CORS, so we
// echo back the request Origin when present.
const getCorsHeaders = (origin) => {
  const allowOrigin = origin || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Requested-With, Origin, X-Device-Fingerprint, X-App-Origin',
    'Access-Control-Max-Age': '86400'
  };
};

// Helper: Send JSON response
const sendJSON = (res, data, status = 200, origin) => {
  const corsHeaders = getCorsHeaders(origin);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  });
  res.end(JSON.stringify(data));
};

const APP_VERSION = process.env.APP_VERSION || `serverjs-${new Date().toISOString()}`;

const toDbBool = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return Boolean(value);
};

const toYmdLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * v2.12.4 — Contabo schema split:
 *   Seasons  → orgtype 'C' (id, scode, Descript, ccode, datefrom, dateto)
 *   sessions → orgtype 'D' (ID, Icode, descript, ccode, time_from, time_to, status)
 *
 * Legacy cPanel deployments kept season columns (SCODE/datefrom/dateto) inside the
 * sessions table, so every helper below probes for the Seasons table once and falls
 * back to the legacy shape. Backward compatible with old databases.
 */
let _hasSeasonsTableCache = null;
const hasSeasonsTable = async () => {
  if (_hasSeasonsTableCache !== null) return _hasSeasonsTableCache;
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name IN ('Seasons', 'Seasons') LIMIT 1`
    );
    _hasSeasonsTableCache = rows.length > 0;
  } catch (e) {
    console.warn('[SEASON] table probe failed:', e?.message || e);
    _hasSeasonsTableCache = false;
  }
  return _hasSeasonsTableCache;
};

// Active season row (date range) covering `date` for a ccode. Returns null when none.
const findActiveSeason = async (ccode, date, conn = pool) => {
  const seasonalTableExists = await hasSeasonsTable();

  if (!seasonalTableExists) {
    return null;
  }

  try {
    const [rows] = await conn.query(
      `SELECT scode AS SCODE, descript,
              DATE_FORMAT(datefrom, '%Y-%m-%d') AS datefrom,
              DATE_FORMAT(dateto, '%Y-%m-%d') AS dateto
         FROM Seasons
        WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
          AND DATE(datefrom) <= ? AND DATE(dateto) >= ?
        ORDER BY datefrom DESC, id DESC LIMIT 1`,
      [ccode, date, date]
    );
    return rows.length ? rows[0] : null;
  } catch (e) {
    console.warn('[SEASON] active lookup failed on Seasons:', e?.message || e);
    return null;
  }
};

// Human-readable name for a season code (falls back to the code itself).
const findSeasonDescript = async (scode, ccode, conn = pool) => {
  const seasonalTableExists = await hasSeasonsTable();

  if (!seasonalTableExists) {
    return null;
  }

  try {
    const [rows] = await conn.query(
      `SELECT descript FROM Seasons
        WHERE UPPER(TRIM(scode)) = UPPER(TRIM(?)) AND TRIM(ccode) = TRIM(?) LIMIT 1`,
      [scode, ccode]
    );
    return rows.length ? rows[0].descript : null;
  } catch (e) {
    console.warn('[SEASON] descript lookup failed on Seasons:', e?.message || e);
    return null;
  }
};



const getPaymentPeriodRange = async (period, ccode) => {
  const normalized = ['day', 'week', 'month', 'season'].includes(period) ? period : 'month';
  const now = new Date();
  const today = toYmdLocal(now);
  let start;
  let end = today;

  if (normalized === 'day') {
    start = today;
  } else if (normalized === 'week') {
    const mondayOffset = (now.getDay() || 7) - 1;
    start = toYmdLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset));
  } else if (normalized === 'month') {
    start = toYmdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  } else {
    const season = await findActiveSeason(ccode, today);
    if (season) {
      start = season.datefrom;
      end = season.dateto;
    }
    if (!start) start = toYmdLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90));
  }

  return { period: normalized, start, end };
};

const resolvePaymentsAccess = async ({ deviceFingerprint, userid }) => {
  const fingerprint = String(deviceFingerprint || '').trim();
  const userId = String(userid || '').trim();

  if (!fingerprint) return { ok: false, status: 400, error: 'device_fingerprint is required' };
  if (!userId) return { ok: false, status: 400, error: 'userid is required' };

  const [deviceRows] = await pool.query(
    'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ? LIMIT 1',
    [fingerprint]
  );
  if (deviceRows.length === 0 || !toDbBool(deviceRows[0].authorized)) {
    return { ok: false, status: 401, error: 'Device not authorized' };
  }

  const ccode = String(deviceRows[0].ccode || '').trim();
  if (!ccode) return { ok: false, status: 403, error: 'Device company not configured' };

  const [settingsRows] = await pool.query(
    'SELECT IFNULL(payments_active, 0) AS payments_active FROM psettings WHERE UPPER(TRIM(cno)) = UPPER(TRIM(?)) LIMIT 1',
    [ccode]
  );
  if (settingsRows.length === 0 || !toDbBool(settingsRows[0].payments_active)) {
    return { ok: false, status: 403, error: 'Payments not active for this company' };
  }

  const [userRows] = await pool.query(
    `SELECT IFNULL(can_access_payments, 0) AS can_access_payments
       FROM Users
      WHERE TRIM(userid) = ? AND UPPER(TRIM(ccode)) = UPPER(TRIM(?))
      LIMIT 1`,
    [userId, ccode]
  );
  if (userRows.length === 0 || !toDbBool(userRows[0].can_access_payments)) {
    return { ok: false, status: 403, error: 'Payment permission denied' };
  }

  return { ok: true, ccode, userid: userId, deviceFingerprint: fingerprint };
};

const chargeFarmerMock = async ({ ref, amount, farmer_code, ccode }) => {
  await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 400));
  const externalId = `MOCK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  console.log('[PAY][SACCO:MOCK] success', { ref, amount, farmer_code, ccode });
  return { success: true, external_transaction_id: externalId };
};

const makePaymentReference = (ccode, index = 0) => {
  const safeCcode = String(ccode || 'CO').trim().replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12) || 'CO';
  const yymmdd = toYmdLocal(new Date()).slice(2).replace(/-/g, '');
  const seq = `${Date.now().toString(36)}${index.toString(36)}`.toUpperCase().slice(-10);
  return `PMT-${safeCcode}-${yymmdd}-${seq}`;
};

// v2.11.2 — Payment calculation. Sums transaction WEIGHT (not amount) for
// transtype=1, payment_status='unpaid' inside the selected period. Multiplies
// by psettings.price_per_kg (renamed from boost_price_per_kg). Deducts total
// outstanding crbal (parsed from "CR01#2000,CR02#1000") capped at the gross
// so a farmer can never owe negative pay. Runs on a caller-supplied executor
// (pool or transactional connection) so it's reusable in both endpoints.
const parseCrbalTotal = (crbal) => {
  if (!crbal || typeof crbal !== 'string') return 0;
  return crbal.split(',').reduce((sum, entry) => {
    const parts = entry.trim().split('#');
    const val = parseFloat(parts[1]);
    return sum + (isFinite(val) ? val : 0);
  }, 0);
};

// v2.11.3 — Payments performance layer.
//   • 60 s in-process response cache for /api/payments/payable. A burst of
//     dashboard opens collapses to one aggregate per company per minute.
//   • Cache is invalidated on every successful /api/payments/process for the
//     affected ccode so paid farmers disappear from the list immediately.
//   • Lightweight retry wrapper around the two payable queries covers the
//     transient `PROTOCOL_CONNECTION_LOST` / `ECONNRESET` sockets the shared
//     cPanel MySQL occasionally drops on long-running scans.
const payablePayableCache = createCache({ max: 200, ttlMs: 60000 });

// v2.12.5/v2.12.6: cache for the farmer cumulative batch scan. On Contabo the
// full-season scan takes 20–35 s for ~2k farmers, so it must NEVER run inside a
// client request. The endpoint now serves this cache only; a background warmer
// recomputes each recently requested (ccode, route, period) key. TTL is long
// enough to always have a snapshot to serve, and the warmer keeps it fresh.
const CUM_BATCH_TTL_MS = 5 * 60 * 1000;      // served snapshot lifetime
const CUM_BATCH_REWARM_MS = 90 * 1000;       // background recompute interval
const cumulativeBatchCache = createCache({ max: 50, ttlMs: CUM_BATCH_TTL_MS });

// Warm-job bookkeeping: key -> { ccode, route, periodStart, periodEnd, lastRun }
const cumulativeWarmKeys = new Map();
// key -> Promise, so concurrent requests never trigger duplicate scans.
const cumulativeWarmInFlight = new Map();

// v2.12.6: 60 s cache for /api/items. The catalogue is effectively static
// during a shift; devices were re-requesting it continuously.
const itemsCache = createCache({ max: 200, ttlMs: 60000 });


// v2.12.5: pool-pressure probe. When the pool is effectively exhausted we
// answer heavy read endpoints with 503 + Retry-After instead of queueing,
// so clients back off rather than piling more work onto MySQL.
const poolPressure = () => {
  try {
    const p = /** @type {any} */ (pool).pool;
    if (!p) return { inUse: 0, free: 0, queued: 0, saturated: false };
    const inUse = p._allConnections.length - p._freeConnections.length;
    const queued = p._connectionQueue.length;
    // Saturated when no free connections AND we're at the configured limit,
    // or when requests are already waiting in the queue.
    const saturated = queued > 0 || (p._freeConnections.length === 0 && inUse >= POOL_LIMIT);
    return { inUse, free: p._freeConnections.length, queued, saturated };
  } catch (_) {
    return { inUse: 0, free: 0, queued: 0, saturated: false };
  }
};

// ---------------------------------------------------------------------------
// v2.12.6: cumulative batch warmer.
//
// computeCumulativeBatch runs the exact same three queries the endpoint used to
// run inline (same SQL, same normalisation, same READ COMMITTED single
// connection semantics from v2.10.119) — nothing about the cumulative formula
// changes. The difference is WHERE it runs: in a background task instead of
// inside the client request, so login/prewarm never blocks for 20–35 s.
// ---------------------------------------------------------------------------
const cumulativeCacheKey = (ccode, route, periodStart, periodEnd) =>
  `cumbatch:${String(ccode).toUpperCase()}:${String(route || 'ALL').toUpperCase()}:${periodStart}:${periodEnd}`;

async function computeCumulativeBatch(ccode, route, periodStart, periodEnd) {
  const routeFilter = route ? ' AND UPPER(TRIM(route)) = UPPER(TRIM(?))' : '';
  const baseParams = route ? [ccode, periodStart, periodEnd, route] : [ccode, periodStart, periodEnd];
  const tRouteFilter = route ? ' AND UPPER(TRIM(t.route)) = UPPER(TRIM(?))' : '';
  const tBaseParams = route ? [ccode, periodStart, periodEnd, route] : [ccode, periodStart, periodEnd];

  const conn = await pool.getConnection();
  let totalRows = [], productRows = [], snapshotMaxId = 0;
  let msTotals = 0, msProducts = 0, msSnapshot = 0;
  try {
    try { await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED"); } catch (e) { /* non-fatal */ }

    let _t0 = Date.now();
    const [tRows] = await conn.query(
      `SELECT TRIM(memberno) as farmer_id, IFNULL(SUM(weight), 0) as cumulative_weight 
       FROM transactions 
       WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?)) AND CAST(Transtype AS UNSIGNED) = 1
       AND CAST(transdate AS DATE) BETWEEN ? AND ?${routeFilter}
       GROUP BY TRIM(memberno)`,
      baseParams
    );
    totalRows = tRows;
    msTotals = Date.now() - _t0;

    _t0 = Date.now();
    const [pRows] = await conn.query(
      `SELECT TRIM(t.memberno) as farmer_id, TRIM(t.icode) as icode, 
              IFNULL(MAX(fi.descript), MIN(TRIM(t.icode))) as product_name,
              IFNULL(SUM(t.weight), 0) as weight 
       FROM transactions t
       LEFT JOIN fm_items fi ON UPPER(TRIM(fi.icode)) = UPPER(TRIM(t.icode)) AND UPPER(TRIM(fi.ccode)) = UPPER(TRIM(t.ccode))
       WHERE UPPER(TRIM(t.ccode)) = UPPER(TRIM(?)) AND CAST(t.Transtype AS UNSIGNED) = 1
       AND CAST(t.transdate AS DATE) BETWEEN ? AND ?${tRouteFilter}
       GROUP BY TRIM(t.memberno), TRIM(t.icode)`,
      tBaseParams
    );
    productRows = pRows;
    msProducts = Date.now() - _t0;

    try {
      _t0 = Date.now();
      const [snapRows] = await conn.query(
        `SELECT IFNULL(MAX(id), 0) as max_id
         FROM transactions
         WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?)) AND CAST(Transtype AS UNSIGNED) = 1
         AND CAST(transdate AS DATE) BETWEEN ? AND ?${routeFilter}`,
        baseParams
      );
      snapshotMaxId = snapRows.length > 0 ? Number(snapRows[0].max_id) || 0 : 0;
      msSnapshot = Date.now() - _t0;
    } catch (_e) { /* probe failure is non-fatal */ }
  } finally {
    try { conn.release(); } catch (_e) {}
  }

  const productMap = {};
  for (const r of productRows) {
    if (!productMap[r.farmer_id]) productMap[r.farmer_id] = [];
    productMap[r.farmer_id].push({
      icode: r.icode || '',
      product_name: r.product_name || r.icode || '',
      weight: parseFloat(r.weight) || 0
    });
  }

  console.log(`[CUM:WARM] ccode=${ccode} route=${route || 'ALL'} period=${periodStart}→${periodEnd} farmers=${totalRows.length} snapshot_max_id=${snapshotMaxId} timings totals=${msTotals}ms products=${msProducts}ms snapshot=${msSnapshot}ms`);

  return {
    farmers: totalRows.map(r => ({
      farmer_id: r.farmer_id,
      cumulative_weight: parseFloat(r.cumulative_weight) || 0,
      by_product: productMap[r.farmer_id] || []
    })),
    month_start: periodStart,
    month_end: periodEnd,
    total_farmers: totalRows.length,
    snapshot_max_id: snapshotMaxId
  };
}

/** Schedule (or join) a background warm for one cumulative key. Never awaited by a request. */
function scheduleCumulativeWarm(ccode, route, periodStart, periodEnd) {
  const key = cumulativeCacheKey(ccode, route, periodStart, periodEnd);
  const prev = cumulativeWarmKeys.get(key);
  cumulativeWarmKeys.set(key, {
    ccode,
    route: route || null,
    periodStart,
    periodEnd,
    lastRun: prev?.lastRun || 0,
    lastAttempt: prev?.lastAttempt || 0,
    failures: prev?.failures || 0
  });

  if (cumulativeWarmInFlight.has(key)) return cumulativeWarmInFlight.get(key);

  // v2.12.10: never let a permanently failing key hammer the DB — back off
  // 30s × failures (capped at 5 min) between attempts.
  const meta0 = cumulativeWarmKeys.get(key);
  if (meta0.failures > 0) {
    const backoff = Math.min(5 * 60 * 1000, 30 * 1000 * meta0.failures);
    if (Date.now() - meta0.lastAttempt < backoff) return null;
  }
  meta0.lastAttempt = Date.now();

  console.log(`[CUM:WARM] start ${key}`);
  const job = (async () => {
    try {
      const payload = await computeCumulativeBatch(ccode, route, periodStart, periodEnd);
      cumulativeBatchCache.set(key, payload);
      const meta = cumulativeWarmKeys.get(key);
      if (meta) { meta.lastRun = Date.now(); meta.failures = 0; }
      return payload;
    } catch (e) {
      const meta = cumulativeWarmKeys.get(key);
      if (meta) meta.failures = (meta.failures || 0) + 1;
      console.error(`[CUM:WARM] failed ${key} (attempt ${meta?.failures}):`, e.message);
      return null;
    } finally {
      cumulativeWarmInFlight.delete(key);
    }
  })();

  cumulativeWarmInFlight.set(key, job);
  return job;
}

// Periodic re-warm of keys devices actually asked for.
// v2.12.10: previously this bailed out whenever the pool reported "saturated",
// which on Contabo is almost always true — so the first warm never ran and the
// endpoint answered `pending` forever. Now only a genuinely long wait queue
// defers the warm, and keys that have never produced a snapshot are prioritised.
setInterval(() => {
  if (cumulativeWarmKeys.size === 0) return;
  if (poolPressure().queued > 20) return;
  const now = Date.now();

  // Priority 1: keys that have never been computed (cold) — these block clients.
  for (const [, meta] of cumulativeWarmKeys) {
    if (!meta.lastRun) {
      scheduleCumulativeWarm(meta.ccode, meta.route, meta.periodStart, meta.periodEnd);
      return;
    }
  }

  for (const [key, meta] of cumulativeWarmKeys) {
    // Drop keys nobody has requested for an hour.
    if (meta.lastRun && now - meta.lastRun > 60 * 60 * 1000 && !cumulativeBatchCache.get(key)) {
      cumulativeWarmKeys.delete(key);
      continue;
    }
    if (now - (meta.lastRun || 0) >= CUM_BATCH_REWARM_MS) {
      scheduleCumulativeWarm(meta.ccode, meta.route, meta.periodStart, meta.periodEnd);
      break; // one heavy scan per tick
    }
  }
}, 15000).unref?.();




// ---------------------------------------------------------------------------
// v2.12.11: cumulative delta overlay.
//
// The batch snapshot is recomputed at most every CUM_BATCH_REWARM_MS and each
// scan itself takes 20–70 s on Contabo, so a receipt that a device just synced
// stayed invisible for minutes. The device then wrote that stale total over its
// local cache, deleted the (already uploaded) unsynced rows, and the NEXT
// receipt printed a LOWER cumulative than the previous one.
//
// applyCumulativeDelta patches every cached snapshot that covers the inserted
// row (same ccode, same period, route matching or 'ALL') immediately after a
// successful insert. It is purely additive and is thrown away as soon as the
// next full snapshot lands, so the cumulative formula itself never changes.
// ---------------------------------------------------------------------------
function applyCumulativeDelta({ ccode, route, farmerId, icode, weight, transdate, transtype }) {
  try {
    if (Number(transtype) !== 1) return;          // only milk/produce collections count
    const w = Number(weight);
    if (!isFinite(w) || w === 0) return;
    const fid = String(farmerId || '').replace(/^#/, '').trim();
    if (!fid) return;
    const ic = String(icode || '').trim().toUpperCase();
    const rt = String(route || '').trim().toUpperCase();
    const day = String(transdate || '').slice(0, 10);
    const cc = String(ccode || '').trim().toUpperCase();

    let patched = 0;
    for (const [key, meta] of cumulativeWarmKeys) {
      if (String(meta.ccode || '').trim().toUpperCase() !== cc) continue;
      // Period must cover the transaction date (string compare on YYYY-MM-DD).
      if (day && (day < meta.periodStart || day > meta.periodEnd)) continue;
      // Route-scoped snapshots only take rows from that route; 'ALL' takes all.
      const metaRoute = meta.route ? String(meta.route).trim().toUpperCase() : null;
      if (metaRoute && metaRoute !== rt) continue;

      const snapshot = cumulativeBatchCache.get(key);
      if (!snapshot || !Array.isArray(snapshot.farmers)) continue;

      let row = snapshot.farmers.find(f => String(f.farmer_id || '').trim() === fid);
      if (!row) {
        row = { farmer_id: fid, cumulative_weight: 0, by_product: [] };
        snapshot.farmers.push(row);
        snapshot.total_farmers = snapshot.farmers.length;
      }
      row.cumulative_weight = Math.round(((Number(row.cumulative_weight) || 0) + w) * 1000) / 1000;

      if (!Array.isArray(row.by_product)) row.by_product = [];
      const prod = row.by_product.find(p => String(p.icode || '').trim().toUpperCase() === ic);
      if (prod) {
        prod.weight = Math.round(((Number(prod.weight) || 0) + w) * 1000) / 1000;
      } else {
        row.by_product.push({ icode: ic, product_name: ic, weight: w });
      }
      patched++;

      // Make the next warmer tick prioritise this key so the overlay is
      // replaced by a real snapshot promptly.
      meta.lastRun = Math.min(meta.lastRun || 0, Date.now() - CUM_BATCH_REWARM_MS);
    }

    if (patched > 0) {
      console.log(`[CUM:DELTA] +${w}kg ${fid} route=${rt || 'ALL'} icode=${ic} patched ${patched} snapshot(s)`);
    }
  } catch (e) {
    // Overlay is best-effort; never let it break an insert.
    console.warn('[CUM:DELTA] failed:', e.message);
  }
}

const invalidatePayableCache = (ccode) => {

  const prefix = `payable:${String(ccode || '').toUpperCase()}:`;
  // Best-effort scan — cache size is capped at 200 so this is cheap.
  // The lruCache module exposes only Map-ish operations via its returned
  // object; we intentionally delete by key. Anything not covered simply
  // ages out in ≤60 s.
  const anyCache = payablePayableCache;
  if (typeof anyCache.clear === 'function' && typeof anyCache.size === 'function') {
    // We don't have a keys() accessor, so on any mutation of ccode we take
    // the safe path and clear everything. Payable is read-heavy; clearing
    // ~200 entries costs microseconds.
    anyCache.clear();
  }
  void prefix;
};

const isTransientDbError = (err) => {
  const code = err && err.code;
  return (
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ECONNRESET' ||
    code === 'ER_QUERY_INTERRUPTED' ||
    code === 'PROTOCOL_PACKETS_OUT_OF_ORDER'
  );
};

const runWithRetry = async (label, requestId, fn) => {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    console.warn(`[PAY][PAYABLE][RETRY] ${label} requestId=${requestId} code=${err.code}`);
    return await fn();
  }
};

// Advance a YYYY-MM-DD string by one day (local time). Used to build a
// half-open [start, endExclusive) window so the transdate index is sargable
// without CAST(transdate AS DATE).
const addOneDay = (ymd) => {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + 1);
  return toYmdLocal(dt);
};

const getCompanyPricePerKg = async (executor, ccode) => {
  const [rows] = await executor.query(
    'SELECT IFNULL(price_per_kg, 0) AS price_per_kg FROM psettings WHERE UPPER(TRIM(cno)) = UPPER(TRIM(?)) LIMIT 1',
    [ccode]
  );
  return Number(rows[0]?.price_per_kg || 0);
};

const computeFarmerPayment = async (executor, ccode, farmerCode, range, pricePerKg) => {
  const [[sumRow]] = await executor.query(
    `SELECT ROUND(SUM(CAST(IFNULL(weight, 0) AS DECIMAL(14,4))), 4) AS total_qty,
            COUNT(*) AS unpaid_count
       FROM transactions
      WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
        AND UPPER(TRIM(memberno)) = UPPER(TRIM(?))
        AND transtype = 1
        AND IFNULL(payment_status, 'unpaid') = 'unpaid'
        AND CAST(transdate AS DATE) BETWEEN ? AND ?`,
    [ccode, farmerCode, range.start, range.end]
  );
  const [[memberRow]] = await executor.query(
    `SELECT IFNULL(crbal, '') AS crbal, IFNULL(descript, '') AS descript
       FROM cm_members
      WHERE UPPER(TRIM(mcode)) = UPPER(TRIM(?))
        AND UPPER(TRIM(ccode)) = UPPER(TRIM(?))
      LIMIT 1`,
    [farmerCode, ccode]
  );

  const totalQty = Number(sumRow?.total_qty || 0);
  const unpaidCount = Number(sumRow?.unpaid_count || 0);
  const gross = Math.round(totalQty * pricePerKg * 100) / 100;
  const rawDeductions = parseCrbalTotal(memberRow?.crbal);
  const deductions = Math.min(rawDeductions, gross);
  const net = Math.round((gross - deductions) * 100) / 100;
  return {
    total_qty: totalQty,
    unpaid_count: unpaidCount,
    gross_amount: gross,
    deductions: Math.round(deductions * 100) / 100,
    net_amount: net,
    farmer_name: memberRow?.descript || farmerCode,
  };
};

const errorToPlainObject = (err) => {
  if (!err) return null;
  const e = err instanceof Error ? err : new Error(String(err));
  const anyErr = /** @type {any} */ (err);
  return {
    name: e.name,
    message: e.message,
    stack: e.stack,
    code: anyErr.code,
    errno: anyErr.errno,
    sqlState: anyErr.sqlState,
    sqlMessage: anyErr.sqlMessage,
  };
};

// Always print fatal errors to stderr (cpanel logs / passenger stderr)
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Promise Rejection:', errorToPlainObject(reason));
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', errorToPlainObject(err));
});

// Main server
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const corsHeaders = getCorsHeaders(origin);

  // Ensure headers exist even if something writes early
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.setHeader(k, v);
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;

  // CORS preflight - handle ALL OPTIONS requests immediately
  if (method === 'OPTIONS') {
    // Use 200 (not 204) to satisfy stricter preflight checks in some environments
    res.writeHead(200, corsHeaders);
    return res.end();
  }

  try {
    const allowsHead = method === 'GET' || method === 'HEAD';

    // Temporary route for deployment/version confirmation
    if (path === '/version' && allowsHead) {
      return sendJSON(res, {
        server: 'Contabo',
        version: '2.12.3'
      });
    }

    // Health check
    if (path === '/api/health' && allowsHead) {
      return sendJSON(res, { success: true, message: 'API running', timestamp: new Date(), version: APP_VERSION });
    }

    // Version check (useful to verify cPanel is running the latest server.js)
    if (path === '/api/version' && allowsHead) {
      return sendJSON(res, { success: true, version: APP_VERSION, node: process.version });
    }

    // Sessions/Seasons endpoint - Fetch from sessions OR season table based on orgtype
    if (path.startsWith('/api/sessions/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);

      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );

      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, {
          success: false,
          message: 'Device not authorized'
        }, 401);
      }

      const ccode = deviceRows[0].ccode;

      // Get orgtype from psettings to determine data source
      const [psettingsRows] = await pool.query(
        'SELECT IFNULL(orgtype, "D") as orgtype FROM psettings WHERE cno = ?',
        [ccode]
      );

      const orgtype = psettingsRows.length > 0 ? psettingsRows[0].orgtype : 'D';
      const periodLabel = orgtype === 'C' ? 'Season' : 'Session';

      const SeasonsAvailable = await hasSeasonsTable();

      if (orgtype === 'C' && SeasonsAvailable) {
        // Coffee mode: Seasons table (id, scode, Descript, ccode, datefrom, dateto).
        // NOTE: Seasons has no time_from/time_to — coffee is date-range driven.
        const today = toYmdLocal(new Date()); // local YYYY-MM-DD (never toISOString)

        const [seasonRows] = await pool.query(
          `SELECT
            id,
            scode AS SCODE,
            descript,
            ccode,
            DATE_FORMAT(datefrom, '%Y-%m-%d') as datefrom,
            DATE_FORMAT(dateto, '%Y-%m-%d') as dateto,
            CASE
              WHEN ? >= DATE(datefrom) AND ? <= DATE(dateto) THEN 1
              ELSE 0
            END as dateEnabled
           FROM Seasons
           WHERE TRIM(ccode) = TRIM(?)
           ORDER BY datefrom DESC`,
          [today, today, ccode]
        );

        const processedSeasons = seasonRows.map(row => ({
          id: row.id,
          SCODE: row.SCODE,
          descript: row.descript,
          ccode: row.ccode,
          datefrom: row.datefrom,
          dateto: row.dateto,
          time_from: null,
          time_to: null,
          dateEnabled: row.dateEnabled === 1
        }));

        return sendJSON(res, {
          success: true,
          data: processedSeasons,
          ccode,
          periodLabel,
          orgtype
        });
      }

      if (orgtype === 'C' && !SeasonsAvailable) {
        // v2.12.5: Do not mix tables. If Coffee and no Seasons table, return empty.
        return sendJSON(res, {
          success: true,
          data: [],
          ccode,
          periodLabel,
          orgtype,
          message: 'Seasons table not found'
        });
      }

      // Dairy (orgtype 'D') / legacy: sessions table
      // (ID, Icode, descript, ccode, time_from, time_to, status).
      const [rows] = await pool.query(
        `SELECT id, Icode AS SCODE, descript, time_from, time_to, ccode
         FROM sessions WHERE TRIM(ccode) = TRIM(?) ORDER BY time_from`,
        [ccode]
      );


      const processedSessions = rows.map(row => ({
        id: row.id,
        SCODE: row.SCODE || row.Icode || null,
        descript: row.descript,
        time_from: row.time_from,
        time_to: row.time_to,
        ccode: row.ccode,
        dateEnabled: true
      }));

      return sendJSON(res, {
        success: true,
        data: processedSessions,
        ccode,
        periodLabel,
        orgtype
      });
    }

    // Get active session for a device (based on current time)
    if (path.startsWith('/api/sessions/active/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      
      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;

      const now = new Date();
      const currentTime = now.toTimeString().split(' ')[0]; // "HH:MM:SS" (legacy TIME columns)
      const currentHour = now.getHours();                   // int (Contabo sessions.time_from/to are INT hours)

      // v2.12.4: coffee (orgtype C) has no time windows — resolve the active season by date.
      const [orgRows] = await pool.query(
        `SELECT IFNULL(orgtype, 'D') as orgtype FROM psettings WHERE TRIM(cno) = TRIM(?) LIMIT 1`,
        [ccode]
      );
      const activeOrgtype = orgRows.length ? String(orgRows[0].orgtype || 'D').toUpperCase() : 'D';

      if (activeOrgtype === 'C') {
        const season = await findActiveSeason(ccode, toYmdLocal(now));
        if (!season) {
          return sendJSON(res, { success: true, data: null, message: 'No active season for today', ccode });
        }
        return sendJSON(res, {
          success: true,
          data: { SCODE: season.SCODE, descript: season.descript, datefrom: season.datefrom, dateto: season.dateto, ccode },
          ccode
        });
      }

      // Dairy: match the current time against the session window.
      // Handles both INT-hour columns (Contabo) and legacy TIME columns.
      const [rows] = await pool.query(
        `SELECT Icode AS SCODE, descript, time_from, time_to, ccode 
         FROM sessions 
         WHERE TRIM(ccode) = TRIM(?)
           AND (
             (time_from <= ? AND time_to >= ?)
             OR (time_from <= ? AND time_to >= ?)
           )
         ORDER BY time_from
         LIMIT 1`,
        [ccode, currentTime, currentTime, currentHour, currentHour]
      );
      
      if (rows.length === 0) {
        return sendJSON(res, { 
          success: true, 
          data: null, 
          message: 'No active session at current time',
          ccode 
        });
      }
      
      return sendJSON(res, { success: true, data: rows[0], ccode });

    }

    // Routes endpoint - Fetch from fm_tanks table
    if (path.startsWith('/api/routes/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      
      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Get routes from fm_tanks for this company, including clientFetch for flow control
      const [rows] = await pool.query(
        `SELECT tcode, descript, icode, idesc, task1, task2, task3, task4, task5, task6, task7, task8, depart, ccode, mprefix, IFNULL(clientFetch, 1) as clientFetch 
         FROM fm_tanks WHERE ccode = ? ORDER BY descript`,
        [ccode]
      );
      
      // Map rows to include explicit permission flags based on clientFetch
      // clientFetch = 1: Enable Buy and Sell, Disable Store
      // clientFetch = 2: Enable Store, Disable Buy and Sell
      // clientFetch = 3: Enable AI Services
      const routesWithPermissions = rows.map(row => ({
        ...row,
        allowBuy: row.clientFetch === 1,
        allowSell: row.clientFetch === 1,
        allowStore: row.clientFetch === 2,
        allowAI: row.clientFetch === 3
      }));
      
      return sendJSON(res, { success: true, data: routesWithPermissions, ccode });
    }

    // Farmers endpoints - Fetch from cm_members table
    
    // NEW: Device-based farmer filtering endpoint
    // Supports: route (exact match for chkroute=1) OR mprefix (prefix match for chkroute=0)
    if (path.startsWith('/api/farmers/by-device/') && method === 'GET') {
      const uniquedevcode = decodeURIComponent(path.split('/')[4]);
      const search = parsedUrl.query.search;
      
      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, { 
          success: false, 
          message: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Get route filter from query params (chkroute=1: filter by exact route)
      const routeFilter = parsedUrl.query.route;
      // Get mprefix filter from query params (chkroute=0: filter by mprefix from fm_tanks)
      const mprefixFilter = parsedUrl.query.mprefix;
      
      // Get farmers for this company, optionally filtered by route or mprefix
      // Include multOpt to enable client-side duplicate session enforcement
      // Include currqty for controlling monthly cumulative display on receipts (1 = show, 0 = hide)
      // crbal is stored as a string like "CR01#200|CR02#150" - keep as string for parsing
      let query = 'SELECT mcode as farmer_id, descript as name, route, ccode, IFNULL(multOpt, 1) as multOpt, IFNULL(currqty, 0) as currqty, IFNULL(crbal, \'\') as crbal FROM cm_members WHERE ccode = ?';
      let params = [ccode];
      
      // Filter by exact route if specified (chkroute=1)
      if (routeFilter) {
        query += ' AND route = ?';
        params.push(routeFilter);
      }
      // Filter by mprefix (farmer_id starts with mprefix) if specified (chkroute=0)
      else if (mprefixFilter) {
        query += ' AND mcode LIKE ?';
        params.push(`${mprefixFilter}%`);
      }
      
      if (search) {
        query += ' AND (mcode LIKE ? OR descript LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      
      query += ' ORDER BY descript';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows, ccode });
    }
    
    // Original farmers endpoint (kept for backward compatibility)
    if (path === '/api/farmers' && method === 'GET') {
      const search = parsedUrl.query.search;
      let query = 'SELECT mcode as farmer_id, descript as name, route, ccode, IFNULL(multOpt, 1) as multOpt, IFNULL(currqty, 0) as currqty, IFNULL(crbal, \'\') as crbal FROM cm_members';
      let params = [];
      if (search) {
        query += ' WHERE mcode LIKE ? OR descript LIKE ?';
        params = [`%${search}%`, `%${search}%`];
      }
      query += ' ORDER BY descript';
      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    if (path.startsWith('/api/farmers/') && method === 'GET') {
      const id = path.split('/')[3];
      const [rows] = await pool.query('SELECT mcode as farmer_id, descript as name, route, ccode, IFNULL(multOpt, 1) as multOpt, IFNULL(currqty, 0) as currqty, IFNULL(crbal, \'\') as crbal FROM cm_members WHERE mcode = ?', [id]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Farmer not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }
    
    // Fetch cm_credits lookup table for credit code descriptions
    if (path === '/api/credits' && method === 'GET') {
      const [rows] = await pool.query('SELECT crcode, descript FROM cm_credits ORDER BY crcode');
      return sendJSON(res, { success: true, data: rows });
    }

    if (path === '/api/farmers' && method === 'POST') {
      const body = await parseBody(req);
      await pool.query(
        'INSERT INTO cm_members (mcode, descript, route) VALUES (?, ?, ?)',
        [body.farmer_id, body.name, body.route]
      );
      return sendJSON(res, { success: true, message: 'Farmer created' }, 201);
    }

    if (path.startsWith('/api/farmers/') && method === 'PUT') {
      const id = path.split('/')[3];
      const body = await parseBody(req);
      const updates = [];
      const values = [];
      if (body.name) { updates.push('descript = ?'); values.push(body.name); }
      if (body.route) { updates.push('route = ?'); values.push(body.route); }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);
      values.push(id);
      await pool.query(`UPDATE cm_members SET ${updates.join(', ')} WHERE mcode = ?`, values);
      return sendJSON(res, { success: true, message: 'Farmer updated' });
    }

    if (path.startsWith('/api/farmers/') && method === 'DELETE') {
      const id = path.split('/')[3];
      await pool.query('DELETE FROM cm_members WHERE mcode = ?', [id]);
      return sendJSON(res, { success: true, message: 'Farmer deleted' });
    }

    // Milk collection endpoints - now using transactions table
    if (path === '/api/milk-collection' && method === 'GET') {
      const { farmer_id, session, date_from, date_to, uniquedevcode } = parsedUrl.query;
      
      // CRITICAL: When querying for accumulation, ccode MUST be enforced
      // Get device's ccode if uniquedevcode provided
      let ccode = null;
      if (uniquedevcode) {
        const [deviceRows] = await pool.query(
          'SELECT ccode FROM devSettings WHERE uniquedevcode = ?',
          [uniquedevcode]
        );
        if (deviceRows.length > 0) {
          ccode = deviceRows[0].ccode;
        }
      }
      
      // Build query with STRICT ccode filtering
      // Transtype = 1 is used for all produce purchases (milk/coffee collections)
      let query = 'SELECT * FROM transactions WHERE Transtype = 1';
      let params = [];
      
      // When checking for accumulation (farmer_id + session + date range provided),
      // ccode filter is REQUIRED to prevent cross-ccode accumulation
      if (farmer_id && session && date_from && date_to) {
        if (ccode === null) {
          // If uniquedevcode was provided but ccode not found, return empty result
          return sendJSON(res, { success: true, data: [] });
        }
        // STRICT: Filter by BOTH memberno AND ccode for accumulation checks
        query += ' AND memberno = ? AND ccode = ? AND session = ? AND transdate >= ? AND transdate <= ?';
        params.push(farmer_id, ccode, session, date_from, date_to);
      } else {
        // For general listing, apply filters as provided
        if (ccode !== null) { query += ' AND ccode = ?'; params.push(ccode); }
        if (farmer_id) { query += ' AND memberno = ?'; params.push(farmer_id); }
        if (session) { query += ' AND session = ?'; params.push(session); }
        if (date_from) { query += ' AND transdate >= ?'; params.push(date_from); }
        if (date_to) { query += ' AND transdate <= ?'; params.push(date_to); }
      }
      
      query += ' ORDER BY transdate DESC';
      const [rows] = await pool.query(query, params);
      
      // Map transactions fields back to expected format
      // DB columns → Frontend fields
      const mappedRows = rows.map(row => ({
        reference_no: row.transrefno,      // DB: transrefno
        uploadrefno: row.Uploadrefno,      // DB: Uploadrefno
        farmer_id: row.memberno,           // DB: memberno
        farmer_name: row.memberno,         // Display placeholder (resolved on frontend)
        route: row.route,                  // DB: route
        session: row.session,              // DB: session (AM/PM or season name)
        weight: row.weight,                // DB: weight
        clerk_name: row.clerk,             // DB: clerk
        collection_date: row.transdate,    // DB: transdate
        product_code: row.icode,           // DB: icode
        entry_type: row.entry_type         // DB: entry_type
      }));
      
      return sendJSON(res, { success: true, data: mappedRows });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'GET') {
      const ref = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM transactions WHERE transrefno = ?', [ref]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Collection not found' }, 404);
      
      // Map transaction fields back to expected format
      // DB columns → Frontend fields
      const mapped = {
        reference_no: rows[0].transrefno,    // DB: transrefno
        uploadrefno: rows[0].Uploadrefno,    // DB: Uploadrefno
        farmer_id: rows[0].memberno,         // DB: memberno
        farmer_name: rows[0].memberno,       // Display placeholder
        route: rows[0].route,                // DB: route
        session: rows[0].session,            // DB: session
        weight: rows[0].weight,              // DB: weight
        clerk_name: rows[0].clerk,           // DB: clerk
        collection_date: rows[0].transdate,  // DB: transdate
        product_code: rows[0].icode,         // DB: icode
        entry_type: rows[0].entry_type       // DB: entry_type
      };
      
      return sendJSON(res, { success: true, data: mapped });
    }

    // NEW: Generate next reference number endpoint
    if (path === '/api/milk-collection/next-reference' && method === 'POST') {
      const body = await parseBody(req);
      const deviceserial = body.device_fingerprint;
      
      if (!deviceserial) {
        return sendJSON(res, { 
          success: false, 
          error: 'device_fingerprint is required' 
        }, 400);
      }
      
      // Get connection for transaction
      const connection = await pool.getConnection();
      
      try {
        // Start transaction
        await connection.beginTransaction();
        
        // Get devcode from devSettings for reference generation
        const [deviceRows] = await connection.query(
          'SELECT ccode, devcode, trnid FROM devSettings WHERE uniquedevcode = ?',
          [deviceserial]
        );
        
        if (deviceRows.length === 0) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device not found' 
          }, 404);
        }
        
        const devcode = deviceRows[0].devcode;
        
        if (!devcode) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device has no assigned devcode. Please re-register the device.' 
          }, 400);
        }
        
        // Get the last transaction number for THIS DEVICE with row lock
        const [lastTransRows] = await connection.query(
          'SELECT transrefno FROM transactions WHERE transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1 FOR UPDATE',
          [`${devcode}%`]
        );
        
        let nextTrnId = 1; // Starting number for this device
        
        if (lastTransRows.length > 0) {
          const lastRef = lastTransRows[0].transrefno;
          // Extract trnid using last 8 digits to avoid clientFetch corruption
          const lastNumber = parseInt(lastRef.slice(-8), 10);
          if (!isNaN(lastNumber)) {
            nextTrnId = lastNumber + 1;
          }
        }
        
        // Generate reference: devcode + 8-digit trnid padded
        const transrefno = `${devcode}${String(nextTrnId).padStart(8, '0')}`;
        
        // Update trnid in devSettings
        await connection.query(
          'UPDATE devSettings SET trnid = ? WHERE uniquedevcode = ?',
          [nextTrnId, deviceserial]
        );
        
        // Commit transaction
        await connection.commit();
        connection.release();
        
        return sendJSON(res, { 
          success: true, 
          data: { reference_no: transrefno }
        });
      } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Reference generation error:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to generate reference number' 
        }, 500);
      }
    }

    // NEW: Reserve batch of reference numbers for fast offline generation
    // DUPLICATE-SAFE: Inserts placeholder records to prevent overlapping reservations
    if (path === '/api/milk-collection/reserve-batch' && method === 'POST') {
      const body = await parseBody(req);
      const deviceserial = body.device_fingerprint;
      const batchSize = body.batch_size || 100;
      
      if (!deviceserial) {
        return sendJSON(res, { 
          success: false, 
          error: 'device_fingerprint is required' 
        }, 400);
      }
      
      const connection = await pool.getConnection();
      
      try {
        await connection.beginTransaction();
        
        // Get devcode from devSettings
        const [deviceRows] = await connection.query(
          'SELECT ccode, devcode, trnid FROM devSettings WHERE uniquedevcode = ?',
          [deviceserial]
        );
        
        if (deviceRows.length === 0) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device not found' 
          }, 404);
        }
        
        const ccode = deviceRows[0].ccode;
        const devcode = deviceRows[0].devcode;
        
        if (!devcode) {
          await connection.rollback();
          connection.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device has no assigned devcode' 
          }, 400);
        }
        
        // CRITICAL: Get the highest transaction number with row lock to prevent duplicates
        const [lastTransRows] = await connection.query(
          'SELECT transrefno FROM transactions WHERE transrefno LIKE ? ORDER BY transrefno DESC LIMIT 1 FOR UPDATE',
          [`${devcode}%`]
        );
        
        let startNumber = 1;
        
        if (lastTransRows.length > 0) {
          const lastRef = lastTransRows[0].transrefno;
          // Extract trnid using last 8 digits to avoid clientFetch corruption
          const lastNumber = parseInt(lastRef.slice(-8), 10);
          if (!isNaN(lastNumber)) {
            startNumber = lastNumber + 1;
          }
        }
        
        const endNumber = startNumber + batchSize;
        
        // DUPLICATE PREVENTION: Insert a placeholder record at the end of the batch
        // Format: devcode + 8-digit padded trnid
        const placeholderRefNo = `${devcode}${String(endNumber - 1).padStart(8, '0')}`;
        
        await connection.query(
          `INSERT INTO transactions (
            transrefno, memberno, itemcode, weight, sprice, amount, 
            Transdate, Transtype, ccode, deviceserial, clerk, 
            session, route, entry_type
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
          [
            placeholderRefNo,
            'BATCH_RESERVATION',
            '000',
            0,
            0,
            0,
            'R', // R for Reservation placeholder
            ccode,
            deviceserial,
            'SYSTEM',
            'AM',
            'RESERVATION',
            'reservation'
          ]
        );
        
        // Update trnid in devSettings to end of batch
        await connection.query(
          'UPDATE devSettings SET trnid = ? WHERE uniquedevcode = ?',
          [endNumber - 1, deviceserial]
        );
        
        await connection.commit();
        connection.release();
        
        console.log(`✅ Reserved batch [${startNumber} to ${endNumber - 1}] - Placeholder: ${placeholderRefNo}`);
        
        return sendJSON(res, { 
          success: true, 
          data: { 
            start: startNumber,
            end: endNumber
          } 
        });
      } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('❌ Error reserving batch:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to reserve batch' 
        }, 500);
      }
    }

    if (path === '/api/milk-collection' && method === 'POST') {
      const body = await parseBody(req);
    
      // Use provided transrefno from frontend (initial attempt)
      let transrefno = body.reference_no;
      if (!transrefno) {
        return sendJSON(res, { 
          success: false, 
          error: 'reference_no is required' 
        }, 400);
      }
      
      // uploadrefno is the type-specific ID (milkid) for approval workflow
      // It's generated on frontend and passed in, or backend generates it
      let uploadrefno = body.uploadrefno || null;
      
      console.log('🟢 BACKEND: Creating NEW transaction');
      console.log('📝 Reference:', transrefno);
      console.log('📝 UploadRef (milkId):', uploadrefno);
      console.log('👤 Farmer:', body.farmer_id);
      console.log('⚖️ Weight:', body.weight, 'Kg');
      console.log('📅 Session:', body.session);
      
      // user_id maps to userId column (login user_id for tracking)
      // clerk_name maps to clerk column (display name/username)
      const userId = body.user_id || body.clerk_name || 'unknown';
      const clerk = body.clerk_name || 'unknown';
      const deviceserial = body.device_fingerprint || 'web';
      
      // Fetch ccode from devSettings using uniquedevcode
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized, milkid FROM devSettings WHERE uniquedevcode = ?',
        [deviceserial]
      );
      
      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        console.log('❌ Device not authorized:', deviceserial);
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 403);
      }
      
      const ccode = deviceRows[0].ccode;
      const currentMilkId = deviceRows[0].milkid || 0;
      console.log('🏢 Company Code:', ccode);
      
      // BACKEND VALIDATION: Enforce psettings rules
      // Fetch psettings for this company to validate business rules
      const [psettingsRows] = await pool.query(
        'SELECT IFNULL(AutoW, 0) as AutoW, IFNULL(zeroopt, 0) as zeroopt FROM psettings WHERE cno = ?',
        [ccode]
      );
      
      const psettings = psettingsRows.length > 0 ? psettingsRows[0] : { AutoW: 0, zeroopt: 0 };
      
      // ENFORCE AutoW: If autow=1, reject manual entry_type
      const entryType = (body.entry_type || 'manual').toLowerCase();
      if (psettings.AutoW === 1 && entryType === 'manual') {
        console.log('❌ AutoW enforcement: Manual entry rejected for company', ccode);
        return sendJSON(res, { 
          success: false, 
          error: 'MANUAL_ENTRY_DISABLED',
          message: 'Manual weight entry is disabled. Please use the digital scale.' 
        }, 400);
      }
      
      // ENFORCE clientFetch: Validate that the route allows Buy/Sell (clientFetch = 1)
      // This prevents bypassing UI controls via direct API calls
      const routeCode = (body.route || '').trim();
      if (routeCode) {
        const [routeRows] = await pool.query(
          'SELECT IFNULL(clientFetch, 1) as clientFetch FROM fm_tanks WHERE tcode = ? AND ccode = ?',
          [routeCode, ccode]
        );
        
        if (routeRows.length > 0) {
          const clientFetch = routeRows[0].clientFetch;
          // clientFetch = 1: Buy/Sell allowed, Store disabled
          // clientFetch = 2: Store allowed, Buy/Sell disabled
          if (clientFetch !== 1) {
            console.log(`❌ clientFetch enforcement: Buy/Sell disabled for route ${routeCode} (clientFetch=${clientFetch})`);
            return sendJSON(res, { 
              success: false, 
              error: 'ROUTE_BUY_SELL_DISABLED',
              message: 'Buy/Sell operations are not allowed for this route. Please use Store instead.' 
            }, 403);
          }
        }
      }
      
      // Parse date and time (LOCAL date, not UTC)
      // NOTE: toISOString() can shift date due to timezone, which breaks monthly cumulative queries.
      const collectionDate = new Date(body.collection_date);
      const pad2 = (n) => String(n).padStart(2, '0');
      const transdate = `${collectionDate.getFullYear()}-${pad2(collectionDate.getMonth() + 1)}-${pad2(collectionDate.getDate())}`; // YYYY-MM-DD local
      const transtime = `${pad2(collectionDate.getHours())}:${pad2(collectionDate.getMinutes())}:${pad2(collectionDate.getSeconds())}`; // HH:MM:SS local
      const timestamp = Math.floor(collectionDate.getTime() / 1000); // Unix timestamp
      
      // CHECK multOpt: If member has multOpt = 0, check for existing transaction in this session
      // NOTE: Sell Portal (transtype=2) is EXEMPT from multOpt restrictions
      const cleanFarmerId = (body.farmer_id || '').replace(/^#/, '').trim();
      const rawSession = (body.session || '').trim();
      
      // Parse transtype early to check for Sell Portal exemption
      // Transtype: 1 = Buy Produce, 2 = Sell Produce (default: 1 for backwards compatibility)
      const transtype = parseInt(body.transtype) || 1;

      // v2.10.39: Look up orgtype to gate session normalization.
      // Dairy (orgtype='D'): collapse to AM/PM (existing behavior).
      // Coffee (orgtype='C'): preserve season descript (e.g. "MAIN HARVEST 2025").
      let orgtype = 'D';
      try {
        const [orgRows] = await pool.query(
          'SELECT IFNULL(orgtype, "D") as orgtype FROM psettings WHERE cno = ? LIMIT 1',
          [ccode]
        );
        if (orgRows.length > 0) orgtype = (orgRows[0].orgtype || 'D').toString().toUpperCase();
      } catch (e) {
        console.warn('[WARN] orgtype lookup failed, defaulting to D:', e?.message);
      }

      let normalizedSession = rawSession.toUpperCase();
      if (orgtype === 'C') {
        // v2.10.50: Coffee — NEVER store AM/PM in session. Prefer SCODE, then descript.
        // If both are missing/AM/PM, look up the active SCODE for this ccode+date.
        const scode = (body.season_code || '').toString().trim();
        const descript = (body.session_descript || rawSession || '').toString().trim();
        normalizedSession = (scode || descript).toUpperCase();
        if (!normalizedSession || normalizedSession === 'AM' || normalizedSession === 'PM') {
          try {
            const season = await findActiveSeason(ccode, transdate);
            if (season && season.SCODE) normalizedSession = String(season.SCODE).toUpperCase();
          } catch (e) { console.warn('Coffee SCODE rescue lookup failed:', e?.message); }
        }
        console.log('☕ Coffee session normalization:', { rawSession, season_code: body.season_code, session_descript: body.session_descript, normalizedSession });
      } else {
        if (normalizedSession.includes('PM') || normalizedSession.includes('EVENING') || normalizedSession.includes('AFTERNOON')) {
          normalizedSession = 'PM';
        } else if (normalizedSession.includes('AM') || normalizedSession.includes('MORNING')) {
          normalizedSession = 'AM';
        }
      }

      console.log('🧼 Normalized values:', {
        farmer_id: { raw: body.farmer_id, clean: cleanFarmerId },
        session: { raw: body.session, normalized: normalizedSession },
        transtype: transtype,
      });

      // Skip multOpt check for Sell Portal (transtype=2) - unlimited sells per session allowed
      if (transtype === 2) {
        console.log('📦 Sell Portal transaction (transtype=2) - skipping multOpt validation');
      } else {
        // Get member's multOpt setting (only for Buy Produce transactions)
        const [memberRows] = await pool.query(
          'SELECT multOpt FROM cm_members WHERE mcode = ? AND ccode = ?',
          [cleanFarmerId, ccode]
        );

        // Default to allowing multiple if member not found or multOpt not set
        const multOpt = memberRows.length > 0 && memberRows[0].multOpt !== null 
          ? parseInt(memberRows[0].multOpt) 
          : 1;

        console.log(`👤 Member ${cleanFarmerId} multOpt: ${multOpt}`);

        if (multOpt === 0) {
          // multOpt=0 means: only ONE "workflow" per session/day.
          // However, a workflow may include multiple bucket rows.
          // Rule:
          // - If a row already exists for this farmer+session+date, then ONLY allow inserts that
          //   share the SAME Uploadrefno (i.e., same workflow/batch).
          // - Any different Uploadrefno is treated as a duplicate session delivery.
          const [existingTransRows] = await pool.query(
            `SELECT transrefno, Uploadrefno FROM transactions 
             WHERE memberno = ?
               AND UPPER(TRIM(session)) = ?
               AND transdate = ?
               AND Transtype = 1
               AND ccode = ?
             ORDER BY transrefno ASC
             LIMIT 1`,
            [cleanFarmerId, normalizedSession, transdate, ccode]
          );

          if (existingTransRows.length > 0) {
            const existingRef = existingTransRows[0].transrefno;
            const existingUploadRef = existingTransRows[0].Uploadrefno;

            // If client didn't send uploadrefno, we cannot safely group; treat as duplicate.
            if (!uploadrefno) {
              console.log(
                `⚠️ multOpt=0: existing delivery found but request has no uploadrefno. Rejecting. existingUploadRef=${existingUploadRef}`
              );
              return sendJSON(res, {
                success: false,
                error: 'DUPLICATE_SESSION_DELIVERY',
                message: `Member already delivered in ${normalizedSession} session today`,
                existing_reference: existingRef,
                existing_uploadrefno: existingUploadRef,
                farmer_id: cleanFarmerId,
                session: normalizedSession,
                date: transdate,
              }, 409);
            }

            // Allow only if uploadrefno matches the already-open workflow for the day/session.
            if (String(uploadrefno) !== String(existingUploadRef)) {
              console.log(
                `⚠️ Member ${cleanFarmerId} already delivered in ${normalizedSession} today with Uploadrefno=${existingUploadRef}. ` +
                `Rejecting new Uploadrefno=${uploadrefno}. Existing ref: ${existingRef}`
              );
              return sendJSON(res, {
                success: false,
                error: 'DUPLICATE_SESSION_DELIVERY',
                message: `Member already delivered in ${normalizedSession} session today`,
                existing_reference: existingRef,
                existing_uploadrefno: existingUploadRef,
                farmer_id: cleanFarmerId,
                session: normalizedSession,
                date: transdate,
              }, 409);
            }

            console.log(
              `✅ multOpt=0: existing delivery found, but Uploadrefno matches (${uploadrefno}). Allowing additional row.`
            );
          }
        }
      }

      // Helper function to attempt insert - NO LONGER auto-regenerates on duplicate
      // If duplicate detected, return success acknowledging record exists (idempotent)
      // This prevents infinite retry loops that create multiple records
      const attemptInsert = async (attemptTransrefno, attemptUploadrefno) => {
        try {
          // Attempt the insert with current reference
          const productCode = body.product_code || '';
          const seasonCAN = body.season_code || '';
          
          const deliveredBy = body.delivered_by || 'owner';
          
          await pool.query(
            `INSERT INTO transactions 
              (transrefno, Uploadrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
               transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
               amount, icode, CAN, time, capType, entry_type, deliveredby)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 0, ?, ?, ?, 0, ?, ?)`,
            [
              attemptTransrefno,
              attemptUploadrefno ? String(attemptUploadrefno) : '',
              userId,
              clerk,
              deviceserial,
              cleanFarmerId,
              body.route,
              toNumOrZero(body.weight),           // v2.12.7: never '' into numeric column
              normalizedSession,
              transdate,
              transtime,
              transtype,
              ccode,
              productCode,
              seasonCAN,
              timestamp,
              body.entry_type || 'manual',
              deliveredBy,
            ]
          );

          // SUCCESS: Update trnid AND milkid AFTER successful insert
          const [devRows] = await pool.query(
            'SELECT devcode FROM devSettings WHERE uniquedevcode = ?',
            [deviceserial]
          );
          if (devRows.length > 0 && devRows[0].devcode) {
            const devcode = devRows[0].devcode;
            // Extract trnid using last 8 digits to avoid clientFetch corruption
            const insertedTrnId = parseInt(attemptTransrefno.slice(-8), 10);
const insertedMilkId = parseInt(String(attemptUploadrefno).replace(/^\D+/, ''), 10);
            if (!isNaN(insertedTrnId)) {
              await pool.query(
                `UPDATE devSettings SET
                  trnid = GREATEST(IFNULL(trnid, 0), ?),
                  milkid = GREATEST(IFNULL(milkid, 0), ?)
                 WHERE uniquedevcode = ?`,
                [
  insertedTrnId,
  isNaN(insertedMilkId) ? 0 : insertedMilkId,
  deviceserial
]
              );
              console.log(
  `✅ Updated trnid to ${insertedTrnId}, milkid to ${insertedMilkId} for device`
);
            }
          }

          console.log('✅ BACKEND: NEW record INSERTED with reference:', attemptTransrefno, ', uploadrefno:', attemptUploadrefno);
          return { success: true, reference_no: attemptTransrefno, uploadrefno: attemptUploadrefno, isNew: true };
        } catch (error) {
          // Check if it's a duplicate entry error
          if (error.code === 'ER_DUP_ENTRY' && error.message.includes('idx_transrefno_unique')) {
            // SAFE IDEMPOTENCY: Fetch existing row and compare critical payload fields
            // Only return success if the existing record truly matches this submission
            try {
              const [existingRows] = await pool.query(
                'SELECT transrefno, memberno, route, weight, session, transdate, Uploadrefno, icode, ccode FROM transactions WHERE transrefno = ? LIMIT 1',
                [attemptTransrefno]
              );
              if (existingRows.length > 0) {
                const existing = existingRows[0];
                const payloadMatch = (
                  String(existing.memberno || '').trim() === String(cleanFarmerId || '').trim() &&
                  Math.abs(Number(existing.weight || 0) - Number(body.weight || 0)) < 0.01 &&
                  String(existing.session || '').trim().toUpperCase() === String(normalizedSession || '').trim().toUpperCase()
                );
                if (payloadMatch) {
                  console.log(`ℹ️ Record ${attemptTransrefno} already exists with matching payload (true idempotent retry)`);
                  return {
                    success: true,
                    reference_no: attemptTransrefno,
                    uploadrefno: attemptUploadrefno,
                    isNew: false,
                    message: 'Record already exists (duplicate reference)'
                  };
                } else {
                  // Payload mismatch — this is a reference COLLISION, not a retry
                  console.warn(`⚠️ Reference collision: ${attemptTransrefno} exists with different payload. Existing: member=${existing.memberno}, weight=${existing.weight}. New: member=${cleanFarmerId}, weight=${body.weight}`);
                  return {
                    success: false,
                    collision: true,
                    reference_no: attemptTransrefno,
                    error: 'REFERENCE_COLLISION',
                    message: 'Reference number belongs to a different transaction. Please regenerate reference and retry.'
                  };
                }
              }
            } catch (lookupErr) {
              console.error('❌ Failed to lookup existing record for collision check:', lookupErr);
            }
            // Fallback: if lookup fails, treat as idempotent success to avoid data loss
            console.log(`ℹ️ Record with reference ${attemptTransrefno} already exists (idempotent fallback)`);
            return {
              success: true,
              reference_no: attemptTransrefno,
              uploadrefno: attemptUploadrefno,
              isNew: false,
              message: 'Record already exists (duplicate reference)'
            };
          } else {
            // Not a duplicate error - rethrow
            throw error;
          }
        }
      };

      // If uploadrefno not provided by frontend, generate from backend
      if (!uploadrefno) {
        uploadrefno = currentMilkId + 1;
        console.log('📝 Backend generated milkId:', uploadrefno);
      }

      try {
        const result = await attemptInsert(transrefno, uploadrefno);
        return sendJSON(res, {
          success: true,
          message: 'Collection created',
          reference_no: result.reference_no,
          uploadrefno: result.uploadrefno
        }, 201);
      } catch (error) {
        // SECURITY (v2.10.83): log SQL details server-side; return generic message to client.
        console.error('❌ BACKEND INSERT ERROR:', error.message);
        console.error('Error code:', error.code);
        return sendJSON(res, {
          success: false,
          error: 'Insert failed'
        }, 500);
      }
    }

    if (path.startsWith('/api/milk-collection/') && method === 'PUT') {
      const ref = path.split('/')[3];
      const body = await parseBody(req);

      console.log('🟡 BACKEND: UPDATING existing transaction');
      console.log('📝 Reference:', ref);
      console.log('⚖️ New Weight:', body.weight, 'Kg');

      // CRITICAL: Get device's ccode to ensure update only affects records for this device
      const deviceserial = body.device_fingerprint;
      if (!deviceserial) {
        return sendJSON(res, {
          success: false,
          error: 'device_fingerprint is required for updates'
        }, 400);
      }

      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [deviceserial]
      );

      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        console.log('❌ Device not authorized for update:', deviceserial);
        return sendJSON(res, {
          success: false,
          error: 'Device not authorized'
        }, 403);
      }

      const ccode = deviceRows[0].ccode;
      console.log('🏢 Company Code:', ccode);

      const updates = [];
      const values = [];
      if (body.weight !== undefined) {
        updates.push('weight = ?');
        values.push(body.weight);
      }
      if (body.collection_date) {
        const collectionDate = new Date(body.collection_date);
        const transdate = collectionDate.toISOString().split('T')[0];
        const transtime = collectionDate.toTimeString().split(' ')[0];
        updates.push('transdate = ?', 'transtime = ?');
        values.push(transdate, transtime);
      }
      if (updates.length === 0) return sendJSON(res, { success: false, error: 'No fields to update' }, 400);

      // STRICT: Update only records matching BOTH transrefno AND ccode
      values.push(ref, ccode);
      const [result] = await pool.query(`UPDATE transactions SET ${updates.join(', ')} WHERE transrefno = ? AND ccode = ?`, values);

      console.log('✅ BACKEND: Record UPDATED, affected rows:', result.affectedRows);
      return sendJSON(res, { success: true, message: 'Collection updated' });
    }

    if (path.startsWith('/api/milk-collection/') && method === 'DELETE') {
      const ref = path.split('/')[3];
      await pool.query('DELETE FROM transactions WHERE transrefno = ?', [ref]);
      return sendJSON(res, { success: true, message: 'Collection deleted' });
    }

    // Periodic Report endpoint - aggregated by farmer with date range
    // CRITICAL: Data is strictly filtered by deviceserial to ensure device isolation
    if (path === '/api/periodic-report' && method === 'GET') {
      const startDate = parsedUrl.query.start_date;
      const endDate = parsedUrl.query.end_date;
      const farmerSearch = parsedUrl.query.farmer_search;
      const uniquedevcode = parsedUrl.query.uniquedevcode;

      if (!startDate || !endDate) {
        return sendJSON(res, { success: false, error: 'start_date and end_date are required' }, 400);
      }

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400);
      }

      // Get device's company code and devcode
      const [deviceRows] = await pool.query(
        'SELECT ccode, devcode FROM devSettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );

      if (deviceRows.length === 0) {
        return sendJSON(res, {
          success: false,
          error: 'Device not authorized or not found'
        }, 401);
      }

      const ccode = deviceRows[0].ccode;
      const devcode = deviceRows[0].devcode;

      // v2.10.53: Cross-device visibility within same ccode. Drop deviceserial filter.
      // Multi-tenant isolation preserved via t.ccode. Optional `route` query param
      // scopes results to the route currently selected on the requesting device.
      const routeFilter = (parsedUrl.query.route || '').toString().trim();
      let query = `
        SELECT
          t.memberno as farmer_id,
          cm.descript as farmer_name,
          cm.route,
          SUM(t.weight) as total_weight,
          COUNT(*) as collection_count
        FROM transactions t
        LEFT JOIN cm_members cm ON t.memberno = cm.mcode AND t.ccode = cm.ccode
        WHERE t.Transtype = 1
          AND CAST(t.transdate AS DATE) BETWEEN ? AND ?
          AND t.ccode = ?
      `;
      let params = [startDate, endDate, ccode];

      if (routeFilter) {
        query += ` AND TRIM(t.route) = TRIM(?)`;
        params.push(routeFilter);
      }

      if (farmerSearch) {
        query += ` AND (t.memberno LIKE ? OR cm.descript LIKE ?)`;
        params.push(`%${farmerSearch}%`, `%${farmerSearch}%`);
      }

      query += ` GROUP BY t.memberno, cm.descript, cm.route ORDER BY cm.descript`;

      const [rows] = await pool.query(query, params);
      return sendJSON(res, { success: true, data: rows });
    }

    // Farmer Detail Report endpoint - individual transactions for a farmer in date range
    // CRITICAL: Data is strictly filtered by deviceserial to ensure device isolation
    if (path === '/api/periodic-report/farmer-detail' && method === 'GET') {
      const startDate = parsedUrl.query.start_date;
      const endDate = parsedUrl.query.end_date;
      const farmerId = parsedUrl.query.farmer_id;
      const uniquedevcode = parsedUrl.query.uniquedevcode;

      if (!startDate || !endDate) {
        return sendJSON(res, { success: false, error: 'start_date and end_date are required' }, 400);
      }

      if (!farmerId) {
        return sendJSON(res, { success: false, error: 'farmer_id is required' }, 400);
      }

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400);
      }

      // Get device's company code, devcode, and company name
      const [deviceRows] = await pool.query(
        `SELECT d.ccode, d.devcode, p.cname as company_name
         FROM devSettings d
         LEFT JOIN psettings p ON d.ccode = p.cno
         WHERE d.uniquedevcode = ? AND d.authorized = 1`,
        [uniquedevcode]
      );

      if (deviceRows.length === 0) {
        return sendJSON(res, {
          success: false,
          error: 'Device not authorized or not found'
        }, 401);
      }

      const ccode = deviceRows[0].ccode;
      const companyName = deviceRows[0].company_name || ccode || 'Company';

      // Get farmer info
      const [farmerRows] = await pool.query(
        'SELECT mcode, descript, route FROM cm_members WHERE mcode = ? AND ccode = ?',
        [farmerId, ccode]
      );

      const farmerName = farmerRows.length > 0 ? farmerRows[0].descript : 'Unknown';
      const farmerRoute = farmerRows.length > 0 ? farmerRows[0].route : '';

      // v2.10.55: Resolve human-readable route descript for the farmer's registered route
      let farmerRouteName = '';
      if (farmerRoute) {
        const [farmerRouteRows] = await pool.query(
          'SELECT descript FROM fm_tanks WHERE TRIM(tcode) = TRIM(?) AND ccode = ? LIMIT 1',
          [farmerRoute, ccode]
        );
        farmerRouteName = farmerRouteRows.length > 0 ? (farmerRouteRows[0].descript || '') : '';
      }

      // v2.10.53: Cross-device visibility — filter by ccode (+ optional route),
      // not deviceserial. Old clients omit `route` and get full ccode results.
      const routeFilter = (parsedUrl.query.route || '').toString().trim();

      const produceParams = [ccode, farmerId, startDate, endDate, ccode];
      let produceSql = `SELECT DISTINCT i.descript as produce_name
         FROM transactions t
         LEFT JOIN fm_items i ON t.icode = i.icode AND i.ccode = ?
         WHERE t.memberno = ?
           AND CAST(t.transdate AS DATE) BETWEEN ? AND ?
           AND t.Transtype = 1
           AND t.ccode = ?`;
      if (routeFilter) {
        produceSql += ` AND TRIM(t.route) = TRIM(?)`;
        produceParams.push(routeFilter);
      }
      produceSql += ` LIMIT 1`;
      const [produceRows] = await pool.query(produceSql, produceParams);

      const produceName = produceRows.length > 0 && produceRows[0].produce_name ? produceRows[0].produce_name : 'PRODUCE';

      // v2.10.77: include icode + product_name per transaction so the receipt
      // can group rows by produce. Additive — old clients ignore extra fields.
      const txParams = [ccode, farmerId, startDate, endDate, ccode];
      let txSql = `SELECT
          t.transdate as date,
          t.transrefno as rec_no,
          t.weight as quantity,
          t.transtime as time,
          UPPER(TRIM(t.icode)) as icode,
          i.descript as product_name
        FROM transactions t
        LEFT JOIN fm_items i ON UPPER(TRIM(i.icode)) = UPPER(TRIM(t.icode)) AND i.ccode = ?
        WHERE t.memberno = ?
          AND t.Transtype = 1
          AND CAST(t.transdate AS DATE) BETWEEN ? AND ?
          AND t.ccode = ?`;
      if (routeFilter) {
        txSql += ` AND TRIM(t.route) = TRIM(?)`;
        txParams.push(routeFilter);
      }
      txSql += ` ORDER BY UPPER(TRIM(t.icode)) ASC, t.transdate ASC, t.transtime ASC`;
      const [transactions] = await pool.query(txSql, txParams);

      // Calculate total weight
      const totalWeight = transactions.reduce((sum, t) => sum + (parseFloat(t.quantity) || 0), 0);

      // v2.10.55: Most recent transaction route within the date range, plus its descript.
      // Used as a fallback to display CENTER on the printed statement when the operator
      // didn't pick a route on the dashboard.
      let transactionRoute = '';
      let transactionRouteName = '';
      const lastRouteParams = [farmerId, startDate, endDate, ccode];
      let lastRouteSql = `SELECT TRIM(t.route) AS route
        FROM transactions t
        WHERE t.memberno = ?
          AND t.Transtype = 1
          AND CAST(t.transdate AS DATE) BETWEEN ? AND ?
          AND t.ccode = ?`;
      if (routeFilter) {
        lastRouteSql += ` AND TRIM(t.route) = TRIM(?)`;
        lastRouteParams.push(routeFilter);
      }
      lastRouteSql += ` ORDER BY t.transdate DESC, t.transtime DESC LIMIT 1`;
      const [lastRouteRows] = await pool.query(lastRouteSql, lastRouteParams);
      if (lastRouteRows.length > 0 && lastRouteRows[0].route) {
        transactionRoute = lastRouteRows[0].route;
        const [txRouteNameRows] = await pool.query(
          'SELECT descript FROM fm_tanks WHERE TRIM(tcode) = TRIM(?) AND ccode = ? LIMIT 1',
          [transactionRoute, ccode]
        );
        transactionRouteName = txRouteNameRows.length > 0 ? (txRouteNameRows[0].descript || '') : '';
      }

      return sendJSON(res, {
        success: true,
        data: {
          company_name: companyName,
          farmer_id: farmerId,
          farmer_name: farmerName,
          farmer_route: farmerRoute,
          farmer_route_name: farmerRouteName,
          transaction_route: transactionRoute,
          transaction_route_name: transactionRouteName,
          produce_name: produceName,
          start_date: startDate,
          end_date: endDate,
          total_weight: totalWeight,
          transactions: transactions
        }
      });
    }

    // Z-Report endpoint - now using transactions table
    if (path === '/api/z-report' && method === 'GET') {
      const date = parsedUrl.query.date || new Date().toISOString().split('T')[0];
      const uniquedevcode = parsedUrl.query.uniquedevcode;

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400);
      }

      // Get device's company code
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devSettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );

      if (deviceRows.length === 0) {
        return sendJSON(res, {
          success: false,
          error: 'Device not authorized or not found'
        }, 401);
      }

      const ccode = deviceRows[0].ccode;

      // Fetch all collections for the specified date and company
      // DB columns → Frontend fields mapping
      const [collections] = await pool.query(
        `SELECT transrefno, Uploadrefno as uploadrefno, memberno as farmer_id, route, weight, session,
                transdate as collection_date, clerk as clerk_name, icode as product_code, entry_type
         FROM transactions
         WHERE transdate = ? AND Transtype = 1 AND ccode = ?
         ORDER BY session, route, memberno`,
        [date, ccode]
      );

      // Calculate totals
      const totalLiters = collections.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0);
      const totalFarmers = new Set(collections.map(c => c.farmer_id)).size;
      const totalEntries = collections.length;

      // Group by route (defensive: normalize unexpected session values)
      const byRoute = collections.reduce((acc, c) => {
        const routeKey = c.route || 'Unknown';
        const sessionKey = c.session === 'PM' ? 'PM' : 'AM';

        if (!acc[routeKey]) {
          acc[routeKey] = { AM: [], PM: [], total: 0 };
        }

        acc[routeKey][sessionKey].push(c);
        acc[routeKey].total += parseFloat(c.weight || 0);
        return acc;
      }, {});

      // Group by session
      const bySession = {
        AM: collections.filter(c => c.session === 'AM'),
        PM: collections.filter(c => c.session === 'PM')
      };

      // Group by collector
      const byCollector = collections.reduce((acc, c) => {
        const collector = c.clerk_name || 'Unknown';
        if (!acc[collector]) {
          acc[collector] = { entries: 0, liters: 0, farmers: new Set() };
        }
        acc[collector].entries++;
        acc[collector].liters += parseFloat(c.weight || 0);
        acc[collector].farmers.add(c.farmer_id);
        return acc;
      }, {});

      // Convert collector farmers Set to count
      Object.keys(byCollector).forEach(key => {
        byCollector[key].farmers = byCollector[key].farmers.size;
      });

      return sendJSON(res, {
        success: true,
        data: {
          date,
          totals: {
            liters: parseFloat(totalLiters.toFixed(2)),
            farmers: totalFarmers,
            entries: totalEntries
          },
          byRoute,
          bySession: {
            AM: {
              entries: bySession.AM.length,
              liters: parseFloat(bySession.AM.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0).toFixed(2))
            },
            PM: {
              entries: bySession.PM.length,
              liters: parseFloat(bySession.PM.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0).toFixed(2))
            }
          },
          byCollector,
          collections
        }
      });
    }

    // ==================== DEVICE-SPECIFIC Z-REPORT API ====================
    // GET /api/z-report/device - Get Z Report filtered by device (not company-wide)
    // This ensures Z Reports are per-device only, never mixing devices
    // Supports period filtering: morning, afternoon, evening, all
    if (path === '/api/z-report/device' && method === 'GET') {
      const date = parsedUrl.query.date || new Date().toISOString().split('T')[0];
      const uniquedevcode = parsedUrl.query.uniquedevcode;
      const seasonFilter = parsedUrl.query.season; // Optional exact session filter
      const periodFilter = parsedUrl.query.period; // Optional period filter: morning, afternoon, evening, all

      if (!uniquedevcode) {
        return sendJSON(res, { success: false, error: 'uniquedevcode is required' }, 400, origin);
      }

      // Get device info including devcode, ccode, and company name
      const [deviceRows] = await pool.query(
        `SELECT d.ccode, d.devcode, p.cname as company_name, p.orgtype, p.rdesc
         FROM devSettings d
         LEFT JOIN psettings p ON d.ccode = p.cno
         WHERE d.uniquedevcode = ? AND d.authorized = 1`,
        [uniquedevcode]
      );

      if (deviceRows.length === 0) {
        return sendJSON(res, {
          success: false,
          error: 'Device not authorized or not found'
        }, 401, origin);
      }

      const { ccode, devcode, company_name, orgtype, rdesc } = deviceRows[0];
      const isCoffee = orgtype === 'C';
      const periodLabel = isCoffee ? 'Season' : 'Session';
      const routeLabel = rdesc || (isCoffee ? 'Center' : 'Route');
      const produceLabel = isCoffee ? 'COFFEE' : 'MILK';

      // Get the device's unique identifier (deviceserial) from the fingerprint
      // The deviceserial in transactions matches the uniquedevcode from devSettings
      const deviceSerial = uniquedevcode;

      // Define CAN column codes for each period (original session SCODE values)
      // These codes match the sessions.SCODE values from the sessions table
      // Morning: MO (or sometimes just using 'AM')
      // Afternoon: AF (or sometimes just using 'PM')
      // Evening: EV, EVE
      const periodCANCodes = {
        morning: ['MO', 'AM', 'MORNING'],
        afternoon: ['AF', 'PM', 'AFTERNOON'],
        evening: ['EV', 'EVE', 'EVENING', 'NIGHT']
      };

      // Define normalized session column values for each period
      // The session column is normalized to AM/PM during milk-collection insertion:
      // - Morning (MO, AM, MORNING) → session='AM'
      // - Afternoon (AF, PM, AFTERNOON) → session='PM'
      // - Evening (EV, EVENING) → session='PM' (because the normalization checks for 'EVENING' → PM)
      // NOTE: EV sessions are normalized to PM in the session column! So we can't rely on session alone.
      const periodNormalizedSession = {
        morning: ['AM'],
        afternoon: ['PM'],
        evening: ['PM'] // EV is normalized to PM in session column, so we MUST use CAN
      };

      // Build query - filter by deviceserial to ensure per-device reporting
      // Include ALL transaction types: 1=Buy Produce, 2=Sell/Store, 3=AI
      // Join fm_tanks to get route description and fm_items for product name
      let query = `
        SELECT t.transrefno, t.Uploadrefno as uploadrefno, t.memberno as farmer_id,
               t.route, t.weight, t.session, t.transdate as collection_date,
               t.transtime, t.clerk as clerk_name, t.icode as product_code,
               t.entry_type, t.CAN as season_code, t.Transtype as transtype,
               t.iprice, t.amount,
               i.descript as product_name,
               TRIM(r.descript) as route_name
        FROM transactions t
        LEFT JOIN fm_items i ON t.icode = i.icode AND i.ccode = ?
        LEFT JOIN fm_tanks r ON t.route = r.tcode AND r.ccode = ?
        WHERE t.transdate = ? AND t.Transtype IN (1, 2, 3) AND t.deviceserial = ?
      `;
      const queryParams = [ccode, ccode, date, deviceSerial];

      // Add period filter if provided
      // CRITICAL: Use CAN column for accurate filtering because session column is normalized
      // The CAN column stores the original SCODE (MO, AF, EV) from sessions table
      if (periodFilter && periodFilter !== 'all' && periodCANCodes[periodFilter]) {
        const canCodes = periodCANCodes[periodFilter];
        // Build OR condition to match CAN column against period codes
        // Use UPPER() for case-insensitive matching
        const canConditions = canCodes.map(() => 'UPPER(TRIM(t.CAN)) = ?').join(' OR ');
        query += ` AND (${canConditions})`;
        // Add CAN codes for filtering
        queryParams.push(...canCodes.map(s => s.toUpperCase()));
      } else if (seasonFilter) {
        // Legacy exact session filter
        query += ` AND t.session = ?`;
        queryParams.push(seasonFilter);
      }

      query += ` ORDER BY t.Transtype ASC, t.icode ASC, t.route ASC, t.transtime ASC, t.memberno`;

      const [collections] = await pool.query(query, queryParams);

      // Get season/session name for header
      let seasonName = '';
      if (collections.length > 0 && collections[0].season_code) {
        const seasonCode = collections[0].season_code;
        seasonName = (await findSeasonDescript(seasonCode, ccode)) || seasonCode;
      } else if (collections.length > 0) {
        seasonName = collections[0].session || 'AM';
      }

      // Get clerk name (from first transaction or device user)
      const clerkName = collections.length > 0 ? (collections[0].clerk_name || 'Unknown') : 'Unknown';

      // Get produce name (from first transaction if available)
      const produceName = collections.length > 0 && collections[0].product_name
        ? collections[0].product_name
        : produceLabel;

      // Calculate totals
      const totalWeight = collections.reduce((sum, c) => sum + parseFloat(c.weight || 0), 0);
      const totalFarmers = new Set(collections.map(c => c.farmer_id)).size;
      const totalEntries = collections.length;


      // Format transactions for frontend display
      const transactions = collections.map(c => {
        // Extract short ref number (last 5 chars of transrefno for compactness)
        const refno = c.transrefno ? c.transrefno.slice(-5) : '';

        // Format time as HH:MM AM/PM
        let timeStr = '';
        if (c.transtime) {
          const timeParts = String(c.transtime).split(':');
          if (timeParts.length >= 2) {
            const hour = parseInt(timeParts[0], 10);
            const minute = timeParts[1];
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const hour12 = hour % 12 || 12;
            timeStr = `${hour12}:${minute} ${ampm}`;
          }
        }

        // Determine transaction type label based on Transtype
        // 1 = Buy Produce, 2 = Sell/Store, 3 = AI
        let transTypeLabel = 'BUY';
        const transtype = parseInt(c.transtype) || 1;
        if (transtype === 2) {
          transTypeLabel = 'SELL';
        } else if (transtype === 3) {
          transTypeLabel = 'AI';
        }

        return {
          transrefno: c.transrefno,
          refno,
          farmer_id: c.farmer_id,
          weight: parseFloat(c.weight || 0),
          time: timeStr,
          session: c.session,
          season_code: c.season_code || '', // CAN column - original session SCODE (MO, AF, EV)
          route: c.route || '', // Route code for grouping
          route_name: c.route_name || c.route || '', // Full descriptive center name
          product_code: c.product_code || '', // Product code for produce grouping
          product_name: c.product_name || '', // Product name for produce grouping
          transtype: transtype, // 1=Buy, 2=Sell/Store, 3=AI
          transTypeLabel: transTypeLabel, // Human readable label
          price: parseFloat(c.iprice || 0),
          amount: parseFloat(c.amount || 0)
        };
      });

      return sendJSON(res, {
        success: true,
        data: {
          date,
          deviceCode: devcode || deviceSerial.substring(0, 8),
          companyName: company_name || 'Company',
          produceLabel,
          produceName,
          periodLabel,
          seasonName,
          routeLabel,
          clerkName,
          totals: {
            weight: parseFloat(totalWeight.toFixed(2)),
            entries: totalEntries,
            farmers: totalFarmers
          },
          transactions,
          isCoffee
        }
      }, 200, origin);
    }

    // Items endpoint with invtype filtering
    // invtype values: '01' = produce (milk, cherry), '05' = store items, '06' = AI items
    if (path === '/api/items' && method === 'GET') {
      const uniquedevcode = parsedUrl.query.uniquedevcode;
      const invtype = parsedUrl.query.invtype; // Optional filter: '01', '05', '06'

      if (!uniquedevcode) {
        return sendJSON(res, {
          success: false,
          message: 'Device code required'
        }, 400);
      }

      // Get device and check authorization
      const [deviceRows] = await pool.query(
        'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [uniquedevcode]
      );

      if (deviceRows.length === 0 || deviceRows[0].authorized !== 1) {
        return sendJSON(res, {
          success: false,
          message: 'Device not authorized'
        }, 401);
      }

      const ccode = deviceRows[0].ccode;

      // v2.12.6: serve from a 60 s cache. Devices were re-requesting the same
      // catalogue continuously; the rows change rarely, so the cache removes
      // the query load without changing the response shape.
      const itemsKey = `items:${String(ccode).toUpperCase()}:${invtype || 'ALL'}`;
      const cachedItems = itemsCache.get(itemsKey);
      if (cachedItems) {
        return sendJSON(res, { success: true, data: cachedItems });
      }


      console.log('[ITEMS] Request:', {
  ccode,
  invtype,
  query: parsedUrl.query
});

      // Build query with optional invtype filter
     let query = 'SELECT * FROM fm_items WHERE ccode = ?';
      const params = [ccode];

      if (invtype) {
        query += ' AND invtype = ?';
        params.push(invtype);
      }

      query += ' ORDER BY descript';

      const [rows] = await pool.query(query, params);

      itemsCache.set(itemsKey, rows);

      // v2.12.5: diagnostics — when a filtered request comes back empty it is
      // usually because Contabo's fm_items rows are not tagged with the expected
      // invtype (new schema defaults invtype to '05'). Logged on cache miss only.
      console.log(`[ITEMS] ccode=${ccode} invtype=${invtype || 'ALL'} rows=${rows.length} (cache miss)`);

if (rows.length === 0) {
  try {
    const [spread] = await pool.query(
      `SELECT IFNULL(invtype, "(null)") AS invtype,
              COUNT(*) AS n
       FROM fm_items
       WHERE ccode = ?
       GROUP BY invtype`,
      [ccode]
    );

    console.log(
      `[ITEMS] ccode=${ccode} invtype spread: ${
        spread.map(r => `${r.invtype}=${r.n}`).join(', ') || 'no rows'
      }`
    );
  } catch (e) {
    console.log('[ITEMS] invtype spread probe failed:', e.message);
  }
}

return sendJSON(res, { success: true, data: rows });

}

 // Sales endpoints - Unified for Store (transtype=2) and AI (transtype=3)
if (path === '/api/sales' && method === 'POST') {
      const body = await parseBody(req);
      const conn = await pool.getConnection();
      
      try {
        await conn.beginTransaction();
        
        // Use frontend-provided references (same logic as Buy module)
        const transrefno = body.transrefno || body.sale_ref || `SALE-${Date.now()}`;
        const uploadrefno = body.uploadrefno || '';
        
        // Determine transtype: 2 = Store, 3 = AI (default to Store for backward compat)
        const transtype = body.transtype === 3 ? 3 : 2;
        
        // Get current date and time
        const now = new Date();
        const transdate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const transtime = now.toTimeString().split(' ')[0]; // HH:MM:SS
        const timestamp = Math.floor(now.getTime() / 1000); // Unix timestamp
        
        // Calculate amount (quantity * price)
        const amount = (body.quantity || 0) * (body.price || 0);
        
        // Get device's ccode from devSettings using device_fingerprint
        let ccode = '';
        let authorized = false;
        if (body.device_fingerprint) {
          const [deviceRows] = await conn.query(
            'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
            [body.device_fingerprint]
          );
          if (deviceRows.length > 0) {
            ccode = deviceRows[0].ccode || '';
            authorized = deviceRows[0].authorized === 1;
          }
        }
        
        // Check device authorization
        if (!authorized) {
          await conn.rollback();
          conn.release();
          return sendJSON(res, { 
            success: false, 
            error: 'Device not authorized' 
          }, 403);
        }
        
        // ENFORCE clientFetch based on transtype
        // transtype 2 (Store): requires clientFetch = 2
        // transtype 3 (AI): requires clientFetch = 3
        const requiredClientFetch = transtype;
        const [allowedRoutes] = await conn.query(
          'SELECT tcode FROM fm_tanks WHERE ccode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
          [ccode, requiredClientFetch]
        );
        
        if (allowedRoutes.length === 0) {
          const serviceName = transtype === 3 ? 'AI Services' : 'Store';
          console.log(`❌ clientFetch enforcement: ${serviceName} disabled for company ${ccode} (no routes with clientFetch=${requiredClientFetch})`);
          await conn.rollback();
          conn.release();
          return sendJSON(res, { 
            success: false, 
            error: transtype === 3 ? 'AI_DISABLED' : 'STORE_DISABLED',
            message: `${serviceName} operations are not enabled for this company. Please contact administrator.` 
          }, 403);
        }
        
        // Use fm_tanks.tcode for route — prefer frontend-selected route_tcode if valid
        let storeRoute = '';
        if (body.route_tcode) {
          const [matchedRoute] = await conn.query(
            'SELECT tcode FROM fm_tanks WHERE ccode = ? AND tcode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
            [ccode, body.route_tcode, requiredClientFetch]
          );
          if (matchedRoute.length > 0) {
            storeRoute = matchedRoute[0].tcode.toString().trim();
          }
        }
        if (!storeRoute) {
          storeRoute = (allowedRoutes[0].tcode || '').toString().trim() || (body.route || '');
        }

        // Idempotency guard: if transrefno already exists, treat as already synced
        const [existingSaleRows] = await conn.query(
          'SELECT ID FROM transactions WHERE transrefno = ? LIMIT 1',
          [transrefno]
        );

        if (existingSaleRows.length > 0) {
          await conn.rollback();
          conn.release();
          return sendJSON(res, {
            success: true,
            duplicate: true,
            sale_ref: transrefno,
            message: 'Sale already exists, treated as synced'
          }, 200);
        }
        
        console.log(`🟢 BACKEND: Creating ${transtype === 3 ? 'AI' : 'Store'} transaction`);
        console.log('📝 TransRefNo:', transrefno);
        console.log('📝 UploadRefNo:', uploadrefno);
        console.log('👤 Member:', body.farmer_id);
        console.log('📦 Item:', body.item_code, body.item_name);
        console.log('💰 Amount:', amount);
        
        // Handle photo upload if provided
        let photoFilename = null;
        let photoDirectory = null;
        
        if (body.photo && typeof body.photo === 'string' && body.photo.startsWith('data:image/')) {
          try {
            const fs = require('fs');
            const path = require('path');
            
            // Extract base64 data from data URL
            const matches = body.photo.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');
              
              // Create directory structure: uploads/store-photos/YYYY/MM
              const uploadsDir = path.join(__dirname, 'uploads', 'store-photos');
              const yearDir = String(now.getFullYear());
              const monthDir = String(now.getMonth() + 1).padStart(2, '0');
              const fullDir = path.join(uploadsDir, yearDir, monthDir);
              
              // Create directories if they don't exist
              if (!fs.existsSync(fullDir)) {
                fs.mkdirSync(fullDir, { recursive: true });
              }
              
              // Generate unique filename
              photoFilename = `${transrefno}_${timestamp}.${ext}`;
              photoDirectory = `uploads/store-photos/${yearDir}/${monthDir}`;
              
              // Write file
              const filePath = path.join(fullDir, photoFilename);
              fs.writeFileSync(filePath, buffer);
              
              console.log(`📷 Photo saved: ${photoDirectory}/${photoFilename}`);
            }
          } catch (photoError) {
            console.error('❌ Photo upload error:', photoError);
            // Continue without photo - don't fail the sale
          }
        }
        
        // Insert into transactions table (including photo columns, AI cow details, season, and icode)
        // Column names match EXACTLY the transactions table schema:
        // cowname, cowbreed, noofcalfs, aibreed, CAN (season)
        // Get season (CAN) from request body for consistency across all transaction types
        const seasonCAN = body.season || '';

        // v2.10.50: Coffee orgs must NEVER store AM/PM in session column.
        // Look up orgtype and normalize session accordingly.
        let salesOrgtype = 'D';
        try {
          const [orgRows] = await conn.query(
            'SELECT IFNULL(orgtype, "D") as orgtype FROM psettings WHERE cno = ? LIMIT 1',
            [ccode]
          );
          if (orgRows.length > 0) salesOrgtype = (orgRows[0].orgtype || 'D').toString().toUpperCase();
        } catch (e) { console.warn('[/api/sales] orgtype lookup failed:', e?.message); }

        let salesSessionVal = (body.session_label || body.session || '').toString().trim();
        let salesSeasonVal  = (seasonCAN || '').toString().trim();
        if (salesOrgtype === 'C') {
          // v2.10.56: Authoritative SCODE resolution for legacy clients (e.g. v2.10.32)
          // that were sending a stale/wrong SCODE for Store/AI. We force session=CAN
          // and pick the canonical SCODE in this priority:
          //   (a) Most recent Buy (Transtype=1) for the same ccode + transdate → CAN
          //   (b) sessions row whose datefrom..dateto covers the row's transdate
          //   (c) Whatever the device sent (fallback, never destructive)
          const sentScode    = (seasonCAN || '').toString().trim().toUpperCase();
          const sentDescript = (body.session_descript || salesSessionVal || '').toString().trim();
          let canonical = '';

          // (a) Look up today's Buy SCODE for this ccode — what the operator actually used
          try {
            const [buyRows] = await conn.query(
              `SELECT TRIM(CAN) AS CAN
                 FROM transactions
                WHERE ccode = ?
                  AND Transtype = 1
                  AND CAST(transdate AS DATE) = CAST(? AS DATE)
                  AND CAN IS NOT NULL AND TRIM(CAN) <> ''
                ORDER BY transdate DESC, transtime DESC
                LIMIT 1`,
              [ccode, transdate]
            );
            if (buyRows.length && buyRows[0].CAN) canonical = String(buyRows[0].CAN).toUpperCase();
          } catch (e) { console.warn('[/api/sales] coffee Buy-SCODE lookup failed:', e?.message); }

          // (b) sessions table fallback (date-range)
          if (!canonical) {
            try {
              const season = await findActiveSeason(ccode, transdate, conn);
              if (season && season.SCODE) canonical = String(season.SCODE).toUpperCase();
            } catch (e) { console.warn('[/api/sales] coffee SCODE rescue failed:', e?.message); }
          }

          // (c) Last resort: trust whatever the device sent (don't write garbage)
          if (!canonical) {
            canonical = (sentScode || sentDescript || '').toUpperCase();
          }

          if (canonical && (sentScode !== canonical || salesSessionVal.toUpperCase() !== canonical)) {
            console.log(`[NORMALIZE] /api/sales coffee: dev=${body.device_fingerprint || ''} ref=${transrefno} session=${salesSessionVal} CAN=${sentScode} → ${canonical}`);
          }

          salesSessionVal = canonical;
          salesSeasonVal  = canonical;
          console.log('☕ /api/sales coffee session normalization:', { sentScode, sentSession: body.session_label || body.session, canonical });
        }

        await conn.query(
          `INSERT INTO transactions 
            (transrefno, Uploadrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
             transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
             amount, icode, CAN, time, capType, milk_session_id, photo_filename, photo_directory,
             cowname, cowbreed, noofcalfs, aibreed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transrefno,                         // transrefno (from frontend)
            uploadrefno,                        // Uploadrefno (from frontend)
            body.user_id || body.sold_by || '', // userId (login user_id for tracking)
            body.sold_by || '',                 // clerk (display name/username)
            body.device_fingerprint || '',      // deviceserial
            body.farmer_id || '',               // memberno
            storeRoute,                         // route (from fm_tanks.tcode, fallback to body.route)
            toNumOrZero(body.quantity),         // weight (using quantity)
            salesSessionVal,                    // v2.10.50: session (SCODE for coffee, label for dairy)
            transdate,                          // transdate
            transtime,                          // transtime
            toIntOrNull(transtype, 2),          // Transtype: 2 for Store, 3 for AI
            0,                                  // processed
            0,                                  // uploaded
            ccode,                              // ccode (from device's devSettings)
            0,                                  // ivat
            toNumOrZero(body.price),            // iprice
            toNumOrZero(amount),                // amount
            body.item_code || '',               // icode (from body)
            salesSeasonVal,                     // v2.10.56: CAN (canonical SCODE for coffee, raw season for dairy)
            timestamp,                          // time
            0,                                  // capType
            0,                                  // v2.12.7: milk_session_id is INT — 0, never ''
            photoFilename,                      // photo_filename
            photoDirectory,                     // photo_directory
            body.cow_name || '',                // cowname (AI) - maps from frontend cow_name
            body.cow_breed || '',               // cowbreed (AI) - maps from frontend cow_breed
            toIntOrNull(body.number_of_calves), // v2.12.7: noofcalfs is INT — 0, never ''
            body.other_details || ''            // aibreed (AI) - maps from frontend other_details
          ]
        );
        
        // Update stock balance
        await conn.query(
          'UPDATE fm_items SET stockbal = stockbal - ? WHERE icode = ?',
          [body.quantity, body.item_code]
        );
        
        await conn.commit();
        conn.release();
        
        // Update storeid/aiid counter in devSettings (same pattern as milk collection)
        if (body.device_fingerprint) {
          try {
            const insertedTrnId = parseInt(transrefno.slice(-8), 10);
            const typeId = uploadrefno ? parseInt(String(uploadrefno).slice(-8), 10) : 0;
            const counterField = transtype === 3 ? 'aiid' : 'storeid';
            if (!isNaN(insertedTrnId)) {
              await pool.query(
                `UPDATE devSettings SET 
                  trnid = GREATEST(IFNULL(trnid, 0), ?),
                  ${counterField} = GREATEST(IFNULL(${counterField}, 0), ?)
                 WHERE uniquedevcode = ?`,
                [insertedTrnId, typeId, body.device_fingerprint]
              );
              console.log(`📊 Updated devSettings: trnid=${insertedTrnId}, ${counterField}=${typeId} for ${body.device_fingerprint}`);
            }
          } catch (counterErr) {
            console.error('⚠️ Failed to update sale counters in devSettings:', counterErr);
            // Don't fail the sale response - counter update is non-critical
          }
        }
        
        return sendJSON(res, { 
          success: true, 
          message: 'Sale recorded', 
          sale_ref: transrefno,
          photo_saved: !!photoFilename,
          photo_path: photoFilename ? `${photoDirectory}/${photoFilename}` : null
        }, 201);
      } catch (error) {
        const isDuplicateRef =
          error?.code === 'ER_DUP_ENTRY' &&
          String(error?.sqlMessage || error?.message || '').includes('idx_transrefno_unique');

        await conn.rollback();
        conn.release();

        if (isDuplicateRef) {
          return sendJSON(res, {
            success: true,
            duplicate: true,
            sale_ref: body.transrefno || body.sale_ref || '',
            message: 'Sale already exists, treated as synced'
          }, 200);
        }

        throw error;
      }
    }

    // Batch Sales endpoint - ONE photo, MULTIPLE items, each with unique transrefno
    // Used by Store when selling multiple items to a single buyer
    if (path === '/api/sales/batch' && method === 'POST') {
      const body = await parseBody(req);
      const conn = await pool.getConnection();
      
      try {
        await conn.beginTransaction();
        
        // Validate required fields
        if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
          await conn.rollback();
          conn.release();
          return sendJSON(res, { success: false, error: 'No items provided' }, 400);
        }
        
        const uploadrefno = body.uploadrefno || '';
        const transtype = body.transtype === 3 ? 3 : 2;
        
        // Get current date and time
        const now = new Date();
        const transdate = now.toISOString().split('T')[0];
        const transtime = now.toTimeString().split(' ')[0];
        const timestamp = Math.floor(now.getTime() / 1000);
        
        // Get device's ccode from devSettings
        let ccode = '';
        let authorized = false;
        if (body.device_fingerprint) {
          const [deviceRows] = await conn.query(
            'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
            [body.device_fingerprint]
          );
          if (deviceRows.length > 0) {
            ccode = deviceRows[0].ccode || '';
            authorized = deviceRows[0].authorized === 1;
          }
        }
        
        if (!authorized) {
          await conn.rollback();
          conn.release();
          return sendJSON(res, { success: false, error: 'Device not authorized' }, 403);
        }
        
        // clientFetch enforcement for Store/AI
        const requiredClientFetch = transtype;
        const [allowedRoutes] = await conn.query(
          'SELECT tcode FROM fm_tanks WHERE ccode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
          [ccode, requiredClientFetch]
        );
        
        if (allowedRoutes.length === 0) {
          const serviceName = transtype === 3 ? 'AI Services' : 'Store';
          await conn.rollback();
          conn.release();
          return sendJSON(res, { 
            success: false, 
            error: transtype === 3 ? 'AI_DISABLED' : 'STORE_DISABLED',
            message: `${serviceName} operations are not enabled for this company.` 
          }, 403);
        }
        
        // Use fm_tanks.tcode for route — prefer frontend-selected route_tcode if valid
        let storeRoute = '';
        if (body.route_tcode) {
          const [matchedRoute] = await conn.query(
            'SELECT tcode FROM fm_tanks WHERE ccode = ? AND tcode = ? AND IFNULL(clientFetch, 1) = ? LIMIT 1',
            [ccode, body.route_tcode, requiredClientFetch]
          );
          if (matchedRoute.length > 0) {
            storeRoute = matchedRoute[0].tcode.toString().trim();
          }
        }
        if (!storeRoute) {
          storeRoute = (allowedRoutes[0].tcode || '').toString().trim() || (body.route || '');
        }
        
        // Handle photo upload ONCE (shared by all items)
        let photoFilename = null;
        let photoDirectory = null;
        
        if (body.photo && typeof body.photo === 'string' && body.photo.startsWith('data:image/')) {
          try {
            const fs = require('fs');
            const path = require('path');
            
            const matches = body.photo.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
              const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, 'base64');
              
              const uploadsDir = path.join(__dirname, 'uploads', 'store-photos');
              const yearDir = String(now.getFullYear());
              const monthDir = String(now.getMonth() + 1).padStart(2, '0');
              const fullDir = path.join(uploadsDir, yearDir, monthDir);
              
              if (!fs.existsSync(fullDir)) {
                fs.mkdirSync(fullDir, { recursive: true });
              }
              
              // Use uploadrefno for batch photo filename
              photoFilename = `${uploadrefno}_${timestamp}.${ext}`;
              photoDirectory = `uploads/store-photos/${yearDir}/${monthDir}`;
              
              const filePath = path.join(fullDir, photoFilename);
              fs.writeFileSync(filePath, buffer);
              
              console.log(`📷 Batch photo saved: ${photoDirectory}/${photoFilename}`);
            }
          } catch (photoError) {
            console.error('❌ Batch photo upload error:', photoError);
            // Continue without photo
          }
        }
        
        console.log(`🛒 Batch sale: ${body.items.length} items, uploadrefno=${uploadrefno}`);
        
        const insertedRefs = [];
        const duplicateRefs = [];
        
        // Insert each item with its unique transrefno
        // Get season (CAN) from request body for consistency across all transaction types
        const seasonCAN = body.season || '';

        // v2.10.50: Coffee orgs must NEVER store AM/PM in session column.
        let batchOrgtype = 'D';
        try {
          const [orgRows] = await conn.query(
            'SELECT IFNULL(orgtype, "D") as orgtype FROM psettings WHERE cno = ? LIMIT 1',
            [ccode]
          );
          if (orgRows.length > 0) batchOrgtype = (orgRows[0].orgtype || 'D').toString().toUpperCase();
        } catch (e) { console.warn('[/api/sales/batch] orgtype lookup failed:', e?.message); }

        let batchSessionVal = (body.session_label || body.session || '').toString().trim();
        let batchSeasonVal  = (seasonCAN || '').toString().trim();
        if (batchOrgtype === 'C') {
          // v2.10.56: Authoritative SCODE resolution for legacy clients (e.g. v2.10.32)
          // Force session=CAN, prefer today's Buy SCODE for the same ccode (what the
          // operator actually used for produce), then sessions date-range, then sent.
          const sentScode    = (seasonCAN || '').toString().trim().toUpperCase();
          const sentDescript = (body.session_descript || batchSessionVal || '').toString().trim();
          let canonical = '';

          try {
            const [buyRows] = await conn.query(
              `SELECT TRIM(CAN) AS CAN
                 FROM transactions
                WHERE ccode = ?
                  AND Transtype = 1
                  AND CAST(transdate AS DATE) = CAST(? AS DATE)
                  AND CAN IS NOT NULL AND TRIM(CAN) <> ''
                ORDER BY transdate DESC, transtime DESC
                LIMIT 1`,
              [ccode, transdate]
            );
            if (buyRows.length && buyRows[0].CAN) canonical = String(buyRows[0].CAN).toUpperCase();
          } catch (e) { console.warn('[/api/sales/batch] coffee Buy-SCODE lookup failed:', e?.message); }

          if (!canonical) {
            try {
              const season = await findActiveSeason(ccode, transdate, conn);
              if (season && season.SCODE) canonical = String(season.SCODE).toUpperCase();
            } catch (e) { console.warn('[/api/sales/batch] coffee SCODE rescue failed:', e?.message); }
          }

          if (!canonical) canonical = (sentScode || sentDescript || '').toUpperCase();

          if (canonical && (sentScode !== canonical || batchSessionVal.toUpperCase() !== canonical)) {
            console.log(`[NORMALIZE] /api/sales/batch coffee: dev=${body.device_fingerprint || ''} session=${batchSessionVal} CAN=${sentScode} → ${canonical}`);
          }

          batchSessionVal = canonical;
          batchSeasonVal  = canonical;
          console.log('☕ /api/sales/batch coffee session normalization:', { sentScode, sentSession: body.session_label || body.session, canonical });
        }

        for (const item of body.items) {
          const transrefno = item.transrefno;
          const amount = (item.quantity || 0) * (item.price || 0);

          try {
            await conn.query(
              `INSERT INTO transactions 
                (transrefno, Uploadrefno, userId, clerk, deviceserial, memberno, route, weight, session, 
                 transdate, transtime, Transtype, processed, uploaded, ccode, ivat, iprice, 
                 amount, icode, CAN, time, capType, milk_session_id, photo_filename, photo_directory,
                 cowname, cowbreed, noofcalfs, aibreed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                transrefno,
                uploadrefno,
                body.user_id || body.sold_by || '', // userId (login user_id for tracking)
                body.sold_by || '',                 // clerk (display name/username)
                body.device_fingerprint || '',
                body.farmer_id || '',
                storeRoute,                         // route (from fm_tanks.tcode, fallback to body.route)
                toNumOrZero(item.quantity),
                batchSessionVal,                  // session (SCODE for coffee, label for dairy)
                transdate,
                transtime,
                toIntOrNull(transtype, 2),
                0,
                0,
                ccode,
                0,
                toNumOrZero(item.price),
                toNumOrZero(amount),
                item.item_code || '',
                batchSeasonVal,                   // v2.10.56: CAN (canonical SCODE for coffee, raw season for dairy)
                timestamp,
                0,
                0,                                // v2.12.7: milk_session_id is INT — 0, never ''
                photoFilename,  // Same photo for all items
                photoDirectory,
                item.cow_name || '',
                item.cow_breed || '',
                toIntOrNull(item.number_of_calves), // v2.12.7: noofcalfs is INT — 0, never ''
                item.other_details || ''
              ]
            );

            // Update stock balance only for newly inserted rows
            await conn.query(
              'UPDATE fm_items SET stockbal = stockbal - ? WHERE icode = ?',
              [item.quantity || 0, item.item_code]
            );

            insertedRefs.push(transrefno);
            console.log(`✅ Inserted item: ${transrefno} - ${item.item_code} x ${item.quantity}`);
          } catch (itemError) {
            const isDuplicateRef =
              itemError?.code === 'ER_DUP_ENTRY' &&
              String(itemError?.sqlMessage || itemError?.message || '').includes('idx_transrefno_unique');

            if (isDuplicateRef) {
              duplicateRefs.push(transrefno);
              console.warn(`⚠️ Duplicate item skipped (already synced): ${transrefno}`);
              continue;
            }

            throw itemError;
          }
        }
        
        await conn.commit();
        conn.release();

        // Update storeid/aiid counter in devSettings (same pattern as milk collection)
        if (body.device_fingerprint && insertedRefs.length > 0) {
          try {
            const maxTrnId = Math.max(...insertedRefs.map(ref => parseInt(ref.slice(-8), 10)));
            const typeId = uploadrefno ? parseInt(String(uploadrefno).slice(-8), 10) : 0;
            const counterField = transtype === 3 ? 'aiid' : 'storeid';
            if (!isNaN(maxTrnId)) {
              await pool.query(
                `UPDATE devSettings SET 
                  trnid = GREATEST(IFNULL(trnid, 0), ?),
                  ${counterField} = GREATEST(IFNULL(${counterField}, 0), ?)
                 WHERE uniquedevcode = ?`,
                [maxTrnId, typeId, body.device_fingerprint]
              );
              console.log(`📊 Batch: Updated devSettings: trnid=${maxTrnId}, ${counterField}=${typeId} for ${body.device_fingerprint}`);
            }
          } catch (counterErr) {
            console.error('⚠️ Failed to update batch sale counters in devSettings:', counterErr);
          }
        }

        const insertedCount = insertedRefs.length;
        const duplicateCount = duplicateRefs.length;
        const allWereDuplicates = insertedCount === 0 && duplicateCount > 0;
        
        return sendJSON(res, { 
          success: true, 
          message: allWereDuplicates
            ? `Batch already synced (${duplicateCount} duplicate item${duplicateCount === 1 ? '' : 's'})`
            : `Batch sale recorded: ${insertedCount} inserted, ${duplicateCount} duplicate`,
          uploadrefno,
          transrefnos: insertedRefs,
          duplicate_transrefnos: duplicateRefs,
          inserted_count: insertedCount,
          duplicate_count: duplicateCount,
          photo_saved: !!photoFilename,
          photo_path: photoFilename ? `${photoDirectory}/${photoFilename}` : null
        }, allWereDuplicates ? 200 : 201);
        
      } catch (error) {
        await conn.rollback();
        conn.release();
        throw error;
      }
    }

    // Background Photo Upload endpoint - for uploading photos after transaction is saved
    // This endpoint is called asynchronously and doesn't block the transaction
    if (path === '/api/photos/upload' && method === 'POST') {
      const body = await parseBody(req);
      
      if (!body.uploadrefno || !body.photo) {
        return sendJSON(res, { 
          success: false, 
          error: 'uploadrefno and photo are required' 
        }, 400);
      }
      
      try {
        const fs = require('fs');
        const pathModule = require('path');
        
        // Extract base64 data from data URL
        const matches = body.photo.match(/^data:image\/(\w+);base64,(.+)$/);
        if (!matches) {
          return sendJSON(res, { 
            success: false, 
            error: 'Invalid photo format' 
          }, 400);
        }
        
        const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        // Create directory structure: uploads/store-photos/YYYY/MM
        const now = new Date();
        const uploadsDir = pathModule.join(__dirname, 'uploads', 'store-photos');
        const yearDir = String(now.getFullYear());
        const monthDir = String(now.getMonth() + 1).padStart(2, '0');
        const fullDir = pathModule.join(uploadsDir, yearDir, monthDir);
        
        // Create directories if they don't exist
        if (!fs.existsSync(fullDir)) {
          fs.mkdirSync(fullDir, { recursive: true });
        }
        
        // Generate filename using uploadrefno
        const timestamp = Math.floor(now.getTime() / 1000);
        const photoFilename = `${body.uploadrefno}_${timestamp}.${ext}`;
        const photoDirectory = `uploads/store-photos/${yearDir}/${monthDir}`;
        
        // Write file
        const filePath = pathModule.join(fullDir, photoFilename);
        fs.writeFileSync(filePath, buffer);
        
        console.log(`📷 Background photo saved: ${photoDirectory}/${photoFilename}`);
        
        // Update ALL transaction records with this uploadrefno to include photo path
        await pool.query(
          `UPDATE transactions 
           SET photo_filename = ?, photo_directory = ? 
           WHERE Uploadrefno = ? AND (photo_filename IS NULL OR photo_filename = '')`,
          [photoFilename, photoDirectory, body.uploadrefno]
        );
        
        return sendJSON(res, { 
          success: true, 
          message: 'Photo uploaded',
          photo_filename: photoFilename,
          photo_directory: photoDirectory,
          photo_path: `${photoDirectory}/${photoFilename}`
        }, 201);
        
      } catch (error) {
        console.error('❌ Background photo upload error:', error);
        return sendJSON(res, { 
          success: false, 
          error: 'Failed to save photo' 
        }, 500);
      }
    }

    if (path === '/api/sales' && method === 'GET') {
      const { farmer_id, date_from, date_to, uniquedevcode, transtype } = parsedUrl.query;
      
      // Get device's ccode if uniquedevcode provided
      let ccode = null;
      if (uniquedevcode) {
        const [deviceRows] = await pool.query(
          'SELECT ccode FROM devSettings WHERE uniquedevcode = ?',
          [uniquedevcode]
        );
        if (deviceRows.length > 0) {
          ccode = deviceRows[0].ccode;
        }
      }
      
      // Support filtering by transtype: 2 = Store, 3 = AI, or both (default)
      let query = 'SELECT * FROM transactions WHERE Transtype IN (2, 3)';
      let params = [];
      
      if (transtype === '2') {
        query = 'SELECT * FROM transactions WHERE Transtype = 2';
      } else if (transtype === '3') {
        query = 'SELECT * FROM transactions WHERE Transtype = 3';
      }
      
      if (ccode !== null) { query += ' AND ccode = ?'; params.push(ccode); }
      if (farmer_id) { query += ' AND memberno = ?'; params.push(farmer_id); }
      if (date_from) { query += ' AND transdate >= ?'; params.push(date_from); }
      if (date_to) { query += ' AND transdate <= ?'; params.push(date_to); }
      query += ' ORDER BY transdate DESC, transtime DESC';
      const [rows] = await pool.query(query, params);
      
      // Map transactions fields back to frontend expected format
      // Including AI-specific fields (cowname, cowbreed, noofcalfs, aibreed)
      const mappedRows = rows.map(row => ({
        sale_ref: row.transrefno,
        transrefno: row.transrefno,
        uploadrefno: row.Uploadrefno,
        transtype: row.Transtype,
        farmer_id: row.memberno,
        item_code: row.icode,
        quantity: row.weight,
        price: row.iprice,
        amount: row.amount,
        sold_by: row.clerk,
        sale_date: `${row.transdate} ${row.transtime}`,
        device_fingerprint: row.deviceserial,
        // AI-specific fields (DB column → frontend field)
        cow_name: row.cowname || '',
        cow_breed: row.cowbreed || '',
        number_of_calves: row.noofcalfs || '',
        other_details: row.aibreed || '',
        // Photo fields
        photo_filename: row.photo_filename,
        photo_directory: row.photo_directory
      }));
      
      return sendJSON(res, { success: true, data: mappedRows });
    }

    // ==================== DEVICE IDENTITY RESOLUTION (v2.10.109) ====================
    // Server-bound identity recovery for reinstalled / cleared-data devices.
    // The client sends a hardware fingerprint bundle; we try to match an
    // existing approved_devices row by (in priority order):
    //   1. legacy device_fingerprint (back-compat — current behavior)
    //   2. SSAID  (Android Settings.Secure.ANDROID_ID — survives reinstall
    //              when the APK is signed with the same key and runs on the
    //              same user profile)
    //   3. SSAID + model + manufacturer (defensive 3-way match)
    // On hit we return the same payload shape as /api/devices/fingerprint/:fp,
    // including devcode/trnid/milkid/storeid/aiid from devSettings, so the
    // device rehydrates its original identity instead of being issued a
    // fresh one. On miss we return 404 and the client falls through to the
    // existing flow. Strictly additive — no existing endpoint touched.
    if (path === '/api/device/resolve-identity' && method === 'POST') {
      const body = await parseBody(req);
      const ssaid = body.ssaid ? String(body.ssaid).trim() : null;
      const model = body.model ? String(body.model).trim() : null;
      const manufacturer = body.manufacturer ? String(body.manufacturer).trim() : null;
      const osVersion = body.osVersion ? String(body.osVersion).trim() : null;
      const legacyFingerprint = body.legacyFingerprint ? String(body.legacyFingerprint).trim() : null;
      const ccodeHint = body.ccode ? String(body.ccode).trim().toUpperCase() : null;

      let matchedRow = null;
      let matchedBy = null;

      try {
        // 1. Try legacy fingerprint — back-compat, also covers normal logins
        if (legacyFingerprint) {
          const [rows] = await pool.query(
            'SELECT * FROM approved_devices WHERE device_fingerprint = ? LIMIT 1',
            [legacyFingerprint]
          );
          if (rows.length > 0) {
            matchedRow = rows[0];
            matchedBy = 'legacy_fingerprint';
          }
        }

        // 2. Try SSAID (the reinstall-recovery primary key). Optionally scoped
        //    by ccode hint when the client knows which company it belongs to.
        if (!matchedRow && ssaid) {
          try {
            // v2.10.111: ORDER BY approved DESC FIRST. Without this, a
            // freshly registered pending duplicate (created right after
            // clear-data) wins over the original approved row because it
            // has a newer last_seen_at. We always prefer the approved /
            // user-assigned row so counters are preserved.
            let rows;
            if (ccodeHint) {
              [rows] = await pool.query(
                `SELECT * FROM approved_devices
                   WHERE ssaid = ? AND UPPER(TRIM(IFNULL(ccode, ""))) = ?
                   ORDER BY approved DESC,
                            (CASE WHEN user_id IS NULL OR user_id = '' OR LOWER(user_id) = 'pending' THEN 1 ELSE 0 END) ASC,
                            last_seen_at DESC, id DESC
                   LIMIT 1`,
                [ssaid, ccodeHint]
              );
            } else {
              [rows] = await pool.query(
                `SELECT * FROM approved_devices
                   WHERE ssaid = ?
                   ORDER BY approved DESC,
                            (CASE WHEN user_id IS NULL OR user_id = '' OR LOWER(user_id) = 'pending' THEN 1 ELSE 0 END) ASC,
                            last_seen_at DESC, id DESC
                   LIMIT 1`,
                [ssaid]
              );
            }
            if (rows.length > 0) {
              matchedRow = rows[0];
              matchedBy = 'ssaid';
            }
          } catch (colErr) {
            // ER_BAD_FIELD_ERROR → migration not yet run. Silently fall through.
            if (colErr && colErr.code !== 'ER_BAD_FIELD_ERROR') {
              console.warn('[DEVICE][RESOLVE] ssaid lookup error:', colErr.message || colErr);
            }
          }
        }

        // 3. Defensive: SSAID + model + manufacturer 3-way match (guards
        //    against rare SSAID collisions after factory reset).
        if (!matchedRow && ssaid && model && manufacturer) {
          try {
            const [rows] = await pool.query(
              `SELECT * FROM approved_devices
                 WHERE ssaid = ? AND device_model = ? AND device_manufacturer = ?
                 ORDER BY approved DESC,
                          (CASE WHEN user_id IS NULL OR user_id = '' OR LOWER(user_id) = 'pending' THEN 1 ELSE 0 END) ASC,
                          last_seen_at DESC, id DESC
                 LIMIT 1`,
              [ssaid, model, manufacturer]
            );
            if (rows.length > 0) {
              matchedRow = rows[0];
              matchedBy = 'ssaid_model_manufacturer';
            }
          } catch (colErr) {
            if (colErr && colErr.code !== 'ER_BAD_FIELD_ERROR') {
              console.warn('[DEVICE][RESOLVE] 3-way lookup error:', colErr.message || colErr);
            }
          }
        }

        if (!matchedRow) {
          console.log(`[DEVICE][RESOLVE] miss — ssaid=${ssaid ? ssaid.substring(0, 8) + '…' : 'none'} legacy=${legacyFingerprint ? legacyFingerprint.substring(0, 8) + '…' : 'none'}`);
          return sendJSON(res, { success: false, error: 'Device not found' }, 404);
        }

        console.log(`[DEVICE][RESOLVE] hit by=${matchedBy} fp=${(matchedRow.device_fingerprint || '').substring(0, 12)}… ssaid=${ssaid ? ssaid.substring(0, 8) + '…' : 'none'}`);

        // Best-effort: update last_seen_at and merge SSAID/model/manufacturer
        // so subsequent matches widen. Swallow ER_BAD_FIELD_ERROR for hosts
        // that haven't run the v2.10.109 migration yet.
        try {
          const historyMerge = legacyFingerprint && legacyFingerprint !== matchedRow.device_fingerprint
            ? legacyFingerprint
            : null;
          await pool.query(
            `UPDATE approved_devices
               SET ssaid = IFNULL(ssaid, ?),
                   device_model = IFNULL(device_model, ?),
                   device_manufacturer = IFNULL(device_manufacturer, ?),
                   os_version = COALESCE(?, os_version),
                   last_seen_at = NOW(),
                   fingerprint_history = CASE
                     WHEN ? IS NULL THEN fingerprint_history
                     WHEN fingerprint_history IS NULL THEN ?
                     WHEN INSTR(fingerprint_history, ?) > 0 THEN fingerprint_history
                     ELSE CONCAT(fingerprint_history, ',', ?)
                   END
             WHERE id = ?`,
            [ssaid, model, manufacturer, osVersion,
             historyMerge, historyMerge, historyMerge, historyMerge,
             matchedRow.id]
          );
        } catch (upErr) {
          if (upErr && upErr.code !== 'ER_BAD_FIELD_ERROR') {
            console.warn('[DEVICE][RESOLVE] last_seen update error:', upErr.message || upErr);
          }
        }

        // Build the response in the same shape as /api/devices/fingerprint/:fp
        // so the client can use it as a drop-in. Pull devcode + counters from
        // devSettings keyed on the ORIGINAL device_fingerprint (which equals
        // uniquedevcode in this system).
        const recoveredFingerprint = matchedRow.device_fingerprint;
        const [devRows] = await pool.query(
          'SELECT uniquedevcode, ccode, devcode, trnid, milkid, storeid, aiid, authorized FROM devSettings WHERE uniquedevcode = ?',
          [recoveredFingerprint]
        );

        const deviceData = {
          ...matchedRow,
          authorized: devRows.length > 0 ? devRows[0].authorized : (matchedRow.approved ? 1 : 0),
          ccode: (devRows.length > 0 && devRows[0].ccode) ? devRows[0].ccode : (matchedRow.ccode || null),
          devcode: devRows.length > 0 ? devRows[0].devcode : null,
          trnid: devRows.length > 0 ? (devRows[0].trnid || 0) : 0,
          milkid: devRows.length > 0 ? (devRows[0].milkid || 0) : 0,
          storeid: devRows.length > 0 ? (devRows[0].storeid || 0) : 0,
          aiid: devRows.length > 0 ? (devRows[0].aiid || 0) : 0,
          resolved_by: matchedBy,
          resolved_fingerprint: recoveredFingerprint,
        };

        // Apply the same GREATEST(devSettings.trnid, MAX(transrefno)) self-heal
        // we use in /api/devices/fingerprint/:fp so a reinstalled device never
        // gets a counter lower than what's actually live in transactions.
        let lastTrnId = parseInt(deviceData.trnid, 10) || 0;
        if (deviceData.devcode) {
          try {
            const [lastRefRows] = await pool.query(
              `SELECT transrefno FROM transactions
                 WHERE transrefno LIKE ?
                 ORDER BY transrefno DESC LIMIT 1`,
              [`${deviceData.devcode}%`]
            );
            if (lastRefRows.length > 0 && lastRefRows[0].transrefno) {
              const txTrnId = parseInt(lastRefRows[0].transrefno.slice(-8), 10) || 0;
              if (txTrnId > lastTrnId) {
                console.log(`[DEVICE][RESOLVE] trnid self-heal ${lastTrnId} -> ${txTrnId} for ${deviceData.devcode}`);
                lastTrnId = txTrnId;
                try {
                  await pool.query(
                    'UPDATE devSettings SET trnid = GREATEST(IFNULL(trnid, 0), ?) WHERE uniquedevcode = ?',
                    [lastTrnId, recoveredFingerprint]
                  );
                } catch (healErr) {
                  console.warn('[DEVICE][RESOLVE] trnid heal failed:', healErr?.message || healErr);
                }
              }
            }
          } catch (txErr) {
            console.warn('[DEVICE][RESOLVE] trnid lookup failed:', txErr?.message || txErr);
          }
        }
        deviceData.trnid = lastTrnId;

        return sendJSON(res, { success: true, data: deviceData });
      } catch (e) {
        // Defensive: any unexpected error → 404 so client falls through to
        // the existing registration flow. NEVER block a reinstalled device.
        console.warn('[DEVICE][RESOLVE] unexpected error, returning miss:', e?.message || e);
        return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      }
    }

    // Devices endpoints
    if (path.startsWith('/api/devices/fingerprint/') && method === 'GET') {
      const fingerprint = decodeURIComponent(path.split('/')[4]);
      
      // First check approved_devices for registration data
      const [approvedRows] = await pool.query(
        'SELECT * FROM approved_devices WHERE device_fingerprint = ?',
        [fingerprint]
      );
      
      // Then check devSettings for authorization, company info, and device code
      const [devRows] = await pool.query(
        'SELECT uniquedevcode, ccode, devcode, trnid, milkid, storeid, aiid, authorized FROM devSettings WHERE uniquedevcode = ?',
        [fingerprint]
      );
      
      if (approvedRows.length === 0 && devRows.length === 0) {
        return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      }
      
      // Combine data from both tables
      const deviceData = {
        ...(approvedRows.length > 0 ? approvedRows[0] : {}),
        authorized: devRows.length > 0 ? devRows[0].authorized : 0,
        ccode: devRows.length > 0 && devRows[0].ccode ? devRows[0].ccode : (approvedRows[0]?.ccode || null),
        devcode: devRows.length > 0 ? devRows[0].devcode : null,
        trnid: devRows.length > 0 ? devRows[0].trnid : 0,
        milkid: devRows.length > 0 ? (devRows[0].milkid || 0) : 0,
        storeid: devRows.length > 0 ? (devRows[0].storeid || 0) : 0,
        aiid: devRows.length > 0 ? (devRows[0].aiid || 0) : 0
      };
      
      // Get company name and ALL settings from psettings if ccode exists
      let companyName = null;
      let cumulativeFrequencyStatus = 0;
      let appSettings = {
        printoptions: 1,
        chkroute: 1,
        rdesc: '', // Empty - will be populated from DB; frontend handles label logic
        stableopt: 0,
        sessprint: 0,
        autow: 0,
        online: 0,
        orgtype: 'D',
        printcumm: 0,
        zeroOpt: 0,
        sackTare: 1,
        sackEdit: 0,
        payments_active: 0
      };
      
      if (deviceData.ccode) {
        const [companyRows] = await pool.query(
          `SELECT 
            cname, 
            caddress,
            tel,
            email,
            cumulative_frequency_status,
            IFNULL(printOptions, 1) as printOptions,
            IFNULL(chkRoute, 1) as chkRoute,
            IFNULL(rdesc, '') as rdesc,
            IFNULL(stableOpt, 0) as stableOpt,
            IFNULL(sessPrint, 0) as sessPrint,
            IFNULL(AutoW, 0) as AutoW,
            IFNULL(onlinemode, 0) as onlinemode,
            IFNULL(orgtype, 'D') as orgtype,
            IFNULL(printcumm, 0) as printcumm,
            IFNULL(zeroopt, 0) as zeroopt,
            IFNULL(sackTare, 1) as sackTare,
            IFNULL(sackEdit, 0) as sackEdit,
            IFNULL(payments_active, 0) as payments_active
          FROM psettings WHERE cno = ?`,
          [deviceData.ccode]);
        
        if (companyRows.length > 0) {
          companyName = companyRows[0].cname;
          cumulativeFrequencyStatus = companyRows[0].cumulative_frequency_status || 0;
          const orgtype = companyRows[0].orgtype || 'D';
          appSettings = {
            printoptions: companyRows[0].printOptions,
            chkroute: companyRows[0].chkRoute,
            rdesc: companyRows[0].rdesc,
            stableopt: companyRows[0].stableOpt,
            sessprint: companyRows[0].sessPrint,
            autow: companyRows[0].AutoW,
            online: companyRows[0].onlinemode,
            orgtype: orgtype,
            printcumm: companyRows[0].printcumm,
            zeroOpt: companyRows[0].zeroopt,
            sackTare: companyRows[0].sackTare,
            sackEdit: companyRows[0].sackEdit,
            payments_active: companyRows[0].payments_active,
            // Derived labels from orgtype
            periodLabel: orgtype === 'C' ? 'Season' : 'Session',
            // Additional company info
            caddress: companyRows[0].caddress,
            tel: companyRows[0].tel,
            email: companyRows[0].email
          };
        }
      }
      
      // Always include company_name and ALL settings in response
      deviceData.company_name = companyName;
      deviceData.cumulative_frequency_status = cumulativeFrequencyStatus;
      deviceData.app_settings = appSettings;
      
      // Get last used trnid for this devcode for counter sync.
      // CRITICAL FIX (v2.10.70): Always cross-check devSettings.trnid against the
      // actual MAX(transrefno) tail in transactions. devSettings.trnid can become
      // stale (e.g. when offline syncs land but the counter UPDATE silently fails,
      // or when records are imported out-of-band). Returning a stale low trnid
      // causes the device to regenerate references that collide with existing
      // backend records (e.g. New: member=M0000 colliding with M03156).
      // We take the GREATEST of the two so the counter never goes backwards.
      let lastTrnId = parseInt(deviceData.trnid, 10) || 0;
      if (deviceData.devcode) {
        try {
          const [lastRefRows] = await pool.query(
            `SELECT transrefno FROM transactions 
             WHERE transrefno LIKE ? 
             ORDER BY transrefno DESC LIMIT 1`,
            [`${deviceData.devcode}%`]
          );
          if (lastRefRows.length > 0 && lastRefRows[0].transrefno) {
            const lastRef = lastRefRows[0].transrefno;
            // Extract trnid using last 8 digits to avoid clientFetch corruption
            const txTrnId = parseInt(lastRef.slice(-8), 10) || 0;
            if (txTrnId > lastTrnId) {
              console.log(`🔧 [TRNID-SYNC] devSettings.trnid (${lastTrnId}) is stale for ${deviceData.devcode}; using transactions MAX (${txTrnId})`);
              lastTrnId = txTrnId;
              // Self-heal: persist the corrected trnid back to devSettings so
              // future calls (and counter-update statements) start from a sane base.
              try {
                await pool.query(
                  'UPDATE devSettings SET trnid = GREATEST(IFNULL(trnid, 0), ?) WHERE uniquedevcode = ?',
                  [lastTrnId, fingerprint]
                );
              } catch (healErr) {
                console.warn('⚠️ [TRNID-SYNC] Failed to self-heal devSettings.trnid:', healErr?.message || healErr);
              }
            }
          }
        } catch (txErr) {
          console.warn('⚠️ [TRNID-SYNC] transactions MAX lookup failed:', txErr?.message || txErr);
        }
      }
      deviceData.trnid = lastTrnId;
      
      return sendJSON(res, { success: true, data: deviceData });
    }

    if (path.startsWith('/api/devices/') && method === 'GET' && path.split('/').length === 4) {
      const deviceId = path.split('/')[3];
      const [rows] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [deviceId]);
      if (rows.length === 0) return sendJSON(res, { success: false, error: 'Device not found' }, 404);
      return sendJSON(res, { success: true, data: rows[0] });
    }

    if (path === '/api/devices' && method === 'GET') {
      const [rows] = await pool.query('SELECT * FROM approved_devices ORDER BY created_at DESC');
      return sendJSON(res, { success: true, data: rows });
    }

    if (path === '/api/devices' && method === 'POST') {
      const body = await parseBody(req);

      // v2.10.111: STABLE IDENTITY GUARD on registration.
      // If the device sends an ssaid that already maps to an approved row,
      // return that row instead of inserting a fresh pending duplicate.
      // Prevents reinstalled / cleared-data devices from generating a new
      // fingerprint and silently breaking trnid/milkid continuity.
      const regSsaid = body.ssaid ? String(body.ssaid).trim() : null;
      if (regSsaid) {
        try {
          const [hwRows] = await pool.query(
            `SELECT * FROM approved_devices
               WHERE ssaid = ?
               ORDER BY approved DESC,
                        (CASE WHEN user_id IS NULL OR user_id = '' OR LOWER(user_id) = 'pending' THEN 1 ELSE 0 END) ASC,
                        last_seen_at DESC, id DESC
               LIMIT 1`,
            [regSsaid]
          );
          if (hwRows.length > 0 && hwRows[0].approved) {
            const recovered = hwRows[0];
            console.log(`[DEVICE][REGISTER] ssaid match → reusing approved row id=${recovered.id} fp=${(recovered.device_fingerprint || '').substring(0, 12)}…`);
            // Best-effort: log the new fingerprint into history
            try {
              const newFp = body.device_fingerprint || null;
              if (newFp && newFp !== recovered.device_fingerprint) {
                await pool.query(
                  `UPDATE approved_devices
                     SET last_seen_at = NOW(),
                         fingerprint_history = CASE
                           WHEN fingerprint_history IS NULL THEN ?
                           WHEN INSTR(fingerprint_history, ?) > 0 THEN fingerprint_history
                           ELSE CONCAT(fingerprint_history, ',', ?)
                         END
                     WHERE id = ?`,
                  [newFp, newFp, newFp, recovered.id]
                );
              }
            } catch (histErr) {
              if (histErr && histErr.code !== 'ER_BAD_FIELD_ERROR') {
                console.warn('[DEVICE][REGISTER] history merge failed:', histErr.message || histErr);
              }
            }
            const [devRows] = await pool.query(
              'SELECT devcode, trnid, milkid, storeid, aiid FROM devSettings WHERE uniquedevcode = ?',
              [recovered.device_fingerprint]
            );
            const deviceData = {
              ...recovered,
              devcode: devRows.length > 0 ? devRows[0].devcode : null,
              trnid: devRows.length > 0 ? (devRows[0].trnid || 0) : 0,
              milkid: devRows.length > 0 ? (devRows[0].milkid || 0) : 0,
              storeid: devRows.length > 0 ? (devRows[0].storeid || 0) : 0,
              aiid: devRows.length > 0 ? (devRows[0].aiid || 0) : 0,
              resolved_fingerprint: recovered.device_fingerprint,
              resolved_by: 'ssaid_register',
            };
            return sendJSON(res, { success: true, data: deviceData, message: 'Recovered original device identity' });
          }
        } catch (regHwErr) {
          if (regHwErr && regHwErr.code !== 'ER_BAD_FIELD_ERROR') {
            console.warn('[DEVICE][REGISTER] ssaid recovery error:', regHwErr.message || regHwErr);
          }
          // Fall through to normal registration
        }
      }

      const [existing] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [body.device_fingerprint]);
      
      if (existing.length > 0) {
        // Device exists - update last_sync and return
        try {
          await pool.query(
            'UPDATE approved_devices SET last_sync = NOW(), updated_at = NOW() WHERE device_fingerprint = ?',
            [body.device_fingerprint]
          );
        } catch (e) {
          // Backward compatibility: some databases may not have updated_at
          if (e && e.code === 'ER_BAD_FIELD_ERROR') {
            await pool.query(
              'UPDATE approved_devices SET last_sync = NOW() WHERE device_fingerprint = ?',
              [body.device_fingerprint]
            );
          } else {
            throw e;
          }
        }

        const [updated] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [body.device_fingerprint]);
        
        // Get devcode and trnid from devSettings
        const [devRows] = await pool.query(
          'SELECT devcode, trnid FROM devSettings WHERE uniquedevcode = ?',
          [body.device_fingerprint]
        );
        const deviceData = { 
          ...updated[0], 
          devcode: devRows.length > 0 ? devRows[0].devcode : null,
          trnid: devRows.length > 0 ? devRows[0].trnid : 0
        };
        
        return sendJSON(res, { success: true, data: deviceData, message: 'Device already registered' });
      } else {
        // Check if device exists in devSettings to get ccode and devcode
        const [devRows] = await pool.query(
          'SELECT ccode, devcode, trnid FROM devSettings WHERE uniquedevcode = ?',
          [body.device_fingerprint]
        );
        const ccode = devRows.length > 0 ? devRows[0].ccode : null;
        const devcode = devRows.length > 0 ? devRows[0].devcode : null;
        const trnid = devRows.length > 0 ? devRows[0].trnid : 0;

        // If device not in devSettings, create a minimal record.
        // v2.12.6: devsettings on Contabo is NOT NULL — never write NULL/empty
        // for uniquedevcode or device; fall back to the '000' placeholder.
        if (devRows.length === 0) {
          try {
            const safeUniqueDevCode = String(body.device_fingerprint || '').trim() || '000';
            const safeDeviceLabel = String(body.device_info || body.model || '').trim() || '000';
            await pool.query(
              'INSERT INTO devSettings (uniquedevcode, device, authorized, trnid) VALUES (?, ?, 0, 0)',
              [safeUniqueDevCode, safeDeviceLabel]
            );

            console.log('📱 Created devSettings record for fingerprint:', body.device_fingerprint.substring(0, 16) + '...');
          } catch (insertError) {
            // Ignore duplicate key errors - device might have been added by another process
            if (insertError.code !== 'ER_DUP_ENTRY') {
              console.error('❌ Failed to create devSettings record:', insertError);
            }
          }
        }

        // Insert new device - ALWAYS set approved to FALSE for new devices
        // v2.10.111: also persist hardware identifiers (ssaid/model/manufacturer/osVersion)
        // so the next reinstall can recover this row via /api/device/resolve-identity.
        const regModel = body.model ? String(body.model).trim() : null;
        const regManufacturer = body.manufacturer ? String(body.manufacturer).trim() : null;
        const regOsVersion = body.osVersion ? String(body.osVersion).trim() : null;
        let result;
        try {
          try {
            // Newest schema (with hardware identity columns)
            [result] = await pool.query(
              `INSERT INTO approved_devices
                 (device_fingerprint, user_id, approved, device_info, last_sync, ccode,
                  ssaid, device_model, device_manufacturer, os_version, last_seen_at,
                  created_at, updated_at)
               VALUES (?, ?, FALSE, ?, NOW(), ?, ?, ?, ?, ?, NOW(), NOW(), NOW())`,
              [body.device_fingerprint, body.user_id, body.device_info || null, ccode,
               regSsaid, regModel, regManufacturer, regOsVersion]
            );
          } catch (e) {
            if (e && e.code === 'ER_BAD_FIELD_ERROR') {
              // Migration not run — fallback to schema without hw columns
              try {
                [result] = await pool.query(
                  'INSERT INTO approved_devices (device_fingerprint, user_id, approved, device_info, last_sync, ccode, created_at, updated_at) VALUES (?, ?, FALSE, ?, NOW(), ?, NOW(), NOW())',
                  [body.device_fingerprint, body.user_id, body.device_info || null, ccode]
                );
              } catch (e2) {
                if (e2 && e2.code === 'ER_BAD_FIELD_ERROR') {
                  [result] = await pool.query(
                    'INSERT INTO approved_devices (device_fingerprint, user_id, approved, device_info, last_sync) VALUES (?, ?, FALSE, ?, NOW())',
                    [body.device_fingerprint, body.user_id, body.device_info || null]
                  );
                } else {
                  throw e2;
                }
              }
            } else {
              throw e;
            }
          }
        } catch (insertErr) {
          // v2.12.2: concurrent registration race — another request inserted the
          // same fingerprint between our SELECT and INSERT. Treat as idempotent
          // success instead of a 500 so login never breaks on a duplicate.
          if (insertErr && insertErr.code === 'ER_DUP_ENTRY') {
            console.warn('[DEVICE][REGISTER] duplicate fingerprint race — returning existing row:', String(body.device_fingerprint).substring(0, 16) + '…');
            const [dupRows] = await pool.query('SELECT * FROM approved_devices WHERE device_fingerprint = ?', [body.device_fingerprint]);
            if (dupRows.length > 0) {
              const [dupDev] = await pool.query(
                'SELECT devcode, trnid, milkid, storeid, aiid FROM devSettings WHERE uniquedevcode = ?',
                [body.device_fingerprint]
              );
              const dupData = {
                ...dupRows[0],
                devcode: dupDev.length > 0 ? dupDev[0].devcode : devcode,
                trnid: dupDev.length > 0 ? (dupDev[0].trnid || 0) : trnid,
                milkid: dupDev.length > 0 ? (dupDev[0].milkid || 0) : 0,
                storeid: dupDev.length > 0 ? (dupDev[0].storeid || 0) : 0,
                aiid: dupDev.length > 0 ? (dupDev[0].aiid || 0) : 0,
              };
              return sendJSON(res, { success: true, data: dupData, message: 'Device already registered' });
            }
          }
          throw insertErr;
        }
        const [newDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [result.insertId]);
        
        // Include devcode and trnid in response
        const deviceData = { ...newDevice[0], devcode: devcode, trnid: trnid };
        
        return sendJSON(res, { success: true, data: deviceData, message: 'Device registered' }, 201);

      }
    }

    if (path.startsWith('/api/devices/') && path.endsWith('/approve') && method === 'PUT') {
      const deviceId = path.split('/')[3];
      const body = await parseBody(req);
      const updates = ['approved = ?', 'updated_at = NOW()'];
      const values = [body.approved !== undefined ? body.approved : true];
      
      if (body.approved_at) {
        updates.push('approved_at = ?');
        values.push(body.approved_at);
      }
      
      values.push(deviceId);
      await pool.query(`UPDATE approved_devices SET ${updates.join(', ')} WHERE id = ?`, values);
      const [updatedDevice] = await pool.query('SELECT * FROM approved_devices WHERE id = ?', [deviceId]);
      return sendJSON(res, { success: true, data: updatedDevice[0], message: 'Device approval status updated' });
    }

    if (path.startsWith('/api/devices/') && method === 'PUT') {
      const deviceId = path.split('/')[3];
      const body = await parseBody(req);
      const updates = ['last_sync = NOW()', 'updated_at = NOW()'];
      const values = [];
      // ONLY allow updating user_id and device_info - NEVER approved status
      if (body.user_id) { updates.push('user_id = ?'); values.push(body.user_id); }
      if (body.device_info) { updates.push('device_info = ?'); values.push(body.device_info); }
      values.push(deviceId);
      await pool.query(`UPDATE approved_devices SET ${updates.join(', ')} WHERE id = ?`, values);
      return sendJSON(res, { success: true, message: 'Device synced' });
    }

    if (path.startsWith('/api/devices/') && method === 'DELETE') {
      const deviceId = path.split('/')[3];
      await pool.query('DELETE FROM approved_devices WHERE id = ?', [deviceId]);
      return sendJSON(res, { success: true, message: 'Device deleted' });
    }

    // SMS Configuration endpoints
    if (path === '/api/sms/config' && method === 'GET') {
      const ccode = parsedUrl.query.ccode;
      
      if (!ccode) {
        return sendJSON(res, { success: false, error: 'ccode is required' }, 400);
      }
      
      const [rows] = await pool.query(
        'SELECT * FROM sms_config WHERE ccode = ?',
        [ccode]
      );
      
      // Return sms_enabled status (default to false if not found)
      const smsEnabled = rows.length > 0 ? rows[0].sms_enabled : false;
      
      return sendJSON(res, { 
        success: true, 
        data: { ccode, sms_enabled: smsEnabled } 
      });
    }

    if (path === '/api/sms/config' && method === 'POST') {
      const body = await parseBody(req);
      const { ccode, sms_enabled } = body;
      
      if (!ccode) {
        return sendJSON(res, { success: false, error: 'ccode is required' }, 400);
      }
      
      // Insert or update SMS config
      await pool.query(
        `INSERT INTO sms_config (ccode, sms_enabled) 
         VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE sms_enabled = ?, updated_at = NOW()`,
        [ccode, sms_enabled !== false, sms_enabled !== false]
      );
      
      return sendJSON(res, { 
        success: true, 
        message: 'SMS configuration updated' 
      });
    }

    // SMS Send endpoint
    if (path === '/api/sms/send' && method === 'POST') {
      const body = await parseBody(req);
      const { phone, message, ccode } = body;
      
      if (!phone || !message) {
        return sendJSON(res, { 
          success: false, 
          error: 'phone and message are required' 
        }, 400);
      }
      
      // Check if SMS is enabled for this ccode
      if (ccode) {
        const [configRows] = await pool.query(
          'SELECT sms_enabled FROM sms_config WHERE ccode = ?',
          [ccode]
        );
        
        if (configRows.length === 0 || !configRows[0].sms_enabled) {
          return sendJSON(res, { 
            success: false, 
            message: 'SMS not enabled for this company' 
          }, 403);
        }
      }
      
      // Get API key from environment
      const apiKey = process.env.SAVVY_BULK_SMS_API_KEY;
      
      if (!apiKey) {
        return sendJSON(res, { 
          success: false, 
          error: 'SMS API key not configured' 
        }, 500);
      }
      
      // Send SMS via Savvy Bulk SMS API
      try {
        const https = require('https');
        const postData = JSON.stringify({
          partnerID: '7878',
          apikey: apiKey,
          pass_type: 'plain',
          clientsmsid: Date.now().toString(),
          mobile: phone,
          message: message,
          shortcode: 'POLYTANO'
        });
        
        const options = {
          hostname: 'sms.textsms.co.ke',
          port: 443,
          path: '/api/services/sendsms/',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        
        const smsResponse = await new Promise((resolve, reject) => {
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ success: false, error: 'Invalid response from SMS provider' });
              }
            });
          });
          
          req.on('error', (e) => {
            reject(e);
          });
          
          req.write(postData);
          req.end();
        });
        
        return sendJSON(res, { 
          success: true, 
          message: 'SMS sent successfully',
          response: smsResponse 
        });
        
      } catch (error) {
        // SECURITY (v2.10.83): suppress upstream error details from client response.
        console.error('SMS Error:', error);
        return sendJSON(res, {
          success: false,
          error: 'Failed to send SMS'
        }, 500);
      }
    }

    // psettings endpoint - Get company settings (ALL behavior switches)
    // REQUIRES device to be authorized in devSettings table
    if (path === '/api/psettings' && method === 'GET') {
      const ccode = parsedUrl.query.ccode;
      const uniquedevcode = parsedUrl.query.uniquedevcode;
      
      let targetCcode = ccode;
      
      // If uniquedevcode provided, verify device is authorized first
      if (!targetCcode && uniquedevcode) {
        const [deviceRows] = await pool.query(
          'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
          [uniquedevcode]
        );
        
        if (deviceRows.length === 0) {
          return sendJSON(res, { success: false, error: 'Device not found' }, 404);
        }
        
        if (!deviceRows[0].authorized || deviceRows[0].authorized !== 1) {
          return sendJSON(res, { success: false, message: 'Device not authorized' }, 401);
        }
        
        targetCcode = deviceRows[0].ccode;
      }
      
      if (!targetCcode) {
        return sendJSON(res, { success: false, error: 'ccode or uniquedevcode is required' }, 400);
      }
      
      const [rows] = await pool.query(
        `SELECT 
          cno AS ccode,
          cname as company_name,
          caddress,
          tel,
          email,
          cumulative_frequency_status,
          IFNULL(printOptions, 1) as printOptions,
          IFNULL(chkRoute, 1) as chkRoute,
          IFNULL(rdesc, 'Route') as rdesc,
          IFNULL(stableOpt, 0) as stableOpt,
          IFNULL(sessPrint, 0) as sessPrint,
          IFNULL(AutoW, 0) as AutoW,
          IFNULL(onlinemode, 0) as onlinemode,
          IFNULL(orgtype, 'D') as orgtype,
          IFNULL(printcumm, 0) as printcumm,
          IFNULL(zeroopt, 0) as zeroopt,
          IFNULL(payments_active, 0) as payments_active
        FROM psettings WHERE cno = ?`,
        [targetCcode]
      );
      
      if (rows.length === 0) {
        return sendJSON(res, { 
          success: true, 
          data: { 
            ccode: targetCcode,
            company_name: null,
            caddress: null,
            tel: null,
            email: null,
            cumulative_frequency_status: 0,
            printoptions: 1,
            chkroute: 1,
            rdesc: 'Route',
            stableopt: 0,
            sessprint: 0,
            autow: 0,
            online: 0,
            orgtype: 'D',
            periodLabel: 'Session',
            printcumm: 0,
            zeroOpt: 0,
            payments_active: 0
          } 
        });
      }
      
      const orgtype = rows[0].orgtype || 'D';
      return sendJSON(res, { 
        success: true, 
        data: {
          ccode: rows[0].ccode,
          company_name: rows[0].company_name,
          caddress: rows[0].caddress,
          tel: rows[0].tel,
          email: rows[0].email,
          cumulative_frequency_status: rows[0].cumulative_frequency_status || 0,
          printoptions: rows[0].printOptions,
          chkroute: rows[0].chkRoute,
          rdesc: rows[0].rdesc,
          stableopt: rows[0].stableOpt,
          sessprint: rows[0].sessPrint,
          autow: rows[0].AutoW,
          online: rows[0].onlinemode,
          orgtype: orgtype,
          periodLabel: orgtype === 'C' ? 'Season' : 'Session',
          printcumm: rows[0].printcumm,
          zeroOpt: rows[0].zeroopt,
          payments_active: rows[0].payments_active
        }
      });
    }

    // ==================== BATCH CUMULATIVE ENDPOINT ====================
    // Returns cumulative weights for ALL farmers under a device's ccode in ONE query
    if (path === '/api/farmer-monthly-frequency-batch' && method === 'GET') {
      const { uniquedevcode, route } = parsedUrl.query;
      
      if (!uniquedevcode) {
        return sendJSON(res, { 
          success: false, 
          error: 'uniquedevcode is required' 
        }, 400);
      }

      // v2.12.10: only refuse when the wait queue is genuinely long. The old
      // `saturated` gate fired on almost every request on Contabo, so the
      // endpoint never reached the cache/warm path and stayed "pending" forever.
      {
        const pp = poolPressure();
        if (pp.queued > 30) {
          console.warn(`[CUM:BATCH] 503 pool queue deep inUse=${pp.inUse} free=${pp.free} queued=${pp.queued}`);
          res.setHeader('Retry-After', '10');
          return sendJSON(res, {
            success: false,
            error: 'Service temporarily unavailable (database busy)',
            retry_after: 10
          }, 503);
        }
      }

      

      
      // Get device's ccode
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devSettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      const toYmdLocal = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const now = new Date();
      let periodStart = toYmdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
      let periodEnd = toYmdLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      
      // For coffee orgs (orgtype=C), use the active session/season date range
      // instead of calendar month, so transactions from the entire season are included
      try {
        const [orgRows] = await pool.query(
          `SELECT IFNULL(orgtype, 'D') as orgtype FROM psettings WHERE TRIM(cno) = TRIM(?) LIMIT 1`, [ccode]
        );
        if (orgRows.length > 0 && orgRows[0].orgtype === 'C') {
          const today = toYmdLocal(now);
          // v2.12.6: allow an explicit season (SCODE) so the app can show
          // cumulative totals for a PAST season, not only the active one.
          let season = null;
          const requestedSeason = String(parsedUrl.query.season || '').trim();
          if (requestedSeason) {
            try {
              const [sRows] = await pool.query(
                `SELECT SCODE, datefrom, dateto FROM Seasons
                 WHERE TRIM(ccode) = TRIM(?) AND TRIM(SCODE) = TRIM(?) LIMIT 1`,
                [ccode, requestedSeason]
              );
              if (sRows.length > 0) season = sRows[0];
              else console.log(`⚠️ Requested season ${requestedSeason} not found for ccode=${ccode}`);
            } catch (e) {
              console.log('⚠️ Season lookup failed:', e.message);
            }
          }
          if (!season) season = await findActiveSeason(ccode, today);
          if (season) {
            const ymd = (v) => (typeof v === 'string' ? v.slice(0, 10) : toYmdLocal(new Date(v)));
            periodStart = ymd(season.datefrom);
            periodEnd = ymd(season.dateto);
            console.log(`📊 Batch cumulative using season range: ${periodStart} to ${periodEnd}`);
          } else {
            console.log(`⚠️ No active season found for ccode=${ccode} on ${today}, falling back to monthly range`);
          }
        }
      } catch (e) {
        console.log('⚠️ Could not detect orgtype for cumulative, using monthly range:', e.message);
      }

      
      // v2.12.6: CACHE-SERVING ENDPOINT. The heavy season-wide scan lives in
      // the background warmer (computeCumulativeBatch) — identical SQL, just
      // never inside a client request. A miss returns immediately with
      // pending:true so login/prewarm completes in milliseconds; the client
      // keeps its IndexedDB cumulative cache untouched and retries.
      const cumCacheKey = cumulativeCacheKey(ccode, route, periodStart, periodEnd);
      const cachedBatch = cumulativeBatchCache.get(cumCacheKey);

      // Always register the key so the warmer keeps this snapshot fresh.
      const warmMeta = cumulativeWarmKeys.get(cumCacheKey);
      const stale = !warmMeta || (Date.now() - (warmMeta.lastRun || 0)) >= CUM_BATCH_REWARM_MS;

      if (cachedBatch) {
        if (stale) scheduleCumulativeWarm(ccode, route, periodStart, periodEnd);
        console.log(`[CUM:BATCH] cache-hit ${cumCacheKey} farmers=${cachedBatch.total_farmers}`);
        return sendJSON(res, { success: true, data: cachedBatch });
      }

      // v2.12.10: on a cold miss, kick the warm AND wait a bounded 12 s for it.
      // Most snapshots finish inside that window, so the client gets real data
      // on the first call instead of looping on `pending` indefinitely.
      const warmJob = scheduleCumulativeWarm(ccode, route, periodStart, periodEnd);
      if (warmJob) {
        const waited = await Promise.race([
          warmJob.catch(() => null),
          new Promise((resolve) => setTimeout(() => resolve(undefined), 12000))
        ]);
        if (waited) {
          console.log(`[CUM:BATCH] warm-served ${cumCacheKey} farmers=${waited.total_farmers}`);
          return sendJSON(res, { success: true, data: waited });
        }
      }

      console.log(`[CUM:BATCH] pending (warming) ${cumCacheKey}`);
      return sendJSON(res, {
        success: true,
        pending: true,
        retry_after: 15,
        data: {
          farmers: [],
          month_start: periodStart,
          month_end: periodEnd,
          total_farmers: 0,
          snapshot_max_id: 0,
          pending: true
        }
      });


    }

    // Farmer monthly cumulative frequency endpoint
    // Returns the count of collections for a farmer in the current month
    if (path === '/api/farmer-monthly-frequency' && method === 'GET') {
      const { farmer_id, uniquedevcode, route } = parsedUrl.query;
      
      if (!farmer_id || !uniquedevcode) {
        return sendJSON(res, { 
          success: false, 
          error: 'farmer_id and uniquedevcode are required' 
        }, 400);
      }
      
      // Get device's ccode
      const [deviceRows] = await pool.query(
        'SELECT ccode FROM devSettings WHERE uniquedevcode = ? AND authorized = 1',
        [uniquedevcode]
      );
      
      if (deviceRows.length === 0) {
        return sendJSON(res, { 
          success: false, 
          error: 'Device not authorized' 
        }, 401);
      }
      
      const ccode = deviceRows[0].ccode;
      
      // Get period start and end dates (LOCAL date, not UTC)
      const toYmdLocal = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const now = new Date();
      let periodStart = toYmdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
      let periodEnd = toYmdLocal(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      
      // For coffee orgs, use active season date range instead of calendar month
      try {
        const [orgRows] = await pool.query(
          `SELECT IFNULL(orgtype, 'D') as orgtype FROM psettings WHERE TRIM(cno) = TRIM(?) LIMIT 1`, [ccode]
        );
        if (orgRows.length > 0 && orgRows[0].orgtype === 'C') {
          const today = toYmdLocal(now);
          const activeSeason = await findActiveSeason(ccode, today);
          if (activeSeason) {
            periodStart = activeSeason.datefrom;
            periodEnd = activeSeason.dateto;
            console.log(`📊 Individual cumulative for ${farmer_id} using season range: ${periodStart} to ${periodEnd}`);
          } else {
            console.log(`⚠️ No active season found for ccode=${ccode} on ${today}, falling back to monthly range`);
          }
        }
      } catch (e) {
        console.log('⚠️ Could not detect orgtype for individual cumulative, using monthly range:', e.message);
      }
      
      // Total weight for this farmer (v2.10.72: UPPER+TRIM normalization)
      const indRouteFilter = route ? ' AND UPPER(TRIM(route)) = UPPER(TRIM(?))' : '';
      const indParams = route ? [farmer_id, ccode, periodStart, periodEnd, route] : [farmer_id, ccode, periodStart, periodEnd];
      
      const [sumRows] = await pool.query(
        `SELECT IFNULL(SUM(weight), 0) as cumulative_weight 
         FROM transactions 
         WHERE UPPER(TRIM(memberno)) = UPPER(TRIM(?)) AND UPPER(TRIM(ccode)) = UPPER(TRIM(?)) AND CAST(Transtype AS UNSIGNED) = 1
         AND CAST(transdate AS DATE) BETWEEN ? AND ?${indRouteFilter}`,
        indParams
      );
      
      // Per-product breakdown for this farmer
      const indTRouteFilter = route ? ' AND UPPER(TRIM(t.route)) = UPPER(TRIM(?))' : '';
      const indTParams = route ? [farmer_id, ccode, periodStart, periodEnd, route] : [farmer_id, ccode, periodStart, periodEnd];
      
      const [productRows] = await pool.query(
        `SELECT TRIM(t.icode) as icode, 
                IFNULL(MAX(fi.descript), ANY_VALUE(TRIM(t.icode))) as product_name,
                IFNULL(SUM(t.weight), 0) as weight 
         FROM transactions t
         LEFT JOIN fm_items fi ON UPPER(TRIM(fi.icode)) = UPPER(TRIM(t.icode)) AND UPPER(TRIM(fi.ccode)) = UPPER(TRIM(t.ccode))
         WHERE UPPER(TRIM(t.memberno)) = UPPER(TRIM(?)) AND UPPER(TRIM(t.ccode)) = UPPER(TRIM(?)) AND CAST(t.Transtype AS UNSIGNED) = 1
         AND CAST(t.transdate AS DATE) BETWEEN ? AND ?${indTRouteFilter}
         GROUP BY TRIM(t.icode)`,
        indTParams
      );
      
      const cumulativeWeight = sumRows.length > 0 ? parseFloat(sumRows[0].cumulative_weight) || 0 : 0;
      const byProduct = productRows.map(r => ({
        icode: r.icode || '',
        product_name: r.product_name || r.icode || '',
        weight: parseFloat(r.weight) || 0
      }));
      
      return sendJSON(res, { 
        success: true, 
        data: {
          farmer_id,
          cumulative_weight: cumulativeWeight,
          by_product: byProduct,
          month_start: periodStart,
          month_end: periodEnd
        }
      });
    }

    // Authentication endpoints
    if (path === '/api/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const { userid, password, device_fingerprint } = body;
      
      console.log('🔐 Login attempt:', { userid, passwordLength: password?.length, hasFp: !!device_fingerprint });
      
      if (!userid || !password) {
        return sendJSON(res, { 
          success: false, 
          error: 'userid and password are required' 
        }, 400);
      }
      
      // v2.10.105 — Multi-tenant login resolution.
      // The (userid, password) pair is NOT unique across companies: the same
      // operator may exist under multiple ccodes. When the client sends a
      // device_fingerprint we know which company this device belongs to, so
      // we scope the user lookup by the device's ccode first. This prevents
      // MySQL from returning an arbitrary same-credential row from another
      // company and then triggering the "Access denied" guard below.
      let deviceCcode = '';
      if (device_fingerprint) {
        try {
          const [devRows] = await pool.query(
            'SELECT ccode FROM devSettings WHERE uniquedevcode = ? LIMIT 1',
            [String(device_fingerprint).trim()]
          );
          deviceCcode = (devRows[0]?.ccode || '').toString().trim();
        } catch (ccodeErr) {
          // Never block login on an unexpected lookup failure — log and continue.
          console.warn('[AUTH][CCODE] device ccode lookup failed:', ccodeErr?.message);
        }
      }

      // Scoped lookup: userid + password + device's ccode (when known).
      let rows = [];
      if (deviceCcode) {
        const [scoped] = await pool.query(
          'SELECT * FROM Users WHERE TRIM(userid) = ? AND TRIM(password) = ? AND UPPER(TRIM(ccode)) = UPPER(?) LIMIT 1',
          [userid.trim(), password.trim(), deviceCcode]
        );
        rows = scoped;
        if (rows.length > 0) {
          console.log(`[AUTH][CCODE] scoped match userid=${userid.trim()} ccode=${deviceCcode.toUpperCase()}`);
        }
      }

      // Legacy / fallback lookup: userid + password only. Used when no
      // device_fingerprint is supplied (older clients) OR when the scoped
      // lookup found nothing (so we can still emit a precise error — either
      // "Invalid credentials" or the existing cross-company "Access denied").
      if (rows.length === 0) {
        const [legacy] = await pool.query(
          'SELECT * FROM Users WHERE TRIM(userid) = ? AND TRIM(password) = ?',
          [userid.trim(), password.trim()]
        );
        rows = legacy;
      }
      
      console.log('🔍 Query result:', rows.length > 0 ? 'User found' : 'No match');
      
      if (rows.length === 0) {
        // Debug: Check if user exists
        const [userCheck] = await pool.query(
          'SELECT userid, LENGTH(password) as pwd_len FROM Users WHERE TRIM(userid) = ?',
          [userid.trim()]
        );
        
        if (userCheck.length > 0) {
          console.log('⚠️ User exists but password mismatch. Password length in DB:', userCheck[0].pwd_len);
        } else {
          console.log('⚠️ User not found in database');
        }
        
        return sendJSON(res, { 
          success: false, 
          error: 'Invalid credentials' 
        }, 401);
      }
      
      const user = rows[0];

      // v2.10.97 — STRICT COMPANY ISOLATION (additive, backward compatible).
      // Still enforced as a defense-in-depth check: if the scoped lookup
      // returned a matching row this is a no-op; if we fell back to the
      // legacy lookup and the matched row's ccode does not equal the device's
      // ccode, we reject (genuine cross-company access attempt).
      if (device_fingerprint && deviceCcode) {
        const userCcode = (user.ccode || '').toString().trim().toUpperCase();
        const devCcodeU = deviceCcode.toUpperCase();
        if (userCcode && devCcodeU !== userCcode) {
          console.warn(`[AUTH][CCODE] Mismatch user=${userCcode} device=${devCcodeU}`);
          return sendJSON(res, {
            success: false,
            error: 'Access denied. Your account is restricted to your assigned company.'
          }, 403);
        }
      }



      
      // Helper to convert MySQL bit/tinyint to boolean
      const toBool = (value) => {
        if (value === null || value === undefined) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        if (Buffer.isBuffer(value)) return value[0] === 1;
        if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
        return Boolean(value);
      };
      
      // Helper to parse supervisor mode as integer (0-4)
      const toSupervisorMode = (value) => {
        if (value === null || value === undefined) return 0;
        if (typeof value === 'number') return value;
        if (Buffer.isBuffer(value)) return value[0];
        if (typeof value === 'string') return parseInt(value, 10) || 0;
        return 0;
      };
      
      // Return user data (excluding sensitive password field)
      // supervisor is now a number (0-4) controlling capture mode:
      // 0 = digital capture + print Z
      // 1 = manual capture + print Z
      // 2 = digital capture only (no Z)
      // 3 = manual capture only (no Z)
      // 4 = manual or digital capture + print Z
      return sendJSON(res, { 
        success: true, 
        data: {
          user_id: user.userid,
          username: user.username,
          email: user.email,
          ccode: user.ccode,
          admin: toBool(user.admin),
          supervisor: toSupervisorMode(user.supervisor),
          dcode: user.dcode,
          groupid: user.groupid,
          depart: user.depart,
          // v2.10.40: expose add_members permission for member-creation gating
          add_members: toBool(user.add_members),
          // v2.11.1: expose Payments permission from real MySQL table `Users`
          can_access_payments: toBool(user.can_access_payments)
        }
      });
    }

    // ===== NEXT MEMBER ID SUGGESTION (v2.10.43, additive; v2.10.45 fix: column is mcode) =====
    // GET /api/members/next-id?device_fingerprint=...
    // Returns the next available member code for the device's ccode, preserving any
    // letter prefix and zero-padding from the most recent existing member.
    if (path === '/api/members/next-id' && method === 'GET') {
      try {
        const deviceFingerprint = (parsedUrl.query.device_fingerprint || req.headers['x-device-fingerprint'] || '').toString().trim();
        if (!deviceFingerprint) {
          return sendJSON(res, { success: false, error: 'device_fingerprint required' }, 400);
        }

        // Resolve ccode (never trust client)
        const [deviceRows] = await pool.query(
          'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
          [deviceFingerprint]
        );
        if (deviceRows.length === 0 || !deviceRows[0].authorized) {
          return sendJSON(res, { success: false, error: 'Device not authorized' }, 401);
        }
        const ccode = deviceRows[0].ccode;

        // v2.10.58: optional explicit prefix (M | D). Backward compatible:
        // when omitted, behavior matches v2.10.43–v2.10.57 (latest-row prefix).
        const rawPrefix = (parsedUrl.query.prefix || '').toString().trim().toUpperCase();
        const requestedPrefix = /^[A-Z]$/.test(rawPrefix) && (rawPrefix === 'M' || rawPrefix === 'D')
          ? rawPrefix
          : null;

        // v2.10.59: Reserved test-ID range (default 9000–9999) is excluded from
        // the next-id calculation. Operators reserve high-numbered IDs for test
        // members; auto-suggestion must skip them so it doesn't propose
        // M10000 (sitting on top of M9999) or collapse to a stale window.
        // Range can be overridden per ccode via psettings.reserved_testid_min /
        // reserved_testid_max (additive — if columns missing, defaults apply).
        let reservedMin = 9000;
        let reservedMax = 9999;
        try {
          const [psRows] = await pool.query(
            `SELECT
               CAST(reserved_testid_min AS UNSIGNED) AS rmin,
               CAST(reserved_testid_max AS UNSIGNED) AS rmax
             FROM psettings WHERE cno = ? LIMIT 1`,
            [ccode]
          );
          if (psRows && psRows[0]) {
            const rmin = Number(psRows[0].rmin);
            const rmax = Number(psRows[0].rmax);
            if (rmin > 0 && rmax > 0 && rmax >= rmin) {
              reservedMin = rmin;
              reservedMax = rmax;
            }
          }
        } catch (psErr) {
          // psettings columns may not exist on this deployment — keep defaults silently
        }

        // Pull recent mcodes for this ccode. When a prefix is requested, scope
        // the query to that prefix so we never miss the latest same-prefix row.
        let rows;
        if (requestedPrefix) {
          [rows] = await pool.query(
            `SELECT mcode FROM cm_members
             WHERE ccode = ? AND mcode IS NOT NULL AND mcode <> ''
               AND mcode LIKE ?
             ORDER BY id DESC LIMIT 200`,
            [ccode, `${requestedPrefix}%`]
          );
        } else {
          [rows] = await pool.query(
            `SELECT mcode FROM cm_members
             WHERE ccode = ? AND mcode IS NOT NULL AND mcode <> ''
             ORDER BY id DESC LIMIT 200`,
            [ccode]
          );
        }

        // Default if no members exist yet
        let prefix = requestedPrefix || 'M';
        let padLength = 5;
        let nextNumber = 1;
        let jumped = false;

        // v2.10.59: Prefix-scoped branch uses true SQL MAX (across ALL rows,
        // not just the recent 200) and excludes the reserved test range.
        // Legacy branch (no prefix) preserves v2.10.43–v2.10.58 behavior so
        // older clients see no change.
        if (requestedPrefix) {
          // Detect padding from the most recent same-prefix non-reserved row
          let detectedPad = 5;
          for (const r of rows) {
            const code = String(r.mcode).trim();
            const m = code.match(/^(\D*)(\d+)$/);
            if (m && m[1] === requestedPrefix) {
              const n = parseInt(m[2], 10);
              if (!isNaN(n) && (n < reservedMin || n > reservedMax)) {
                detectedPad = m[2].length;
                break;
              }
            }
          }
          padLength = detectedPad;
          prefix = requestedPrefix;

          // True MAX numeric tail in SQL — bypasses LIMIT 200 entirely so we
          // never miss the real top member because of recent test inserts.
          // Filter: prefix + numeric-tail-only + outside reserved range.
          const prefixLen = requestedPrefix.length;
          const [maxRows] = await pool.query(
            `SELECT COALESCE(MAX(CAST(SUBSTRING(mcode, ?) AS UNSIGNED)), 0) AS max_num
             FROM cm_members
             WHERE ccode = ?
               AND mcode LIKE ?
               AND mcode REGEXP CONCAT('^', ?, '[0-9]+$')
               AND CAST(SUBSTRING(mcode, ?) AS UNSIGNED) NOT BETWEEN ? AND ?`,
            [prefixLen + 1, ccode, `${requestedPrefix}%`, requestedPrefix, prefixLen + 1, reservedMin, reservedMax]
          );
          const maxNum = Number(maxRows?.[0]?.max_num || 0);
          nextNumber = maxNum + 1;

          // Jump rule: never propose an ID inside the reserved range
          if (nextNumber >= reservedMin && nextNumber <= reservedMax) {
            nextNumber = reservedMax + 1;
            jumped = true;
          }
        } else if (rows.length > 0) {
          // Legacy path (no prefix param) — unchanged from v2.10.58
          const latest = String(rows[0].mcode).trim();
          const match = latest.match(/^(\D*)(\d+)$/);
          if (match) {
            prefix = match[1] || '';
            padLength = match[2].length;
          } else {
            prefix = '';
            padLength = Math.max(5, latest.length);
          }
          let maxNum = 0;
          for (const r of rows) {
            const code = String(r.mcode).trim();
            const m = code.match(/^(\D*)(\d+)$/);
            if (m && m[1] === prefix) {
              const n = parseInt(m[2], 10);
              if (!isNaN(n) && n > maxNum) maxNum = n;
            }
          }
          nextNumber = maxNum + 1;
        }

        const padded = String(nextNumber).padStart(padLength, '0');
        const suggested = `${prefix}${padded}`;

        return sendJSON(res, {
          success: true,
          data: {
            suggested,
            prefix,
            padLength,
            // v2.10.59: additive fields — older clients ignore these
            reservedRange: [reservedMin, reservedMax],
            jumped
          }
        });
      } catch (err) {
        // SECURITY (v2.10.83): hide internal error details from client.
        console.error('[ERROR] /api/members/next-id GET failed:', err?.message);
        return sendJSON(res, { success: false, error: 'Failed to compute next member id' }, 500);
      }
    }

    // ===== ADD MEMBER ENDPOINT (v2.10.40, additive — does not modify legacy /api/farmers POST) =====
    if (path === '/api/members' && method === 'POST') {
      try {
        const body = await parseBody(req);
        const deviceFingerprint = req.headers['x-device-fingerprint'] || body.device_fingerprint || '';
        const userId = (body.user_id || '').toString().trim();

        if (!deviceFingerprint) {
          return sendJSON(res, { success: false, error: 'Device fingerprint required' }, 400);
        }
        if (!userId) {
          return sendJSON(res, { success: false, error: 'user_id required' }, 400);
        }

        // Resolve ccode from device (never trust client)
        const [deviceRows] = await pool.query(
          'SELECT ccode, authorized FROM devSettings WHERE uniquedevcode = ?',
          [deviceFingerprint]
        );
        if (deviceRows.length === 0 || !deviceRows[0].authorized) {
          return sendJSON(res, { success: false, error: 'Device not authorized' }, 401);
        }
        const ccode = deviceRows[0].ccode;

        // Verify user has add_members permission
        const [userRows] = await pool.query(
          'SELECT IFNULL(add_members, 0) AS add_members FROM Users WHERE TRIM(userid) = ? LIMIT 1',
          [userId]
        );
        if (userRows.length === 0) {
          return sendJSON(res, { success: false, error: 'User not found' }, 403);
        }
        const addPermRaw = userRows[0].add_members;
        const hasPerm = (addPermRaw === 1 || addPermRaw === '1' || addPermRaw === true ||
                         (Buffer.isBuffer(addPermRaw) && addPermRaw[0] === 1));
        if (!hasPerm) {
          return sendJSON(res, { success: false, error: 'Permission denied: add_members not enabled for this user' }, 403);
        }

        // Validate required fields
        const gender = (body.gender || '').toString().trim().toUpperCase();
        const descript = (body.descript || '').toString().trim();
        const mmcode = (body.mmcode || '').toString().trim();
        const idno = (body.idno || '').toString().trim();
        const route = (body.route || '').toString().trim();
        const multOpt = (body.multOpt === 1 || body.multOpt === '1' || body.multOpt === true) ? 1 : 0;

        if (!gender || !descript || !mmcode || !idno || !route) {
          return sendJSON(res, { success: false, error: 'Missing required fields: gender, descript, mmcode, idno, route' }, 400);
        }
        if (descript.length > 100 || mmcode.length > 50 || idno.length > 50 || route.length > 50) {
          return sendJSON(res, { success: false, error: 'Field length exceeded' }, 400);
        }

        // v2.10.53: Hard-fail on duplicate (mcode, ccode). NO silent auto-rename.
        // Operators must see exactly which ID they tried to create. The next-id
        // suggestion endpoint already prefills a unique ID; manual override that
        // collides should error loudly so the user picks a different ID.
        const [existing] = await pool.query(
          'SELECT mcode FROM cm_members WHERE TRIM(mcode) = TRIM(?) AND ccode = ? LIMIT 1',
          [mmcode, ccode]
        );
        if (existing.length > 0) {
          console.warn(`[WARN] /api/members duplicate rejected: mcode=${mmcode}, ccode=${ccode}`);
          return sendJSON(res, {
            success: false,
            error: `Member ID "${mmcode}" already exists for this company. Please use a different ID.`
          }, 409);
        }

        try {
          await pool.query(
            `INSERT INTO cm_members (mcode, descript, gender, idno, route, ccode, status, multOpt, currqty)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0)`,
            [mmcode, descript, gender, idno, route, ccode, multOpt]
          );

          console.log(`[SUCCESS] Member added: ${mmcode} (${descript}) by user=${userId}, ccode=${ccode}`);

          return sendJSON(res, {
            success: true,
            data: {
              farmer_id: mmcode,
              name: descript,
              route,
              ccode,
              multOpt,
              currqty: 0
            }
          });
        } catch (dupErr) {
          // Race-safety net: if a UNIQUE index exists and another device inserted
          // the same mcode between our pre-check and INSERT, surface 409 cleanly.
          if (dupErr && (dupErr.code === 'ER_DUP_ENTRY' || dupErr.errno === 1062)) {
            console.warn(`[WARN] /api/members race-condition duplicate: mcode=${mmcode}, ccode=${ccode}`);
            return sendJSON(res, {
              success: false,
              error: `Member ID "${mmcode}" already exists for this company. Please use a different ID.`
            }, 409);
          }
          throw dupErr;
        }
      } catch (err) {
        // SECURITY (v2.10.83): hide internal error details from client.
        console.error('[ERROR] /api/members POST failed:', err?.message);
        return sendJSON(res, { success: false, error: 'Failed to add member' }, 500);
      }
    }

    // ===== TRANSACTION PHOTOS ENDPOINT (Read-only for auditing, filtered by ccode) =====
    if (path === '/api/transaction-photos' && method === 'GET') {
      const page = parseInt(parsedUrl.query.page) || 1;
      const limit = Math.min(parseInt(parsedUrl.query.limit) || 20, 100);
      const offset = (page - 1) * limit;
      const search = parsedUrl.query.search || '';
      const dateFilter = parsedUrl.query.date || '';
      const deviceFingerprint = parsedUrl.query.device_fingerprint || '';

      // Require device_fingerprint for ccode isolation
      if (!deviceFingerprint) {
        return sendJSON(res, { success: false, error: 'Device fingerprint required' }, 400);
      }

      // Look up ccode and devcode from devSettings
      const [deviceRows] = await pool.query(
        'SELECT ccode, devcode, authorized FROM devSettings WHERE uniquedevcode = ?',
        [deviceFingerprint]
      );
      if (deviceRows.length === 0 || !deviceRows[0].authorized) {
        return sendJSON(res, { success: false, error: 'Device not authorized' }, 401);
      }
      const ccode = deviceRows[0].ccode;
      const devcode = deviceRows[0].devcode;

      // Filter by ccode; optionally by route tcode from dashboard selection
      const routeFilter = parsedUrl.query.route || '';
      let whereClause = 't.photo_filename IS NOT NULL AND t.photo_filename != "" AND t.ccode = ?';
      const params = [ccode];
      if (routeFilter) {
        whereClause += ' AND t.route = ?';
        params.push(routeFilter);
      }

      // Add search filter (member, reference, clerk)
      if (search) {
        whereClause += ' AND (t.memberno LIKE ? OR t.transrefno LIKE ? OR t.clerk LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      // Add date filter
      if (dateFilter) {
        whereClause += ' AND t.transdate = ?';
        params.push(dateFilter);
      }

      // Get total count (grouped by unique photo per member)
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM (
           SELECT t.photo_filename, t.memberno, t.transdate
           FROM transactions t WHERE ${whereClause}
           GROUP BY t.photo_filename, t.memberno, t.transdate
         ) as grouped`,
        params
      );
      const total = countResult[0]?.total || 0;

      // Get paginated results — JOIN fm_items for item descriptions
      const [rows] = await pool.query(
        `SELECT MIN(t.ID) as ID, GROUP_CONCAT(t.transrefno ORDER BY t.ID SEPARATOR ', ') as transrefnos,
                t.memberno, t.transdate, MIN(t.transtime) as transtime, t.clerk,
                SUM(t.amount) as amount, t.photo_filename, t.photo_directory,
                COUNT(*) as item_count,
                GROUP_CONCAT(CONCAT(IFNULL(i.descript, t.icode), ' (', IFNULL(t.weight, 1), ')') ORDER BY t.ID SEPARATOR ', ') as items_summary
         FROM transactions t
         LEFT JOIN fm_items i ON t.icode = i.icode AND i.ccode = t.ccode
         WHERE ${whereClause}
         GROUP BY t.photo_filename, t.memberno, t.transdate, t.clerk, t.photo_directory
         ORDER BY MIN(t.ID) DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      // Filter out rows where the photo file has been deleted from disk
      const fs = require('fs');
      const pathModule = require('path');
      const uploadsBase = pathModule.join(__dirname, '');
      const validRows = rows.filter(row => {
        if (!row.photo_directory || !row.photo_filename) return false;
        const filePath = pathModule.join(uploadsBase, row.photo_directory, row.photo_filename);
        try {
          return fs.existsSync(filePath);
        } catch {
          return false;
        }
      });

      const adjustedTotal = validRows.length < rows.length ? total - (rows.length - validRows.length) : total;
      return sendJSON(res, {
        success: true,
        data: validRows,
        total: adjustedTotal,
        page,
        limit,
        totalPages: Math.ceil(adjustedTotal / limit)
      });
    }

    // ===== PAYMENTS ENDPOINTS (v2.11.2 — quantity × price − crbal deductions) =====
    if (path === '/api/payments/payable' && method === 'GET') {
      const deviceFingerprint = parsedUrl.query.uniquedevcode || parsedUrl.query.device_fingerprint;
      const userid = parsedUrl.query.userid || parsedUrl.query.user_id;
      const access = await resolvePaymentsAccess({ deviceFingerprint, userid });
      if (!access.ok) return sendJSON(res, { success: false, error: access.error }, access.status || 403);

      const periodInput = String(parsedUrl.query.period || 'month');
      const range = await getPaymentPeriodRange(periodInput, access.ccode);
      const pricePerKg = await getCompanyPricePerKg(pool, access.ccode);

      // v2.11.3 — canonicalise once in JS; the SQL then compares the indexed
      // column raw, so idx_tx_pay_scan can drive the range scan.
      const ccodeKey = String(access.ccode || '').trim().toUpperCase();
      const endExclusive = addOneDay(range.end);
      const reqId = `payable_${Date.now().toString(36)}`;

      const cacheKey = `payable:${ccodeKey}:${range.period}:${range.start}:${range.end}:${pricePerKg}`;
      const cached = payablePayableCache.get(cacheKey);
      if (cached) {
        console.log(`[PAY][PAYABLE][CACHE] hit ccode=${ccodeKey} period=${range.period} farmers=${cached.data.length}`);
        return sendJSON(res, cached);
      }

      // Step 1 — aggregate on the indexed columns only. No LEFT JOIN, no
      // per-row CAST/UPPER/TRIM. Half-open date window keeps `transdate`
      // sargable against the composite index.
      const aggSql = `
        SELECT memberno AS farmer_code,
               SUM(weight) AS total_qty,
               COUNT(*)    AS unpaid_count
          FROM transactions
         WHERE ccode = ?
           AND transtype = 1
           AND payment_status = 'unpaid'
           AND transdate >= ? AND transdate < ?
         GROUP BY memberno
        HAVING SUM(weight) > 0
      `;

      const [aggRows] = await runWithRetry('aggregate', reqId, () =>
        pool.query(aggSql, [ccodeKey, range.start, endExclusive])
      );

      if (!aggRows || aggRows.length === 0) {
        const empty = { success: true, data: [], price_per_kg: pricePerKg, period: range };
        payablePayableCache.set(cacheKey, empty);
        console.log(`[PAY][PAYABLE] ccode=${ccodeKey} period=${range.period} ${range.start}→${range.end} price=${pricePerKg} farmers=0`);
        return sendJSON(res, empty);
      }

      // Step 2 — bounded farmer lookup, chunked at 500 codes per IN() to
      // keep the packet size within safe limits.
      const codes = aggRows.map(r => String(r.farmer_code || '').trim()).filter(Boolean);
      const memberMap = new Map(); // farmer_code(upper) → { name, crbal }
      const CHUNK = 500;
      for (let i = 0; i < codes.length; i += CHUNK) {
        const slice = codes.slice(i, i + CHUNK);
        if (slice.length === 0) continue;
        const placeholders = slice.map(() => '?').join(',');
        const [mrows] = await runWithRetry('members', reqId, () =>
          pool.query(
            `SELECT mcode, descript, crbal
               FROM cm_members
              WHERE ccode = ? AND mcode IN (${placeholders})`,
            [ccodeKey, ...slice]
          )
        );
        for (const m of mrows) {
          const key = String(m.mcode || '').trim().toUpperCase();
          if (!key) continue;
          memberMap.set(key, {
            name: String(m.descript || '').trim(),
            crbal: String(m.crbal || ''),
          });
        }
      }

      const data = aggRows.map(r => {
        const farmerCode = String(r.farmer_code || '').trim();
        const key = farmerCode.toUpperCase();
        const member = memberMap.get(key) || { name: '', crbal: '' };
        const totalQty = Number(r.total_qty || 0);
        const gross = Math.round(totalQty * pricePerKg * 100) / 100;
        const rawDeductions = parseCrbalTotal(member.crbal);
        const deductions = Math.round(Math.min(rawDeductions, gross) * 100) / 100;
        const net = Math.round((gross - deductions) * 100) / 100;
        return {
          farmer_code: farmerCode,
          farmer_name: member.name || farmerCode,
          total_qty: totalQty,
          unpaid_count: Number(r.unpaid_count || 0),
          price_per_kg: pricePerKg,
          gross_amount: gross,
          deductions,
          net_amount: net,
          total_payable: net, // backward-compat with existing UI
          payment_status: 'unpaid',
        };
      })
        .filter(r => r.net_amount > 0)
        .sort((a, b) => a.farmer_name.localeCompare(b.farmer_name));

      const payload = { success: true, data, price_per_kg: pricePerKg, period: range };
      payablePayableCache.set(cacheKey, payload);
      console.log(`[PAY][PAYABLE] ccode=${ccodeKey} period=${range.period} ${range.start}→${range.end} price=${pricePerKg} farmers=${data.length}`);
      return sendJSON(res, payload);
    }



    if (path === '/api/payments/process' && method === 'POST') {
      const body = await parseBody(req);
      const access = await resolvePaymentsAccess({
        deviceFingerprint: body.device_fingerprint || body.uniquedevcode,
        userid: body.userid || body.user_id,
      });
      if (!access.ok) return sendJSON(res, { success: false, error: access.error }, access.status || 403);

      const farmerCodes = Array.isArray(body.farmer_codes)
        ? body.farmer_codes.map(code => String(code || '').trim()).filter(Boolean).slice(0, 500)
        : [];
      if (farmerCodes.length === 0) {
        return sendJSON(res, { success: false, error: 'farmer_codes is required' }, 400);
      }

      const range = await getPaymentPeriodRange(String(body.period || 'month'), access.ccode);
      const pricePerKg = await getCompanyPricePerKg(pool, access.ccode);
      const results = [];

      for (let i = 0; i < farmerCodes.length; i++) {
        const farmerCode = farmerCodes[i];
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          const calc = await computeFarmerPayment(conn, access.ccode, farmerCode, range, pricePerKg);
          if (calc.net_amount <= 0) {
            await conn.rollback();
            results.push({
              farmer_code: farmerCode,
              payment_reference: '',
              amount: 0,
              gross_amount: calc.gross_amount,
              deductions: calc.deductions,
              net_amount: calc.net_amount,
              total_qty: calc.total_qty,
              status: 'failed',
              error: calc.gross_amount <= 0
                ? 'No unpaid quantity for selected period'
                : 'Net payable is zero after credit deductions',
            });
            continue;
          }

          const ref = makePaymentReference(access.ccode, i);
          // Insert payment (pending) with NET amount — this is the amount
          // sent to the SACCO/payment provider.
          const [insertResult] = await conn.query(
            `INSERT INTO payments
              (payment_reference, ccode, farmer_code, amount, status, payment_date, created_by)
             VALUES (?, ?, ?, ?, 'pending', NOW(), ?)`,
            [ref, access.ccode, farmerCode, calc.net_amount, access.userid]
          );
          const paymentId = insertResult.insertId;

          // Lock the source transactions into 'pending' so they can't be
          // re-selected while the SACCO call is in flight.
          await conn.query(
            `UPDATE transactions
                SET payment_id = ?, payment_status = 'pending'
              WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
                AND UPPER(TRIM(memberno)) = UPPER(TRIM(?))
                AND transtype = 1
                AND IFNULL(payment_status, 'unpaid') = 'unpaid'
                AND CAST(transdate AS DATE) BETWEEN ? AND ?`,
            [paymentId, access.ccode, farmerCode, range.start, range.end]
          );
          await conn.commit();

          // v2.11.6 — resolve KCB payout routing from cm_members.
          const [benRows] = await pool.query(
            `SELECT IFNULL(descript,'') AS descript,
                    IFNULL(tel,'')      AS tel,
                    IFNULL(bankcode,'') AS bankcode,
                    IFNULL(bnumber,'')  AS bnumber,
                    IFNULL(payment_method,'') AS payment_method
               FROM cm_members
              WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
                AND UPPER(TRIM(mcode)) = UPPER(TRIM(?))
              LIMIT 1`,
            [access.ccode, farmerCode]
          );
          const beneficiary = benRows[0] || {};
          const payMethod = String(beneficiary.payment_method || '').trim().toUpperCase();
          const bankCodeRaw = String(beneficiary.bankcode || '').trim();
          const bnumber = String(beneficiary.bnumber || '').trim();
          const tel = String(beneficiary.tel || '').trim();

          let transactionType = null;
          let beneficiaryBankCode = null;
          let creditAccountNumber = null;
          let missingReason = null;
          if (payMethod === 'MPESA') {
            transactionType = 'MO';
            beneficiaryBankCode = 'MPESA';
            creditAccountNumber = tel;
            if (!tel) missingReason = 'Missing MPESA phone number';
          } else if (payMethod === 'BANK') {
            if (!bankCodeRaw) missingReason = 'Missing bank code';
            else if (!bnumber) missingReason = 'Missing bank account number';
            else {
              transactionType = bankCodeRaw === '01' ? 'IF' : 'EF';
              beneficiaryBankCode = bankCodeRaw;
              creditAccountNumber = bnumber;
            }
          } else {
            missingReason = payMethod
              ? `Unsupported payment_method: ${payMethod}`
              : 'Missing payment_method on cm_members';
          }

          if (missingReason) {
            await conn.beginTransaction();
            await conn.query(`UPDATE payments SET status = 'failed' WHERE payment_id = ?`, [paymentId]);
            await conn.query(
              `UPDATE transactions
                  SET payment_status = 'failed'
                WHERE payment_id = ? AND payment_status = 'pending'`,
              [paymentId]
            );
            await conn.commit();
            console.warn(`[PAY][TRANSFER] skipped ref=${ref} farmer=${farmerCode} reason=${missingReason}`);
            results.push({
              farmer_code: farmerCode,
              payment_reference: ref,
              amount: calc.net_amount,
              gross_amount: calc.gross_amount,
              deductions: calc.deductions,
              net_amount: calc.net_amount,
              total_qty: calc.total_qty,
              status: 'failed',
              error: missingReason,
            });
            continue;
          }

          console.log(`[PAY][TRANSFER] farmer=${farmerCode} ref=${ref} type=${transactionType} amount=${calc.net_amount}`);
          const sacco = await chargeFarmerViaKCB({
            ref,
            amount: calc.net_amount,
            farmerName: beneficiary.descript || calc.farmer_name || farmerCode,
            accountNumber: creditAccountNumber,
            bankCode: beneficiaryBankCode,
            transactionType,
            ccode: access.ccode,
            requestId: ref,
          });

          if (!sacco?.success) {
            await conn.beginTransaction();
            await conn.query(`UPDATE payments SET status = 'failed' WHERE payment_id = ?`, [paymentId]);
            await conn.query(
              `UPDATE transactions
                  SET payment_status = 'failed'
                WHERE payment_id = ? AND payment_status = 'pending'`,
              [paymentId]
            );
            await conn.commit();
            results.push({
              farmer_code: farmerCode,
              payment_reference: ref,
              amount: calc.net_amount,
              gross_amount: calc.gross_amount,
              deductions: calc.deductions,
              net_amount: calc.net_amount,
              total_qty: calc.total_qty,
              status: 'failed',
              error: sacco?.error || sacco?.statusDescription || 'Payment declined',
            });
            continue;
          }

          // Accepted for processing by KCB. Do NOT mark as paid — the
          // /api/payments/kcb/callback endpoint finalises the status.
          // Persist the initial external reference for reconciliation.
          await conn.beginTransaction();
          await conn.query(
            `UPDATE payments
                SET external_transaction_id = ?,
                    kcb_retrieval_ref = ?,
                    kcb_ft_reference = ?,
                    kcb_merchant_id = ?
              WHERE payment_id = ?`,
            [
              sacco.external_transaction_id,
              sacco.retrievalRefNumber,
              sacco.ftReference,
              sacco.merchantID,
              paymentId,
            ]
          );
          await conn.commit();

          results.push({
            farmer_code: farmerCode,
            payment_reference: ref,
            amount: calc.net_amount,
            gross_amount: calc.gross_amount,
            deductions: calc.deductions,
            net_amount: calc.net_amount,
            total_qty: calc.total_qty,
            status: 'pending',
            external_transaction_id: sacco.external_transaction_id,
          });
        } catch (e) {
          await conn.rollback().catch(() => {});
          console.error('[PAY][PROCESS] farmer failed:', farmerCode, e?.message || e);
          results.push({
            farmer_code: farmerCode,
            payment_reference: '',
            amount: 0,
            status: 'failed',
            error: 'Payment processing failed',
          });
        } finally {
          conn.release();
        }
      }

      // v2.11.3 — any state change on this ccode makes the cached payable
      // list stale. Invalidate so the next GET reflects the new statuses.
      invalidatePayableCache(access.ccode);
      console.log(`[PAY][PROCESS] ccode=${access.ccode} userid=${access.userid} period=${range.period} price=${pricePerKg} requested=${farmerCodes.length}`);
      return sendJSON(res, { success: true, data: results });
    }

    if (path === '/api/payments/history' && method === 'GET') {
      const deviceFingerprint = parsedUrl.query.uniquedevcode || parsedUrl.query.device_fingerprint;
      const userid = parsedUrl.query.userid || parsedUrl.query.user_id;
      const access = await resolvePaymentsAccess({ deviceFingerprint, userid });
      if (!access.ok) return sendJSON(res, { success: false, error: access.error }, access.status || 403);

      const clauses = ['UPPER(TRIM(ccode)) = UPPER(TRIM(?))'];
      const params = [access.ccode];
      if (parsedUrl.query.farmer_code) {
        clauses.push('UPPER(TRIM(farmer_code)) = UPPER(TRIM(?))');
        params.push(String(parsedUrl.query.farmer_code).trim());
      }
      if (parsedUrl.query.from) {
        clauses.push('DATE(payment_date) >= ?');
        params.push(String(parsedUrl.query.from).trim());
      }
      if (parsedUrl.query.to) {
        clauses.push('DATE(payment_date) <= ?');
        params.push(String(parsedUrl.query.to).trim());
      }

      const [rows] = await pool.query(
        `SELECT payment_id, payment_reference, farmer_code, amount, status,
                DATE_FORMAT(payment_date, '%Y-%m-%d %H:%i:%s') AS payment_date,
                external_transaction_id
           FROM payments
          WHERE ${clauses.join(' AND ')}
          ORDER BY payment_date DESC
          LIMIT 500`,
        params
      );

      console.log(`[PAY][HISTORY] ccode=${access.ccode} userid=${access.userid} rows=${rows.length}`);
      return sendJSON(res, { success: true, data: rows });
    }

    // v2.11.6 — KCB Funds Transfer async callback.
    // KCB posts the final status of a transfer here. Authenticated with a
    // shared secret in the `x-kcb-callback-secret` header. Idempotent — a
    // repeat delivery for a settled payment returns { already: true }.
    if (path === '/api/payments/kcb/callback' && method === 'POST') {

    console.log("========== KCB CALLBACK RECEIVED ==========");
    console.log("HEADERS:", req.headers);

    const body = await parseBody(req);
    const fs = require('fs');

fs.appendFileSync(
  '/home/maddasys/public_html/sync-service/kcb-callback.json',
  JSON.stringify(body, null, 2) + "\n\n-------------------------\n\n"
);
    console.log("========== KCB CALLBACK RECEIVED ==========");
console.log(JSON.stringify(body, null, 2));


console.log("BODY:");
console.log(JSON.stringify(body, null, 2));
console.log("===========================================");

const ref = String(body.transactionReference || body.payment_reference || '').trim();
      if (!ref) return sendJSON(res, { success: false, error: 'transactionReference required' }, 400);

      const [rows] = await pool.query(
        `SELECT payment_id, ccode, status FROM payments WHERE payment_reference = ? LIMIT 1`,
        [ref]
      );
      if (rows.length === 0) {
        console.warn(`[PAY][CALLBACK] unknown ref=${ref}`);
        return sendJSON(res, { success: false, error: 'unknown reference' }, 404);
      }
      const row = rows[0];
      if (row.status === 'success' || row.status === 'failed') {
        console.log(`[PAY][CALLBACK] already ref=${ref} status=${row.status}`);
        return sendJSON(res, { success: true, already: true });
      }

 const transactionStatus = String(body.transactionStatus ?? '').trim().toUpperCase();
const transactionMessage = String(body.transactionMessage ?? '').trim().toUpperCase();

const statusCodeIn =
    body.statusCode ??
    body.responseCode ??
    body.status ??
    transactionStatus;

const s = String(statusCodeIn).trim().toUpperCase();

const isSuccess =
    s === '0' ||
    s === '00' ||
    s === 'SUCCESS' ||
    s === 'ACCEPTED' ||
    s === 'PAID' ||
    transactionStatus === 'SUCCESS' ||
    transactionMessage === 'SUCCESS';

const paymentStatus = isSuccess ? 'success' : 'failed';
const txStatus = isSuccess ? 'paid' : 'failed';

      const merchantID = body.merchantID ?? body.merchantId ?? null;
      const retrievalRef = body.retrievalRefNumber ?? body.retrievalReference ?? null;
      const ftReference = body.ftReference ?? null;
      const txnMessage =
    body.transactionMessage ??
    body.statusMessage ??
    body.statusDescription ??
    body.responseDescription ??
    null;
      const txnDateRaw = body.transactionDate ?? body.paymentDate ?? null;
      let txnDate = null;
      if (txnDateRaw) {
        const d = new Date(txnDateRaw);
        if (!isNaN(d.getTime())) txnDate = d.toISOString().slice(0, 19).replace('T', ' ');
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
                     
              console.error("===== CALLBACK VALUES =====");
console.error("statusCodeIn:", statusCodeIn);
console.error("paymentStatus:", paymentStatus);
console.error("txnMessage:", txnMessage);
console.error("body:", JSON.stringify(body));
console.error("===========================");
        await conn.query(
          `UPDATE payments
              SET status = ?,
 
                  external_transaction_id = COALESCE(?, external_transaction_id),
                  kcb_merchant_id = COALESCE(?, kcb_merchant_id),
                  kcb_retrieval_ref = COALESCE(?, kcb_retrieval_ref),
                  kcb_ft_reference = COALESCE(?, kcb_ft_reference),
                  kcb_transaction_message = COALESCE(?, kcb_transaction_message),
                  kcb_transaction_date = COALESCE(?, kcb_transaction_date)
            WHERE payment_id = ?`,
          [
            paymentStatus,
            retrievalRef || ftReference || null,
            merchantID,
            retrievalRef,
            ftReference,
            txnMessage ? String(txnMessage).slice(0, 255) : null,
            txnDate,
            row.payment_id,
          ]
        );
        await conn.query(
          `UPDATE transactions
              SET payment_status = ?
            WHERE payment_id = ? AND payment_status = 'pending'`,
          [txStatus, row.payment_id]
        );
        await conn.commit();
      } catch (e) {
        await conn.rollback().catch(() => {});
        throw e;
      } finally {
        conn.release();
      }

      invalidatePayableCache(row.ccode);
      console.log(`[PAY][CALLBACK] ref=${ref} status=${paymentStatus} merchant=${merchantID || 'n/a'}`);
      return sendJSON(res, { success: true, status: paymentStatus });
    }

    // ===== YETU SACCO MEMBER PAYMENTS (v2.12.0) =====
    // Additive module: webhook + member portal read APIs. Returns true when
    // the request was handled so the chain can fall through otherwise.
    if (path.startsWith('/api/yetu/')) {
      const handled = await handleYetuRoutes({ pool, path, method, req, res, parsedUrl, sendJSON });
      if (handled) return;
    }

    // 404

    sendJSON(res, { success: false, error: 'Endpoint not found' }, 404);

  } catch (error) {
    console.error(error);
    const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // v2.10.108: detect DB-busy / pool-pressure and respond with a fast,
    // retryable 503 instead of a generic 500. The client's resilientFetch
    // already retries 5xx with backoff, so this turns silent hangs into
    // graceful degradation when MYSQL max_user_connections (=40 on cPanel)
    // is approached.
    if (isPoolPressureError(error)) {
      console.warn('[DB_BUSY]', {
        requestId,
        method,
        path,
        code: /** @type {any} */ (error).code,
        errno: /** @type {any} */ (error).errno,
      });
      return sendJSON(
        res,
        { success: false, error: 'db_busy', retryable: true, requestId },
        503
      );
    }

    // Log full details to stderr (this is what you want to see in cPanel/Passenger logs)
    console.error('[ERROR]', {
      requestId,
      method,
      path,
      query: parsedUrl.query,
      error: errorToPlainObject(error),
    });

    // Keep response safe/minimal for clients (but include requestId to correlate)
    sendJSON(
      res,
      {
        success: false,
        error: 'Server error',
        requestId,
      },
      500
    );
  }
});

// v2.10.119 (backend hotfix): HTTP keep-alive idle reaper. Node fires this
// callback when a socket sits idle (no request in flight) for
// REQUEST_TIMEOUT_MS ms — typical for Capacitor clients between API calls.
// We silently destroy the idle socket so it doesn't linger; the client
// transparently reopens a new connection on its next request. Previously
// this path warned on every idle close, flooding stderr with harmless
// "[TIMEOUT] socket idle" lines. NOTE: this is socket-level only — it does
// NOT bound in-flight request duration or hold MySQL pool slots; those
// are guarded separately by request body / handler timeouts.
const PORT = process.env.PORT || 3000;
server.setTimeout(REQUEST_TIMEOUT_MS, (socket) => {
  try { socket.destroy(); } catch (_) { /* noop */ }
});
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT} (pool=${POOL_LIMIT}, queue=${QUEUE_LIMIT}, timeout=${REQUEST_TIMEOUT_MS}ms)`));
