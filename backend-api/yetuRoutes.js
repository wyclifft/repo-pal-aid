/**
 * v2.12.0 — Yetu Sacco routes.
 *
 * Registered from server.js as a single handler in the existing manual
 * routing chain:
 *
 *   POST /api/yetu/callback        (webhook — deposits only)
 *   GET  /api/yetu/transactions    (member portal, paginated/filtered)
 *   GET  /api/yetu/summary         (member portal summary cards)
 *
 * Returns `true` when the request was handled, `false` otherwise so the
 * caller can continue matching other routes.
 */
const { verifyYetuRequest, describeAuthHeaders } = require('./yetuAuth');
const svc = require('./yetuService');

// Exact response envelope required by Yetu Sacco.
const YETU_ACK = {
  result: '0',
  response: 'success',
  message: 'Request received successfully',
};

const MAX_BODY_BYTES = 256 * 1024;

const readRawBody = (req) => new Promise((resolve) => {
  let data = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    data += chunk.toString();
    if (data.length > MAX_BODY_BYTES) { tooLarge = true; data = ''; }
  });
  req.on('end', () => resolve(tooLarge ? '' : data));
  req.on('error', () => resolve(''));
});

const toDbBool = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return Boolean(value);
};

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  (req.socket && req.socket.remoteAddress) ||
  null;

/**
 * Portal access gate: authorized device + Sacco org type + payments active +
 * per-user permission. Also resolves the member account the user may read.
 */
const resolveSaccoAccess = async (pool, { deviceFingerprint, userid }) => {
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

  // v2.12.7 — psettings is keyed by `cno` (there is no `ccode` column).
  const [settingsRows] = await pool.query(
    `SELECT IFNULL(payments_active, 0) AS payments_active, IFNULL(orgtype, 'D') AS orgtype
       FROM psettings WHERE UPPER(TRIM(cno)) = UPPER(TRIM(?)) LIMIT 1`,
    [ccode]
  );
  if (settingsRows.length === 0) return { ok: false, status: 403, error: 'Company not configured' };
  if (String(settingsRows[0].orgtype || '').trim().toUpperCase() !== 'S') {
    return { ok: false, status: 403, error: 'Sacco module not supported for this organization' };
  }
  if (!toDbBool(settingsRows[0].payments_active)) {
    return { ok: false, status: 403, error: 'Payments not active for this company' };
  }

  const [userRows] = await pool.query(
    `SELECT IFNULL(can_access_payments, 0) AS can_access_payments, link_account
       FROM Users
      WHERE TRIM(userid) = ? AND UPPER(TRIM(ccode)) = UPPER(TRIM(?))
      LIMIT 1`,
    [userId, ccode]
  );
  if (userRows.length === 0 || !toDbBool(userRows[0].can_access_payments)) {
    return { ok: false, status: 403, error: 'Payment permission denied' };
  }

  const accountNumber = String(userRows[0].link_account || '').trim();
  if (!accountNumber) {
    return { ok: false, status: 403, error: 'No Sacco account is linked to this user' };
  }

  return { ok: true, ccode, userid: userId, accountNumber };
};

const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

/**
 * @returns {Promise<boolean>} handled
 */
const handleYetuRoutes = async ({ pool, path, method, req, res, parsedUrl, sendJSON }) => {
  // ── Webhook ───────────────────────────────────────────────────────────────
  if (path === '/api/yetu/callback' && method === 'POST') {
    const rawBody = await readRawBody(req);
    let body = {};
    try { body = JSON.parse(rawBody); } catch { body = {}; }

    const logId = await svc.logWebhookRequest(pool, {
      sourceIp: clientIp(req),
      endpoint: path,
      rawBody,
      rawHeaders: JSON.stringify({ auth: describeAuthHeaders(req.headers), 'content-type': req.headers['content-type'] }),
      transactionReference: null,
    });

    const auth = verifyYetuRequest(req, rawBody);
    if (!auth.ok) {
      await svc.finalizeWebhookLog(pool, logId, { outcome: 'invalid', httpStatus: 401, error: auth.reason });
      console.warn('[YETU][CALLBACK] rejected reason=%s', auth.reason);
      return sendJSON(res, { result: '1', response: 'failed', message: 'Unauthorized' }, 401), true;
    }

    const payload = svc.normalizeYetuPayload(body);
    const errors = svc.validateYetuPayload(payload);
    if (errors.length > 0) {
      await svc.finalizeWebhookLog(pool, logId, {
        outcome: 'invalid', httpStatus: 400, reference: payload.reference || null, error: errors.join('; '),
      });
      console.warn('[YETU][CALLBACK] invalid payload:', errors.join('; '));
      return sendJSON(res, { result: '1', response: 'failed', message: errors.join('; ') }, 400), true;
    }

    try {
      const result = await svc.storeDeposit(pool, payload, rawBody);
      await svc.finalizeWebhookLog(pool, logId, {
        outcome: result.duplicate ? 'duplicate' : 'accepted',
        httpStatus: 200,
        reference: payload.reference,
      });
      console.log(
        '[YETU][CALLBACK] ref=%s account=%s amount=%s %s%s',
        payload.reference, payload.accountNumber, payload.amount,
        result.duplicate ? 'duplicate(no-op)' : 'stored',
        result.allocated ? '' : ' [unallocated]'
      );
      // Yetu always receives the exact success envelope for accepted payloads.
      return sendJSON(res, YETU_ACK, 200), true;
    } catch (e) {
      await svc.finalizeWebhookLog(pool, logId, {
        outcome: 'error', httpStatus: 500, reference: payload.reference, error: e && e.message,
      });
      console.error('[YETU][CALLBACK] store failed:', e && e.message);
      return sendJSON(res, { result: '1', response: 'failed', message: 'Internal error' }, 500), true;
    }
  }

  // ── Member portal: transactions ───────────────────────────────────────────
  if (path === '/api/yetu/transactions' && method === 'GET') {
    const q = parsedUrl.query || {};
    const access = await resolveSaccoAccess(pool, {
      deviceFingerprint: q.uniquedevcode || q.device_fingerprint,
      userid: q.userid || q.user_id,
    });
    if (!access.ok) return sendJSON(res, { success: false, error: access.error }, access.status || 403), true;

    const from = isYmd(q.from) ? q.from : null;
    const to = isYmd(q.to) ? q.to : null;

    const result = await svc.listTransactions(pool, {
      ccode: access.ccode,
      accountNumber: access.accountNumber,
      page: q.page,
      limit: q.limit,
      search: String(q.search || '').slice(0, 80),
      from,
      to,
      sort: q.sort,
      order: q.order,
    });

    console.log('[YETU][TXNS] ccode=%s account=%s page=%s rows=%s', access.ccode, access.accountNumber, result.page, result.data.length);
    return sendJSON(res, { success: true, ...result }), true;
  }

  // ── Member portal: summary ────────────────────────────────────────────────
  if (path === '/api/yetu/summary' && method === 'GET') {
    const q = parsedUrl.query || {};
    const access = await resolveSaccoAccess(pool, {
      deviceFingerprint: q.uniquedevcode || q.device_fingerprint,
      userid: q.userid || q.user_id,
    });
    if (!access.ok) return sendJSON(res, { success: false, error: access.error }, access.status || 403), true;

    const summary = await svc.getSummary(pool, { ccode: access.ccode, accountNumber: access.accountNumber });
    return sendJSON(res, { success: true, data: { ...summary, account_number: access.accountNumber } }), true;
  }

  return false;
};

module.exports = { handleYetuRoutes, resolveSaccoAccess, YETU_ACK };
