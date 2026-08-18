
const mysql = require('mysql2/promise');
require('dotenv').config({ path: __dirname + '/../.env' });

/**
 * v2.12.19 — Query Plan Verification Script
 * This script runs EXPLAIN on the refactored queries to ensure they hit the new indexes.
 */
async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1
  });

  const testCcode = 'TEST001';
  const testFarmer = 'F001';
  const testDate = '2026-08-01';

  const queries = [
    {
      name: 'Farmer Cumulative Frequency (SARGable)',
      sql: `EXPLAIN SELECT IFNULL(SUM(weight), 0) FROM transactions
            WHERE memberno = ? AND ccode = ? AND Transtype = 1
            AND transdate BETWEEN ? AND ?`,
      params: [testFarmer, testCcode, testDate, testDate]
    },
    {
      name: 'Z-Report / Sync Scan (SARGable)',
      sql: `EXPLAIN SELECT transrefno FROM transactions
            WHERE transdate = ? AND Transtype = 1 AND ccode = ?`,
      params: [testDate, testCcode]
    },
    {
        name: 'Farmer Detail Report (SARGable)',
        sql: `EXPLAIN SELECT t.transdate FROM transactions t
              WHERE t.memberno = ? AND t.Transtype = 1 AND t.transdate BETWEEN ? AND ? AND t.ccode = ?`,
        params: [testFarmer, testDate, testDate, testCcode]
    }
  ];

  console.log('--- EXPLAIN Plan Verification ---');
  for (const q of queries) {
    try {
      const [rows] = await pool.query(q.sql, q.params);
      console.log(`\nQuery: ${q.name}`);
      console.table(rows.map(r => ({
        table: r.table,
        type: r.type,
        key: r.key,
        ref: r.ref,
        rows: r.rows,
        Extra: r.Extra
      })));

      const usesIndex = rows.some(r => r.key && r.key !== 'NULL');
      if (usesIndex) {
        console.log('✅ PASS: Index usage detected.');
      } else {
        console.log('❌ FAIL: Full table scan detected (key is NULL).');
      }
    } catch (err) {
      console.error(`Error verifying ${q.name}:`, err.message);
    }
  }

  await pool.end();
}

run();
