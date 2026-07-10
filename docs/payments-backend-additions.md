# v2.11.0 — Payments module backend additions

The web/APK frontend now ships a Payments module. These SQL migrations and
Express routes must be applied to `server.js` for the module to work in
production. The workflow is designed so the client contract does **not**
change when the mock SACCO service is swapped for the real integration.

Everything here is **additive**. No existing column, endpoint, or row is
altered. Legacy APKs remain fully compatible.

---

## 1. SQL migration

```sql
-- psettings: per-company activation flag
ALTER TABLE psettings
  ADD COLUMN IF NOT EXISTS payments_active TINYINT(1) NOT NULL DEFAULT 0;

-- users: per-user permission gate
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_access_payments TINYINT(1) NOT NULL DEFAULT 0;

-- payments table
CREATE TABLE IF NOT EXISTS payments (
  payment_id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  payment_reference       VARCHAR(40)  NOT NULL UNIQUE,
  ccode                   VARCHAR(20)  NOT NULL,
  farmer_code             VARCHAR(40)  NOT NULL,
  amount                  DECIMAL(14,2) NOT NULL,
  status                  ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  payment_date            DATETIME     NOT NULL,
  external_transaction_id VARCHAR(80)  NULL,
  created_by              VARCHAR(40)  NULL,
  created_at              TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pay_ccode_farmer (ccode, farmer_code),
  INDEX idx_pay_ccode_status (ccode, status),
  INDEX idx_pay_ccode_date   (ccode, payment_date)
);

-- transactions: link to payment + payment_status flag
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS payment_status ENUM('unpaid','paid') NOT NULL DEFAULT 'unpaid',
  ADD INDEX idx_txn_payment_lookup (ccode, payment_status, memberno);
```

Existing rows default to `unpaid`. No data migration is required.

Include `payments_active` in every `/api/device-settings` (or equivalent
psettings) response payload under `app_settings.payments_active` so the
frontend picks it up. The frontend already reads `deviceData.app_settings
.payments_active` (see `useAppSettings.ts`).

Include `can_access_payments` on the user record returned by `/api/login` so
`AppUser.can_access_payments` is populated.

---

## 2. Mock SACCO service (`services/saccoPaymentService.js`)

The single swap point. Replace `chargeFarmer` internals with the real SACCO
HTTP call — nothing else changes.

```js
// server-side: services/saccoPaymentService.js
const MODE = process.env.SACCO_MODE || 'mock';

async function chargeFarmer({ ref, amount, farmer_code, ccode }) {
  if (MODE === 'mock') {
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    return {
      success: true,
      external_transaction_id: `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    };
  }
  // TODO(SACCO API): real integration here. Must return the same shape.
  throw new Error('SACCO live mode not implemented');
}

module.exports = { chargeFarmer };
```

---

## 3. Express routes (add to `server.js`)

All routes strictly filter by JWT `ccode`, and refuse to run when
`psettings.payments_active !== 1` or `users.can_access_payments !== 1`.

```js
// server.js — additive block, do not modify existing routes
const { chargeFarmer } = require('./services/saccoPaymentService');

function periodRange(period) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start;
  if (period === 'day')    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'week') {
    const d = now.getDay() || 7; // Mon-based
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d - 1));
  }
  else if (period === 'month')  start = new Date(now.getFullYear(), now.getMonth(), 1);
  else /* season */             start = new Date(now.getTime() - 90 * 86400 * 1000);
  return { start, end };
}

async function assertPaymentsAccess(req, res) {
  const ccode = req.auth.ccode;
  const userId = req.auth.user_id;
  const [[ps]] = await pool.query('SELECT payments_active FROM psettings WHERE ccode = ?', [ccode]);
  if (!ps || ps.payments_active !== 1) { res.status(403).json({ success:false, error:'payments not active' }); return false; }
  const [[u]]  = await pool.query('SELECT can_access_payments FROM users WHERE user_id = ? AND ccode = ?', [userId, ccode]);
  if (!u || u.can_access_payments !== 1) { res.status(403).json({ success:false, error:'not authorized' }); return false; }
  return true;
}

// GET /api/payments/payable?period=day|week|month|season
app.get('/api/payments/payable', authenticateJWT, async (req, res) => {
  if (!(await assertPaymentsAccess(req, res))) return;
  const ccode = req.auth.ccode;
  const period = ['day','week','month','season'].includes(req.query.period) ? req.query.period : 'month';
  const { start, end } = periodRange(period);
  const [rows] = await pool.query(
    `SELECT t.memberno AS farmer_code,
            COALESCE(m.descript, t.memberno) AS farmer_name,
            ROUND(SUM(CAST(t.amount AS DECIMAL(14,2))), 2) AS total_payable,
            COUNT(*) AS unpaid_count,
            'unpaid' AS payment_status
       FROM transactions t
       LEFT JOIN cm_members m ON m.mmcode = t.memberno AND m.ccode = t.ccode
      WHERE t.ccode = ?
        AND t.payment_status = 'unpaid'
        AND CAST(t.transdate AS DATETIME) BETWEEN ? AND ?
      GROUP BY t.memberno
      HAVING total_payable > 0
      ORDER BY farmer_name`,
    [ccode, start, end]
  );
  res.json({ success:true, data: rows });
});

// POST /api/payments/process  { farmer_codes: [...], period }
app.post('/api/payments/process', authenticateJWT, async (req, res) => {
  if (!(await assertPaymentsAccess(req, res))) return;
  const ccode = req.auth.ccode;
  const userId = req.auth.user_id;
  const period = ['day','week','month','season'].includes(req.body.period) ? req.body.period : 'month';
  const farmerCodes = Array.isArray(req.body.farmer_codes) ? req.body.farmer_codes.slice(0, 500) : [];
  if (farmerCodes.length === 0) return res.status(400).json({ success:false, error:'no farmers' });
  const { start, end } = periodRange(period);
  const yymmdd = new Date().toISOString().slice(2,10).replace(/-/g,'');
  const results = [];

  for (const code of farmerCodes) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [[sum]] = await conn.query(
        `SELECT ROUND(SUM(CAST(amount AS DECIMAL(14,2))),2) AS total
           FROM transactions
          WHERE ccode = ? AND memberno = ? AND payment_status='unpaid'
            AND CAST(transdate AS DATETIME) BETWEEN ? AND ?`,
        [ccode, code, start, end]
      );
      const amount = Number(sum?.total || 0);
      if (amount <= 0) {
        await conn.rollback();
        results.push({ farmer_code: code, payment_reference:'', amount:0, status:'failed', error:'no unpaid transactions' });
        continue;
      }
      const ref = `PMT-${ccode}-${yymmdd}-${String(Date.now()).slice(-6)}`;
      const [ins] = await conn.query(
        `INSERT INTO payments (payment_reference, ccode, farmer_code, amount, status, payment_date, created_by)
         VALUES (?, ?, ?, ?, 'pending', NOW(), ?)`,
        [ref, ccode, code, amount, userId]
      );
      const paymentId = ins.insertId;
      const sacco = await chargeFarmer({ ref, amount, farmer_code: code, ccode });
      if (!sacco?.success) {
        await conn.query(`UPDATE payments SET status='failed' WHERE payment_id = ?`, [paymentId]);
        await conn.commit();
        results.push({ farmer_code: code, payment_reference: ref, amount, status:'failed', error:'SACCO declined' });
        continue;
      }
      await conn.query(
        `UPDATE payments SET status='success', external_transaction_id = ? WHERE payment_id = ?`,
        [sacco.external_transaction_id, paymentId]
      );
      await conn.query(
        `UPDATE transactions
            SET payment_id = ?, payment_status='paid'
          WHERE ccode = ? AND memberno = ? AND payment_status='unpaid'
            AND CAST(transdate AS DATETIME) BETWEEN ? AND ?`,
        [paymentId, ccode, code, start, end]
      );
      await conn.commit();
      results.push({
        farmer_code: code,
        payment_reference: ref,
        amount,
        status: 'success',
        external_transaction_id: sacco.external_transaction_id,
      });
    } catch (e) {
      await conn.rollback().catch(()=>{});
      results.push({ farmer_code: code, payment_reference:'', amount:0, status:'failed', error: e.message });
    } finally {
      conn.release();
    }
  }
  res.json({ success:true, data: results });
});

// GET /api/payments/history?farmer_code=&from=&to=
app.get('/api/payments/history', authenticateJWT, async (req, res) => {
  if (!(await assertPaymentsAccess(req, res))) return;
  const ccode = req.auth.ccode;
  const { farmer_code, from, to } = req.query;
  const clauses = ['ccode = ?']; const args = [ccode];
  if (farmer_code) { clauses.push('farmer_code = ?'); args.push(farmer_code); }
  if (from)        { clauses.push('payment_date >= ?'); args.push(from); }
  if (to)          { clauses.push('payment_date <= ?'); args.push(to); }
  const [rows] = await pool.query(
    `SELECT payment_id, payment_reference, farmer_code, amount, status, payment_date, external_transaction_id
       FROM payments WHERE ${clauses.join(' AND ')} ORDER BY payment_date DESC LIMIT 500`,
    args
  );
  res.json({ success:true, data: rows });
});
```

---

## 4. Rollout order

1. Apply SQL migration (all columns default-safe).
2. Deploy `services/saccoPaymentService.js` in mock mode (`SACCO_MODE=mock`).
3. Deploy the three routes.
4. Flip `psettings.payments_active = 1` for the pilot company.
5. Set `users.can_access_payments = 1` for authorized users.
6. Verify end-to-end with the mock. Swap `chargeFarmer` to live when ready.

Until step 3 the frontend transparently shows an empty payables list with a
helpful "backend not deployed yet" message — nothing crashes, nothing else
breaks.
