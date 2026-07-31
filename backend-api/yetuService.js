/**
 * v2.12.0 — Yetu Sacco service layer.
 *
 * Responsibilities:
 *   • Tolerant normalisation of the inbound webhook payload.
 *   • Company (ccode) + member resolution from the account number.
 *   • Idempotent persistence of deposits.
 *   • Read models for the member portal (transactions + summary).
 *
 * Yetu Sacco has confirmed the webhook carries DEPOSITS ONLY, so every
 * accepted payload is stored as a successful `deposit`. The `txn_type`
 * column already exists so withdrawals can be added later without redesign.
 */

// ── Payload normalisation ───────────────────────────────────────────────────

const pick = (obj, keys) => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      return obj[key];
    }
  }
  return undefined;
};

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** Accepts ISO, "YYYY-MM-DD HH:mm:ss", epoch seconds/ms. Falls back to now. */
const parseTimestamp = (value) => {
  const raw = str(value);
  if (!raw) return new Date();
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  const normalised = raw.replace(' ', 'T');
  const d = new Date(normalised);
  if (!isNaN(d.getTime())) return d;
  const d2 = new Date(raw);
  return isNaN(d2.getTime()) ? new Date() : d2;
};

const toMysqlDateTime = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};

/**
 * Maps the many possible field spellings Yetu may use onto our canonical
 * shape. Unknown extra fields are preserved via raw_payload.
 */
const normalizeYetuPayload = (body = {}) => {
  const reference = str(pick(body, [
    'transaction_reference', 'transactionReference', 'transactionRef', 'trans_ref',
    'reference', 'transactionId', 'transaction_id', 'receipt_number', 'receiptNumber',
  ]));
  const accountNumber = str(pick(body, [
    'member_number', 'memberNumber', 'account_number', 'accountNumber',
    'member_no', 'memberNo', 'account', 'billRefNumber', 'bill_ref_number',
  ]));
  const amountRaw = pick(body, ['amount', 'transaction_amount', 'transactionAmount', 'transAmount', 'value']);
  const payerName = str(pick(body, ['payer_name', 'payerName', 'customer_name', 'customerName', 'name', 'fullName']));
  const payerMobile = str(pick(body, ['payer_mobile', 'payerMobile', 'msisdn', 'phone', 'phone_number', 'phoneNumber', 'mobile']));
  const timestamp = parseTimestamp(pick(body, [
    'transaction_timestamp', 'transactionTimestamp', 'transaction_date', 'transactionDate',
    'timestamp', 'date', 'transTime', 'trans_time',
  ]));
  const channel = str(pick(body, ['channel', 'source', 'paymentChannel'])) || 'YETU';

  const amount = Number(String(amountRaw === undefined ? '' : amountRaw).replace(/[, ]/g, ''));

  return {
    reference,
    accountNumber,
    amount,
    payerName: payerName || null,
    payerMobile: payerMobile || null,
    transactionDate: toMysqlDateTime(timestamp),
    channel,
    txnType: 'deposit',
  };
};

/** @returns {string[]} list of validation errors (empty = valid) */
const validateYetuPayload = (p) => {
  const errors = [];
  if (!p.reference) errors.push('transaction reference is required');
  else if (p.reference.length > 80) errors.push('transaction reference too long');
  if (!p.accountNumber) errors.push('member/account number is required');
  else if (p.accountNumber.length > 60) errors.push('member/account number too long');
  if (!isFinite(p.amount)) errors.push('amount must be numeric');
  else if (p.amount <= 0) errors.push('amount must be greater than zero');
  return errors;
};

// ── Persistence ─────────────────────────────────────────────────────────────

const logWebhookRequest = async (pool, entry) => {
  try {
    const [result] = await pool.query(
      `INSERT INTO yetu_webhook_logs
         (source_ip, endpoint, outcome, transaction_reference, raw_body, raw_headers)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.sourceIp || null,
        entry.endpoint,
        'received',
        entry.transactionReference || null,
        (entry.rawBody || '').slice(0, 60000),
        (entry.rawHeaders || '').slice(0, 4000),
      ]
    );
    return result.insertId;
  } catch (e) {
    console.error('[YETU][LOG] failed to persist webhook log:', e && e.message);
    return null;
  }
};

const finalizeWebhookLog = async (pool, logId, { outcome, httpStatus, reference, error }) => {
  if (!logId) return;
  try {
    await pool.query(
      `UPDATE yetu_webhook_logs
          SET outcome = ?, http_status = ?, transaction_reference = COALESCE(?, transaction_reference),
              error_message = ?
        WHERE log_id = ?`,
      [outcome, httpStatus || null, reference || null, error ? String(error).slice(0, 255) : null, logId]
    );
  } catch (e) {
    console.error('[YETU][LOG] failed to finalise webhook log:', e && e.message);
  }
};

/**
 * Resolve the owning company + member for an account number.
 * Falls back to the configured Sacco company so unmatched deposits are still
 * captured (allocation_status = 'unallocated') and can be reconciled later.
 */
const resolveMember = async (pool, accountNumber) => {
  const [rows] = await pool.query(
    `SELECT member_id, ccode FROM sacco_members
      WHERE UPPER(TRIM(account_number)) = UPPER(TRIM(?)) AND status = 'active'
      LIMIT 1`,
    [accountNumber]
  );
  if (rows.length > 0) {
    return { memberId: rows[0].member_id, ccode: String(rows[0].ccode || '').trim(), allocated: true };
  }

  let ccode = String(process.env.YETU_DEFAULT_CCODE || '').trim();
  if (!ccode) {
    const [companies] = await pool.query(
      `SELECT ccode FROM psettings WHERE UPPER(TRIM(orgtype)) = 'S' ORDER BY ccode LIMIT 1`
    );
    ccode = companies.length > 0 ? String(companies[0].ccode || '').trim() : '';
  }
  return { memberId: null, ccode, allocated: false };
};

/**
 * Idempotent insert. A replayed reference is a no-op.
 * @returns {{ stored: boolean, duplicate: boolean, txnId?: number }}
 */
const storeDeposit = async (pool, payload, rawBody) => {
  const { memberId, ccode, allocated } = await resolveMember(pool, payload.accountNumber);
  if (!ccode) {
    throw new Error('no Sacco company configured (psettings.orgtype = "S")');
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO sacco_transactions
         (ccode, member_id, account_number_raw, transaction_reference, amount,
          payer_name, payer_mobile, transaction_date, channel, txn_type,
          allocation_status, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ccode,
        memberId,
        payload.accountNumber,
        payload.reference,
        payload.amount,
        payload.payerName,
        payload.payerMobile,
        payload.transactionDate,
        payload.channel,
        payload.txnType,
        allocated ? 'allocated' : 'unallocated',
        (rawBody || '').slice(0, 60000),
      ]
    );
    return { stored: true, duplicate: false, txnId: result.insertId, ccode, allocated };
  } catch (e) {
    if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
      return { stored: false, duplicate: true, ccode, allocated };
    }
    throw e;
  }
};

// ── Read models (member portal) ─────────────────────────────────────────────

const SORTABLE = {
  transaction_date: 'transaction_date',
  amount: 'amount',
  payer_name: 'payer_name',
  transaction_reference: 'transaction_reference',
};

/**
 * Always scoped to (ccode, account_number) resolved server-side from the
 * authenticated user — the client can never request another member's rows.
 */
const listTransactions = async (pool, { ccode, accountNumber, page, limit, search, from, to, sort, order }) => {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (safePage - 1) * safeLimit;
  const sortCol = SORTABLE[String(sort || '').toLowerCase()] || 'transaction_date';
  const sortDir = String(order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const where = [`UPPER(TRIM(ccode)) = UPPER(TRIM(?))`, `UPPER(TRIM(account_number_raw)) = UPPER(TRIM(?))`];
  const params = [ccode, accountNumber];

  const term = String(search || '').trim();
  if (term) {
    where.push(`(transaction_reference LIKE ? OR payer_name LIKE ? OR payer_mobile LIKE ?)`);
    const like = `%${term}%`;
    params.push(like, like, like);
  }
  if (from) { where.push(`transaction_date >= ?`); params.push(`${from} 00:00:00`); }
  if (to) { where.push(`transaction_date <= ?`); params.push(`${to} 23:59:59`); }

  const whereSql = where.join(' AND ');

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total, IFNULL(SUM(amount), 0) AS filtered_total
       FROM sacco_transactions WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0].total) || 0;

  const [rows] = await pool.query(
    `SELECT txn_id, transaction_reference, amount, payer_name, payer_mobile,
            transaction_date, channel, txn_type, allocation_status
       FROM sacco_transactions
      WHERE ${whereSql}
      ORDER BY ${sortCol} ${sortDir}, txn_id ${sortDir}
      LIMIT ? OFFSET ?`,
    [...params, safeLimit, offset]
  );

  return {
    data: rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
    filteredTotal: Number(countRows[0].filtered_total) || 0,
  };
};

const getSummary = async (pool, { ccode, accountNumber }) => {
  const [rows] = await pool.query(
    `SELECT
        IFNULL(SUM(amount), 0) AS lifetime_total,
        COUNT(*) AS lifetime_count,
        IFNULL(SUM(CASE WHEN YEAR(transaction_date) = YEAR(CURDATE())
                         AND MONTH(transaction_date) = MONTH(CURDATE())
                        THEN amount ELSE 0 END), 0) AS month_total,
        IFNULL(SUM(CASE WHEN YEAR(transaction_date) = YEAR(CURDATE())
                        THEN amount ELSE 0 END), 0) AS year_total,
        MAX(transaction_date) AS last_deposit_date
       FROM sacco_transactions
      WHERE UPPER(TRIM(ccode)) = UPPER(TRIM(?))
        AND UPPER(TRIM(account_number_raw)) = UPPER(TRIM(?))`,
    [ccode, accountNumber]
  );
  const r = rows[0] || {};
  return {
    lifetime_total: Number(r.lifetime_total) || 0,
    lifetime_count: Number(r.lifetime_count) || 0,
    month_total: Number(r.month_total) || 0,
    year_total: Number(r.year_total) || 0,
    last_deposit_date: r.last_deposit_date || null,
  };
};

module.exports = {
  normalizeYetuPayload,
  validateYetuPayload,
  logWebhookRequest,
  finalizeWebhookLog,
  resolveMember,
  storeDeposit,
  listTransactions,
  getSummary,
};
