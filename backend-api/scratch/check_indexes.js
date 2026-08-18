
const mysql = require('mysql2/promise');
require('dotenv').config({ path: __dirname + '/../.env' });

async function run() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    connectionLimit: 1
  });

  try {
    const [rows] = await pool.query('SHOW INDEX FROM transactions');
    console.log('Indexes on transactions:');
    rows.forEach(row => {
      console.log(`- ${row.Key_name}: ${row.Column_name}`);
    });

    const [memberRows] = await pool.query('SHOW INDEX FROM cm_members');
    console.log('\nIndexes on cm_members:');
    memberRows.forEach(row => {
      console.log(`- ${row.Key_name}: ${row.Column_name}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
